// D02-02 live check: 5 consecutive real muse-spark-1.3 Claimant calls on the fixture finding,
// then every usable answer's sealed bets run through the real TS harness and judged by src/judge.ts.
//
// Run: pnpm exec tsx tests/evidence/D02-02/claimant-live.ts
// Writes (next to this file): claimant-5-runs.jsonl, judged-runs.json, prompt.txt.
// Writes real refusals (gate rejections, declined bets) to proofs/refusals/.
// Every model call appends its usage line to tests/evidence/usage/usage.jsonl (server/meta/client.ts).
// Nothing here prints or stores the API key or any request header.

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge } from "../../../src/judge.ts";
import type { AgentEvent, Target } from "../../../src/types.ts";
import { TS_GATE_CONTEXT } from "../../../server/app.ts";
import { CLAIMANT_MODEL, buildClaimantMessages, runClaimant, type ClaimantResult } from "../../../server/meta/roles/claimant.ts";
import { FIXTURE_FILE, FIXTURE_FINDING_LABEL, fixtureFinding } from "../../../server/meta/roles/fixture-finding.ts";
import { writeRefusal } from "../../../server/proofs/refusals.ts";
import { localExecutor } from "../../../runners/executor/local.ts";
import { readFixture, tsRunner } from "../../../runners/ts/control.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = 5;

const fileText = readFixture({ kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: "" });
const target: Target = { kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: createHash("sha256").update(fileText).digest("hex") };
const finding = fixtureFinding(fileText);
const input = { target, finding, fileText, gateContext: TS_GATE_CONTEXT, findingLabel: FIXTURE_FINDING_LABEL };

writeFileSync(
  join(HERE, "prompt.txt"),
  buildClaimantMessages(input).map((m) => `[${m.role}]\n${m.content}`).join("\n\n") + "\n",
);

const lines: string[] = [];
const results: ClaimantResult[] = [];
const refusalFiles: string[] = [];
let usd = 0;

for (let i = 1; i <= RUNS; i++) {
  const events: AgentEvent[] = [];
  const r = await runClaimant(input, {
    emit: (e) => events.push(e),
    onRefusal: (rec) => refusalFiles.push(writeRefusal(rec)),
  });
  results.push(r);
  usd += r.usage?.usd ?? 0;
  const row = {
    run: i,
    model: CLAIMANT_MODEL,
    ok: r.ok,
    ...(r.ok ? {} : { reason: r.reason }),
    modelCalls: r.attempts.length,
    attempts: r.attempts.map((a) => ({ content: a.content, finishReason: a.finishReason ?? null, error: a.error ?? null, usage: a.usage ?? null })),
    rejected: r.rejected.map((e) => ({ id: e.id, params: e.params, gate: e.gate })),
    ...(r.ok
      ? {
          experiment: { id: r.experiment.id, params: r.experiment.params, gate: r.experiment.gate },
          bets: r.bets.map((b) => ({ id: b.id, measures: b.measures, question: b.question, answer: b.answer, rationale: b.rationale, sealedAt: b.sealedAt, sealedHash: b.sealedHash })),
        }
      : {}),
    usage: r.usage ?? null,
    events: events.map((e) => ({ role: e.role, action: e.action, ...(e.model ? { model: e.model } : {}) })),
  };
  lines.push(JSON.stringify(row));
  console.log(`run ${i}: ${r.ok ? `ok, ${(r.experiment.params as { shape: string }).shape} ${JSON.stringify(r.experiment.params)}` : `no usable answer (${r.reason})`}; model calls ${r.attempts.length}; gate rejections ${r.rejected.length}; $${(r.usage?.usd ?? 0).toFixed(6)}`);
}
writeFileSync(join(HERE, "claimant-5-runs.jsonl"), lines.join("\n") + "\n");

// Every usable answer: run its experiment for real (control first) and judge its sealed bets.
const runner = tsRunner(localExecutor);
const judged = [];
for (const [i, r] of results.entries()) {
  if (!r.ok) continue;
  const run = await runner.run(r.experiment, {});
  const verdicts = r.bets.map((b) => judge(b, run));
  judged.push({
    run: i + 1,
    experiment: r.experiment.params,
    runId: run.id,
    seed: run.seed,
    controlPassed: run.controlPassed,
    measured: run.result.measured,
    notMeasured: run.result.notMeasured,
    rows: r.bets.map((b, k) => ({
      measures: b.measures,
      bet: b.answer,
      observed: verdicts[k]!.observed ?? null,
      outcome: verdicts[k]!.outcome,
      reason: verdicts[k]!.reason ?? null,
      judgedBy: verdicts[k]!.judgedBy,
    })),
  });
  const say = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" } as const;
  console.log(`judged run ${i + 1} (control ${run.controlPassed ? "passed" : "did not pass"}): ` +
    verdicts.map((v, k) => `${r.bets[k]!.measures} bet ${r.bets[k]!.answer.kind === "declined" ? "declined" : String((r.bets[k]!.answer as { value: unknown }).value)} vs ${String(v.observed ?? "-")} → ${say[v.outcome]}`).join("; "));
}
writeFileSync(join(HERE, "judged-runs.json"), JSON.stringify(judged, null, 2) + "\n");

const okCount = results.filter((r) => r.ok).length;
console.log(`usable: ${okCount}/${RUNS}; first-try usable: ${results.filter((r) => r.ok && r.attempts.length === 1).length}/${RUNS}; cost (upper bound, Spark price unverified): $${usd.toFixed(6)}`);
console.log(`refusal files written: ${refusalFiles.length}`);
for (const f of refusalFiles) console.log(`  ${f.slice(f.indexOf("proofs/"))}`);
