// Does the test a round opens on reach the flaw? Each file has a copy with its flaws fixed. The same test runs on both: if the two runs differ, the test reached a flaw.
// Plain code decides, from two real runs; no model judges. Real Muse Wonder calls, stops at the cap.
//   pnpm exec tsx tests/evidence/R5/flaw-aim.mts after|weak <calls per file> <out.json>
// flaw-aim-before.json came from this script at commit 7ab7c8c's prompt, with that commit's plain-code pick (src/default-test.ts, since removed).
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runProposer } from "../../../server/meta/roles/proposer";
import { PASTED_RUNNERS } from "../../../runners/pasted-registry";
import { executorFromEnv } from "../../../runners/executor/select";

const [mode, perFile, out] = process.argv.slice(2) as [string, string, string];
const CAP = 0.28;
const dir = new URL("flaw-aim/", import.meta.url);
const FILES: [string, "ts" | "py", string][] = [["pricing.ts", "ts", "quoteOrder"], ["importer.py", "py", "run_import"], ["orders.ts", "ts", "fetchAllOrders"], ["routes.ts", "ts", "report"], ["retry.ts", "ts", "withRetry"]];
const WEAK = "In this person's earlier rounds, their sealed bets most often did not match what the code did on these kinds of question: timing (5 of 7 didn't match; guessed lower than the run 4, higher 1). Counted by plain code from their own bets; it says nothing about this code. Use this only to choose between tests that show the flaw equally well; it never changes which flaw you test.";
const executor = executorFromEnv();
const ctl = { js: null, ts: null, py: null } as Record<string, unknown>;
const runOn = async (source: string, language: "ts" | "py", params: unknown) => {
  const r = PASTED_RUNNERS[language]!;
  ctl[language] ??= await r.control(executor);
  const exp = { id: `e_${Math.random().toString(36).slice(2, 10)}`, target: { kind: "pasted", ref: `pasted.${language}`, language, source, codeSha256: createHash("sha256").update(source).digest("hex") }, params, gate: { allowed: true }, createdAt: new Date().toISOString() };
  const run = await r.run(exp as never, ctl[language] as never, executor);
  const m = run.result.measured as Record<string, unknown>;
  return { outcome: m.outcome, returnedJson: m.returnedJson, thrown: m.thrownName ?? m.errorName, message: m.thrownMessage ?? m.errorMessage, measured: m, control: run.controlPassed };
};
const same = (a: Awaited<ReturnType<typeof runOn>>, b: Awaited<ReturnType<typeof runOn>>) => JSON.stringify(a.measured) === JSON.stringify(b.measured);
let spent = 0;
const rows: unknown[] = [];
for (const [file, language, exportName] of FILES) {
  const source = readFileSync(new URL(file, dir), "utf8");
  const fixed = readFileSync(new URL(file.replace(/\.(ts|py)$/, ".fixed.$1"), dir), "utf8");
  const exportsFound = PASTED_RUNNERS[language]!.read(source).exports;
  const exportLine = exportsFound.find((e) => e.name === exportName)!.line;
  for (let i = 0; i < Number(perFile); i++) {
    if (spent >= CAP) { console.log("cap reached"); break; }
    const r = await runProposer({ source, language, exportName, exportLine, exportNames: exportsFound.map((e) => e.name), ...(mode === "weak" ? { weakSpots: WEAK } : {}) });
    spent += r.usage?.usd ?? 0;
    const allowed = r.proposals.filter((p) => p.gate.allowed);
    const at = allowed.length === 0 ? -1 : 0;
    const tests = [];
    for (const p of allowed) {
      const a = await runOn(source, language, p.params).catch((e: Error) => ({ error: e.message }) as never);
      const b = await runOn(fixed, language, p.params).catch((e: Error) => ({ error: e.message }) as never);
      tests.push({ params: p.params, reached: !same(a, b), planted: a, fixedCopy: b });
    }
    const row = { file, mode, claim: r.ok ? r.claim : null, usd: r.usage?.usd ?? null, allowed: allowed.length, proposed: r.proposals.length, defaultIndex: at, defaultReached: at >= 0 ? tests[at]!.reached : false, anyReached: tests.some((t) => t.reached), tests };
    rows.push(row);
    console.log(file, i, "default", at, "reached", row.defaultReached, "any", row.anyReached, "$", (r.usage?.usd ?? 0).toFixed(4));
    writeFileSync(out, JSON.stringify({ mode, spent, rows }, null, 1));
  }
}
const rs = rows as { defaultReached: boolean; anyReached: boolean }[];
console.log(`${mode}: default test reached a flaw in ${rs.filter((r) => r.defaultReached).length} of ${rs.length}; some test did in ${rs.filter((r) => r.anyReached).length}. spent $${spent.toFixed(3)}`);
