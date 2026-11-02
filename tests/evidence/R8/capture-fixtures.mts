//   BASE=<page> pnpm exec tsx tests/evidence/R8/capture-fixtures.mts tests/unit/fixtures/r8-runs
// Captures real sandbox runs (the U3 mock server, $0) as fixtures for the R8 unit tests.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { U1_EXAMPLE } from "../../../web/u1-example";
const R = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
// BASE: the page (vite) in front of tests/evidence/U3/mock-server.ts.
const BASE = `${process.env.BASE ?? "http://localhost:18982"}/api`;
let session: string | null = null;
const call = async (path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-atlas-claimant": "spark", ...(session ? { "x-atlas-session": session } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const s = r.headers.get("x-atlas-session");
  if (s) session = s;
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j as any;
};
const url = { kind: "json", value: "https://shop.example/orders" };
const si = (name: string, calls: unknown[]) => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls });
const cases: Record<string, { code: string; language: "ts" | "py"; params: unknown }> = {
  example: { code: U1_EXAMPLE, language: "ts", params: { shape: "call-function", exportName: "fetchWithRetry", args: [si("fetchIt", [{ do: "throw", errorName: "Error", message: "flaky source failed" }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }] } },
  "example-returns": { code: U1_EXAMPLE, language: "ts", params: { shape: "call-function", exportName: "fetchWithRetry", args: [si("fetchIt", [{ do: "throw", errorName: "Error", message: "flaky source failed" }, { do: "return", value: { price: 42 } }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }] } },
  "example-never": { code: U1_EXAMPLE, language: "ts", params: { shape: "call-function", exportName: "fetchWithRetry", args: [si("fetchIt", [{ do: "never_settle" }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }] } },
  "orders-throws": { code: readFileSync(`${R}/tests/evidence/U3/inputs/orders.ts`, "utf8"), language: "ts", params: { shape: "call-function", exportName: "fetchAllOrders", args: [url], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 429, body: {} }] } } },
  "orders-returns": { code: readFileSync(`${R}/tests/evidence/U3/inputs/orders.ts`, "utf8"), language: "ts", params: { shape: "call-function", exportName: "fetchAllOrders", args: [url, { kind: "json", value: 2 }], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: { items: [{ id: "o1" }], nextCursor: "c2" } }, { do: "respond", status: 200, body: { items: [{ id: "o2" }], nextCursor: null } }] } } },
  "py-plan": { code: readFileSync(`${R}/tests/evidence/U3/inputs/plan_cache.py`, "utf8"), language: "py", params: { shape: "call-function", exportName: "get_user_plan", args: [{ kind: "json", value: 1 }] } },
};
const OUT = process.argv[2]!;
mkdirSync(OUT, { recursive: true });
for (const [name, c] of Object.entries(cases)) {
  session = null;
  const paste = await call("/paste", { code: c.code, language: c.language });
  const target = { ref: paste.target.ref, codeSha256: paste.target.codeSha256 };
  const ex = await call("/experiments", { target, params: c.params, quiz: true });
  const q = ex.questions[0];
  const answer = q.kind === "quiz" ? { kind: "quiz", choice: q.quiz[0].id } : { kind: "quiz", choice: "a" };
  await call("/bets", { experimentId: ex.experiment.id, who: "human", bets: [{ measures: q.measures, answer }] });
  const run = await call("/runs", { experimentId: ex.experiment.id });
  let helpers: unknown = null;
  for (let i = 0; i < 20 && helpers === null; i++) {
    try { helpers = await call(`/runs/${run.run.id}/helpers`); } catch (e) { await new Promise((r) => setTimeout(r, 300)); }
  }
  const keep = { name, language: c.language, source: c.code, outline: paste.outline, params: ex.experiment.params, run: { id: run.run.id, trace: run.run.trace, result: run.run.result, controlPassed: run.run.controlPassed, twin: run.run.twin, conditions: run.run.conditions ?? [] }, helpers };
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(keep, null, 1) + "\n");
  console.log(name, run.run.result.measured.outcome, JSON.stringify(helpers).slice(0, 160));
}
