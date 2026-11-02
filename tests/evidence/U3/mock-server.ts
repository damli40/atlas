// U3 click-through at $0: the real Atlas server (paste reader, outline, gate, quiz, sandboxes, judge, seals, proof file)
// with every MODEL call mocked. Each mocked sentence says it is a mock. Muse Wonder's mock answers after
// U3_WONDER_DELAY_MS (default 6,000 ms) so the waiting panel is seen.
// - orders.ts (fetchAllOrders): "429 twice then 200" (the walkthrough's), "429 four times" (the retry limit) and a
//   truncation test (the fake keeps saying there is a next page, maxPages 2).
// - plan_cache.py (get_user_plan): get_user_plan(True) (the walkthrough's degenerate test, now written in Python),
//   one call, and two calls (the cache's edge).
// - Muse Spark / Muse Spark Open: fixed letters (a / b).
// Run: PORT=<port> pnpm exec tsx tests/evidence/U3/mock-server.ts   then   ATLAS_API_PORT=<port> pnpm exec vite --port <port2> --strictPort
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { withInviteGate } from "../../../server/access/gate";
import { openInviteStore } from "../../../server/access/store";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";

const MOCK = process.env.U3_QUIET_MOCK ? "" : "(mocked for the U3 click-through: no model was called)";
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const url = { kind: "json", value: "https://example.com/orders" };
const page = (id: string, next: string | null) => ({ do: "respond", status: 200, body: { items: [{ id }], nextCursor: next } });
const ORDERS = {
  claim: `People expect fetchAllOrders to return every order or fail loudly; it silently stops after maxPages pages and gives up on a 4th 429 with a bare "HTTP 429".${MOCK ? ` ${MOCK}` : ""}`,
  experiments: [
    { shape: "call-function", exportName: "fetchAllOrders", args: [url], network: { replaces: "fetch", then: "throw_exhausted", calls: [{ do: "respond", status: 429, body: {} }, { do: "respond", status: 429, body: {} }, { do: "respond", status: 200, body: { items: [{ id: "o1" }, { id: "o2" }], nextCursor: null } }] } },
    { shape: "call-function", exportName: "fetchAllOrders", args: [url], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 429, body: {} }] } },
    { shape: "call-function", exportName: "fetchAllOrders", args: [url, { kind: "json", value: 2 }], network: { replaces: "fetch", then: "repeat_last", calls: [page("o1", "c2"), page("o2", "c3"), page("o3", null)] } },
  ],
};
const CLAIM_ORDERS = {
  claim: `People expect a 4th 429 to be retried like the first three; the code throws "HTTP 429" instead.${MOCK ? ` ${MOCK}` : ""}`,
  experiments: [{ shape: "call-function", exportName: "fetchAllOrders", args: [url], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 429, body: {} }] } }],
};
const one = { kind: "json", value: 1 };
const PLAN = {
  claim: `People expect get_user_plan to read the database on every call; the second call within 60 s comes from the cache in 0 ms, and the cache's clock starts before the slow read.${MOCK ? ` ${MOCK}` : ""}`,
  experiments: [
    { shape: "call-function", exportName: "get_user_plan", args: [{ kind: "json", value: true }] },
    { shape: "call-function", exportName: "get_user_plan", args: [one] },
    { shape: "call-function", exportName: "get_user_plan", args: [one], calls: [{ exportName: "get_user_plan", args: [one] }, { exportName: "get_user_plan", args: [one] }] },
  ],
};
const CLAIM_PLAN = {
  claim: `People expect the cached plan to last 60 s after the read; it expires 60 s after the read STARTED.${MOCK ? ` ${MOCK}` : ""}`,
  experiments: [{ shape: "call-function", exportName: "get_user_plan", args: [one], watchLimitMs: 120000, calls: [{ exportName: "get_user_plan", args: [one] }, { exportName: "get_user_plan", args: [one], waitMs: 59700 }] }],
};
// Round 4's driver: the cold test's getTemperature (its claim test never reaches fetch) and waitForJob (a loop that never ends).
const WEATHER = { claim: "People expect getTemperature to validate the API payload; the code does not.", experiments: [{ shape: "call-function", exportName: "getTemperature", args: [{ kind: "json", value: "Lagos" }], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: { current: { temp_c: 31 } } }] } }] };
const CLAIM_WEATHER = { claim: "People expect getTemperature to validate the API payload; the code does not.", experiments: [{ shape: "call-function", exportName: "getTemperature", args: [{ kind: "json", value: "Abuja" }], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: { current: { temp_c: "hot" } } }] } }] };
const LOOP = { claim: "People expect waitForJob to poll until the job finishes; it spins forever.", experiments: [{ shape: "call-function", exportName: "waitForJob", args: [{ kind: "json", value: { id: "a", done: false } }] }] };
// The machine's truth driver (tests/evidence/R5/truth.mjs): a paste names its test with // CASE_name.
const si = (name: string, calls: unknown[]) => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls });
const CASES: Record<string, unknown[]> = {
  panel: [{ shape: "call-function", exportName: "pad", args: [{ kind: "json", value: 1 }] }],
  fone: [{ shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }],
  gone: [{ shape: "call-function", exportName: "g", args: [{ kind: "json", value: 1 }] }],
  padded: [{ shape: "call-function", exportName: "report", args: [{ kind: "json", value: "p50" }] }],
  unusedfake: [{ shape: "call-function", exportName: "summarize", args: [si("fetchIt", [{ do: "throw", errorName: "Error", message: "boom" }])] }],
  pynested: [{ shape: "call-function", exportName: "count", args: [{ kind: "json", value: ["a", "b"] }] }],
  noarg: [{ shape: "call-function", exportName: "f", args: [] }],
  plain: [{ shape: "call-function", exportName: "f", args: [si("x", [{ do: "return", value: 1 }])] }],
  xthrows: [{ shape: "call-function", exportName: "f", args: [si("x", [{ do: "throw", errorName: "Error", message: "from fake" }])] }],
  xwait: [{ shape: "call-function", exportName: "f", args: [si("x", [{ do: "return", value: 1, afterMs: 500 }])] }],
};
const delay = Number(process.env.U3_WONDER_DELAY_MS ?? 6000);
const EXAMPLE = {
  claim: `People expect fetchWithRetry to wait and try again until the source answers; after its last try it throws what the source threw.${MOCK ? ` ${MOCK}` : ""}`,
  experiments: [
    { shape: "call-function", exportName: "fetchWithRetry", args: [{ kind: "stand-in", name: "fetchIt", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "TypeError", message: "fetch failed" }] }] },
    { shape: "call-function", exportName: "fetchWithRetry", args: [{ kind: "stand-in", name: "fetchIt", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "TypeError", message: "fetch failed" }, { do: "return", value: { price: 42 } }] }] },
  ],
};
export const mockChat = async (a: ChatArgs): Promise<ChatResult> => {
  const all = a.messages.map((m) => m.content).join("\n");
  if (a.role === "investigator") {
    await new Promise((r) => setTimeout(r, delay));
    const claimRound = /check this sentence/.test(all);
    const caseName = /CASE_(\w+)/.exec(all)?.[1];
    if (caseName && CASES[caseName]) return { ok: true, finishReason: "stop", usage, content: JSON.stringify({ claim: "A mock sentence.", experiments: CASES[caseName] }) };
    const py = /get_user_plan/.test(all);
    if (/getTemperature/.test(all)) return { ok: true, finishReason: "stop", usage, content: JSON.stringify(claimRound ? CLAIM_WEATHER : WEATHER) };
    if (/waitForJob/.test(all)) return { ok: true, finishReason: "stop", usage, content: JSON.stringify(LOOP) };
    if (/fetchWithRetry/.test(all) && /backoffMs/.test(all)) return { ok: true, finishReason: "stop", usage, content: JSON.stringify(EXAMPLE) };
    return { ok: true, finishReason: "stop", usage, content: JSON.stringify(py ? (claimRound ? CLAIM_PLAN : PLAN) : claimRound ? CLAIM_ORDERS : ORDERS) };
  }
  const qs = [...all.matchAll(/measures "([^"]+)"/g)].map((m) => m[1]!);
  const letter = /open/i.test(a.model ?? "") ? "b" : "a";
  return { ok: true, finishReason: "stop", usage, content: JSON.stringify({ bets: qs.map((m) => ({ measures: m, answer: { kind: "quiz", choice: letter }, rationale: MOCK || "Read from the code." })) }) };
};

