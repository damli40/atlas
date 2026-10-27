// D07-01 live acceptance: open-weights mode through the real HTTP app (server/app.ts, in process).
//
// Four rounds, each with the header x-atlas-claimant: both, so Muse Spark (muse-spark-1.3, Meta's API)
// and Muse Spark Open (meta-models/muse-spark-open-1026, via Baseten) each seal their own bets on the
// same experiment before the run:
// - 3 rounds on the withRpcRetry fixture, scenario S3 (every call fails, 5 errors in a row);
// - 1 Moonwell Level 2 round (PR #578, fork of Base one block before MIP-X43 ran, proposal applied),
//   on the cbETH line a person picked before (proposals/ChainlinkOracleConfigs.sol line 42).
// The run is the real runner (the sandbox for TS, an anvil fork of Base for EVM); src/judge.ts judges.
//
// "You" in these rounds is this script: it seals the same fixed bets every time, chosen before any
// run (calls 3, totalWaitMs 3000, outcome "throws"; Moonwell: $2,200). They are labelled as such in
// the README; they are not a person's guesses.
//
// --moonwell-only: run only the Moonwell round and append it to the rounds already on file (used after the
// first pass stopped on a script bug before the Moonwell round asked any model; see the README).
// Run: with BASE_RPC_URL and GITHUB_TOKEN set in the environment, `pnpm exec tsx tests/evidence/D07-01/live.ts`
// Spend guard: stops before a call once Meta spend reaches $0.45 or Baseten spend $2.50 (task caps $0.50 / $3).
// Writes (next to this file): live-rounds.json (every round's answers), round-<n>.atlas.json, prompts.json,
// live-summary.json. Each model call appends its usage line to tests/evidence/usage/usage.jsonl.
// Nothing here prints or stores a key, an auth header or the RPC URL: errors are scrubbed of URLs.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../server/app.ts";
import { createModelBudget } from "../../../server/meta/budget.ts";
import { createMetaClient, providerFor, type ChatArgs, type ChatResult } from "../../../server/meta/client.ts";
import { createProofStore, MOONWELL_PR_REF } from "../../../server/evm-round.ts";
import { SPARK_MODEL, SPARK_OPEN_MODEL } from "../../../src/claimants.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAP = { meta: 0.45, baseten: 2.5 };
const scrub = (s: string) => s.replace(/https?:\/\/\S+/g, "<url>").replace(/wss?:\/\/\S+/g, "<url>");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// The production client settings (server/index.ts): 45 s per call, provider picked from the model id.
const client = createMetaClient({ timeoutMs: 45_000 });
const spent = { meta: 0, baseten: 0 };
const prompts: { round: number; model: string; provider: string; messagesSha256: string }[] = [];
let roundNo = 0;
const guarded = async (args: ChatArgs): Promise<ChatResult> => {
  const p = providerFor(args.model);
  if (spent[p] >= CAP[p]) return { ok: false, reason: `stopped by the D07-01 script: ${p} spend reached $${spent[p].toFixed(4)}` };
  // Only the first message set of each model per round is the prompt; a repair try adds to it.
  if (!prompts.some((x) => x.round === roundNo && x.model === args.model)) prompts.push({ round: roundNo, model: args.model, provider: p, messagesSha256: sha(JSON.stringify(args.messages)) });
  const r = await client.chat(args);
  spent[p] += r.usage?.usd ?? 0;
  return r;
};

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
  run: { id: string; startedAt: string; controlPassed?: boolean; forkBlock?: number; result: { measured: Record<string, unknown> } };
  verdicts: { betId: string; outcome: string; observed?: unknown; reason?: string; judgedBy: string }[];
  bets: { id: string; who: string; measures: string; answer: { kind: string; value?: unknown; reason?: string }; rationale?: string; sealedAt: string; sealedHash: string }[];
  models: Slot[];
  proof?: { ok: boolean; runId: string };
  falseAlarm?: unknown;
};

