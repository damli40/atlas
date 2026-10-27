// D02-06 live check: 3 real muse-spark-1.3 calls in BET-ONLY mode on oracle row S3 (every call
// fails with an error, 5 times in a row), the experiment a person picks by default. Each usable
// answer's sealed bets are judged by src/judge.ts against a real run of withRpcRetry in the sandbox.
//
// Run: pnpm exec tsx tests/evidence/D02-06/spark-on-s3.ts
// Writes (next to this file): spark-on-s3.jsonl (one line per call), prompt.txt.
// Every model call appends its usage line to tests/evidence/usage/usage.jsonl (server/meta/client.ts).
// Nothing here prints or stores the API key or any request header. Nothing is tuned: whatever Spark
// bets is the result.

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge } from "../../../src/judge.ts";
import { questionsFor } from "../../../src/gate.ts";
import type { Experiment, Target } from "../../../src/types.ts";
import { TS_GATE_CONTEXT } from "../../../server/app.ts";
import { createAgentLog, sessionEmitter } from "../../../server/log/agentlog.ts";
import { buildBetOnlyMessages, runClaimantBets } from "../../../server/meta/roles/claimant-bets.ts";
import { CLAIMANT_MODEL } from "../../../server/meta/roles/claimant.ts";
import { FIXTURE_FILE, fixtureFinding } from "../../../server/meta/roles/fixture-finding.ts";
import { localExecutor } from "../../../runners/executor/local.ts";
import { readFixture, tsRunner } from "../../../runners/ts/control.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CALLS = 3;
const S3 = { shape: "retry-scenario" as const, failTimes: 5, failure: "error" as const };

const fileText = readFixture({ kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: "" });
const target: Target = { kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: createHash("sha256").update(fileText).digest("hex") };
const finding = fixtureFinding(fileText);
const questions = questionsFor(S3, TS_GATE_CONTEXT);
const runner = tsRunner(localExecutor);
const say = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" } as const;

const lines: string[] = [];
let usd = 0;
for (let i = 1; i <= CALLS; i++) {
  const experiment: Experiment = { id: `S3-live-${i}`, target, runner: "ts", params: S3, proposedBy: { role: "human" }, gate: { allowed: true } };
  const input = { experiment, questions, finding, fileText, gateContext: TS_GATE_CONTEXT };
  if (i === 1) writeFileSync(join(HERE, "prompt.txt"), buildBetOnlyMessages(input).map((m) => `[${m.role}]\n${m.content}`).join("\n\n") + "\n");
  const log = createAgentLog();
  const r = await runClaimantBets(input, { log: sessionEmitter(log, "live") });
  usd += r.usage?.usd ?? 0;
  const base = {
    call: i,
    model: CLAIMANT_MODEL,
    experiment: S3,
    ok: r.ok,
    modelCalls: r.attempts.length,
    attempts: r.attempts.map((a) => ({ content: a.content, finishReason: a.finishReason ?? null, error: a.error ?? null, usage: a.usage ?? null })),
    usage: r.usage ?? null,
    events: log.history("live").map((e) => ({ role: e.event.role, action: e.event.action, ...(e.event.model ? { model: e.event.model } : {}) })),
  };
  if (!r.ok) {
    lines.push(JSON.stringify({ ...base, reason: r.reason }));
    console.log(`call ${i}: no usable answer (${r.reason}); model calls ${r.attempts.length}; $${(r.usage?.usd ?? 0).toFixed(6)}`);
    continue;
  }
  const run = await runner.run(experiment, {});
  const verdicts = r.bets.map((b) => judge(b, run));
  const rows = r.bets.map((b, k) => ({
    measures: b.measures,
    bet: b.answer,
    rationale: b.rationale,
    observed: verdicts[k]!.observed ?? null,
    outcome: verdicts[k]!.outcome,
    reason: verdicts[k]!.reason ?? null,
    sealedHash: b.sealedHash,
  }));
  lines.push(JSON.stringify({ ...base, runId: run.id, seed: run.seed, controlPassed: run.controlPassed, measured: run.result.measured, rows }));
  console.log(
    `call ${i} (model calls ${r.attempts.length}, control ${run.controlPassed ? "passed" : "did not pass"}, $${(r.usage?.usd ?? 0).toFixed(6)}): ` +
      rows.map((x) => `${x.measures} bet ${x.bet.kind === "declined" ? "declined" : String((x.bet as { value: unknown }).value)} vs ${String(x.observed ?? "-")} → ${say[x.outcome]}`).join("; "),
  );
}
writeFileSync(join(HERE, "spark-on-s3.jsonl"), lines.join("\n") + "\n");
console.log(`cost (upper bound, Spark price unverified): $${usd.toFixed(6)}`);
