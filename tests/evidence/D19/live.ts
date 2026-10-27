// D19 live check: three Muse Spark bet-only calls on the Moonwell Level 2 experiment, each given only
// "what the bettor sees" (src/bet-context.ts), then ONE real run on a fork of Base at block 42194662
// (the fork block is fixed, so every call's bet is judged against the same run), judged by src/judge.ts.
//
// Run: ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/evidence/D19/live.ts )
// Writes (next to this file): prompt-after.txt, live-answers.jsonl, live-run.json, live-summary.json.
// Every model call appends its usage line to tests/evidence/usage/usage.jsonl (server/meta/client.ts).
// Budget: stops before a call once this script has spent $0.45 (the task allows $0.50).
// Nothing here prints or stores the API key or the RPC URL: errors are scrubbed of URLs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seenContextFor } from "../../../server/app.ts";
import { ASKED_FIELD, EVM_GATE_CONTEXT, MOONWELL_PR_REF, forkBlockFor, humanFinding } from "../../../server/evm-round.ts";
import { chat as realChat, type ChatArgs, type ChatResult } from "../../../server/meta/client.ts";
import { buildBetOnlyMessages, runClaimantBets } from "../../../server/meta/roles/claimant-bets.ts";
import { MOONWELL_PR_578 } from "../../../server/targets/github.ts";
import { PR578_CODE_SHA256 } from "../../../runners/evm/moonwell-base.ts";
import { evmRunner } from "../../../runners/evm/runner.ts";
import { gate, questionsFor } from "../../../src/gate.ts";
import { judge } from "../../../src/judge.ts";
import type { Experiment } from "../../../src/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const CALLS = 3;
const MAX_SCRIPT_USD = 0.45;
const scrub = (s: string) => s.replace(/https?:\/\/\S+/g, "<url>").replace(/wss?:\/\/\S+/g, "<url>");

// The same finding as D04-04's driver: line 42 of ChainlinkOracleConfigs.sol (the cbETH feed config), picked by a person.
const FILE = "proposals/ChainlinkOracleConfigs.sol";
const text = readFileSync(join(ROOT, "contracts", "lib", "moonwell", FILE), "utf8");
const picked = humanFinding([{ path: FILE, text }], FILE, 42, 42);
if (!picked.ok) throw new Error(picked.reason);
const finding = picked.finding;

const decision = gate({ shape: "apply-proposal-then-read", markets: "touched" }, EVM_GATE_CONTEXT);
if (!decision.allowed) throw new Error(`gate refused: ${decision.reason}`);
const exp: Experiment = {
  id: "d19-level2",
  target: { kind: "github-pr", ref: MOONWELL_PR_REF, commit: MOONWELL_PR_578.commit, codeSha256: PR578_CODE_SHA256 },
  runner: "evm",
  params: decision.params,
  proposedBy: { role: "human" },
  gate: { allowed: true },
} as Experiment;
const questions = questionsFor(decision.params, EVM_GATE_CONTEXT).filter((q) => q.measures === ASKED_FIELD);
const seenContext = seenContextFor(exp, questions, finding);
if (seenContext === undefined) throw new Error("no seen context for this experiment");
const input = { experiment: exp, questions, finding, findingLabel: "picked by a person; file and lines checked by plain code", fileText: text, gateContext: EVM_GATE_CONTEXT, seenContext };
writeFileSync(join(HERE, "prompt-after.txt"), buildBetOnlyMessages(input).map((m) => `=== ${m.role} ===\n${m.content}`).join("\n\n") + "\n");

let spent = 0;
const guarded = async (args: ChatArgs): Promise<ChatResult> => {
  if (spent >= MAX_SCRIPT_USD) return { ok: false, reason: `stopped: this script already spent $${spent.toFixed(4)}` };
  const r = await realChat(args);
  spent += r.usage?.usd ?? 0;
  return r;
};

const answers: Array<Record<string, unknown>> = [];
const allBets = [];
for (let i = 1; i <= CALLS; i++) {
  const r = await runClaimantBets(input, { chat: guarded });
  const row: Record<string, unknown> = { call: i, at: new Date().toISOString(), ok: r.ok, attempts: r.attempts.length, usage: r.usage ?? null };
  if (r.ok) {
    const b = r.bets[0]!;
    row.answer = b.answer;
    row.rationale = b.rationale;
    row.sealedHash = b.sealedHash;
    allBets.push({ call: i, bet: b });
  } else {
    row.reason = r.reason;
    row.detail = r.detail;
    row.raw = r.attempts.map((a) => a.content);
  }
  answers.push(row);
  console.log(`call ${i}: ${r.ok ? JSON.stringify(r.bets[0]!.answer) : `no usable answer (${r.reason})`} · $${(r.usage?.usd ?? 0).toFixed(4)}`);
}

// One real run (the bets are all sealed before it starts).
const forkBlock = forkBlockFor(exp.params);
let run;
try {
  run = await evmRunner({ onProgress: (s) => console.log(`  runner: ${scrub(s)}`) }).run(exp, { forkBlock });
} catch (e) {
  const msg = scrub(e instanceof Error ? e.message : String(e));
  writeFileSync(join(HERE, "live-answers.jsonl"), answers.map((a) => JSON.stringify(a)).join("\n") + "\n");
  throw new Error(`the run failed: ${msg}`);
}
writeFileSync(join(HERE, "live-run.json"), JSON.stringify(run, null, 2) + "\n");

for (const { call, bet } of allBets) {
  const v = judge(bet, run);
  const row = answers.find((a) => a.call === call)!;
  row.verdict = v.outcome;
  row.verdictReason = v.reason ?? null;
}
for (const a of answers) if (!a.ok) a.verdict = "cant_check (no usable answer)";
writeFileSync(join(HERE, "live-answers.jsonl"), answers.map((a) => JSON.stringify(a)).join("\n") + "\n");

const m = run.result.measured;
const summary = {
  model: "muse-spark-1.3",
  calls: CALLS,
  forkBlock: run.forkBlock,
  controlPassed: run.controlPassed,
  observedCbEthUsd1e18: m["priceUsd1e18:cbETH"] ?? null,
  referenceCbEthUsd1e18: run.result.references?.["refUsd1e18:cbETH"]?.value ?? null,
  verdicts: answers.map((a) => ({ call: a.call, answer: a.answer ?? null, verdict: a.verdict })),
  spentUsd: Number(spent.toFixed(6)),
};
writeFileSync(join(HERE, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
