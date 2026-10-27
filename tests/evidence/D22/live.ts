// D22 live rounds through the real HTTP app (server/app.ts, in process), recorded as they come back.
//
// - 3 Moonwell Level 2 rounds (PR #578, line 42 of proposals/ChainlinkOracleConfigs.sol picked by this script,
//   fork of Base one block before MIP-X43 ran, proposal applied), header x-atlas-claimant: both, so Muse Spark
//   (muse-spark-1.3, Meta's API) and Muse Spark Open (meta-models/muse-spark-open-1026, via Baseten) each seal
//   their own bet. Before any bet, the server reads the D22 chain facts at block 42194662 (one short fork,
//   cached for the later rounds).
// - 1 fixture round (withRpcRetry, scenario S3), same header, to confirm nothing changed there.
// The run is the real runner (anvil fork for EVM, the sandbox for TS); src/judge.ts judges.
//
// "You" in these rounds is this script: fixed bets chosen before any run (Moonwell $2,200; fixture calls 3,
// totalWaitMs 3000, outcome "throws"), the same as D07-01. They are not a person's guesses.
// Nothing is tuned after seeing an answer: the prompt and the bet instruction are fixed in code before round 1.
//
// For each Moonwell round the script also rebuilds, from the HTTP answers alone, the text the bet screen renders
// (src/bet-context.ts, as web/screens/Moonwell.tsx calls it) and checks it equals the block in each model's prompt.
//
// Run: BASE_RPC_URL and GITHUB_TOKEN in the environment, `pnpm exec tsx tests/evidence/D22/live.ts`
// Spend guard: no call once Meta spend reaches $1.20 or Baseten $0.60 (task cap: $2 for both together).
// Writes next to this file: live-rounds.json, round-<n>.atlas.json, prompts.json, live-summary.json,
// chain-facts.json. Each model call appends its usage line to tests/evidence/usage/usage.jsonl.
// Nothing here prints or stores a key, an auth header or the RPC URL: errors are scrubbed of URLs.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../server/app.ts";
import { createModelBudget } from "../../../server/meta/budget.ts";
import { createMetaClient, providerFor, type ChatArgs, type ChatResult } from "../../../server/meta/client.ts";
import { SEEN_CONTEXT_HEADING } from "../../../server/meta/roles/claimant-bets.ts";
import { createProofStore, MOONWELL_PR_REF } from "../../../server/evm-round.ts";
import { moonwellBetContext } from "../../../src/bet-context.ts";
import { chainFactsLines, type ChainFactsResult } from "../../../src/chain-facts.ts";
import { SPARK_MODEL, SPARK_OPEN_MODEL } from "../../../src/claimants.ts";
import type { Question } from "../../../src/gate.ts";
import type { Finding } from "../../../src/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAP = { meta: 1.2, baseten: 0.6 };
const scrub = (s: string) => s.replace(/https?:\/\/\S+/g, "<url>").replace(/wss?:\/\/\S+/g, "<url>");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const client = createMetaClient({ timeoutMs: 45_000 }); // the production client settings (server/index.ts)
const spent = { meta: 0, baseten: 0 };
const prompts: { round: number; model: string; provider: string; messagesSha256: string; user: string }[] = [];
let roundNo = 0;
const guarded = async (args: ChatArgs): Promise<ChatResult> => {
  const p = providerFor(args.model);
  if (spent[p] >= CAP[p]) return { ok: false, reason: `stopped by the D22 script: ${p} spend reached $${spent[p].toFixed(4)}` };
  if (!prompts.some((x) => x.round === roundNo && x.model === args.model)) {
    prompts.push({ round: roundNo, model: args.model, provider: p, messagesSha256: sha(JSON.stringify(args.messages)), user: args.messages[1]?.content ?? "" });
  }
  const r = await client.chat(args);
  spent[p] += r.usage?.usd ?? 0;
  return r;
};

// No evmRun and no chainFacts option: the real runner and the real (cached) chain-facts reader.
const app = createApp({
  modelBets: { chat: guarded, budget: createModelBudget(), sparkOpen: { available: true } },
  proofs: createProofStore({ publish: false }), // kept in memory; nothing written to proofs/
});

