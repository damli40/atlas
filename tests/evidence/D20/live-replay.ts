// D20 live round: Muse Code's real Moonwell proposal (stored, no new model call), applied in the
// "theoretical-direct-wire" mode, replayed on a fresh Base fork at the original block, the SAME sealed
// bets judged before | after.
//
// Inputs, all committed evidence (no model is called):
// - tests/evidence/D06-01/retry-evm/run-evm.json: the original round hhFxiKOUHg (POST /runs answer): the run
//   at 42194662, the sealed bets revealed with their nonces (person 2200 USD ±10%; Muse Spark declined),
//   the verdicts.
// - tests/evidence/D06-01/retry-evm/replay-evm.json: Muse Code's answer (attempt 1, `muse exec`, model id
//   reported muse-spark-1.3): line 42 cbETHETH_ORACLE → cbETH_ORACLE. Its diff is taken out by
//   src/diff.ts extractDiff, exactly as the Fixer does.
// The round's .atlas.json is rebuilt by src/atlasfile.ts buildAtlasFile from those (the person picked line
// 42 of the config; the Investigator was not asked), and it must verify before anything replays.
//
// Run (the RPC URL is read at run time, never printed):
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/evidence/D20/live-replay.ts <proofs dir> )
// Writes tests/evidence/D20/: d20.atlas.json, change-answer.json, replay-run.json, live-output.txt lines on stdout.
// <proofs dir> (optional): a copy of the .atlas.json is written there as <runId>/.atlas.json for the server
// (ATLAS_PUBLISH_PROOFS=1 ATLAS_PROOFS_DIR=<proofs dir>), so the real proof card can open it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAtlasFile, verifyAtlasFile, withChange } from "../../../src/atlasfile.ts";
import { extractDiff } from "../../../src/diff.ts";
import { judge } from "../../../src/judge.ts";
import { CHANGE_CAPTION, theoryCaptions, towardFromBets } from "../../../src/change.ts";
import { evaluateReplayRule } from "../../../src/falsealarm.ts";
import { formatUsd1e18 } from "../../../src/units.ts";
import type { Bet, Change, Experiment, Finding, Run, Target, Verdict } from "../../../src/types.ts";
import { checkChange, moonwellChangeContext, MOONWELL_CONFIG_FILE } from "../../../runners/change.ts";
import { evmRunner } from "../../../runners/evm/runner.ts";
import { scrubDeep } from "../../../runners/evm/redact.ts";
import { MIP_X43_MERGE_COMMIT, PR578_CODE_SHA256 } from "../../../runners/evm/moonwell-base.ts";
import { extraCaptionsFor } from "../../../server/evm-round.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const D06 = join(HERE, "../D06-01/retry-evm");
const proofsDir = process.argv[2];
if (!process.env.BASE_RPC_URL) throw new Error("BASE_RPC_URL is not set (load ~/.config/atlas/rpc.env first)");

