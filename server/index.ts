// Final review S3: FIRST, before any module reads process.env: the repo's .env (never printed).
import "./load-env";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { serverOptions, switchesFromEnv } from "./wiring";
import { removeSandboxLeftovers } from "./sandbox-leftovers";
import { describeClientRule, trustProxyFromEnv, trustedHopsFromEnv } from "./client-ip";
import { createMetaClient, DEFAULT_USAGE_PATH, loadBasetenKey } from "./meta/client";
import { createModelBudget, DEFAULT_CALLS_PER_HOUR, DEFAULT_EXPERIMENTS_PER_SESSION, DEFAULT_SPEND_CEILING_USD, envNumber, readUsageTotal } from "./meta/budget";
import { fileRefusalWriter } from "./proofs/refusals";
import { createProofStore } from "./evm-round";
import { dotEnv } from "./load-env";
import { currentStartupNotes } from "./startup-check";
import { executorFromEnv } from "../runners/executor/select";
import { warmUp } from "../runners/executor/warm";
import { join, resolve } from "node:path";
import { accessFromEnv } from "./access/setup";
import { withInviteGate } from "./access/gate";
import { meteredChainFacts, meteredExecutor, meteredGate } from "./access/metered";
import { runAs } from "./access/context";
import { createReplayGate, createRunGate, createSandboxGate } from "./replay-limits";
import { createChainFactsReader } from "../runners/evm/chain-facts";
import type { ModelBudget } from "./meta/budget";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 8787);

// E3 review r2 M4: a wrong proxy-hop setting stops the server here (it throws), instead of quietly counting the
// wrong address. The rule in use is printed below.
const hops = trustedHopsFromEnv();
// E3 review r2 M1: sandbox folders left by a run that was cut short (a server that died mid-run) are deleted.
const leftovers = removeSandboxLeftovers();


// S5: limits on model calls. The spend so far is read from the usage log once, at startup.
const usagePath = process.env.ATLAS_USAGE_PATH ?? DEFAULT_USAGE_PATH;
const spentAtStart = readUsageTotal(usagePath);
const spendCeilingUsd = envNumber(process.env.ATLAS_SPEND_CEILING_USD, DEFAULT_SPEND_CEILING_USD);
// G1 (D33, D34): invite codes, per-code budgets and the owner's reserve, kept on disk outside the repo
// (server/access/). ATLAS_REQUIRE_INVITE=1 on the hosted server; a wrong value or a missing code store stops it here.
let budgetRef: ModelBudget | undefined;
const access = accessFromEnv(process.env, { ceilingUsd: spendCeilingUsd, modelSpentUsd: () => budgetRef?.spentUsd() ?? 0 });
const budget = createModelBudget({
  callsPerHour: envNumber(process.env.ATLAS_MODEL_CALLS_PER_HOUR, DEFAULT_CALLS_PER_HOUR),
  experimentsPerSession: envNumber(process.env.ATLAS_MODEL_EXPERIMENTS_PER_SESSION, DEFAULT_EXPERIMENTS_PER_SESSION),
  spendCeilingUsd,
  // G1: the larger of the usage log and the ledger, so a host whose usage log could not be written still keeps its spend.
  spentAtStartUsd: Math.max(spentAtStart.usd, access.ledger.modelUsdAllTime()),
  guard: access.ledger,
});
budgetRef = budget;

// D07-01: Muse Spark Open (open weights, via Baseten) can be asked only when a Baseten key is on this
// machine (BASETEN_API_KEY or ~/.config/baseten/env). The key is only checked for presence here, never
// printed. ATLAS_SPARK_OPEN=off turns it off. When it is not available, the page's toggle says why.
const sparkOpen =
  process.env.ATLAS_SPARK_OPEN === "off"
    ? { available: false as const, reason: "turned off on this server (ATLAS_SPARK_OPEN=off)" }
    : loadBasetenKey()
      ? { available: true as const }
      : { available: false as const, reason: "no Baseten access on this server" };

// D04-04: each completed round's .atlas.json + run.json is written to <proofs dir>/<runId>/ ONLY when
// ATLAS_PUBLISH_PROOFS=1 (default off: kept in memory, served by GET /proofs/:runId and /replay/:runId).
// ATLAS_PROOFS_DIR moves the folder (and the refusal records with it) somewhere else, e.g. a scratch
// folder for a test round, so nothing lands in the public proofs/ by accident.
const publishProofs = process.env.ATLAS_PUBLISH_PROOFS === "1";
const proofsDir = process.env.ATLAS_PROOFS_DIR ? resolve(process.env.ATLAS_PROOFS_DIR) : fileURLToPath(new URL("../proofs", import.meta.url));
const proofs = createProofStore({ publish: publishProofs, dir: proofsDir });
const refusalsDir = process.env.ATLAS_PROOFS_DIR ? join(proofsDir, "refusals") : undefined;