async function call<T>(method: "GET" | "POST", path: string, session: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-atlas-session": session, ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as T };
}
const must = <T,>(r: { status: number; json: T }, what: string): T => {
  if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${scrub(JSON.stringify(r.json)).slice(0, 400)}`);
  return r.json;
};

type Slot = { model: string; who: string; display: string; status: string; reason?: string; detail?: string; sealed: unknown[] };
type RunOut = {
  run: { id: string; startedAt: string; controlPassed?: boolean; forkBlock?: number; result: { measured: Record<string, unknown>; references?: Record<string, { value: string }> } };
  verdicts: { betId: string; outcome: string; observed?: unknown; reason?: string; judgedBy: string }[];
  bets: { id: string; who: string; measures: string; answer: { kind: string; value?: unknown; reason?: string }; rationale?: string; sealedAt: string; sealedHash: string }[];
  models: Slot[];
  proof?: { ok: boolean; runId: string };
};
type PrAnswer = { ref: string; codeSha256: string; commit?: string; title: string; files: { path: string; text: string }[] };

const rounds: unknown[] = [];
let factsShown: ChainFactsResult | undefined;

async function round(kind: "fixture" | "moonwell") {
  roundNo++;
  const session = `d22live${roundNo}`;
  console.log(`round ${roundNo} (${kind})`);
  let target: { ref: string; codeSha256: string };
  let params: Record<string, unknown>;
  let findingId: string | undefined;
  let finding: Finding | undefined;
  let pr: PrAnswer | undefined;
  let mine: { measures: string; answer: unknown }[];
  if (kind === "fixture") {
    const t = must(await call<{ ref: string; codeSha256: string }>("POST", "/targets", session, { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" }), "target");
    target = { ref: t.ref, codeSha256: t.codeSha256 };
    params = { shape: "retry-scenario", failTimes: 5, failure: "error" };
    mine = [
      { measures: "calls", answer: { kind: "integer", value: 3 } },
      { measures: "totalWaitMs", answer: { kind: "integer", value: 3000 } },
      { measures: "outcome", answer: { kind: "enum", value: "throws" } },
    ];
  } else {
    pr = must(await call<PrAnswer>("POST", "/targets", session, { kind: "github-pr", ref: MOONWELL_PR_REF }), "PR target");
    target = { ref: pr.ref, codeSha256: pr.codeSha256 };
    const f = must(await call<{ finding: Finding }>("POST", "/findings", session, { target, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 }), "finding");
    findingId = f.finding.id;
    finding = f.finding;
    params = { shape: "apply-proposal-then-read", markets: "touched" };
    mine = [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }];
  }
  const t0 = Date.now();
  const exp = must(
    await call<{ experiment: { id: string }; questions: Question[]; models: Slot[]; claimant: string; chainFacts?: ChainFactsResult }>("POST", "/experiments", session, { target, params, ...(findingId ? { findingId } : {}) }, { "x-atlas-claimant": "both" }),
    "experiment",
  );
  const experimentMs = Date.now() - t0;
  const id = exp.experiment.id;
  if (exp.chainFacts) factsShown ??= exp.chainFacts;
  const sealedBets = must(await call<{ bets: unknown[] }>("POST", "/bets", session, { experimentId: id, who: "human", bets: mine }), "script bets");
  const waited = must(await call<{ models: Slot[] }>("POST", `/experiments/${id}/model-bets`, session, {}), "model bets");
  for (const s of waited.models) console.log(`  ${s.model}: ${s.status}${s.reason ? ` (${s.reason})` : ""}, ${s.sealed.length} sealed`);

  // Parity: the screen's text (rebuilt from the HTTP answers, as the page does) against each model's prompt.
  let parity: { screenSha256: string; models: { model: string; samePromptBlock: boolean }[] } | null = null;
  if (kind === "moonwell" && pr && finding) {
    const fileText = pr.files.find((x) => x.path === finding!.file)!.text;
    const screen = moonwellBetContext({ level: "level2", question: exp.questions[0]!, finding, fileText, pr: { ref: pr.ref, title: pr.title, ...(pr.commit !== undefined ? { commit: pr.commit } : {}), fileCount: pr.files.length, codeSha256: pr.codeSha256 }, ...(exp.chainFacts ? { chainFacts: exp.chainFacts } : {}) });
    parity = {
      screenSha256: sha(screen),
      models: prompts.filter((p) => p.round === roundNo).map((p) => ({ model: p.model, samePromptBlock: p.user.startsWith(`${SEEN_CONTEXT_HEADING}\n${screen}\n\nQUESTIONS`) })),
    };
  }

  const r0 = Date.now();
  const runRes = await call<RunOut & { error?: string }>("POST", "/runs", session, { experimentId: id });
  if (runRes.status !== 200) throw new Error(`run: HTTP ${runRes.status} ${scrub(runRes.json.error ?? "")}`);
  const run = runRes.json;
  console.log(`  run ${run.run.id} in ${Math.round((Date.now() - r0) / 1000)} s, control ${run.run.controlPassed ? "passed" : "did not pass"}`);
  if (run.proof?.ok) {
    const p = await call<unknown>("GET", `/proofs/${run.proof.runId}`, session);
    if (p.status === 200) writeFileSync(join(HERE, `round-${roundNo}.atlas.json`), JSON.stringify(p.json, null, 2) + "\n");
  }
  const byWho = (who: string) =>
    run.bets
      .filter((b) => b.who === who)
      .map((b) => {
        const v = run.verdicts.find((x) => x.betId === b.id);
        return { measures: b.measures, bet: b.answer, measured: v?.observed ?? run.run.result.measured[b.measures] ?? null, verdict: v?.outcome ?? null, reason: v?.reason ?? null, rationale: b.rationale ?? null, sealedHash: b.sealedHash };
      });
  const row = {
    round: roundNo,
    kind,
    experimentId: id,
    runId: run.run.id,
    claimantHeader: "both",
    postExperimentMs: experimentMs,
    chainFactsOk: exp.chainFacts?.ok ?? null,
    parity,
    slotsBeforeRun: waited.models.map((s) => ({ model: s.model, status: s.status, reason: s.reason ?? null, sealedHashes: s.sealed.length })),
    slotsAfterRun: run.models.map((s) => ({ model: s.model, status: s.status, reason: s.reason ?? null, detail: s.detail ?? null })),
    controlPassed: run.run.controlPassed ?? null,
    forkBlock: run.run.forkBlock ?? null,
    reference: run.run.result.references?.["refUsd1e18:cbETH"]?.value ?? null,
    script: byWho("human"),
    spark: byWho(`model:${SPARK_MODEL}`),
    sparkOpen: byWho(`model:${SPARK_OPEN_MODEL}`),
    scriptSealed: sealedBets.bets.length,
  };
  for (const who of ["spark", "sparkOpen", "script"] as const) {
    console.log(`  ${who}: ${row[who].map((b) => `${b.measures}=${JSON.stringify(b.bet.kind === "declined" ? `declined: ${b.bet.reason}` : b.bet.value)} → ${b.verdict}`).join("; ") || "no bets"}`);
  }
  rounds.push(row);
  writeFileSync(join(HERE, "live-rounds.json"), JSON.stringify(rounds, null, 2) + "\n");
}

try {
  for (let i = 0; i < 3; i++) await round("moonwell");
  await round("fixture");
} catch (e) {
  console.error(`stopped: ${scrub(e instanceof Error ? e.message : String(e))}`);
  process.exitCode = 1;
} finally {
  writeFileSync(join(HERE, "prompts.json"), JSON.stringify(prompts.map(({ user: _u, ...p }) => p), null, 2) + "\n");
  if (factsShown) {
    writeFileSync(join(HERE, "chain-facts.json"), JSON.stringify(factsShown, null, 2) + "\n");
    writeFileSync(join(HERE, "chain-facts-shown.txt"), chainFactsLines(factsShown).join("\n") + "\n");
  }
  const moonwellPrompt = prompts.find((p) => p.model === SPARK_MODEL && p.user.startsWith(SEEN_CONTEXT_HEADING));
  if (moonwellPrompt) writeFileSync(join(HERE, "prompt-moonwell.txt"), moonwellPrompt.user + "\n");
  const samePrompt = [...new Set(prompts.map((p) => p.round))].map((r) => {
    const hs = prompts.filter((p) => p.round === r).map((p) => p.messagesSha256);
    return { round: r, models: hs.length, identical: hs.length === 2 && hs[0] === hs[1] };
  });
  const summary = { at: new Date().toISOString(), spentUsd: { meta: Number(spent.meta.toFixed(6)), baseten: Number(spent.baseten.toFixed(6)) }, samePrompt, rounds: rounds.length };
  writeFileSync(join(HERE, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