const MOONWELL_ONLY = process.argv.includes("--moonwell-only");
const rounds: unknown[] = MOONWELL_ONLY && existsSync(join(HERE, "live-rounds.json")) ? JSON.parse(readFileSync(join(HERE, "live-rounds.json"), "utf8")) : [];
if (MOONWELL_ONLY && existsSync(join(HERE, "prompts.json"))) prompts.push(...JSON.parse(readFileSync(join(HERE, "prompts.json"), "utf8")));
if (MOONWELL_ONLY) roundNo = rounds.length;
async function round(kind: "fixture" | "moonwell") {
  roundNo++;
  const session = `d07live${roundNo}`;
  console.log(`round ${roundNo} (${kind})`);
  let target: { ref: string; codeSha256: string };
  let params: unknown;
  let findingId: string | undefined;
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
    // The answer carries the PR's files; the experiment takes only ref and fingerprint.
    const pr = must(await call<{ ref: string; codeSha256: string }>("POST", "/targets", session, { kind: "github-pr", ref: MOONWELL_PR_REF }), "PR target");
    target = { ref: pr.ref, codeSha256: pr.codeSha256 };
    const f = must(await call<{ finding: { id: string } }>("POST", "/findings", session, { target: { ref: target.ref, codeSha256: target.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 }), "finding");
    findingId = f.finding.id;
    params = { shape: "apply-proposal-then-read", markets: "touched" };
    mine = [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }];
  }
  const exp = must(
    await call<{ experiment: { id: string }; models: Slot[]; claimant: string }>("POST", "/experiments", session, { target, params, ...(findingId ? { findingId } : {}) }, { "x-atlas-claimant": "both" }),
    "experiment",
  );
  const id = exp.experiment.id;
  const sealedBets = must(await call<{ bets: unknown[] }>("POST", "/bets", session, { experimentId: id, who: "human", bets: mine }), "script bets");
  const waited = must(await call<{ models: Slot[] }>("POST", `/experiments/${id}/model-bets`, session, {}), "model bets");
  for (const s of waited.models) console.log(`  ${s.model}: ${s.status}${s.reason ? ` (${s.reason})` : ""}, ${s.sealed.length} sealed`);
  const t0 = Date.now();
  const runRes = await call<RunOut & { error?: string }>("POST", "/runs", session, { experimentId: id });
  if (runRes.status !== 200) throw new Error(`run: HTTP ${runRes.status} ${scrub(runRes.json.error ?? "")}`);
  const run = runRes.json;
  console.log(`  run ${run.run.id} in ${Math.round((Date.now() - t0) / 1000)} s, control ${run.run.controlPassed ? "passed" : "did not pass"}`);
  let atlas: unknown = null;
  if (run.proof?.ok) {
    const p = await call<unknown>("GET", `/proofs/${run.proof.runId}`, session);
    if (p.status === 200) {
      atlas = p.json;
      writeFileSync(join(HERE, `round-${roundNo}.atlas.json`), JSON.stringify(atlas, null, 2) + "\n");
    }
  }
  const byWho = (who: string) =>
    run.bets
      .filter((b) => b.who === who)
      .map((b) => {
        const v = run.verdicts.find((x) => x.betId === b.id);
        return { measures: b.measures, bet: b.answer, measured: v?.observed ?? run.run.result.measured[b.measures] ?? null, verdict: v?.outcome ?? null, reason: v?.reason ?? null, rationale: b.rationale ?? null };
      });
  const row = {
    round: roundNo,
    kind,
    experimentId: id,
    runId: run.run.id,
    claimantHeader: "both",
    slotsBeforeRun: waited.models.map((s) => ({ model: s.model, status: s.status, reason: s.reason ?? null, sealedHashes: s.sealed.length })),
    slotsAfterRun: run.models.map((s) => ({ model: s.model, status: s.status, reason: s.reason ?? null, detail: s.detail ?? null })),
    controlPassed: run.run.controlPassed ?? null,
    forkBlock: run.run.forkBlock ?? null,
    script: byWho("human"),
    spark: byWho(`model:${SPARK_MODEL}`),
    sparkOpen: byWho(`model:${SPARK_OPEN_MODEL}`),
    scriptSealed: sealedBets.bets.length,
    falseAlarm: run.falseAlarm ?? null,
  };
  for (const who of ["spark", "sparkOpen", "script"] as const) {
    console.log(`  ${who}: ${row[who].map((b) => `${b.measures}=${JSON.stringify(b.bet.kind === "declined" ? "declined" : b.bet.value)} → ${b.verdict}`).join("; ") || "no bets"}`);
  }
  rounds.push(row);
  writeFileSync(join(HERE, "live-rounds.json"), JSON.stringify(rounds, null, 2) + "\n");
}

try {
  if (!MOONWELL_ONLY) for (let i = 0; i < 3; i++) await round("fixture");
  await round("moonwell");
} catch (e) {
  console.error(`stopped: ${scrub(e instanceof Error ? e.message : String(e))}`);
  process.exitCode = 1;
} finally {
  writeFileSync(join(HERE, "prompts.json"), JSON.stringify(prompts, null, 2) + "\n");
  const samePrompt = [...new Set(prompts.map((p) => p.round))].map((r) => {
    const hs = prompts.filter((p) => p.round === r).map((p) => p.messagesSha256);
    return { round: r, models: hs.length, identical: hs.length === 2 && hs[0] === hs[1] };
  });
  const before = MOONWELL_ONLY && existsSync(join(HERE, "live-summary.json")) ? (JSON.parse(readFileSync(join(HERE, "live-summary.json"), "utf8")) as { spentUsd: { meta: number; baseten: number } }) : null;
  if (before) {
    spent.meta += before.spentUsd.meta;
    spent.baseten += before.spentUsd.baseten;
  }
  const summary = { at: new Date().toISOString(), spentUsd: { meta: Number(spent.meta.toFixed(6)), baseten: Number(spent.baseten.toFixed(6)) }, samePrompt, rounds: rounds.length };
  writeFileSync(join(HERE, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
