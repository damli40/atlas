// D04-03 live check: the Investigator (muse-wonder-1.0, fallback muse-spark-1.3) on the fixture
// and on Moonwell PR #578 (read through server/targets/github.ts at its merge commit).
//
// Run: pnpm exec tsx tests/evidence/D04-03/investigator-live.ts [fixtureRuns=3] [prRuns=5] [prOut] [summaryOut]
// Writes (next to this file): investigator-5-runs.jsonl (PR runs), fixture-runs.jsonl, prompt-fixture.txt,
// prompt-pr578.txt, summary.json. Every model call appends its usage line to
// tests/evidence/usage/usage.jsonl (server/meta/client.ts). Stops after any single call over $1, or once the script has spent $2.70.
// Nothing here prints or stores the API key, any request header or the GitHub token.

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, Target } from "../../../src/types.ts";
import { chat as realChat, DEFAULT_USAGE_PATH, type ChatArgs, type ChatResult } from "../../../server/meta/client.ts";
import { readUsageTotal } from "../../../server/meta/budget.ts";
import { buildInvestigatorMessages, estimateTokens, effortFor, runInvestigator, type InvestigatorInput, type InvestigatorResult } from "../../../server/meta/roles/investigator.ts";
import { FIXTURE_FILE } from "../../../server/meta/roles/fixture-finding.ts";
import { fetchGithubPr, MOONWELL_PR_578 } from "../../../server/targets/github.ts";
import { readFixture } from "../../../runners/ts/control.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_RUNS = Number(process.argv[2] ?? 3);
const PR_RUNS = Number(process.argv[3] ?? 5);
/** Where the PR runs go (the first series is investigator-5-runs.jsonl). */
const PR_OUT = process.argv[4] ?? "investigator-5-runs.jsonl";
const SUMMARY_OUT = process.argv[5] ?? "summary.json";
const MAX_CALL_USD = 1;
/** The task's budget is about $3 in all: stop before starting a call once this script has spent $2.70. */
const MAX_SCRIPT_USD = 2.7;
let scriptUsd = 0;

const before = readUsageTotal(DEFAULT_USAGE_PATH);
let stop = false;
let maxCall = 0;
const guarded = async (args: ChatArgs): Promise<ChatResult> => {
  if (stop) return { ok: false, reason: "stopped: an earlier call cost more than $1" };
  if (scriptUsd >= MAX_SCRIPT_USD) {
    stop = true;
    return { ok: false, reason: `stopped: this script already spent $${scriptUsd.toFixed(2)}` };
  }
  const r = await realChat(args);
  const usd = r.usage?.usd ?? 0;
  scriptUsd += usd;
  maxCall = Math.max(maxCall, usd);
  if (usd > MAX_CALL_USD) stop = true;
  return r;
};

// ---- the fixture ----
const fixtureText = readFixture({ kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: "" });
const fixtureTarget: Target = { kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: createHash("sha256").update(fixtureText).digest("hex") };
const fixtureLines = fixtureText.split("\n");
// withRpcRetry's lines, found by plain code: from its declaration to the first line that is exactly "}".
const fnStart = fixtureLines.findIndex((l) => l.startsWith("export async function withRpcRetry")) + 1;
const fnEnd = fixtureLines.findIndex((l, i) => i >= fnStart && l === "}") + 1;
if (fnStart < 1 || fnEnd < fnStart) throw new Error("withRpcRetry not found in the fixture");

