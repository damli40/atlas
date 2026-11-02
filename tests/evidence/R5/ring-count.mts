// Which realistic files with a throw get a ring from a real traced run: the sealed run and the third run, on the real sandbox. No model. Each test is written to reach that file's throw.
//   pnpm exec tsx tests/evidence/R5/ring-count.mts <out.json>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { executorFromEnv } from "../../../runners/executor/select";
import { PASTED_RUNNERS } from "../../../runners/pasted-registry";
import { helperRun } from "../../../server/helpers";
import { endOfFile, machinePartsOfFile } from "../../../renderer/authors/machine";
import { fileOutline } from "../../../src/file-outline";
import { U1_EXAMPLE } from "../../../web/u1-example";
import { FILES } from "./realistic-files";

const si = (name: string, calls: unknown[]) => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls });
const j = (value: unknown) => ({ kind: "json", value });
const TESTS: Record<string, unknown[]> = {
  signup: [si("db", [{ do: "return", value: 1 }]), si("mail", [{ do: "return", value: 1 }]), j("no-at-sign"), j("longenough1")],
  retry: [si("f", [{ do: "throw", errorName: "Error", message: "boom" }])],
  py_users: [j([])],
  // withRetry again, where the file's own throw gets out
  orders: [j("https://example.com/orders")],
};
const extra: Record<string, [string, "ts", string]> = { orders: [readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8"), "ts", "fetchAllOrders"], example: [U1_EXAMPLE, "ts", "fetchWithRetry"] };
const executor = executorFromEnv();
const controls: Record<string, unknown> = {};
const rows: unknown[] = [];
for (const [name, [source, language, fn]] of [...Object.entries(FILES), ...Object.entries(extra)]) {
  const outline = fileOutline(source, language);
  const hasThrow = (outline.throwsInFile ?? []).length > 0;
  if (!hasThrow) {
    rows.push({ name, hasThrow });
    continue;
  }
  const args = name === "example" ? [si("fetchIt", [{ do: "throw", errorName: "Error", message: "flaky" }]), j(3), j(100)] : TESTS[name] ?? [];
  const params = { shape: "call-function", exportName: fn, args, ...(name === "orders" ? { network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 429, body: {} }] } } : {}) };
  const r = PASTED_RUNNERS[language]!;
  controls[language] ??= await r.control(executor);
  const exp = { id: `e_${name}`, target: { kind: "pasted", ref: `pasted.${language}`, language, source, codeSha256: createHash("sha256").update(source).digest("hex") }, runner: "ts", proposedBy: { role: "human" }, params, gate: { allowed: true } };
  const run = await r.run(exp as never, controls[language] as never, executor);
  const helpers = await helperRun(exp as never, run, { executor });
  const steps = "steps" in helpers ? helpers.steps : [];
  const thrownAt = "steps" in helpers ? helpers.thrownAt ?? null : null;
  const m = run.result.measured as Record<string, unknown>;
  const end = endOfFile({ measured: m, parts: machinePartsOfFile(source, language, params as never, outline), tested: fn, test: params, steps, thrownAt });
  rows.push({ name, hasThrow, outcome: m.outcome, thrown: m.thrownMessage, thrownAt, helpers: "none" in helpers ? helpers.none : "ok", end });
  console.log(name, m.outcome, m.thrownMessage ?? "", "line", thrownAt, "->", JSON.stringify(end));
}
writeFileSync(process.argv[2]!, JSON.stringify(rows, null, 1));
const withThrow = rows.filter((x) => (x as { hasThrow: boolean }).hasThrow) as { end: { on: string } | null; outcome: unknown }[];
console.log(`${withThrow.length} files with a throw; ${withThrow.filter((x) => x.end && x.end.on !== "words").length} placed`);
