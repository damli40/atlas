// Re-runs the plain-code checks (runners/change.ts) on the model answers stored in a POST /changes
// answer, with no model call. Used when the checks themselves changed after a live run, to show what
// the stored answers give under the current checks. The answers are never edited.
// Run: pnpm exec tsx tests/tools/recheck-fixer-answers.ts <replay-evm.json>

import { readFileSync } from "node:fs";
import { extractDiff } from "../../src/diff.ts";
import { checkChange, moonwellChangeContext } from "../../runners/change.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: recheck-fixer-answers.ts <POST /changes answer json>");
const d = JSON.parse(readFileSync(file, "utf8")) as { fixer: { attempts: { attempt: number; path: string; model: string; reason?: string; answer?: string }[] } };
const ctx = moonwellChangeContext();
for (const a of d.fixer.attempts) {
  console.log(`attempt ${a.attempt} (${a.path}, ${a.model}): reason at the time: ${a.reason ?? "accepted"}`);
  const got = a.answer ? extractDiff(a.answer) : null;
  const r = got ? await checkChange(got.diff, ctx) : { ok: false as const, reason: "no diff in the answer" };
  console.log(`  current checks: ${r.ok ? "accepted" : r.reason}`);
}