// ---- PR #578 ----
const pr = await fetchGithubPr({ ...MOONWELL_PR_578, expectCommit: MOONWELL_PR_578.commit });
const CONFIGS = "proposals/ChainlinkOracleConfigs.sol";
const configsText = pr.files.find((f) => f.path === CONFIGS)?.content;
if (!configsText) throw new Error(`${CONFIGS} not in the PR`);
// The cbETHETH_ORACLE push: the uncommented line holding OracleConfig("cbETHETH_ORACLE", ...).
const cbLines = configsText.split("\n").flatMap((l, i) => (/^\s*OracleConfig\("cbETHETH_ORACLE"/.test(l) ? [i + 1] : []));
if (cbLines.length !== 1) throw new Error(`expected one cbETHETH_ORACLE push line, found ${cbLines.length}`);
const cbLine = cbLines[0]!;

const fixtureInput: InvestigatorInput = { target: fixtureTarget, files: [{ path: FIXTURE_FILE, text: fixtureText }] };
const prInput: InvestigatorInput = {
  target: pr.target,
  files: pr.files.filter((f) => f.content !== undefined).map((f) => ({ path: f.path, text: f.content! })),
  pr: { title: pr.title, description: pr.description },
};
const dump = (i: InvestigatorInput) => buildInvestigatorMessages(i).map((m) => `[${m.role}]\n${m.content}`).join("\n\n") + "\n";
writeFileSync(join(HERE, "prompt-fixture.txt"), dump(fixtureInput));
writeFileSync(join(HERE, "prompt-pr578.txt"), dump(prInput));
console.log(`fixture: withRpcRetry is lines ${fnStart}–${fnEnd}; prompt ≈ ${estimateTokens(buildInvestigatorMessages(fixtureInput))} tokens (${effortFor(buildInvestigatorMessages(fixtureInput))})`);
console.log(`PR #578 at ${pr.target.commit}: ${prInput.files.length} files, cbETHETH_ORACLE push on ${CONFIGS} line ${cbLine}; prompt ≈ ${estimateTokens(buildInvestigatorMessages(prInput))} tokens (${effortFor(buildInvestigatorMessages(prInput))})`);

function row(label: string, run: number, r: InvestigatorResult, events: AgentEvent[], hit: (f: { file: string; lineStart: number; lineEnd: number }) => boolean) {
  const findings = r.ok ? r.findings : [];
  return {
    target: label,
    run,
    ok: r.ok,
    ...(r.ok ? { model: r.model, fellBack: r.fellBack } : { reason: r.reason }),
    hit: findings.some(hit),
    findings: findings.map((f) => ({ id: f.id, file: f.file, lineStart: f.lineStart, lineEnd: f.lineEnd, kind: f.kind, verified: f.verified, model: f.proposedBy.model, claim: f.claim, quotedSnippet: f.quotedSnippet, hit: hit(f) })),
    dropped: r.dropped,
    calls: r.attempts.map((a) => ({ model: a.model, attempt: a.attempt, reasoningEffort: a.reasoningEffort, finishReason: a.finishReason ?? null, kept: a.kept, dropped: a.dropped, error: a.error ?? null, usage: a.usage ?? null })),
    usage: r.usage ?? null,
    events: events.map((e) => ({ role: e.role, ...(e.model ? { model: e.model } : {}), action: e.action, ...(e.usage ? { usd: e.usage.usd } : {}) })),
  };
}

async function series(label: string, input: InvestigatorInput, n: number, hit: (f: { file: string; lineStart: number; lineEnd: number }) => boolean, out: string) {
  const lines: string[] = [];
  let hits = 0;
  let done = 0;
  for (let i = 1; i <= n && !stop; i++) {
    const events: AgentEvent[] = [];
    const t0 = Date.now();
    const r = await runInvestigator(input, { chat: guarded, log: { emit: (e) => (events.push(e as AgentEvent), e as AgentEvent), model: (e) => (events.push(e as AgentEvent), e as AgentEvent) } });
    const x = row(label, i, r, events, hit);
    lines.push(JSON.stringify(x));
    writeFileSync(join(HERE, out), lines.join("\n") + "\n");
    done++;
    if (x.hit) hits++;
    const where = x.findings.map((f) => `${f.file.split("/").pop()}:${f.lineStart}-${f.lineEnd}(${f.kind})${f.hit ? "*" : ""}`).join(", ");
    console.log(`${label} run ${i}: ${r.ok ? `ok (${r.model}${r.fellBack ? ", fallback" : ""})` : `no usable answer (${r.reason})`}; kept [${where}]; dropped ${r.dropped.length}; calls ${r.attempts.length}; $${(r.usage?.usd ?? 0).toFixed(4)}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    for (const d of r.dropped) console.log(`   dropped: ${d.file ?? "?"} ${d.lineStart ?? "?"}-${d.lineEnd ?? "?"} ${d.reason}`);
  }
  return { runs: done, hits };
}

const fx = await series("fixture", fixtureInput, FIXTURE_RUNS, (f) => f.file === FIXTURE_FILE && f.lineStart >= fnStart && f.lineEnd <= fnEnd, "fixture-runs.jsonl");
const pr5 = await series("pr578", prInput, PR_RUNS, (f) => f.file === CONFIGS && f.lineStart <= cbLine && cbLine <= f.lineEnd, PR_OUT);

const after = readUsageTotal(DEFAULT_USAGE_PATH);
const summary = {
  fixture: { withRpcRetryLines: [fnStart, fnEnd], runs: fx.runs, runsWithAVerifiedFindingInside: fx.hits },
  pr578: { commit: pr.target.commit, codeSha256: pr.target.codeSha256, cbETHETHOraclePushLine: { file: CONFIGS, line: cbLine }, runs: pr5.runs, runsWithAVerifiedFindingCoveringIt: pr5.hits },
  usageLog: { usdBefore: before.usd, usdAfter: after.usd, spentThisScript: after.usd - before.usd, linesBefore: before.lines, linesAfter: after.lines, mostExpensiveCallUsd: maxCall },
  stoppedOverOneDollar: stop,
};
writeFileSync(join(HERE, SUMMARY_OUT), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