// E4: ATLAS_EXECUTOR=modal runs every sandboxed command in a throwaway Modal Sandbox (the hosted mode, D25);
// unset or "local" keeps this machine's Node sandbox. An unknown value stops the server here. No fallback.
// G1: every sandbox is reserved and settled in the ledger (Modal's daily caps kept on disk too).
// G1 review B3: the Modal executor's own in-memory daily caps are lifted; the ledger keeps them on disk, with shares.
const executor = meteredExecutor(executorFromEnv(process.env, { maxSandboxesPerDay: 1_000_000, maxSandboxSecondsPerDay: 1_000_000 }), access.ledger);

// Every model role is wired in server/wiring.ts (E3 review M3: a test builds the same options). Each role is on
// unless its switch says off: ATLAS_MODEL_BETS, ATLAS_INVESTIGATOR, ATLAS_PROPOSER (E3), ATLAS_FIXER, ATLAS_ADVERSARY.
// S7: the live server writes a public refusal record for every gate refusal and can't-check verdict.
const on = switchesFromEnv();
const modelBetsOn = on.modelBets;
const investigatorOn = on.investigator;
const fixerOn = on.fixer;
const adversaryOn = on.adversary;
const inner = createApp({
  ...serverOptions(process.env, {
    makeChat: (timeoutMs) => createMetaClient(timeoutMs !== undefined ? { timeoutMs } : {}).chat,
    budget,
    sparkOpen,
    proofs,
    refusals: fileRefusalWriter(refusalsDir, (e) => console.error(`could not write a refusal record: ${e instanceof Error ? e.message : String(e)}`)),
  }),
  executor,
  // G1: EVM fork runs and replays are also counted per invite per day.
  // G1 review M3/B3: the owner's code has its own copy of each shared gate, so devs cannot use up the owner's slots.
  runGate: meteredGate(createRunGate(), access.ledger, "EVM run", { ownerGate: createRunGate() }),
  replayGate: meteredGate(createReplayGate(), access.ledger, "EVM replay", { ownerGate: createReplayGate() }),
  sandboxGate: meteredGate(createSandboxGate(), access.ledger, "sandbox start", { ownerGate: createSandboxGate(), count: false }),
  // G1 review m2: the chain-facts read counts as one EVM run of the invite that caused it; a failure is cached 60 s.
  chainFacts: meteredChainFacts((() => {
    const r = createChainFactsReader();
    return (block: number) => r.read(block);
  })(), access.ledger),
});
const app = withInviteGate(inner, { store: access.store, require: access.require, ledger: access.ledger, secureCookie: access.secureCookie, ...(access.publicOrigin ? { publicOrigin: access.publicOrigin } : {}) });
for (const note of access.notes) console.log(note);

console.log(`client address for the per-address caps: ${describeClientRule(trustProxyFromEnv(), hops)}`);
if (leftovers > 0) console.log(`deleted ${leftovers} leftover sandbox folder(s) from runs that were cut short`);

// Final review S3: which .env keys were read (names only, never values), and plain notes about this machine.
if (dotEnv.loaded.length > 0) console.log(`.env: read ${dotEnv.loaded.join(", ")} (values not shown)`);
for (const note of currentStartupNotes()) console.warn(`note: ${note}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Atlas server listening on http://localhost:${info.port} (model bets ${modelBetsOn ? "on" : "off"}, Muse Spark Open ${sparkOpen.available ? "available" : `not available (${sparkOpen.reason})`}, investigator ${investigatorOn ? "on" : "off"}, test proposer ${on.proposer ? "on" : "off"}, fixer ${fixerOn ? "on" : "off"}, adversary ${adversaryOn ? "on" : "off"}, outliner ${on.outliner ? "on" : "off"}, .atlas.json files ${publishProofs ? "written to the proofs folder" : "kept in memory only"}, sandbox ${executor.kind === "modal" ? "Modal (a throwaway container per run, no network)" : "local (Node permission model on this machine)"})`);
  // D32: warm Modal once, in the background; never blocks or stops the server.
  void runAs({ kind: "system", label: "server warm-up (D32)", route: "startup" }, () => warmUp(executor));
  if (modelBetsOn || investigatorOn) {
    console.log(`model budget: $${budget.spentUsd().toFixed(2)} already spent (usage log, ${spentAtStart.lines} lines${spentAtStart.skipped ? `, ${spentAtStart.skipped} unreadable` : ""})`);
  }
});