const budget = createModelBudget({ spendCeilingUsd: 5, callsPerHour: 100_000 });
const app = createApp({ modelBets: { chat: mockChat, budget, sparkOpen: { available: true } }, paste: { proposer: { chat: mockChat } }, keptProofsDir: join(mkdtempSync(join(tmpdir(), "u3-kept-")), "kept") });
// With U3_GATE_FILE set: the real invite gate in front, and one code written to that file (never printed), so the browser checks the hosted path.
let served: { fetch: typeof app.fetch } = app;
if (process.env.U3_GATE_FILE) {
  const dir = mkdtempSync(join(tmpdir(), "u3-gate-"));
  const store = openInviteStore(dir, { env: { ATLAS_INVITE_PEPPER: "x".repeat(64), ATLAS_INVITE_SECRET: "x".repeat(64) } as never });
  const made = store.create({ label: "check", dailyUsd: 3 }) as unknown as { code: string };
  writeFileSync(process.env.U3_GATE_FILE, made.code, { mode: 0o600 });
  served = withInviteGate(app, { store, require: true, secureCookie: false });
}
serve({ fetch: served.fetch, port: Number(process.env.PORT ?? 18951) }, (i) => console.log(`U3 mock-model server on ${i.port}: every model call is mocked ($0)`));