// ── 1. The original round, rebuilt and verified ────────────────────────────────────────────────
const stored = JSON.parse(readFileSync(join(D06, "run-evm.json"), "utf8")) as { run: Run; bets: Bet[]; verdicts: Verdict[] };
const run = stored.run;
const target: Target = { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578", codeSha256: PR578_CODE_SHA256, commit: MIP_X43_MERGE_COMMIT };
const experiment: Experiment = { id: run.experimentId, target, runner: "evm", params: { shape: "apply-proposal-then-read", markets: "touched" }, proposedBy: { role: "human" }, gate: { allowed: true } };
const ctx = moonwellChangeContext();
const line42 = ctx.files[MOONWELL_CONFIG_FILE]!.split("\n")[41]!;
const finding: Finding = { id: "d20-line42", file: MOONWELL_CONFIG_FILE, lineStart: 42, lineEnd: 42, kind: "other", claim: "", verified: true, quotedSnippet: line42, proposedBy: { role: "human", model: "none: picked by a person" } };
const file = buildAtlasFile({ target, experiment, bets: stored.bets, run, verdicts: stored.verdicts, findings: [finding], agentLog: [], extraCaptions: extraCaptionsFor(finding, [], []), createdAt: new Date().toISOString() });
console.log(`original round ${run.id} at block ${run.forkBlock}: .atlas.json rebuilt and verified (${file.captions.length} captions)`);
const usd = (k: string, r: Run) => (typeof r.result.measured[k] === "string" ? formatUsd1e18(BigInt(r.result.measured[k] as string)) : `not measured (${r.result.notMeasured[k] ?? "no value"})`);
const ref = (r: Run) => (r.result.references?.["refUsd1e18:cbETH"] ? formatUsd1e18(BigInt(r.result.references["refUsd1e18:cbETH"].value)) : "not measured");
console.log(`before: cbETH ${usd("priceUsd1e18:cbETH", run)}, reference ${ref(run)}, price sources ${String(run.result.measured["priceSources:cbETH"] ?? "not measured")}, control ${run.controlPassed}`);

// ── 2. Muse Code's stored proposal, checked by plain code ──────────────────────────────────────
const answers = JSON.parse(readFileSync(join(D06, "replay-evm.json"), "utf8")) as { fixer: { attempts: { attempt: number; path: string; model: string; answer?: string }[] } };
const museAttempt = answers.fixer.attempts.find((a) => a.path === "muse-exec" && a.answer)!;
const diff = extractDiff(museAttempt.answer!)!.diff;
const checked = await checkChange(diff, ctx);
if (!checked.ok) throw new Error(`the stored proposal is not usable: ${checked.reason}`);
console.log(`Muse Code's stored proposal (attempt ${museAttempt.attempt}, ${museAttempt.path}, model ${museAttempt.model}): ${checked.changedLines} changed lines; mode ${checked.mode ?? "the proposal's own rule"}; wired directly: ${JSON.stringify(checked.directWired ?? [])}`);
const change: Change = {
  id: "d20-change",
  runId: run.id,
  diff,
  proposedBy: { role: "fixer", model: museAttempt.model },
  toward: towardFromBets(stored.bets, stored.verdicts)!,
  ...(checked.mode ? { mode: checked.mode, directWired: checked.directWired ?? [] } : {}),
};
for (const t of theoryCaptions(change)) console.log(`caption: ${t}`);

// ── 3. The replay: same experiment, same block, fresh fork ─────────────────────────────────────
const progress: string[] = [];
const t0 = Date.now();
const replay = scrubDeep(await evmRunner({ onProgress: (s) => progress.push(s) }).replayWithChange(run, change, { experiment, onProgress: () => {} }));
console.log(`replay ${replay.id}: ${Math.round((Date.now() - t0) / 1000)} s; fork block ${replay.forkBlock} (original ${run.forkBlock}); control ${replay.controlPassed}`);
console.log(`after: cbETH ${usd("priceUsd1e18:cbETH", replay)}, reference ${ref(replay)}, price sources ${String(replay.result.measured["priceSources:cbETH"] ?? `not measured (${replay.result.notMeasured["priceSources:cbETH"]})`)}, cbETH feed ${String(replay.result.measured["feedAddress:cbETH"])}`);

// ── 4. The SAME sealed bets, before | after ────────────────────────────────────────────────────
const after = stored.bets.map((b) => judge(b, replay));
for (const b of stored.bets) {
  const v1 = stored.verdicts.find((v) => v.betId === b.id)!;
  const v2 = after.find((v) => v.betId === b.id)!;
  const said = b.answer.kind === "number" ? `${b.answer.value} ${b.answer.unit} ±${b.answer.tolerancePct}%` : b.answer.kind;
  console.log(`bet ${b.who} (${said}): before ${v1.outcome} | after ${v2.outcome}${v2.reason ? ` (${v2.reason})` : ""}`);
}
const passRule = evaluateReplayRule(replay, run);
console.log("PASS-RULE.md replay lines, in theory (about this theoretical replay, not the real proposal):");
for (const l of passRule) console.log(`  ${l.outcome.padEnd(13)} ${l.rule}\n                ${l.detail}`);

// ── 5. Into the .atlas.json, verified again as a whole ─────────────────────────────────────────
const next = withChange(file, change, { run: replay, verdicts: after, passRule });
const v = verifyAtlasFile(JSON.parse(JSON.stringify(next)));
console.log(`.atlas.json with the change: ${v.ok ? "verifies" : `does NOT verify: ${v.problems.join("; ")}`}; captions:`);
for (const c of next.captions) console.log(`  - ${c}`);
writeFileSync(join(HERE, "d20.atlas.json"), JSON.stringify(next, null, 2) + "\n");
writeFileSync(join(HERE, "replay-run.json"), JSON.stringify(replay, null, 2) + "\n");
const changeAnswer = {
  ok: true,
  runId: run.id,
  change: { ...change, replayRunId: replay.id },
  fixer: { path: "muse-exec", model: museAttempt.model, attempts: [{ attempt: museAttempt.attempt, path: "muse-exec", model: museAttempt.model, ok: true, note: "the stored answer from tests/evidence/D06-01/retry-evm (no new model call)" }], usage: null },
  diff,
  caption: CHANGE_CAPTION,
  replay,
  bets: stored.bets,
  before: { run: { id: run.id, forkBlock: run.forkBlock, codeSha256: run.codeSha256 }, verdicts: stored.verdicts },
  after: { run: { id: replay.id, forkBlock: replay.forkBlock, codeSha256: replay.codeSha256 }, verdicts: after },
  passRule,
  proof: { ok: v.ok, runId: run.id, ...(v.ok ? {} : { reason: v.problems.join("; ") }) },
};
writeFileSync(join(HERE, "change-answer.json"), JSON.stringify(changeAnswer, null, 2) + "\n");
writeFileSync(join(HERE, "progress.txt"), progress.join("\n") + "\n");
if (proofsDir) {
  mkdirSync(join(proofsDir, run.id), { recursive: true });
  writeFileSync(join(proofsDir, run.id, ".atlas.json"), JSON.stringify(next, null, 2) + "\n");
  console.log(`copy for the server written under the proofs dir as ${run.id}/.atlas.json`);
}
