// The Atlas HTTP server (Hono).
//
// Routes:
// - POST /targets {kind: "ts-fixture", ref} → the Target: which file, and the SHA-256 of its exact bytes.
// - POST /experiments {target, params, id?} (D02-04) → src/gate.ts decides; plain code writes the
//   questions. Human-proposed for now. A refused experiment is kept (422) and can never run.
// - POST /bets {experimentId, measures, answer, who: "human"} (D02-04) → the server checks the answer
//   fits the question, seals it at SERVER time with a SERVER nonce (server/bets.ts), and returns the
//   sealed bet with its hash but without the nonce. Refused with 409 once the run has started.
// - POST /runs {experimentId} (D02-04) → freezes the bets, checks every bet was sealed before the run
//   started, runs the control (once per code SHA-256) and the experiment in the sandbox, lets
//   src/judge.ts judge each bet, and reveals every bet in full (with its nonce).
// - POST /experiments/:id/model-bets (D02-06) → waits for the model's bets on that SAME experiment
//   and returns its slot: status ("sealed", "no_usable_answer", "off") and the sealed hashes only.
//   The model is asked as soon as the experiment is created (when the server was built with
//   `modelBets`), from the experiment and the plain-code questions only: never the person's bets.
//   Its answers and rationale stay on the server until POST /runs reveals every bet.
// - POST /investigate {target: {ref, codeSha256}} | {pr: "owner/repo#N"} (D04-03) → the Investigator
//   (muse-wonder-1.0, falling back to muse-spark-1.3) reads the target's files and returns up to 3
//   findings that plain code verified against the file, plus every place it removed and why. A PR is
//   read at its merge commit, with its title and description. The fixture's finding written by hand
//   stays as the labelled fallback when no verified finding exists. Limited per session and by the
//   model budget. The claim sentences are in the answer (model panel) only, never in a log line.
// - D04-04, the Moonwell pull request on the EVM runner:
//   POST /targets {kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578"} reads the PR at its
//   merge commit (server/targets/github.ts) and accepts it only when its files hash to the copy the
//   EVM runner applies (server/evm-round.ts); the answer lists the PR's files so a person can pick lines.
//   POST /investigate {target} works on it too. POST /findings {target, file, lineStart, lineEnd} records
//   lines a person picked (proposedBy human, no claim). POST /experiments takes an optional findingId.
//   On the PR, the gate allows apply-proposal-then-read (Level 2, fork 42194662) and price-read
//   (Level 1, fork 42194663); the round asks the one cbETH question. POST /runs forks Base with anvil
//   (30–90 s; each step is a runner line on the agent-log SSE), judges, and returns the false-alarm rows.
//   EVM runs are capped at once and per hour, per session and overall (env ATLAS_RUNS_*); over a cap the
//   answer is 429 with the reason, and the round stays open so the person can run it later.
// - Every completed round becomes an .atlas.json (src/atlasfile.ts), kept in memory and written to
//   <proofs dir>/<runId>/.atlas.json + run.json only when the caller turns publishing on
//   (server/index.ts: ATLAS_PUBLISH_PROOFS=1). GET /proofs/:runId returns it. GET /replay/:runId
//   re-executes it (TS: same seed; EVM: same fork block) and says whether `measured` is deep-equal.
//   EVM replays need the x-atlas-session header and are capped at once and per hour, per session and
//   overall (server/replay-limits.ts; env ATLAS_REPLAY_*); over a cap the answer is 429 with the reason.
// - POST /sweeps {target, params} (D06-02) → the waves screen. src/gate.ts allows only "concurrency-sweep"
//   here (1..200 callers); the control runs first (once per code SHA-256); then that many callers each call
//   the real function with the same failure pattern, on one virtual clock, in the sandbox. Returns the Run
//   (call times per virtual moment). No bets: nobody is asked anything about a sweep. One at a time per session.
// - X1, the code explorer (server/outline/routes.ts): POST /outline/jobs {repo, ref?, subfolder?} | {files} starts an
//   outline job (repo intake ≤ 50 files / 300 KB, plain-code code map, one Muse Wonder outline + one repair at most,
//   plain-code verification); GET /outline/jobs/:id, /outline, /parts/:partId, /atlas read it. Per session, per address.
// - GET /events/:sessionId (D02-05) → SSE of the session's agent events (server/log/). The session
//   is the `x-atlas-session` header; the server makes one and returns it when absent. Experiments
//   and bets belong to the session that made them.
//
// Plain words on trust:
// - The browser never seals and never writes a time. The server seals each bet when it arrives, so
//   "sealed before the run" is the server's own clock, checked again just before the run.
// - A stored bet whose hash no longer matches its fields stops the run with 409 before anything
//   runs, and nothing is judged.
// - Only the server's own copy of a target is used (from POST /targets), so the code hash and the
//   "pre-existing" label come from the server, not from the request.
// - Runs, targets and bets live in memory only. The one thing written to proofs/ (public) is a
//   refusal record, and only through the `refusals` writer the caller passes (server/index.ts passes
//   the file writer; tests pass an in-memory one or none): one for every gate refusal and every
//   can't-check verdict (S7). No key, URL or local path goes into a record.
// - One bet per bettor per question (S1): a second bet by the same person on the same question of
//   the same experiment is refused with 409. POST /bets answers with the person's whole sealed set,
//   which is exactly the set the run will judge.
// - Before the run, no log line, SSE event or API answer carries a model's answer values (S2).
// - Model calls are limited (server/meta/budget.ts, S5); when a limit is reached the model is not
//   asked and the person's round goes on.
// - D07-01, open-weights mode: the x-atlas-claimant header on POST /experiments picks who places the
//   model's bets: "spark" (default, Muse Spark 1.3 on Meta's API), "spark-open" (Muse Spark Open,
//   meta-models/muse-spark-open-1026, via Baseten) or "both" (each seals its own bets on the same
//   experiment, from the same prompt). GET /claimants says whether Muse Spark Open can be asked and,
//   if not, why; when it cannot, its slot says "not available (<reason>)" and no bet is ever made up.

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { judge } from "../src/judge";
import { canonicalJson, verifySeal } from "../src/seal";
import { bodyLimit } from "hono/body-limit";
import { createModelBudget, type ModelBudget } from "./meta/budget";
import { principalClientKey, runAs } from "./access/context";
import { createShareLimit, DEFAULT_GITHUB_SHARES, type ShareLimit } from "./access/shares";
import { cleanRecord, type RefusalWriter } from "./proofs/refusals";
import { checkAnswer, createBetStore, humanBetBody, humanBetsBody, MAX_BETS, MAX_EXPERIMENTS, modelSlotsOf, modelSlotView, modelSlotViews, newExperimentId, newRound, publicBet, sealedAfter, sealHumanBet, type BetStore, type ModelSlot, type Round } from "./bets";
import type { ChatArgs, ChatResult } from "./meta/client";
import { CLAIMANT_MODEL } from "./meta/roles/claimant";
import { modelDisplay, runClaimantBets } from "./meta/roles/claimant-bets";
import { AUTONOMOUS_PERSON_REASON, CLAIMANT_HEADER, CLAIMANT_MODES, DEFAULT_CLAIMANT_MODE, SPARK_OPEN_MODEL, modelsFor, parseClaimantMode, type ClaimantMode, type ClaimantsInfo } from "../src/claimants";
import { moonwellBetContext, moonwellLevelOf } from "../src/bet-context";
import { CHAIN_FACTS_BLOCK, type ChainFactsResult, type MoonwellChainFacts } from "../src/chain-facts";
import { createChainFactsReader } from "../runners/evm/chain-facts";
import { FIXTURE_FILE, FIXTURE_FINDING_LABEL, fixtureContextRange, fixtureFinding } from "./meta/roles/fixture-finding";
import { INVESTIGATOR_FALLBACK_MODEL, INVESTIGATOR_MODEL, runInvestigator, type InvestigatorFile } from "./meta/roles/investigator";
import { fetchGithubPr, type GithubPrTarget } from "./targets/github";
import { CALL_DEFAULT_WATCH_LIMIT_MS, SWEEP_GATE_CONTEXT, gate, type GateContext, type Question } from "../src/gate";
import type { AtlasFile, Bet, BettorSlot, Experiment, Finding, Run, RunAttempt, Target, Verdict } from "../src/types";
import type { Executor } from "../runners/runner";
import { localExecutor } from "../runners/executor/local";
import { AgentEventError, createAgentLog, oneLine, sessionEmitter, type AgentLog } from "./log/agentlog";
import { roundLog } from "./log/round";
import { BAD_SESSION, registerEventRoutes, sessionIdOf } from "./log/sse";
import { DEFAULT_WATCH_LIMIT_MS } from "../runners/ts/harness";
import { evmRunner } from "../runners/evm/runner";
import { falseAlarmFromRun } from "../runners/evm/level2";
import { redactRpc, scrubDeep } from "../runners/evm/redact";
import { RunDidNotFinish, runFailureReason } from "./run-failure";
import { createHourlyLimit, createReplayGate, createRunGate, createSandboxGate, type ReplayGate } from "./replay-limits";
import { clientIpOf, trustProxyFromEnv, trustedHopsFromEnv } from "./client-ip";
import { buildAtlasFile, callRunAgreesWithItsTrace, resultDiff, sameJson, timingRuleOf, verifyAtlasFile, withChange } from "../src/atlasfile";
import { ASKED_FIELD, createProofStore, EVM_GATE_CONTEXT, MOONWELL_PR_REF, evmTargetRefusal, extraCaptionsFor, forkBlockFor, humanFinding, recordedFindings, type ProofStore } from "./evm-round";
import { control as runTsControl, readFixture, runExperiment, tsRunner } from "../runners/ts/control";
import { changeAndReplay, type ChangeAnswer, type ReplayFn } from "./changes";
import { MUSE_CODE, type MuseExec } from "./meta/roles/fixer";
import { ADVERSARY_MODEL, runAdversary } from "./meta/roles/adversary";
import { functionDefaults } from "../src/experiment-name";
import { fileLines } from "../src/words";
import { createPaste, DEFAULT_PASTES_PER_IP_PER_HOUR, PASTE_BODY_BYTES, PASTE_SWEEP_MS, type PasteOptions } from "./paste";

/** E3 review r3: all pasted proof files together, at most this many characters (the oldest drops first). */
export const MAX_PASTED_PROOF_CHARS = 64 * 1024 * 1024;
import { guardPastedChat } from "./meta/pasted-guard";
import { pastedBetHead } from "../src/paste-context";
import { quizQuestionsFor } from "../src/quiz";
import { pastedSeenCap } from "./meta/roles/claimant-bets";
import { MAX_PASTED_PROMPT_CHARS } from "./meta/pasted-guard";
import { createOutlineRoutes, DEFAULT_OUTLINES_PER_IP_PER_HOUR, OUTLINE_BODY_BYTES, type OutlineOptions } from "./outline/routes";
import { memoryTrackStore, type Person, type TrackStore } from "./track-store";
import { entriesFromRound, recordBefore, trackRecordOf, weakSpotSummary, type TrackRecord } from "../src/track-record";
import { createLabeler, DEFAULT_LABELS_PER_CLIENT_PER_HOUR } from "./labels";
import { labelsForBettors } from "../src/failure-labels";
import { currentPrincipal } from "./access/context";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
/** X3: the page's random per-browser id (localStorage), naming "this browser" for the track record when there is no invite code. */
export const BROWSER_HEADER = "x-atlas-browser";
const PRE_EXISTING_PATH = resolve(REPO_ROOT, "PRE-EXISTING.md");
export const PRE_EXISTING_LABEL = { label: "Pre-existing: written before the hackathon", listedIn: "PRE-EXISTING.md" } as const;

// ---------- request schemas ----------

const PR_REF = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}#[1-9]\d{0,6}$/;
const targetBody = z.union([
  z.object({ kind: z.literal("ts-fixture"), ref: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("github-pr"), ref: z.string().regex(PR_REF, "ref must look like owner/repo#123") }),
]);

const findingBody = z
  .object({
    target: z.object({ ref: z.string().min(1).max(200), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    file: z.string().min(1).max(300),
    lineStart: z.number().int(),
    lineEnd: z.number().int(),
  })
  .strict();

const experimentBody = z.object({
  /** Optional: a caller-chosen id (letters, digits, _ or -). The server makes one when absent. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  target: z.object({ ref: z.string().min(1), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  runner: z.enum(["ts", "evm"]).optional(),
  /** D04-04: the finding this round works on (from POST /investigate or POST /findings in this session). */
  findingId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  /** E3: a pasted target's test proposed by Muse Wonder in this session (POST /paste/proposals), used instead of params. */
  proposalId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  /** E3 review (D10): the person's test was edited from this proposal of Muse Wonder's (POST /paste/proposals). */
  editedFrom: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  // The params are checked by src/gate.ts below (not here), so a refusal carries the gate's plain reason.
  params: z.unknown().optional(),
  /** U1 (D47/D48): ask the questions as a quiz (options written by plain code, src/quiz.ts). Pasted call-function tests only. */
  quiz: z.literal(true).optional(),
  // Human-proposed only, for now (the Claimant's model bets arrive through the server, not this route).
  proposedBy: z.object({ role: z.literal("human") }).optional(),
});

const runBody = z.object({ experimentId: z.string().min(1).max(64) }).strict();

const sweepBody = z
  .object({
    target: z.object({ ref: z.string().min(1).max(200), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    // Checked by src/gate.ts (SWEEP_GATE_CONTEXT), so a refusal carries the gate's plain reason.
    params: z.unknown(),
  })
  .strict();

function plainReason(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join(".") : "body"}: ${i.message}`)
    .join("; ");
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** True when PRE-EXISTING.md names this fixture path. The label is shown only then. */
function listedAsPreExisting(fixturePath: string): boolean {
  if (!existsSync(PRE_EXISTING_PATH)) return false;
  const text = readFileSync(PRE_EXISTING_PATH, "utf8");
  const escaped = fixturePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The path must stand alone: not part of a longer path such as "x.ts.bak" (a full stop ending a sentence is fine).
  return new RegExp(`(?<![\\w./-])${escaped}(?![\\w/-]|\\.\\w)`).test(text);
}

/** What the gate allows in a TS round: "retry-scenario". The sweep (D06-02) has its own route and context (SWEEP_GATE_CONTEXT), with no bets. */
export const TS_GATE_CONTEXT: GateContext = { shapes: ["retry-scenario"], watchLimitMs: DEFAULT_WATCH_LIMIT_MS };

/**
 * D19: the "what the bettor sees" text for an EVM (Moonwell) round, built by the same function the
 * bet screen renders (src/bet-context.ts). Undefined for any other round (the fixture keeps its prompt).
 * `pr` is what the screen's pull request line shows; `fileText` is the chosen finding's whole file.
 */
export function seenContextFor(
  exp: Experiment,
  questions: readonly Question[],
  finding: Finding,
  fileText: string,
  pr: { title: string; fileCount: number },
  chainFacts?: ChainFactsResult,
): string | undefined {
  if (exp.runner !== "evm") return undefined;
  const level = moonwellLevelOf(exp.params.shape);
  const q = questions[0];
  if (!level || !q) return undefined;
  const t = exp.target;
  return moonwellBetContext({
    level,
    question: q,
    finding,
    fileText,
    pr: { ref: t.ref, title: pr.title, ...(t.commit !== undefined ? { commit: t.commit } : {}), fileCount: pr.fileCount, codeSha256: t.codeSha256 },
    ...(chainFacts !== undefined ? { chainFacts } : {}),
  });
}

/** E3 review r3 minor 3: a call-function test with every left-out field set to what the run uses anyway. */
export function withCallDefaults(params: unknown): unknown {
  const p = params as { shape?: string; watchLimitMs?: number; args?: unknown[] };
  if (!p || p.shape !== "call-function" || !Array.isArray(p.args)) return params;
  return {
    ...p,
    watchLimitMs: p.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS,
    args: p.args.map((a) => {
      const arg = a as { kind?: string; calls?: { do?: string; afterMs?: number }[] };
      if (arg.kind !== "stand-in" || !Array.isArray(arg.calls)) return a;
      return { ...arg, calls: arg.calls.map((st) => (st.do === "return" ? { ...st, afterMs: st.afterMs ?? 0 } : st)) };
    }),
  };
}

/** E3: a pasted experiment as the routes return it: the page already has the code, so the source is not echoed back. */
export function withoutSource(exp: Experiment): Experiment {
  if (exp.target.kind !== "pasted") return exp;
  const { source: _kept, ...target } = exp.target;
  return { ...exp, target };
}

/** E3 review M4: a pasted round's proof file as anyone but its session sees it: the source removed, the fingerprint kept. */
export function withheldSource(file: AtlasFile): AtlasFile & { sourceWithheld: true } {
  const strip = <T extends { kind: string; source?: string }>(t: T): T => {
    if (t.kind !== "pasted") return t;
    const { source: _s, ...rest } = t;
    return rest as T;
  };
  // E3 review r2 M1: nor the session's activity log (other pastes' fingerprints, gate reasons quoting values). The
  // test, the facts, the verdicts and the models' bets stay: they are what the proof is.
  return { ...file, target: strip(file.target), experiments: file.experiments.map((e) => ({ ...e, target: strip(e.target) })), agentLog: [], sourceWithheld: true };
}

/** E3: the stand-in "finding" a pasted round hands the bet role (the whole file; never in a prompt or a proof file). */
export function wholeFileFinding(ref: string, source: string): Finding {
  const lines = (source.endsWith("\n") ? source.slice(0, -1) : source).split("\n").length;
  return { id: "pasted-file", file: ref, lineStart: 1, lineEnd: lines, kind: "other", claim: "", verified: true, quotedSnippet: "", proposedBy: { role: "human", model: "none: picked by a person" } };
}

// ---------- the app ----------

/**
 * Model bets (D02-06). When given, the server asks this model for its bets on every allowed
 * experiment, as soon as the experiment exists. Absent (the default, and in tests unless they pass a
 * mocked chat), no model is asked and the slot says so.
 */
export interface ModelBetsOptions {
  chat: (args: ChatArgs) => Promise<ChatResult>;
  model?: string;
  now?: () => Date;
  /**
   * The longest the server waits for the model's bets (default MODEL_BETS_DEADLINE_MS). POST /runs
   * waits for them, so a model that never answers must not hold a person's run for minutes.
   */
  deadlineMs?: number;
  /** Call and spend limits (S5). Default: createModelBudget() with its defaults (60 calls an hour, 10 experiments a session, $100). */
  budget?: ModelBudget;
  /**
   * D07-01: can this server ask Muse Spark Open (via Baseten)? Default: not available, "this server
   * was not set up for Baseten". server/index.ts sets it from the Baseten key's presence (no paid call).
   */
  sparkOpen?: { available: true } | { available: false; reason: string };
}

/** How long the server waits for the model's bets before it gives up and the slot says so. */
export const MODEL_BETS_DEADLINE_MS = 60_000;

/** The largest JSON body any route reads (a whole round's bets fit in a few KB). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Runs kept in memory (with their traces); the oldest are dropped first. */
export const MAX_RUNS = 1000;

/** The Investigator (D04-03). Absent: POST /investigate answers that no model is asked. */
export interface InvestigatorOptions {
  chat: (args: ChatArgs) => Promise<ChatResult>;
  model?: string;
  /** null: no fallback model. */
  fallbackModel?: string | null;
  /** Reads a merged PR at its merge commit. Default: server/targets/github.ts fetchGithubPr. */
  fetchPr?: (pr: { owner: string; repo: string; number: number }) => Promise<GithubPrTarget>;
  /** Shared with model bets when both are on. Default: the model-bets budget, else createModelBudget(). */
  budget?: ModelBudget;
}

/** Investigations one session may ask for (each is 1–4 paid model calls). */
export const MAX_INVESTIGATIONS_PER_SESSION = 3;
/** The largest target the Investigator reads, in characters (about 150k tokens, about $0.60 of Wonder input). */
export const MAX_INVESTIGATE_CHARS = 600_000;
/** Sessions whose investigation counts and findings are kept; the oldest drop first. */
const MAX_INVESTIGATED_SESSIONS = 1000;
/** Pull requests kept after reading (their files); the oldest drop first. */
const MAX_CACHED_PRS = 20;

const investigateBody = z.union([
  z.object({ target: z.object({ ref: z.string().min(1).max(200), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }) }).strict(),
  z.object({ pr: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}#[1-9]\d{0,6}$/, "pr must look like owner/repo#123") }).strict(),
]);

export interface AppOptions {
  investigator?: InvestigatorOptions;
  executor?: Executor;
  agentLog?: AgentLog;
  betStore?: BetStore;
  modelBets?: ModelBetsOptions;
  /** Receives a record for every gate refusal and every can't-check verdict (S7). Default: none (nothing is written). */
  refusals?: RefusalWriter;
  /** Reads a merged PR (POST /targets for github-pr). Default: the investigator's fetchPr, else server/targets/github.ts. */
  fetchPr?: (pr: { owner: string; repo: string; number: number }) => Promise<GithubPrTarget>;
  /** Runs an EVM experiment at its fork block. Default: runners/evm/runner.ts (spawns anvil; needs BASE_RPC_URL). Tests pass a stand-in. */
  evmRun?: (exp: Experiment, opts: { forkBlock: number; onProgress: (step: string) => void }) => Promise<Run>;
  /**
   * D22: reads the chain facts every Moonwell bettor sees, at block 42194662 (before the proposal ran). Default:
   * a cached reader on a short-lived anvil fork (runners/evm/chain-facts.ts) when the real EVM runner is in use;
   * none when a stand-in `evmRun` is given (tests), and then the bettors see "Atlas could not read them". `null`: none.
   */
  chainFacts?: ((block: number) => Promise<MoonwellChainFacts>) | null;
  /** Where .atlas.json files go. Default: memory only (nothing written). */
  proofs?: ProofStore;
  /** Caps on EVM replays (S5). Default: createReplayGate() with limits from the environment (server/replay-limits.ts). */
  replayGate?: ReplayGate;
  /** Caps on EVM runs (POST /runs). Default: createRunGate() with limits from the environment (ATLAS_RUNS_*). */
  runGate?: ReplayGate;
  /** E3 review B5: caps on every sandbox start (TS runs, sweeps, change replays, replays). Default: createSandboxGate() (ATLAS_SANDBOX_*). */
  sandboxGate?: ReplayGate;
  /** S5: read the client address from X-Forwarded-For's first hop (behind a proxy). Default: ATLAS_TRUST_PROXY=1. */
  trustProxy?: boolean;
  /** S5: model rounds (experiments that ask the model) and investigations one client address may start an hour. */
  perClientModelLimits?: { modelRoundsPerHour?: number; investigationsPerHour?: number };
  /**
   * D06-01, POST /changes: the Fixer (Muse Code via `muse exec`, chat fallback). Absent: no model is
   * asked and the answer says so. `museExec: null` skips Muse Code (chat fallback only).
   */
  fixer?: { museExec?: MuseExec | null; chat: (args: ChatArgs) => Promise<ChatResult>; budget?: ModelBudget; repairWith?: "same" | "chat-fallback" };
  /** D06-01: replays a change on the TS runner. Default: tsRunner(executor).replayWithChange. */
  tsReplay?: ReplayFn;
  /** D06-01: replays a change on the EVM runner. Default: evmRunner().replayWithChange (spawns anvil; needs BASE_RPC_URL). */
  evmReplay?: ReplayFn;
  /**
   * D07-02, POST /adversary: the Adversary (muse-spark-1.3) proposes one more experiment after a run, and
   * Atlas runs it as an autonomous round (the claimant model(s) the x-atlas-claimant header picks bet, no person, no click). Absent: no model is asked
   * and the answer says so. Spark's bets in that round use `modelBets` (absent: Spark's slot says "not asked").
   */
  adversary?: { chat: (args: ChatArgs) => Promise<ChatResult>; model?: string; budget?: ModelBudget };
  /**
   * E3, the paste flow (server/paste.ts): Muse Wonder's test proposals (`proposer`, absent = not asked) and the
   * runners by language (default runners/pasted-registry.ts).
   */
  paste?: PasteOptions;
  /**
   * X1, the code explorer's outline jobs (server/outline/routes.ts): Muse Wonder's outline (`outliner`, absent = not
   * asked; the code map is still built) and the GitHub reader (tests pass a stand-in).
   */
  outline?: OutlineOptions;
  /** G1 review B7: the shared GitHub allowance (one object for every app on the server). */
  githubReads?: ShareLimit;
  /** G1 review B7: read the Moonwell PR once at startup so the finale never depends on GitHub later. */
  warmMoonwellPr?: boolean;
  /**
   * X3 (D27): where each person's track record is kept (server/track-store.ts). server/index.ts passes the on-disk
   * store next to the invite store; default: in memory only.
   */
  trackStore?: TrackStore;
}

/** D07-02: "what else?" questions one session may ask (each is up to 2 Adversary calls, Spark's bets and one run). */
export const MAX_ADVERSARY_PER_SESSION = 3;

/** D07-02: what POST /adversary answers. The Adversary's `why` is model text, shown only in a model panel. */
export interface AdversaryAnswer {
  ok: boolean;
  /** The run the Adversary read. */
  fromRunId: string;
  /** Plain reason when there is no autonomous verdict (not asked, no usable answer, the run could not finish). */
  reason?: string;
  adversary: {
    model: string;
    display: string;
    /** The proposal the gate allowed: its experiment id, its plain-code name (shape id + params) and its params. */
    proposed?: { experimentId: string; name: string; params: Experiment["params"] };
    /** The model's own sentence. Model panel only, never a verdict. */
    why?: string;
    /** Proposals the gate refused on the way (recorded in proofs/refusals/ by the live server). Screen-safe reasons only. */
    rejected: { id: string; safeReason: string }[];
    /** Dollars the Adversary's calls cost, as the API reported them (null when no call reported usage). */
    usd: number | null;
  } | null;
  /** The person's slot in the autonomous round: never asked. */
  person?: { status: "not asked"; reason: string };
  /** The autonomous round: the experiment, the plain-code questions, Spark's slot, and the run's answer (as POST /runs). */
  round?: Record<string, unknown>;
}

/** D06-01: changes one session may ask for (each is up to 4 paid model calls and one replay). */
export const MAX_CHANGES_PER_SESSION = 3;
const changeBody = z.object({ runId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict();

/** S5: per client address, an hour (env ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR, ATLAS_INVESTIGATIONS_PER_IP_PER_HOUR). */
export const DEFAULT_MODEL_ROUNDS_PER_IP_PER_HOUR = 20;
/** M5 (day-6 review): sweeps one client address may run per hour (sessions are free to make). */
export const DEFAULT_SWEEPS_PER_IP_PER_HOUR = 120;
export const DEFAULT_INVESTIGATIONS_PER_IP_PER_HOUR = 6;
const envCount = (raw: string | undefined, fallback: number) => (raw !== undefined && /^\d{1,4}$/.test(raw.trim()) ? Number(raw.trim()) : fallback);

const defaultEvmRun: NonNullable<AppOptions["evmRun"]> = (exp, opts) => evmRunner({ onProgress: opts.onProgress }).run(exp, { forkBlock: opts.forkBlock });

export function createApp(opts: AppOptions = {}) {
  const executor = opts.executor ?? localExecutor;
  const betStore = opts.betStore ?? createBetStore(); // D02-04: experiments and server-sealed bets, per session
  const agentLog = opts.agentLog ?? createAgentLog(); // D02-05: per-session agent events
  const refusals: RefusalWriter = opts.refusals ?? (() => {});
  const budget = opts.modelBets?.budget ?? opts.investigator?.budget ?? opts.adversary?.budget ?? opts.paste?.proposer?.budget ?? opts.outline?.outliner?.budget ?? (opts.modelBets || opts.investigator || opts.adversary || opts.paste?.proposer || opts.outline?.outliner ? createModelBudget() : undefined);
  const modelChat = opts.modelBets && budget ? budget.wrap(opts.modelBets.chat) : undefined;
  const investigatorChat = opts.investigator && budget ? budget.wrap(opts.investigator.chat) : undefined;
  const adversaryChat = opts.adversary && budget ? budget.wrap(opts.adversary.chat) : undefined;
  /** Per session: how many investigations it asked for, and the verified findings by target codeSha256. */
  const investigations = new Map<string, { count: number; findings: Map<string, Finding[]> }>();
  const investigationsOf = (sessionId: string) => {
    let s = investigations.get(sessionId);
    if (s) investigations.delete(sessionId);
    else s = { count: 0, findings: new Map() };
    investigations.set(sessionId, s); // most recently used last
    while (investigations.size > MAX_INVESTIGATED_SESSIONS) investigations.delete(investigations.keys().next().value!);
    return s;
  };
  const prCache = new Map<string, Promise<GithubPrTarget>>();
  /** G1 review B7: a failed read is remembered for 60 s, so asking again does not spend GitHub's allowance. */
  const prFailed = new Map<string, { at: number; error: unknown }>();
  const fetchPrFn = opts.fetchPr ?? opts.investigator?.fetchPr ?? ((p: { owner: string; repo: string; number: number }) => fetchGithubPr(p));
  /** G1 review B7: GitHub reads per invite code an hour (shared with the owner's app when the server passes one in). */
  const githubReads = opts.githubReads ?? createShareLimit(DEFAULT_GITHUB_SHARES, "GitHub reads");
  const prKey = (ref: { owner: string; repo: string; number: number }) => `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
  const PINNED_PR = MOONWELL_PR_REF.toLowerCase();
  /**
   * Reads a PR once (cached). G1 review B7: a read that is not cached takes one GitHub read from the spender's share
   * (refused with the reason, nothing fetched); a failed read is remembered for 60 s; the Moonwell PR (the finale) is
   * never dropped from the cache once read.
   */
  const readPr = (ref: { owner: string; repo: string; number: number }, fetchPr = fetchPrFn): Promise<GithubPrTarget> => {
    const key = prKey(ref);
    let got = prCache.get(key);
    if (!got) {
      const failed = prFailed.get(key);
      if (failed && Date.now() - failed.at < 60_000) return Promise.reject(failed.error);
      const allowed = githubReads.take();
      if (!allowed.ok) return Promise.reject(new Error(allowed.reason));
      got = fetchPr(ref);
      prCache.set(key, got);
      got.then(
        () => prFailed.delete(key),
        (error: unknown) => {
          prCache.delete(key);
          prFailed.set(key, { at: Date.now(), error });
          while (prFailed.size > 200) prFailed.delete(prFailed.keys().next().value!);
        },
      );
      while (prCache.size > MAX_CACHED_PRS) {
        const oldest = [...prCache.keys()].find((k) => k !== PINNED_PR);
        if (oldest === undefined) break;
        prCache.delete(oldest);
      }
    }
    return got;
  };
  // G1 review B7: the server may read the finale's PR once at startup (as the server itself), so it is cached and pinned.
  if (opts.warmMoonwellPr) {
    const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(MOONWELL_PR_REF)!;
    void runAs({ kind: "system", label: "Moonwell PR warm-up", route: "startup" }, () => readPr({ owner: m[1]!, repo: m[2]!, number: Number(m[3]) }).catch(() => undefined));
  }
  /** github-pr targets Atlas registered, with their files, by codeSha256. */
  const prTargets = new Map<string, GithubPrTarget>();
  const prFiles = (pr: GithubPrTarget) => pr.files.filter((f) => f.content !== undefined).map((f) => ({ path: f.path, text: f.content! }));
  /** Per session: every finding (Investigator's or a person's) by id. */
  const sessionFindings = new Map<string, Map<string, Finding>>();
  const findingsOf = (sessionId: string) => {
    let m = sessionFindings.get(sessionId);
    if (!m) {
      m = new Map();
      sessionFindings.set(sessionId, m);
      while (sessionFindings.size > MAX_INVESTIGATED_SESSIONS) sessionFindings.delete(sessionFindings.keys().next().value!);
    }
    return m;
  };
  const evmRun = opts.evmRun ?? defaultEvmRun;
  // D22: one reader per app, so the facts are read once per fork block and reused by every later round.
  const readFacts: ((block: number) => Promise<MoonwellChainFacts>) | null =
    opts.chainFacts !== undefined
      ? opts.chainFacts
      : opts.evmRun
        ? null
        : (() => {
            const r = createChainFactsReader();
            return (block: number) => r.read(block);
          })();
  /**
   * D22: the facts for a Moonwell round, read BEFORE any bet on it is asked for. Always at CHAIN_FACTS_BLOCK,
   * whatever the round's level. Undefined for a round that is not a Moonwell level. Never throws.
   */
  const chainFactsFor = async (exp: Experiment): Promise<ChainFactsResult | undefined> => {
    if (exp.runner !== "evm" || !exp.gate.allowed || !moonwellLevelOf(exp.params.shape)) return undefined;
    if (!readFacts) return { ok: false, reason: "this server reads no chain facts" };
    try {
      return { ok: true, facts: await readFacts(CHAIN_FACTS_BLOCK) };
    } catch (e) {
      return { ok: false, reason: oneLine(redactRpc(e instanceof Error ? e.message : String(e)), 300) };
    }
  };
  const replayGate = opts.replayGate ?? createReplayGate();
  const runGate = opts.runGate ?? createRunGate();
  const sandboxGate = opts.sandboxGate ?? createSandboxGate();
  /** E3 review B5/M4: which session made each pasted round (its source and its replays are that session's only). */
  const pastedOwners = new Map<string, string>();
  const trustProxy = opts.trustProxy ?? trustProxyFromEnv();
  const proxyHops = trustedHopsFromEnv(); // E3 review r2 M4: read once; an invalid value throws here, not per request
  // G1: with an invite code, the per-address limits count by the code (server/access/context.ts), so a new address or a
  // new X-Forwarded-For hop gives nothing extra; without one, by the client address as before.
  const clientOf = (c: Context) => principalClientKey() ?? clientIpOf(c, trustProxy, proxyHops);
  const modelRoundsByIp = createHourlyLimit(opts.perClientModelLimits?.modelRoundsPerHour ?? envCount(process.env.ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR, DEFAULT_MODEL_ROUNDS_PER_IP_PER_HOUR), "model rounds");
  const investigationsByIp = createHourlyLimit(opts.perClientModelLimits?.investigationsPerHour ?? envCount(process.env.ATLAS_INVESTIGATIONS_PER_IP_PER_HOUR, DEFAULT_INVESTIGATIONS_PER_IP_PER_HOUR), "investigations");
  const proofStore = opts.proofs ?? createProofStore({ publish: false });
  // E3: a pasted round's .atlas.json holds the pasted source, so it is kept in memory only, never published to disk
  // (the proofs folder is part of the public repo), whatever the main store does.
  // E3 review r3 M2 / minor 1: a pasted proof file is kept WITHOUT its source; the source is re-attached from the one
  // shared copy (server/paste.ts) when the file is read, so the file lives exactly as long as the source (2 hours after
  // its last paste), not "until 200 later runs". All pasted proof files together are capped at MAX_PASTED_PROOF_CHARS
  // (oldest dropped first).
  const pastedFiles = new Map<string, { file: AtlasFile; chars: number }>();
  let pastedFileChars = 0;
  const stripSource = <T extends { kind: string; source?: string }>(t: T): T => {
    const { source: _s, ...rest } = t;
    return rest as T;
  };
  const pastedProofs = {
    put(file: AtlasFile, _run: unknown) {
      const bare: AtlasFile = { ...file, target: stripSource(file.target), experiments: file.experiments.map((e) => ({ ...e, target: stripSource(e.target) })) };
      const chars = JSON.stringify(bare).length;
      const id = file.runs[0]!.id;
      const old = pastedFiles.get(id);
      if (old) pastedFileChars -= old.chars;
      pastedFiles.set(id, { file: bare, chars });
      pastedFileChars += chars;
      while (pastedFileChars > MAX_PASTED_PROOF_CHARS && pastedFiles.size > 1) {
        const [k, v] = pastedFiles.entries().next().value!;
        pastedFiles.delete(k);
        pastedOwners.delete(k);
        pastedFileChars -= v.chars;
      }
      return { published: false } as { published: boolean; error?: string };
    },
    get(runId: string): AtlasFile | undefined {
      const e = pastedFiles.get(runId);
      if (!e) return undefined;
      const shared = paste.sourceTarget(e.file.target);
      if (!shared || typeof shared.source !== "string") {
        pastedFiles.delete(runId);
        pastedOwners.delete(runId);
        pastedFileChars -= e.chars;
        return undefined; // the source expired, and the file with it
      }
      const withSource = <T extends { kind: string }>(t: T): T => ({ ...t, source: shared.source });
      return { ...e.file, target: withSource(e.file.target), experiments: e.file.experiments.map((x) => ({ ...x, target: withSource(x.target) })) };
    },
  };
  /** E3 review r2 M1 / r3 B1: drop everything made from a pasted source 2 hours after it was last pasted. */
  const expirePasted = () => {
    for (const o of paste.expire()) betStore.peek(o.sessionId)?.delete(o.experimentId);
    for (const id of [...pastedFiles.keys()]) pastedProofs.get(id); // drops files whose source expired
  };
  // Checked every minute, and before every request (at most once a second), so nothing expired is ever served.
  const sweeper = setInterval(expirePasted, PASTE_SWEEP_MS);
  (sweeper as { unref?: () => void }).unref?.();
  let lastSweep = 0;
  const sweepSoon = () => {
    const now = Date.now();
    if (now - lastSweep < 1_000) return;
    lastSweep = now;
    expirePasted();
  };
  /** E3 review r3 minor 1: a round that is running, or holds the person's sealed bets that have not run, is never dropped. */
  const keepRound = (sid: string, eid: string) => {
    const r = betStore.peek(sid)?.get(eid);
    // The person's sealed bets, not the models' (they seal on every round by themselves); the session's 50-experiment
    // cap still bounds what a person can protect.
    return r !== undefined && (r.status === "running" || (r.status === "open" && r.bets.some((b) => b.who === "human")));
  };
  const proofOf = (runId: string) => proofStore.get(runId) ?? pastedProofs.get(runId);
  const pastedExperimentsByIp = createHourlyLimit(envCount(process.env.ATLAS_PASTED_EXPERIMENTS_PER_IP_PER_HOUR, 200), "experiments on pasted code");
  const pastesByIp = createHourlyLimit(envCount(process.env.ATLAS_PASTES_PER_IP_PER_HOUR, DEFAULT_PASTES_PER_IP_PER_HOUR), "pastes");
  // X3 (D27): each person's track record, from their sealed bets and the judge's verdicts only (src/track-record.ts).
  const trackStore = opts.trackStore ?? memoryTrackStore();
  /**
   * Who "the person" is for the track record: the invite code (by its id) when there is one; otherwise this browser
   * (the page's random id in x-atlas-browser, kept in localStorage); otherwise the session.
   */
  const personOf = (c: Context, sessionId: string): Person => {
    const p = currentPrincipal();
    if (p?.kind === "invite") return { kind: "invite", id: p.id };
    const b = c.req.header(BROWSER_HEADER);
    if (b && /^[A-Za-z0-9_-]{16,64}$/.test(b)) return { kind: "browser", id: b };
    return { kind: "session", id: sessionId };
  };
  const recordOf = (person: Person): TrackRecord => trackRecordOf(trackStore.entries(person));
  const paste = createPaste(opts.paste ?? {}, {
    agentLog,
    betStore,
    ...(budget ? { budget } : {}),
    takeModelRound: (c) => modelRoundsByIp.take(clientOf(c)),
    takePaste: (c) => pastesByIp.take(clientOf(c)),
    executorKind: executor.kind,
    // X3: Muse Wonder is told only the kinds of question where this person's bets most often didn't match (counts).
    weakSpotsOf: (c, sessionId) => weakSpotSummary(recordOf(personOf(c, sessionId))),
  });
  opts.paste?.expose?.(paste);
  /** E3 review r2 B3: a pasted round's bettor text: its shared test part, then the file's shared numbered block. */
  const seenOf = (round: Round): string | undefined => {
    if (round.seenHead === undefined || !round.seenFile) return undefined;
    return `${round.seenHead}\n${paste.fileBlock(round.seenFile.codeSha256, round.experiment.target.source ?? "", round.seenFile.exportLine)}`;
  };
  /**
   * E3: the known-case check of a pasted language's runner on this server's executor. E4 (D31) reuses a passed
   * control for up to 10 minutes per (harness, executor); the run records the control it relied on.
   */
  const pastedControl = async (lang: "js" | "ts" | "py"): Promise<Run> => {
    const runner = paste.runners[lang];
    if (!runner) throw new Error(`this server has no runner for ${lang}`);
    const run = await runner.control(executor);
    keepRun(run);
    return run;
  };
  /** E3: one pasted experiment through its language's runner, after that runner's known-case check. */
  const runPasted = async (exp: Experiment, seed?: string): Promise<Run> => {
    const lang = exp.target.language ?? "js";
    const runner = paste.runners[lang];
    if (!runner) throw new Error(`this server has no runner for ${lang}`);
    const ctl = await pastedControl(lang);
    // R1 (D42): a replay runs with the original run's seed, so it reproduces exactly.
    return runner.run(exp, ctl, executor, seed !== undefined ? { seed } : undefined);
  };
  // X1: outline jobs, per session, limited per client address (env ATLAS_OUTLINES_PER_IP_PER_HOUR) and by the model budget.
  const outlinesByIp = createHourlyLimit(envCount(process.env.ATLAS_OUTLINES_PER_IP_PER_HOUR, DEFAULT_OUTLINES_PER_IP_PER_HOUR), "outlines");
  const outline = createOutlineRoutes(opts.outline ?? {}, { agentLog, ...(budget ? { budget } : {}), takeOutline: (c) => {
      // An outline job reads code, so it also counts against E3's per-address paste allowance. Both are checked
      // before either is counted (X1 review round 3, minor 3), so a refusal never spends the other allowance.
      const ip = clientOf(c);
      const a = outlinesByIp.check(ip);
      if (!a.ok) return a;
      const b = pastesByIp.check(ip);
      if (!b.ok) return b;
      outlinesByIp.take(ip);
      return pastesByIp.take(ip);
    }, takeModelRound: (c) => modelRoundsByIp.take(clientOf(c)), takeGithubRead: () => githubReads.take() });
  // X3 review M3: label requests per client an hour (per invite code when there is one).
  const labelsByIp = createHourlyLimit(envCount(process.env.ATLAS_LABELS_PER_IP_PER_HOUR, DEFAULT_LABELS_PER_CLIENT_PER_HOUR), "label requests");
  // X3 (D28): common-failure labels for a pasted function and for every confirmed part of an outline (plain code).
  // D50: the same labels go into a pasted round's bettor text, so every bettor sees them before betting.
  const labeler = createLabeler({
    paste,
    betStore,
    proofOf,
    takeLabels: (c) => labelsByIp.take(clientOf(c)),
    outlineJobOf: (id) => {
      const j = outline.jobOf(id);
      return j ? { sessionId: j.sessionId, ...(j.section ? { section: j.section } : {}) } : undefined;
    },
  });
  /** The text of one file of a target, as Atlas read it. */
  const fileTextOf = (target: Target, file: string): string | undefined => {
    if (target.kind === "ts-fixture") return file === target.ref ? readFixture(target) : undefined;
    const pr = prTargets.get(target.codeSha256);
    return pr?.files.find((f) => f.path === file)?.content;
  };
  /**
   * The finding a round's model bets use: the session's first verified Investigator finding on this
   * exact code (a retry one first), else the fixture finding written by hand, with its label.
   */
  const findingFor = (sessionId: string, target: Target, fileText: string): { finding: Finding; label: string } => {
    const found = investigations.get(sessionId)?.findings.get(target.codeSha256) ?? [];
    const pick = found.find((f) => f.kind === "retry") ?? found[0];
    if (pick) return { finding: pick, label: `found by ${pick.proposedBy.model}; file, lines and quote checked by plain code` };
    return { finding: fixtureFinding(fileText), label: FIXTURE_FINDING_LABEL };
  };
  const findingLabel = (f: Finding): string =>
    f.proposedBy.role === "human"
      ? "picked by a person; file and lines checked by plain code"
      : f.id === fixtureFinding("").id
        ? FIXTURE_FINDING_LABEL
        : `found by ${f.proposedBy.model}; file, lines and quote checked by plain code`;
  const targets = new Map<string, Target>(); // by codeSha256
  const controls = new Map<string, Promise<Run>>(); // passed controls only, by codeSha256
  const runs = new Map<string, Run>(); // in memory today; not published
  const keepRun = (run: Run) => {
    runs.set(run.id, run);
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
  };
  /** A refusal record must never stop a round. It is scrubbed (no paths, URLs or keys) before any writer sees it. */
  const record = (r: Parameters<RefusalWriter>[0]) => {
    try {
      refusals(cleanRecord(r));
    } catch {
      // The writer failed; the round's answer still stands.
    }
  };

  const getControl = (target: Target): Promise<Run> => {
    const cached = controls.get(target.codeSha256);
    if (cached) return cached;
    const p = runTsControl(target, executor).then((run) => {
      keepRun(run);
      // A control that did not pass is not kept: the next request tries again (it may have been a timeout).
      if (run.controlPassed !== true) controls.delete(target.codeSha256);
      return run;
    });
    p.catch(() => controls.delete(target.codeSha256));
    controls.set(target.codeSha256, p);
    return p;
  };

  /**
   * Day-7 review M3/M7: every bettor of the round for its file, including those who sealed nothing: the person
   * ("not asked" in an autonomous round) and each model slot ("no usable answer" is never a decline).
   */
  const bettorSlotsOf = (round: Round, bets: Bet[]): BettorSlot[] => {
    const out: BettorSlot[] = [];
    if (round.autonomous) out.push({ who: "human", status: "not_asked", reason: AUTONOMOUS_PERSON_REASON });
    else if (bets.some((b) => b.who === "human")) out.push({ who: "human", status: "sealed" });
    for (const s of modelSlotsOf(round)) {
      const who = s.who as BettorSlot["who"];
      if (bets.some((b) => b.who === who)) out.push({ who, status: "sealed" });
      else out.push({ who, status: s.status === "no_usable_answer" ? "no_usable_answer" : "not_asked", ...(s.reason ? { reason: oneLine(redactRpc(s.reason), 300) } : {}) });
    }
    for (const b of bets) if (!out.some((s) => s.who === b.who)) out.push({ who: b.who, status: "sealed" });
    return out;
  };

  /** Build (and verify) the round's .atlas.json, keep it, and write it when publishing is on. Never throws. */
  const keepProof = (sessionId: string, round: Round, run: Run, bets: Bet[], verdicts: Verdict[]) => {
    const exp = round.experiment;
    const investigatorFindings = investigations.get(sessionId)?.findings.get(exp.target.codeSha256) ?? [];
    const log = agentLog.history(sessionId).map((e) => e.event);
    try {
      const file = buildAtlasFile({
        target: exp.target,
        experiment: exp,
        bets,
        run,
        verdicts,
        ...(round.finding ? { findings: recordedFindings(round.finding, investigatorFindings) } : {}),
        agentLog: log,
        bettors: bettorSlotsOf(round, bets),
        extraCaptions: extraCaptionsFor(round.finding, investigatorFindings, log, exp.target.codeSha256),
        ...(round.attempts && round.attempts.length ? { attempts: round.attempts } : {}),
        createdAt: new Date().toISOString(),
      });
      const put = (exp.target.kind === "pasted" ? pastedProofs : proofStore).put(file, run);
      if (exp.target.kind === "pasted") {
        pastedOwners.set(run.id, sessionId);
        while (pastedOwners.size > 2000) pastedOwners.delete(pastedOwners.keys().next().value!);
      }
      return { ok: true as const, runId: run.id, captions: file.captions, published: put.published, ...(put.error ? { error: put.error } : {}) };
    } catch (e) {
      return { ok: false as const, runId: run.id, reason: redactRpc(e instanceof Error ? e.message : String(e)) };
    }
  };

  /** D07-01: whether Muse Spark Open can be asked here, and if not, why. */
  const sparkOpen = opts.modelBets?.sparkOpen ?? { available: false as const, reason: "this server was not set up for Baseten" };

  /**
   * Ask the model(s) for bets on this round's experiment. Never throws; each slot records its outcome.
   * D07-01: "both" makes two slots (Muse Spark, then Muse Spark Open). The checks that are about the
   * round (a finding, the per-client and per-session limits) run once; each model then gets the SAME
   * prompt (D18, D19) and seals its own bets. Neither sees the other's bets.
   */
  /**
   * `slotTaken`: the caller already counted this round against the model-bets limits (day-7 review S4: the
   * autonomous round's POST /adversary takes ONE experiment slot and ONE per-address round for the whole round).
   */
  const startModelBets = (round: Round, sessionId: string, clientIp: string, mode: ClaimantMode = DEFAULT_CLAIMANT_MODE, slotTaken = false): void => {
    const wanted = opts.modelBets?.model && mode === DEFAULT_CLAIMANT_MODE ? [opts.modelBets.model] : modelsFor(mode);
    const slots: ModelSlot[] = wanted.map((model) => ({ model, who: `model:${model}`, display: modelDisplay(model), status: "off" }));
    round.models = slots;
    round.model = slots[0];
    round.claimantMode = mode;
    const offAll = (reason: string) => {
      for (const s of slots) s.reason = reason;
    };
    if (!opts.modelBets || !budget || !modelChat) return offAll("this server asks no Meta model for bets");
    // Muse Spark Open is never asked when this server cannot reach it; its slot says why.
    const askable = slots.filter((s) => {
      if (s.model !== SPARK_OPEN_MODEL || sparkOpen.available) return true;
      s.reason = `not available: ${sparkOpen.reason}`;
      return false;
    });
    if (askable.length === 0) return;
    const exp = round.experiment;
    // The finding the model works on: the one the person chose for this round, else (fixture only)
    // the session's Investigator finding or the hand-written one. D18: the model sees its file,
    // lines and the code around them, never a claim sentence.
    let picked: { finding: Finding; label: string; fileText: string } | undefined;
    if (exp.target.kind === "pasted" && typeof exp.target.source === "string") {
      // E3: pasted code has no finding. The models bet on the whole file the person sees (round.seenContext, D19);
      // this stand-in finding only satisfies the bet role's input and never reaches the prompt or the proof file.
      const src = exp.target.source;
      picked = { finding: wholeFileFinding(exp.target.ref, src), label: "", fileText: src };
    } else if (round.finding) {
      const text = fileTextOf(exp.target, round.finding.file);
      if (text !== undefined) picked = { finding: round.finding, label: findingLabel(round.finding), fileText: text };
    } else if (exp.target.kind === "ts-fixture" && exp.target.ref === FIXTURE_FILE) {
      const fileText = readFixture(exp.target);
      const f = findingFor(sessionId, exp.target, fileText);
      picked = { finding: f.finding, label: f.label, fileText };
      round.finding = f.finding; // the finding this round worked on, for its .atlas.json
    }
    if (!picked) {
      for (const s of askable) s.reason = `no finding chosen yet for ${exp.target.ref}`;
      return;
    }
    if (!slotTaken) {
      const byIp = modelRoundsByIp.take(clientIp);
      const allowed = byIp.ok ? budget.startExperiment(sessionId) : byIp;
      if (!allowed.ok) {
        for (const s of askable) s.reason = allowed.reason; // e.g. "call limit reached": the person's round goes on without the model
        return;
      }
    }
    const { finding, label: findingLabelText, fileText } = picked;
    // The retry defaults sit more than 20 lines above the loop, so for the fixture the model sees the
    // whole verbatim block whichever finding is used (fixture-finding.ts explains why).
    const contextRange = exp.target.ref === FIXTURE_FILE ? fixtureContextRange(fileText) : undefined;
    // D19: on the Moonwell PR the model gets exactly what the person's bet screen shows (src/bet-context.ts).
    const prOf = exp.target.kind === "github-pr" ? prTargets.get(exp.target.codeSha256) : undefined;
    const seenContext = exp.target.kind === "pasted" ? seenOf(round) : prOf ? seenContextFor(exp, round.questions, finding, fileText, { title: prOf.title, fileCount: prFiles(prOf).length }, round.chainFacts) : undefined;
    if (exp.target.kind === "pasted" && seenContext === undefined) {
      for (const s of askable) s.reason = "the bet screen's text was not built, so no model is asked";
      return;
    }
    // E3: a call carrying pasted code may only reach a non-contributor Meta model (server/meta/pasted-guard.ts).
    const chat = exp.target.kind === "pasted" ? guardPastedChat(modelChat) : modelChat;
    const { now } = opts.modelBets;
    const deadlineMs = opts.modelBets.deadlineMs ?? MODEL_BETS_DEADLINE_MS;
    for (const slot of askable) {
      const model = slot.model;
      slot.status = "thinking";
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<{ ok: false; reason: string; detail: string }>((ok) => {
        const why = `the model did not answer within ${deadlineMs >= 1000 ? `${Math.round(deadlineMs / 1000)} s` : `${deadlineMs} ms`}`;
        timer = setTimeout(() => ok({ ok: false, reason: why, detail: why }), deadlineMs);
        (timer as { unref?: () => void }).unref?.();
      });
      slot.settled = Promise.race([
        runClaimantBets(
          { experiment: exp, questions: round.questions, finding, findingLabel: findingLabelText, ...(contextRange ? { contextRange } : {}), ...(seenContext !== undefined ? { seenContext } : {}), ...(exp.target.kind === "pasted" ? { seenInstruction: null } : {}), ...(round.repeatOf ? { repeat: true as const } : {}), fileText, gateContext: round.gateContext ?? TS_GATE_CONTEXT, model },
          { chat, log: sessionEmitter(agentLog, sessionId), ...(now ? { now } : {}) },
        ),
        late, // an answer after the deadline is never sealed into this round
      ]).finally(() => clearTimeout(timer)).then(
        (r) => {
          if (!r.ok) {
            slot.status = "no_usable_answer";
            slot.reason = r.reason; // names the kind of problem only (S2)
            if (r.detail !== r.reason) slot.detail = r.detail; // may quote the model's values: shown after the run
          } else if (round.betsFrozenAt !== undefined) {
            // Cannot happen while POST /runs waits for this promise; kept so a late answer is never judged.
            slot.status = "no_usable_answer";
            slot.reason = "the answer arrived after the bets were frozen";
          } else {
            round.bets.push(...r.bets);
            slot.status = "sealed";
          }
        },
        (e: unknown) => {
          slot.status = "no_usable_answer";
          slot.reason = `the server could not finish the model call: ${e instanceof Error ? e.message : String(e)}`;
        },
      );
    }
  };

  /** Waits until every model slot of the round has sealed its bets or given no usable answer. */
  const modelsSettled = (round: Round) => Promise.all(modelSlotsOf(round).map((s) => s.settled));

  const app = new Hono();

  // One large POST must not be read whole into memory.
  // E3: POST /paste carries up to 64 KB of code, escaped as JSON, so it has its own (larger) limit.
  // X1: POST /outline/jobs may carry up to 300 KB of uploaded code, escaped as JSON, so it has its own (larger) limit too.
  const defaultLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: `the request body is larger than ${MAX_BODY_BYTES} bytes` }, 413) });
  const pasteLimit = bodyLimit({ maxSize: PASTE_BODY_BYTES, onError: (c) => c.json({ error: `the request body is larger than ${PASTE_BODY_BYTES} bytes; Atlas reads one file of at most 64 KB` }, 413) });
  const outlineLimit = bodyLimit({ maxSize: OUTLINE_BODY_BYTES, onError: (c) => c.json({ error: `the request body is larger than ${OUTLINE_BODY_BYTES} bytes; Atlas reads at most 300 KB of code` }, 413) });
  app.use("*", (c, next) => {
    sweepSoon(); // E3 review r3 B1: nothing made from an expired paste is ever served
    return c.req.path === "/paste" ? pasteLimit(c, next) : c.req.path === "/outline/jobs" ? outlineLimit(c, next) : defaultLimit(c, next);
  });

  app.get("/health", (c) => c.json({ ok: true }));
  // D07-01: what the page's claimant toggle offers. No model call: availability is known at startup.
  app.get("/claimants", (c) => {
    const display = modelDisplay(SPARK_OPEN_MODEL);
    const info: ClaimantsInfo = {
      default: DEFAULT_CLAIMANT_MODE,
      modes: CLAIMANT_MODES,
      sparkOpen: opts.modelBets && sparkOpen.available ? { model: SPARK_OPEN_MODEL, display, available: true } : { model: SPARK_OPEN_MODEL, display, available: false, reason: !opts.modelBets ? "this server asks no Meta model for bets" : sparkOpen.available ? "unknown" : sparkOpen.reason },
    };
    return c.json(info);
  });
  registerEventRoutes(app, agentLog); // D02-05: GET /events/:sessionId (SSE)
  paste.register(app); // E3: GET /paste/languages, POST /paste, /paste/proposals, /paste/claim
  labeler.register(app); // X3 (D28): POST /paste/labels, GET /outline/jobs/:id/labels

  // X3 (D27): GET /track-record[?before=<runId>] → this person's record now and, with `before`, their record before
  // that round (null when the round is not in their record). Plain code over their own sealed bets and verdicts.
  app.get("/track-record", (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const person = personOf(c, sessionId);
    const entries = trackStore.entries(person);
    const before = c.req.query("before");
    return c.json({
      person: person.kind,
      record: trackRecordOf(entries),
      ...(before !== undefined ? { before: /^[A-Za-z0-9_-]{1,64}$/.test(before) ? recordBefore(entries, before) : null } : {}),
    });
  });
  outline.register(app); // X1: POST /outline/jobs, GET /outline/jobs/:id[/outline|/parts/:partId|/atlas]

  app.post("/targets", async (c) => {
    if (sessionIdOf(c) === null) return c.json({ error: BAD_SESSION }, 400); // D02-05
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = targetBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    if (parsed.data.kind === "github-pr") {
      // D04-04: a pull request. Read at its merge commit by the server; accepted for running only when
      // its files are exactly the copy the EVM runner applies.
      const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(parsed.data.ref)!;
      let pr: GithubPrTarget;
      try {
        pr = await readPr({ owner: m[1]!, repo: m[2]!, number: Number(m[3]) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: `could not read pull request ${parsed.data.ref}: ${msg}` }, /^call limit reached/.test(msg) ? 429 : 502); // G1 review B7
      }
      const refusal = evmTargetRefusal(pr.target.ref, pr.target.codeSha256, pr.target.commit);
      if (refusal) return c.json({ error: refusal, target: pr.target }, 422);
      targets.set(pr.target.codeSha256, pr.target);
      prTargets.set(pr.target.codeSha256, pr);
      // The files go back with the target so a person can read them and pick lines (POST /findings).
      return c.json({ ...pr.target, title: pr.title, files: prFiles(pr).map((f) => ({ path: f.path, text: f.text })) });
    }
    const { kind, ref } = parsed.data;
    const inside = ref.startsWith("tests/fixtures/") ? ref.slice("tests/fixtures/".length) : ref;
    const fixturePath = relative(REPO_ROOT, resolve(REPO_ROOT, "tests/fixtures", inside)).split(sep).join("/");
    let code: string;
    try {
      code = readFixture({ kind, ref: fixturePath, codeSha256: "" });
    } catch (e) {
      const why = (e as NodeJS.ErrnoException).code === "ENOENT" ? `there is no file at ${fixturePath}` : (e as Error).message;
      return c.json({ error: why }, 400);
    }
    const target: Target = {
      kind,
      ref: fixturePath,
      codeSha256: sha256(code),
      ...(listedAsPreExisting(fixturePath) ? { preExisting: { ...PRE_EXISTING_LABEL } } : {}),
    };
    targets.set(target.codeSha256, target);
    return c.json(target);
  });

  app.post("/experiments", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = experimentBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const body = parsed.data;
    // D07-01: who places the model's bets (x-atlas-claimant). A value Atlas does not know is refused, never guessed.
    const claimant = parseClaimantMode(c.req.header(CLAIMANT_HEADER));
    if (!claimant.ok) return c.json({ error: claimant.reason }, 400);

    // E3: a pasted target lives in the session that pasted it (POST /paste), never in the shared target list.
    const pastedEntry = paste.entryOf(sessionId, body.target);
    const target = pastedEntry?.target ?? targets.get(body.target.codeSha256);
    if (!target || target.ref !== body.target.ref) {
      return c.json({ error: "unknown target: register it with POST /targets first (same ref and codeSha256), or paste it in this session (POST /paste)" }, 400);
    }
    // D04-04: the runner and the gate's allow-list follow the target, never the request.
    const runnerKind = target.kind === "github-pr" ? ("evm" as const) : ("ts" as const);
    const gateCtx: GateContext = pastedEntry ? { shapes: ["call-function"], exportNames: pastedEntry.exports.map((e) => e.name), ...(pastedEntry.target.language ? { language: pastedEntry.target.language } : {}) } : runnerKind === "evm" ? EVM_GATE_CONTEXT : TS_GATE_CONTEXT;
    if (body.quiz && !pastedEntry) return c.json({ error: "quiz is for pasted code only" }, 400);
    // E3: a test Muse Wonder proposed in this session, used as proposed (an edited one comes as params, from the person).
    if (body.params === undefined && body.proposalId === undefined) return c.json({ error: "body: send params (the experiment) or, for pasted code, proposalId" }, 400);
    let fromProposal: { setId: string; model: string; params: unknown } | undefined;
    let editedFrom: { setId: string; model: string; proposalId: string } | undefined;
    if (body.proposalId !== undefined) {
      if (!pastedEntry) return c.json({ error: "proposalId is for pasted code only" }, 400);
      if (body.params !== undefined || body.editedFrom !== undefined) return c.json({ error: "send proposalId alone, or params (with editedFrom when you edited a proposal)" }, 400);
      const found = paste.proposalOf(sessionId, body.proposalId, target.codeSha256);
      if ("error" in found) return c.json({ error: found.error }, found.status);
      fromProposal = { setId: found.set.id, model: found.set.model, params: found.proposal.params };
    }
    if (body.editedFrom !== undefined) {
      if (!pastedEntry) return c.json({ error: "editedFrom is for pasted code only" }, 400);
      const found = paste.proposalOf(sessionId, body.editedFrom, target.codeSha256, true);
      if ("error" in found) return c.json({ error: found.error }, found.status);
      editedFrom = { setId: found.set.id, model: found.set.model, proposalId: body.editedFrom };
    }
    // E3 review B3: experiments on pasted code are counted per client address (each holds a bet-screen text and a run).
    if (pastedEntry) {
      const perIp = pastedExperimentsByIp.take(clientOf(c));
      if (!perIp.ok) return c.json({ error: `experiment not made: ${perIp.reason}` }, 429);
    }
    if (body.runner !== undefined && body.runner !== runnerKind) return c.json({ error: `${target.ref} runs on the ${runnerKind} runner, not ${body.runner}` }, 400);
    let finding: Finding | undefined;
    if (body.findingId !== undefined) {
      finding = sessionFindings.get(sessionId)?.get(body.findingId);
      if (!finding || fileTextOf(target, finding.file) === undefined) {
        return c.json({ error: `this session has no finding ${body.findingId} on ${target.ref}: get one from POST /investigate or POST /findings first` }, 400);
      }
    }
    // The only route that creates a session (S4), and only after the request is otherwise valid.
    const opened = betStore.open(sessionId);
    if (!opened.ok) return c.json({ error: opened.reason }, 503);
    const rounds = opened.rounds;
    const id = body.id ?? newExperimentId();
    if (rounds.has(id)) return c.json({ error: `this session already has an experiment ${id}` }, 409);
    if (rounds.size >= MAX_EXPERIMENTS) return c.json({ error: `a session holds at most ${MAX_EXPERIMENTS} experiments; start a new session` }, 409);

    const log = roundLog(sessionEmitter(agentLog, sessionId));
    const asked = fromProposal ? fromProposal.params : body.params;
    const decision = gate(asked, gateCtx);
    const experiment = {
      id,
      target,
      runner: runnerKind,
      params: decision.allowed ? decision.params : asked,
      proposedBy: fromProposal
        ? { role: "investigator" as const, model: fromProposal.model }
        : editedFrom
          ? { role: "human" as const, editedFrom: { model: editedFrom.model, proposalId: editedFrom.proposalId } }
          : { role: "human" as const },
      gate: decision.allowed ? { allowed: true as const } : { allowed: false as const, reason: decision.reason },
    } as Experiment;
    const round = newRound(experiment, gateCtx);
    round.gateContext = gateCtx;
    // U1 (D48): the quiz replaces the free answers with plain code's options; the person and every model get the same ones.
    if (body.quiz && decision.allowed) {
      round.questions = quizQuestionsFor(experiment.params, gateCtx.exportNames, gateCtx.language);
      round.extraQuestions = [];
    }
    if (finding) round.finding = finding;
    if (runnerKind === "evm" && decision.allowed) {
      // One plain-code question per Moonwell round: cbETH's price (src/gate.ts's template). The other
      // markets are still measured and shown in the false-alarm table; nobody bets on them.
      const asked = round.questions.filter((q) => q.measures === ASKED_FIELD);
      if (asked.length > 0) round.questions = asked;
      round.extraQuestions = [];
    }
    // E3 review r2 M2 (coordinator's decision): a test canonically equal to one already run in this session is
    // accepted, said on screen and to every model, and its bets are sealed with repeat: true.
    if (decision.allowed) {
      // E3 review r3 minor 3: compared with the defaults filled in, so writing a default out does not hide a repeat.
      const asRun = (p: unknown) => canonicalJson(withCallDefaults(p));
      const same = [...rounds.values()].find((r) => r.run !== undefined && r.experiment.target.codeSha256 === target.codeSha256 && asRun(r.experiment.params) === asRun(experiment.params));
      if (same) round.repeatOf = same.experiment.id;
    }
    if (pastedEntry && decision.allowed) {
      // D19: the bet screen's text; the page shows it and every betting model gets it. E3 review r2 B2/B3/M3: the
      // test part is keyed on everything that appears in it, length-checked against the one limit (the prompt cap
      // minus the prompt's fixed part) BEFORE it is cached, and shared by every round with the same text; the
      // numbered file is kept once per file and joined on when the text is served.
      const call = experiment.params as Extract<Experiment["params"], { shape: "call-function" }>;
      const line = pastedEntry.exports.find((e) => e.name === call.exportName)?.line ?? 0;
      // U1: the questions are part of the text (a quiz lists its options), so they are part of the key.
      // X3 review round 2 (D50): the called function's failure labels, in the text every bettor gets (and in the key).
      const labels = labelsForBettors(labeler.forPaste(sessionId, target, call.exportName));
      const key = [target.codeSha256, target.language, line, canonicalJson(experiment.proposedBy), canonicalJson(experiment.params), round.repeatOf ?? "", body.quiz ? "quiz" : "", ...labels].join("\n");
      const block = paste.fileBlock(target.codeSha256, target.source ?? "", line);
      const cap = pastedSeenCap(round.questions, MAX_PASTED_PROMPT_CHARS);
      const got = paste.headFor(
        key,
        () => pastedBetHead({ experiment, questions: round.questions, exportLine: line, labels, ...(round.repeatOf ? { repeatOf: round.repeatOf } : {}) }),
        (head) => (head.length + 1 + block.length > cap ? `the text every bettor gets for this test would be ${head.length + 1 + block.length} characters; with the questions around it, a model's prompt may hold at most ${cap}, so this test is not made` : null),
      );
      if (!got.ok) return c.json({ error: got.reason }, 413);
      round.seenHead = got.head;
      round.seenFile = { codeSha256: target.codeSha256, exportLine: line };
    }
    rounds.set(id, round); // a refused experiment is kept too (shown, never run)
    if (pastedEntry) {
      // E3 review r2 B3: pasted rounds are capped per session and overall; the oldest that is not running is dropped.
      const dropped = paste.trackRound(sessionId, id, (round.seenHead?.length ?? 0) + 2_000, paste.sourceKeyOf(target), keepRound);
      for (const d of dropped) betStore.peek(d.sessionId)?.delete(d.experimentId);
    }
    // The stand-in line only when the hand-written fixture finding is the one in use.
    const usesInvestigatorFinding = (investigations.get(sessionId)?.findings.get(target.codeSha256)?.length ?? 0) > 0;
    if (decision.allowed && target.kind === "ts-fixture" && !finding && !usesInvestigatorFinding) log.investigatorStub(experiment);
    if (decision.allowed && finding) {
      const who = finding.proposedBy.role === "human" ? "picked by a person" : `found by ${finding.proposedBy.model}`;
      agentLog.emit(sessionId, { role: "human", action: oneLine(`chooses ${fileLines(finding.file, finding.lineStart, finding.lineEnd)} (${who}) for ${id}`), ref: { kind: "finding", id: finding.id } });
    }
    try {
      log.gate(experiment); // one flattened line; the 422 below keeps the full reason (S3)
    } catch (e) {
      if (!(e instanceof AgentEventError)) throw e; // a refused log line never hides the gate's answer
    }
    if (!decision.allowed) {
      // E3: a refusal about pasted code is not written to the public proofs folder (its values may come from the
      // judge's own code); it is kept in the round and shown.
      if (target.kind !== "pasted") {
        record({
          kind: "gate_rejection",
          id,
          experimentId: id,
          time: new Date().toISOString(),
          role: "human",
          trigger: "POST /experiments: the gate refused the experiment, so it never ran",
          experiment: body.params,
          reason: decision.reason,
        });
      }
      // E3 review minor 4: the refusal never echoes the pasted source back.
      return c.json({ error: `gate: rejected (${decision.reason}); nothing will run`, experiment: withoutSource(experiment) }, 422);
    }
    if (pastedEntry && (fromProposal || editedFrom)) paste.linkExperiment(id, sessionId, (fromProposal ?? editedFrom)!.setId);
    // D22: the chain facts at block 42194662 are read before anyone is asked to bet; the page and every model get the same object.
    const facts = await chainFactsFor(experiment);
    if (facts !== undefined) round.chainFacts = facts;
    startModelBets(round, sessionId, clientOf(c), claimant.mode); // D02-06: the model bets on this SAME experiment, from the questions only
    return c.json({ experiment: target.kind === "pasted" ? withoutSource(experiment) : experiment, questions: round.questions, extraQuestions: round.extraQuestions, model: modelSlotView(round), models: modelSlotViews(round), claimant: claimant.mode, ...(round.chainFacts ? { chainFacts: round.chainFacts } : {}), ...(round.seenHead !== undefined ? { seenContext: seenOf(round) } : {}), ...(round.repeatOf ? { repeatOf: round.repeatOf } : {}) });
  });

  app.post("/investigate", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = investigateBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const body = parsed.data;
    const model = opts.investigator?.model ?? INVESTIGATOR_MODEL;
    // Limits first, so a request that will not be answered does not spend GitHub's rate limit either.
    const mine = investigationsOf(sessionId);
    const capped = mine.count >= MAX_INVESTIGATIONS_PER_SESSION;

    // 1. The target and its files, read by the server (never taken from the request).
    let target: Target;
    let files: InvestigatorFile[];
    let pr: { title: string; description: string } | undefined;
    let fallbackFinding: (Finding & { label: string }) | undefined;
    if ("target" in body) {
      const t = targets.get(body.target.codeSha256);
      if (!t || t.ref !== body.target.ref) return c.json({ error: "unknown target: register it with POST /targets first (same ref and codeSha256)" }, 400);
      target = t;
      const known = t.kind === "github-pr" ? prTargets.get(t.codeSha256) : undefined;
      if (known) {
        // D04-04: a PR registered with POST /targets: the files the server read then, with the PR's title and description.
        files = prFiles(known);
        pr = { title: known.title, description: known.description };
      } else {
        const text = readFixture(t);
        files = [{ path: t.ref, text }];
        if (t.ref === FIXTURE_FILE) fallbackFinding = { ...fixtureFinding(text), label: FIXTURE_FINDING_LABEL };
      }
    } else {
      if (!opts.investigator || !investigatorChat) return c.json({ ok: false, reason: "not asked (this server asks no Meta model to investigate)", findings: [], dropped: [], model });
      if (capped) return c.json({ ok: false, reason: `not asked (call limit reached: this session already asked for ${MAX_INVESTIGATIONS_PER_SESSION} investigations)`, findings: [], dropped: [], model });
      const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(body.pr)!;
      const ref = { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
      let prTarget: GithubPrTarget;
      try {
        prTarget = await readPr(ref, opts.investigator?.fetchPr ?? fetchPrFn);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: `could not read pull request ${body.pr}: ${msg}` }, /^call limit reached/.test(msg) ? 429 : 502); // G1 review B7
      }
      target = prTarget.target;
      files = prTarget.files.filter((f) => f.content !== undefined).map((f) => ({ path: f.path, text: f.content! }));
      pr = { title: prTarget.title, description: prTarget.description };
    }
    const chars = files.reduce((n, f) => n + f.text.length, 0) + (pr ? pr.title.length + pr.description.length : 0);
    if (chars > MAX_INVESTIGATE_CHARS) {
      return c.json({ error: `the target is ${chars} characters; the Investigator reads at most ${MAX_INVESTIGATE_CHARS}` }, 413);
    }

    const notAsked = (reason: string) =>
      c.json({ ok: false, reason: `not asked (${reason})`, target, findings: [], dropped: [], model, ...(fallbackFinding ? { fallbackFinding } : {}) });
    if (!opts.investigator || !investigatorChat) return notAsked("this server asks no Meta model to investigate");

    // 2. Limits: per session here, calls an hour and total spend in the budget (S5).
    if (capped) {
      return notAsked(`call limit reached: this session already asked for ${MAX_INVESTIGATIONS_PER_SESSION} investigations`);
    }
    // S5: sessions are free to make, so investigations are also counted per client address.
    const byIp = investigationsByIp.take(clientOf(c));
    if (!byIp.ok) return notAsked(byIp.reason);
    mine.count++;

    // 3. The model proposes; plain code verifies each place against the file.
    const r = await runInvestigator(
      {
        target,
        files,
        ...(pr ? { pr } : {}),
        model,
        fallbackModel: opts.investigator.fallbackModel === undefined ? INVESTIGATOR_FALLBACK_MODEL : opts.investigator.fallbackModel,
      },
      { chat: investigatorChat, log: sessionEmitter(agentLog, sessionId) },
    );
    const dropped = r.dropped.map((d) => ({ model: d.model, attempt: d.attempt, file: d.file, lineStart: d.lineStart, lineEnd: d.lineEnd, kind: d.kind, reason: d.reason }));
    if (!r.ok) {
      return c.json({ ok: false, reason: r.reason, target, findings: [], dropped, model, usage: r.usage ?? null, ...(fallbackFinding ? { fallbackFinding } : {}) });
    }
    mine.findings.set(target.codeSha256, r.findings);
    const byId = findingsOf(sessionId);
    for (const f of r.findings) byId.set(f.id, f); // D04-04: a round may name one with findingId
    return c.json({ ok: true, target, findings: r.findings, dropped, model: r.model, fellBack: r.fellBack, usage: r.usage ?? null });
  });

  // D04-04: lines a person picked themselves. Checked against the file Atlas read; no claim.
  app.post("/findings", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = findingBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const body = parsed.data;
    const target = targets.get(body.target.codeSha256);
    if (!target || target.ref !== body.target.ref) return c.json({ error: "unknown target: register it with POST /targets first (same ref and codeSha256)" }, 400);
    const pr = target.kind === "github-pr" ? prTargets.get(target.codeSha256) : undefined;
    const files = pr ? prFiles(pr) : [{ path: target.ref, text: readFixture(target) }];
    const r = humanFinding(files, body.file, body.lineStart, body.lineEnd);
    if (!r.ok) return c.json({ error: r.reason }, 400);
    findingsOf(sessionId).set(r.finding.id, r.finding);
    agentLog.emit(sessionId, { role: "human", action: oneLine(`picks ${fileLines(r.finding.file, r.finding.lineStart, r.finding.lineEnd)} (file and lines checked)`), ref: { kind: "finding", id: r.finding.id } });
    return c.json({ finding: r.finding });
  });

  app.post("/experiments/:id/model-bets", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const id = c.req.param("id");
    const round = betStore.peek(sessionId)?.get(id); // a lookup never creates a session (S4)
    if (!round) return c.json({ error: `this session has no experiment ${id}: create it with POST /experiments first` }, 404);
    if (!round.experiment.gate.allowed) return c.json({ error: `the gate refused experiment ${id}, so no model bets on it` }, 422);
    betStore.touch(sessionId);
    await modelsSettled(round);
    // Hashes only: the model's answers and rationale stay on the server until the run reveals every bet.
    return c.json({ model: modelSlotView(round), models: modelSlotViews(round) });
  });

  app.post("/bets", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    // Two bodies: one bet {measures, answer}, or all of a person's answers at once {bets: [...]} (the page).
    const many = humanBetsBody.safeParse(raw.body);
    const one = many.success ? null : humanBetBody.safeParse(raw.body);
    if (!many.success && !one!.success) return c.json({ error: plainReason((raw.body as { bets?: unknown })?.bets !== undefined ? many.error : one!.error!) }, 400);
    const experimentId = many.success ? many.data.experimentId : one!.data!.experimentId;
    const wanted = many.success ? many.data.bets : [{ measures: one!.data!.measures, answer: one!.data!.answer }];

    const round = betStore.peek(sessionId)?.get(experimentId); // a lookup never creates a session (S4)
    if (!round) return c.json({ error: `this session has no experiment ${experimentId}: create it with POST /experiments first` }, 404);
    if (!round.experiment.gate.allowed) return c.json({ error: `the gate refused experiment ${experimentId}, so it takes no bets` }, 422);
    if (round.autonomous) return c.json({ error: `${experimentId} is an autonomous round (proposed by the Adversary, run by Atlas): no person is asked, so it takes no person's bets` }, 409);
    // E3 review B2: once Muse Wonder's sentence for this round's tests has been shown, no more bets are sealed on it.
    const closed = paste.betsClosed(sessionId, experimentId);
    if (closed) return c.json({ error: `${closed}, so this bet was not sealed` }, 409);
    // Final review S2: after a run attempt that did not finish, the bets stay frozen (the same set runs again).
    const tried = round.attempts?.at(-1);
    if (tried) return c.json({ error: `bets on ${experimentId} are frozen: a run was tried at ${tried.startedAt} and did not finish; try the run again (the sealed bets stay as they are), so this bet was not sealed` }, 409);
    // Bets are frozen at run start. Checked with no await between here and the push below.
    if (round.status !== "open") {
      const when = round.betsFrozenAt ? `its run started at ${round.betsFrozenAt}` : "its run is starting";
      return c.json({ error: `bets on ${experimentId} are closed: ${when}, so this bet was not sealed` }, 409);
    }
    if (round.bets.length + wanted.length > MAX_BETS) return c.json({ error: `an experiment takes at most ${MAX_BETS} bets` }, 409);

    // Check EVERY answer before sealing any: one refused answer means nothing is sealed.
    const all = [...round.questions, ...round.extraQuestions];
    const seen = new Set<string>();
    const checked: { question: (typeof all)[number]; answer: Parameters<typeof sealHumanBet>[2] }[] = [];
    for (const w of wanted) {
      const question = all.find((q) => q.measures === w.measures);
      if (!question) {
        return c.json({ error: `no question on ${experimentId} measures "${w.measures}"; the questions measure ${all.map((q) => q.measures).join(", ")}` }, 400);
      }
      if (seen.has(w.measures)) return c.json({ error: `two answers to "${w.measures}" in one request; send one per question` }, 400);
      seen.add(w.measures);
      // One bet per bettor per question (S1): a sealed bet is never joined by a second one.
      if (round.bets.some((b) => b.who === "human" && b.measures === w.measures)) {
        return c.json({ error: `you already sealed a bet on "${w.measures}" for ${experimentId}; a sealed bet cannot be changed or joined by another`, bets: round.bets.filter((b) => b.who === "human").map(publicBet) }, 409);
      }
      const ok = checkAnswer(question, w.answer);
      if (!ok.ok) return c.json({ error: ok.reason }, 400);
      checked.push({ question, answer: ok.answer });
    }

    const sealedAt = new Date(); // one server time for the whole request
    const sealed = checked.map((x) => sealHumanBet(round, x.question, x.answer, sealedAt)); // server clock, server nonce
    round.bets.push(...sealed);
    betStore.touch(sessionId);
    roundLog(sessionEmitter(agentLog, sessionId)).humanBets(sealed);
    // The nonce stays here until the run: without it nobody can recompute the hash yet.
    // `bets` is this person's WHOLE sealed set on the experiment: exactly the set the run will judge.
    const mine = round.bets.filter((b) => b.who === "human").map(publicBet);
    return c.json({ ...(many.success ? {} : { bet: publicBet(sealed[0]!) }), bets: mine });
  });

  app.post("/runs", async (c) => {
    const sessionId = sessionIdOf(c); // D02-05
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = runBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);

    const round = betStore.peek(sessionId)?.get(parsed.data.experimentId); // a lookup never creates a session (S4)
    if (!round) return c.json({ error: `this session has no experiment ${parsed.data.experimentId}: create it with POST /experiments first` }, 404);
    const experiment = round.experiment;
    if (!experiment.gate.allowed) {
      return c.json({ error: `gate: rejected (${experiment.gate.reason}); nothing ran`, experiment }, 422);
    }
    if (round.autonomous) return c.json({ error: `${experiment.id} is an autonomous round: Atlas runs it itself (POST /adversary)` }, 409);
    if (round.status === "running") {
      const why = round.betsFrozenAt ? `its run started at ${round.betsFrozenAt}` : "its run is waiting for the model's bets";
      return c.json({ error: `experiment ${experiment.id} is already running: ${why}` }, 409);
    }
    if (round.status === "stopped") return c.json({ error: `experiment ${experiment.id} stopped: ${round.stoppedReason ?? "no reason recorded"}; start a new experiment` }, 409);
    if (round.status !== "open") return c.json({ error: `experiment ${experiment.id} already ran (started ${round.betsFrozenAt ?? "earlier"}); start a new experiment to run again` }, 409);
    if (round.bets.length === 0) return c.json({ error: "place at least one bet first: a run only happens after bets are sealed" }, 409);
    // An EVM run forks Base and makes paid RPC reads, so it is capped at once and per hour, per session
    // and overall (server/replay-limits.ts). Checked before the bets freeze, so a refused run can be retried.
    let runSlot: { release: () => void } | undefined;
    if (experiment.runner === "evm") {
      const slot = runGate.take(sessionId, clientOf(c));
      if (!slot.ok) return c.json({ error: `run not started: ${slot.reason}` }, 429);
      runSlot = slot;
    } else {
      // E3 review B5: a sandbox start, capped like every other.
      const slot = sandboxGate.take(sessionId, clientOf(c));
      if (!slot.ok) return c.json({ error: `run not started: ${slot.reason}` }, 429);
      runSlot = slot;
    }
    try {
      const r = await runRound(sessionId, round);
      // X3 (D27): the person's judged bets go into their track record (plain code; never the code itself).
      if (r.status === 200) Object.assign(r.body, { track: recordRound(personOf(c, sessionId), r.body) });
      return c.json(r.body, r.status);
    } catch (e) {
      // Final review S2: the run did not finish. Nothing was judged; the experiment and its sealed bets stay,
      // and the same experiment can run again (POST /runs). 503: the server could not do it right now.
      if (e instanceof RunDidNotFinish) return c.json({ error: e.message, didNotFinish: { reason: e.reason, attempts: round.attempts ?? [] } }, 503);
      throw e;
    } finally {
      runSlot?.release();
    }
  });

  /**
   * X3 (D27): adds the person's judged bets of one finished round to their track record. Returns their record before
   * and after this round. A store that cannot write never changes the run's answer: the reason is returned instead.
   */
  function recordRound(person: Person, body: Record<string, unknown>): { person: Person["kind"]; before: TrackRecord; after: TrackRecord } | { error: string } {
    try {
      const run = body.run as Run | undefined;
      const bets = body.bets as Bet[] | undefined;
      const verdicts = body.verdicts as Verdict[] | undefined;
      const before = recordOf(person);
      if (!run || !bets || !verdicts) return { person: person.kind, before, after: before };
      trackStore.add(person, entriesFromRound(bets, verdicts, run));
      return { person: person.kind, before, after: recordOf(person) };
    } catch (e) {
      return { error: `the track record could not be saved: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * The body of POST /runs once the request is accepted (and, on the EVM runner, holds a run slot).
   * D07-02: also the autonomous round's run. Returns the answer and its HTTP status; throws (after
   * logging it) when the runner could not finish.
   */
  async function runRound(sessionId: string, round: Round): Promise<{ status: 200 | 409; body: Record<string, unknown> }> {
    const experiment = round.experiment;
    betStore.touch(sessionId);

    // Freeze the person's bets NOW, before any await: from here every POST /bets on this experiment gets 409.
    round.status = "running";
    // The models' bets are part of the round: wait until they are sealed (or gave no usable answer).
    await modelsSettled(round);
    const bets = [...round.bets];
    const log = roundLog(sessionEmitter(agentLog, sessionId));

    // The run must start strictly after the last seal. Two requests can land in the same
    // millisecond, so wait (a few ms at most) until the clock has moved past the last seal. A seal
    // further in the future than that is not waited for: the check below refuses it.
    // The same holds for an earlier attempt that did not finish (final review S2): the .atlas.json check
    // requires that attempt to have stopped strictly before this run starts. A retry that lands in the same
    // millisecond as the 503 made the file fail to verify, so no proof was kept (tests/evidence/flaky).
    const reach = Date.now() + 20;
    const lastSeal = Math.max(0, ...bets.map((b) => Date.parse(b.sealedAt)).filter((t) => t <= reach));
    const lastStop = Math.max(0, ...(round.attempts ?? []).map((a) => Date.parse(a.stoppedAt)).filter((t) => t <= reach));
    const waitPast = Math.max(lastSeal, lastStop);
    while (Date.now() <= waitPast) await new Promise((ok) => setTimeout(ok, 1));
    const frozenAt = new Date().toISOString();
    round.betsFrozenAt = frozenAt;

    // Seals before anything runs: a bet whose hash does not match its fields is never judged, and nothing runs.
    const unsealed = bets.filter((b) => !verifySeal(b)).map((b) => b.id);
    log.seals(bets.length, unsealed);
    if (unsealed.length > 0) {
      round.status = "stopped";
      round.stoppedReason = `the seal did not verify for bet ${unsealed.join(", ")}`;
      return { status: 409, body: { error: `the seal did not verify for bet ${unsealed.join(", ")}: its fields do not hash to its sealedHash, so it was not judged and nothing ran`, betIds: unsealed } };
    }
    // Every bet sealed strictly before the bets were frozen (server clock). Checked again against the run below.
    const late = sealedAfter(bets, round.betsFrozenAt);
    if (late.length > 0) {
      round.status = "stopped";
      round.stoppedReason = `bet ${late.join(", ")} was not sealed before the run started`;
      return { status: 409, body: { error: `bet ${late.join(", ")} was not sealed before the run started, so nothing ran`, betIds: late } };
    }

    let run: Run;
    try {
      if (experiment.runner === "evm") {
        // D04-04: a fork of Base at the block the shape names (30–90 s). Each step is a runner line on the
        // agent-log SSE, so the page shows progress instead of a blind wait.
        const forkBlock = forkBlockFor(experiment.params);
        // S1: whatever the runner returns is scrubbed of the RPC URL again before it is kept, logged or sent.
        run = scrubDeep(await evmRun(experiment, {
          forkBlock,
          onProgress: (step) => {
            try {
              log.progress(experiment, redactRpc(step));
            } catch {
              // a progress line the log refused never stops the run
            }
          },
        }));
      } else if (experiment.target.kind === "pasted") {
        // E3: the pasted file's language picks its runner (runners/pasted-registry.ts).
        run = await runPasted(experiment);
      } else {
        const ctl = await getControl(experiment.target);
        run = await runExperiment(experiment, ctl, { executor });
      }
    } catch (e) {
      // Final review S2: the runner stopped before a Run existed (no RPC, anvil failed or was slow, the sandbox
      // could not start). That is not a result: nothing is judged. The attempt is recorded, the bets stay
      // frozen, and the round is open again so the SAME experiment can run with the SAME sealed bets. An
      // autonomous round has no "try again" button, so it stops (the Adversary can be asked again).
      const reason = runFailureReason(e);
      const attempt: RunAttempt = { attempt: (round.attempts?.length ?? 0) + 1, startedAt: frozenAt, stoppedAt: new Date().toISOString(), reason };
      (round.attempts ??= []).push(attempt);
      if (round.autonomous) {
        round.status = "stopped";
        round.stoppedReason = `the run did not finish: ${reason}`;
      } else round.status = "open";
      log.runDidNotFinish(experiment, attempt);
      throw new RunDidNotFinish(reason);
    }
    keepRun(run);
    if (experiment.target.kind === "pasted") for (const d of paste.noteRoundChars(experiment.id, JSON.stringify(run).length, keepRound)) betStore.peek(d.sessionId)?.delete(d.experimentId);
    log.runner(experiment, run);
    // The promise this route makes: every bet's sealedAt is earlier than run.startedAt.
    const lateForRun = sealedAfter(bets, run.startedAt);
    if (lateForRun.length > 0) {
      round.status = "stopped";
      round.stoppedReason = `bet ${lateForRun.join(", ")} was not sealed before run ${run.id} started`;
      return { status: 409, body: { error: `bet ${lateForRun.join(", ")} was not sealed before run ${run.id} started, so it was not judged`, betIds: lateForRun } };
    }
    const verdicts: Verdict[] = bets.map((b) => judge(b, run));
    log.judge(verdicts, run);
    // S7: every can't-check verdict from a real run gets a public refusal record.
    for (const v of verdicts) {
      if (v.outcome !== "cant_check") continue;
      if (experiment.target.kind === "pasted") continue; // E3: never written to the public folder (see POST /experiments)
      const b = bets.find((x) => x.id === v.betId)!;
      const model = b.who === "human" ? undefined : b.who.slice("model:".length);
      record({
        kind: "cant_check",
        id: b.id,
        betId: b.id,
        runId: run.id,
        experimentId: experiment.id,
        time: run.finishedAt,
        role: b.who === "human" ? "human" : "claimant",
        ...(model ? { model } : {}),
        trigger: `POST /runs: src/judge.ts could not check the bet on ${b.measures}`,
        experiment: experiment.params,
        reason: v.reason ?? "no reason given",
        measures: b.measures,
        question: b.question,
      });
    }
    round.status = "done";
    round.run = run;
    round.verdicts = verdicts;
    let proof = keepProof(sessionId, round, run, bets, verdicts);
    // E3 review r3 M1: a pasted run with no proof file is never judged silently. When the run's own record does not
    // hold together (e.g. its trace lost the ending), its facts are not complete, so every verdict becomes "can't
    // check" with the reason; otherwise the verdicts stand and the page shows why there is no proof file.
    if (!proof.ok && experiment.target.kind === "pasted") {
      const broken = callRunAgreesWithItsTrace(run);
      if (broken.length > 0) {
        const reason = `no proof file could be made, because the run's record does not hold together (${broken.join("; ")}), so nothing from it is judged`;
        for (let i = 0; i < verdicts.length; i++) verdicts[i] = { betId: verdicts[i]!.betId, runId: run.id, outcome: "cant_check", reason, judgedBy: "src/judge.ts" };
        round.verdicts = verdicts;
        proof = { ok: false as const, runId: run.id, reason };
      }
    }
    const falseAlarm = experiment.runner === "evm" && experiment.params.shape === "apply-proposal-then-read" ? falseAlarmFromRun(run) : undefined;
    // Reveal every bet in full (with its nonce) so the browser can recompute each hash itself.
    return { status: 200, body: { run, verdicts, bets, betsFrozenAt: round.betsFrozenAt, model: modelSlotView(round), models: modelSlotViews(round), proof, ...(falseAlarm ? { falseAlarm } : {}), ...(experiment.target.kind === "pasted" ? { experiment: withoutSource(experiment) } : {}) } };
  }

  // D06-02: the waves screen. Many callers at once, same failure pattern, one virtual clock, in the sandbox.
  const sweepsRunning = new Set<string>();
  const sweepsByIp = createHourlyLimit(envCount(process.env.ATLAS_SWEEPS_PER_IP_PER_HOUR, DEFAULT_SWEEPS_PER_IP_PER_HOUR), "sweeps");
  app.post("/sweeps", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    // M5: counted per client address before anything else (a gate refusal also writes a file).
    const perIp = sweepsByIp.take(clientOf(c));
    if (!perIp.ok) return c.json({ error: `sweep not started: ${perIp.reason}` }, 429);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = sweepBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const target = targets.get(parsed.data.target.codeSha256);
    if (!target || target.ref !== parsed.data.target.ref) {
      return c.json({ error: "unknown target: register it with POST /targets first (same ref and codeSha256)" }, 400);
    }
    if (target.kind !== "ts-fixture") return c.json({ error: `${target.ref} runs on the EVM runner; the waves screen runs TypeScript targets only` }, 400);
    const id = newExperimentId();
    const decision = gate(parsed.data.params, SWEEP_GATE_CONTEXT);
    if (!decision.allowed) {
      record({
        kind: "gate_rejection",
        id,
        experimentId: id,
        time: new Date().toISOString(),
        role: "human",
        trigger: "POST /sweeps: the gate refused the sweep, so it never ran",
        experiment: parsed.data.params,
        reason: decision.reason,
      });
      return c.json({ error: `gate: rejected (${decision.reason}); nothing will run` }, 422);
    }
    if (sweepsRunning.has(sessionId)) return c.json({ error: "a sweep is already running for this session; wait for it to finish" }, 429);
    const sandboxSlot = sandboxGate.take(sessionId, clientOf(c)); // E3 review B5
    if (!sandboxSlot.ok) return c.json({ error: `sweep not started: ${sandboxSlot.reason}` }, 429);
    const experiment: Experiment = { id, target, runner: "ts", params: decision.params, proposedBy: { role: "human" }, gate: { allowed: true } };
    sweepsRunning.add(sessionId);
    let run: Run;
    let ctl: Run;
    try {
      ctl = await getControl(target);
      run = await runExperiment(experiment, ctl, { executor });
    } finally {
      sweepsRunning.delete(sessionId);
      sandboxSlot.release();
    }
    keepRun(run);
    const p = decision.params as Extract<Experiment["params"], { shape: "concurrency-sweep" }>;
    try {
      agentLog.emit(sessionId, {
        role: "runner",
        action: oneLine(`runs ${p.callers} caller${p.callers === 1 ? "" : "s"} at once (concurrency-sweep, failTimes ${p.failTimes}); control ${run.controlPassed ? "matched" : "did not match"}`),
        ref: { kind: "run", id: run.id },
      });
    } catch {
      // a refused log line never hides the run
    }
    return c.json({ experiment, run, control: { runId: ctl.id, passed: ctl.controlPassed } });
  });

  // D06-01: Muse Code proposes a change toward what the bettors expected; plain code checks it; the
  // same experiment re-runs on the changed code (same seed / same fork block); the same bets are judged.
  const changesByRun = new Map<string, Promise<ChangeAnswer>>();
  const changesPerSession = new Map<string, number>();
  const fixerBudget = opts.fixer ? (opts.fixer.budget ?? budget ?? createModelBudget()) : undefined;
  app.post("/changes", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = changeBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const runId = parsed.data.runId;
    const round = [...(betStore.peek(sessionId)?.values() ?? [])].find((r) => r.run?.id === runId);
    if (!round || round.status !== "done" || !round.run) return c.json({ error: `this session has no finished run ${runId}` }, 404);
    // One change per run: asking again returns the same answer (no new model call, no new replay).
    const known = changesByRun.get(runId);
    if (known) return c.json(await known);
    // E3: pasted code is never sent to Muse Code (a `muse exec` call is not behind the pasted-code model guard), and
    // replaying a change on pasted code is not built, so no model is asked.
    if (round.experiment.target.kind === "pasted") {
      return c.json({ ok: false, runId, reason: `${MUSE_CODE}: not asked (changes to pasted code are not built yet)`, fixer: null, toward: null } satisfies ChangeAnswer);
    }
    if (!opts.fixer || !fixerBudget) {
      return c.json({ ok: false, runId, reason: `${MUSE_CODE}: not asked (this server asks no Meta model for changes)`, fixer: null, toward: null } satisfies ChangeAnswer);
    }
    const used = changesPerSession.get(sessionId) ?? 0;
    if (used >= MAX_CHANGES_PER_SESSION) return c.json({ ok: false, runId, reason: `${MUSE_CODE}: not asked (call limit reached: this session already asked for ${MAX_CHANGES_PER_SESSION} changes)`, fixer: null, toward: null } satisfies ChangeAnswer);
    let slot: { release: () => void } | undefined;
    if (round.experiment.runner === "evm") {
      // The replay forks Base (paid RPC reads): it takes a run slot like POST /runs. M6 (day-6 review):
      // taken BEFORE the per-IP model-round slot, so a busy fork never spends a model round.
      const s = runGate.take(sessionId, clientOf(c));
      if (!s.ok) return c.json({ error: `change not started: ${s.reason}` }, 429);
      slot = s;
    } else {
      const s = sandboxGate.take(sessionId, clientOf(c)); // E3 review B5: the change replay starts the sandbox
      if (!s.ok) return c.json({ error: `change not started: ${s.reason}` }, 429);
      slot = s;
    }
    const byIp = modelRoundsByIp.take(clientOf(c));
    if (!byIp.ok) {
      slot?.release();
      return c.json({ ok: false, runId, reason: `${MUSE_CODE}: not asked (${byIp.reason})`, fixer: null, toward: null } satisfies ChangeAnswer);
    }
    changesPerSession.set(sessionId, used + 1);
    const emitter = sessionEmitter(agentLog, sessionId);
    const exp = round.experiment;
    const names = Object.fromEntries(modelSlotsOf(round).filter((m) => m.status !== "off").map((m) => [m.who, m.display]));
    const work = changeAndReplay(round, {
      fixer: { chat: opts.fixer.chat, ...(opts.fixer.museExec !== undefined ? { museExec: opts.fixer.museExec } : {}), ...(opts.fixer.repairWith ? { repairWith: opts.fixer.repairWith } : {}), guard: fixerBudget.track },
      tsReplay: opts.tsReplay ?? ((run, change, ctx) => tsRunner(executor).replayWithChange(run, change, ctx)),
      evmReplay: opts.evmReplay ?? ((run, change, ctx) => evmRunner({ onProgress: ctx.onProgress }).replayWithChange(run, change, ctx)),
      log: emitter,
      names,
    }).then(
      (a) => scrubDeep(a) as ChangeAnswer, // S1: no RPC URL in any answer
      (e: unknown) => {
        const message = redactRpc(e instanceof Error ? e.message : String(e));
        roundLog(emitter).runnerStopped(exp, message);
        return { ok: false as const, runId, reason: `the replay could not finish: ${message}`, fixer: null, toward: null };
      },
    );
    changesByRun.set(runId, work);
    try {
      const answer = await work;
      // M6 (day-6 review): a replay that could not finish is not kept, so the run can be asked again.
      if (!answer.ok && answer.reason.startsWith("the replay could not finish")) changesByRun.delete(runId);
      if (answer.ok) {
        keepRun(answer.replay);
        // D06-01: the change and its replay go into the round's .atlas.json (verified again as a whole).
        const file = proofStore.get(runId);
        if (file && !file.change) {
          try {
            const next = withChange(file, answer.change, { run: answer.replay, verdicts: answer.after.verdicts, ...(answer.passRule ? { passRule: answer.passRule } : {}) });
            const put = proofStore.put(next, { run: round.run, replay: answer.replay });
            return c.json({ ...answer, proof: { ok: true, runId, published: put.published, ...(put.error ? { error: put.error } : {}) } });
          } catch (e) {
            return c.json({ ...answer, proof: { ok: false, runId, reason: redactRpc(e instanceof Error ? e.message : String(e)) } });
          }
        }
      }
      return c.json(answer);
    } finally {
      slot?.release();
    }
  });

  // D07-02: "what else?". The Adversary reads a finished round and proposes one more experiment on the same
  // target; the gate decides; a repeat of an experiment already run here is refused; then Atlas runs it as an
  // autonomous round: plain-code questions, Muse Spark's bets sealed before the run, the person "not asked",
  // the run, the judge. No human click between the proposal and the verdict.
  const adversaryByRun = new Map<string, Promise<AdversaryAnswer>>();
  const adversaryPerSession = new Map<string, number>();
  /** The finding a round worked on, with its file text (the same choice startModelBets makes). */
  const roundFinding = (sessionId: string, round: Round): { finding: Finding; fileText: string } | undefined => {
    const exp = round.experiment;
    if (round.finding) {
      const text = fileTextOf(exp.target, round.finding.file);
      return text === undefined ? undefined : { finding: round.finding, fileText: text };
    }
    if (exp.target.kind === "ts-fixture" && exp.target.ref === FIXTURE_FILE) {
      const fileText = readFixture(exp.target);
      return { finding: findingFor(sessionId, exp.target, fileText).finding, fileText };
    }
    return undefined;
  };
  app.post("/adversary", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = changeBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const runId = parsed.data.runId;
    // D07-01: the claimant header picks who bets in the autonomous round ("both": Spark AND Spark Open), as on POST /experiments.
    const claimant = parseClaimantMode(c.req.header(CLAIMANT_HEADER));
    if (!claimant.ok) return c.json({ error: claimant.reason }, 400);
    const rounds = betStore.peek(sessionId);
    const round = [...(rounds?.values() ?? [])].find((r) => r.run?.id === runId);
    if (!rounds || !round || round.status !== "done" || !round.run) return c.json({ error: `this session has no finished run ${runId}` }, 404);
    // One "what else?" per run: asking again returns the same answer (no new model call, no new run).
    const known = adversaryByRun.get(runId);
    if (known) return c.json(await known);
    const model = opts.adversary?.model ?? ADVERSARY_MODEL;
    const display = modelDisplay(model);
    const notAsked = (reason: string) => c.json({ ok: false, fromRunId: runId, reason: `Adversary (${model}): not asked (${reason})`, adversary: null } satisfies AdversaryAnswer);
    if (!opts.adversary || !adversaryChat || !budget) return notAsked("this server asks no Meta model what else to run");
    const used = adversaryPerSession.get(sessionId) ?? 0;
    if (used >= MAX_ADVERSARY_PER_SESSION) return notAsked(`call limit reached: this session already asked ${MAX_ADVERSARY_PER_SESSION} times`);
    if (rounds.size >= MAX_EXPERIMENTS) return notAsked(`a session holds at most ${MAX_EXPERIMENTS} experiments; start a new session`);
    if (round.experiment.target.kind === "pasted") return notAsked("what else on pasted code is not built yet");
    const picked = roundFinding(sessionId, round);
    if (!picked) return notAsked(`no finding on ${round.experiment.target.ref} for this run`);
    let slot: { release: () => void } | undefined;
    if (round.experiment.runner === "evm") {
      // The autonomous round forks Base (paid RPC reads): it takes a run slot like POST /runs, BEFORE any model call.
      const s = runGate.take(sessionId, clientOf(c));
      if (!s.ok) return c.json({ error: `what else not started: ${s.reason}` }, 429);
      slot = s;
    }
    const byIp = modelRoundsByIp.take(clientOf(c));
    const allowed = byIp.ok ? budget.startExperiment(sessionId) : byIp;
    if (!allowed.ok) {
      slot?.release();
      return notAsked(allowed.reason);
    }
    adversaryPerSession.set(sessionId, used + 1);
    const emitter = sessionEmitter(agentLog, sessionId);
    const clientIp = clientOf(c);
    const work = (async (): Promise<AdversaryAnswer> => {
      const exp0 = round.experiment;
      const gateCtx = round.gateContext ?? (exp0.runner === "evm" ? EVM_GATE_CONTEXT : TS_GATE_CONTEXT);
      const alreadyRun = [...rounds.values()]
        .filter((r) => r.experiment.gate.allowed && r.experiment.target.codeSha256 === exp0.target.codeSha256 && (r.run !== undefined || r.status !== "open"))
        .map((r) => r.experiment.params);
      const measuresOf = Object.fromEntries(round.bets.map((b) => [b.id, b.measures]));
      try {
        emitter.emit({ role: "human", action: oneLine(`asks what else, after run ${runId}`), ref: { kind: "run", id: runId } });
      } catch {
        // a refused log line never stops the round
      }
      const a = await runAdversary(
        {
          target: exp0.target,
          finding: picked.finding,
          fileText: picked.fileText,
          ...(exp0.target.ref === FIXTURE_FILE ? { contextRange: fixtureContextRange(picked.fileText) } : {}),
          lastExperiment: exp0.params,
          lastRun: round.run!,
          verdicts: round.verdicts ?? [],
          measuresOf,
          alreadyRun,
          gateContext: gateCtx,
          // The repeat check fills left-out fields with the function's defaults, read from the target's own code.
          ...(exp0.target.kind === "ts-fixture" ? { functionDefaults: functionDefaults(readFixture(exp0.target)) } : {}),
          model,
        },
        { chat: adversaryChat, log: emitter, onRefusal: (r) => record(r) },
      );
      const rejected = a.rejected.map((x) => ({ id: x.id, safeReason: x.safeReason }));
      const usd = a.usage ? a.usage.usd : null;
      if (!a.ok) return { ok: false, fromRunId: runId, reason: `${display}: no usable answer (${a.reason})`, adversary: { model, display, rejected, usd } };

      // Plain code builds the experiment from the gate-checked params; the model's words name nothing.
      const recheck = gate(a.params, gateCtx);
      if (!recheck.allowed) return { ok: false, fromRunId: runId, reason: `gate: rejected (${recheck.reason})`, adversary: { model, display, rejected, usd } };
      const id = newExperimentId();
      const experiment: Experiment = { id, target: exp0.target, runner: exp0.runner, params: recheck.params, proposedBy: { role: "adversary", model }, gate: { allowed: true } };
      const next = newRound(experiment, gateCtx);
      next.gateContext = gateCtx;
      next.finding = picked.finding;
      next.extraQuestions = []; // nobody else bets in an autonomous round
      next.autonomous = { fromRunId: runId, adversaryModel: model };
      rounds.set(id, next);
      const adversary = { model, display, proposed: { experimentId: id, name: a.name, params: recheck.params }, why: a.why, rejected, usd };
      const person = { status: "not asked" as const, reason: AUTONOMOUS_PERSON_REASON };
      try {
        emitter.emit({ role: "human", action: oneLine(`not asked: ${id} is an autonomous round (${a.name}); no person bets, no click`), ref: { kind: "experiment", id } });
      } catch {
        // a refused log line never stops the round
      }
      // The claimant model(s) bet on the plain-code questions, sealed before the run. This round's model-bets
      // limits were counted once above, for the whole round (S4).
      // M4 (day-7 review): the mode of the round it reads, never the page's current toggle.
      const nextFacts = await chainFactsFor(experiment); // D22: the same facts, read before the models bet
      if (nextFacts !== undefined) next.chainFacts = nextFacts;
      startModelBets(next, sessionId, clientIp, round.claimantMode ?? claimant.mode, true);
      await modelsSettled(next);
      const seated = modelSlotsOf(next).filter((s) => s.status === "sealed");
      if (seated.length === 0) {
        // S4: nobody bet, so there is nothing to judge: the code is not run (on Moonwell, no paid fork for nobody).
        rounds.delete(id);
        const why = modelSlotsOf(next)
          .map((s) => `${s.display}: ${s.status === "no_usable_answer" ? `no usable answer (${s.reason ?? "no reason given"})` : `not asked (${s.reason ?? "no reason given"})`}`)
          .join("; ");
        try {
          emitter.emit({ role: "runner", action: oneLine(`does not run ${id}: no bettor sealed a bet`), ref: { kind: "experiment", id } });
        } catch {
          // a refused log line never stops the answer
        }
        return { ok: false, fromRunId: runId, reason: `no bettor sealed a bet, so Atlas did not run it: ${why || "no model was asked"}`, adversary, person, round: { experiment, questions: next.questions, model: modelSlotView(next), models: modelSlotViews(next) } };
      }
      let r: Awaited<ReturnType<typeof runRound>>;
      // E3 review B5: an autonomous TypeScript round starts the sandbox too.
      const sbx = next.experiment.runner === "evm" ? null : sandboxGate.take(sessionId, clientIp);
      if (sbx && !sbx.ok) return { ok: false, fromRunId: runId, reason: `the run did not start: ${sbx.reason}`, adversary, person, round: { experiment, questions: next.questions, model: modelSlotView(next), models: modelSlotViews(next) } };
      try {
        r = await runRound(sessionId, next);
      } catch (e) {
        const message = e instanceof RunDidNotFinish ? e.message : `the run did not finish: ${redactRpc(e instanceof Error ? e.message : String(e))}`;
        return { ok: false, fromRunId: runId, reason: message, adversary, person, round: { experiment, questions: next.questions, model: modelSlotView(next), models: modelSlotViews(next) } };
      } finally {
        if (sbx?.ok) sbx.release();
      }
      if (r.status !== 200) return { ok: false, fromRunId: runId, reason: String(r.body.error), adversary, person, round: { experiment, questions: next.questions, model: modelSlotView(next), models: modelSlotViews(next) } };
      return { ok: true, fromRunId: runId, adversary, person, round: { experiment, questions: next.questions, ...r.body } };
    })().then(
      (a) => scrubDeep(a) as AdversaryAnswer, // S1: no RPC URL in any answer
      (e: unknown): AdversaryAnswer => ({ ok: false, fromRunId: runId, reason: `the server could not finish: ${redactRpc(e instanceof Error ? e.message : String(e))}`, adversary: null }),
    );
    adversaryByRun.set(runId, work);
    try {
      const answer = await work;
      // M6 (day-7 review): an answer with no finished run is not kept, so "what else?" can be asked again
      // (within the session cap of MAX_ADVERSARY_PER_SESSION). A finished run is kept: asking again shows it.
      const ran = (answer.round as { run?: unknown } | undefined)?.run !== undefined;
      if (!answer.ok && !ran) adversaryByRun.delete(runId);
      return c.json(answer);
    } finally {
      slot?.release();
    }
  });

  // D04-04: the round's .atlas.json, as kept (memory) or published (disk).
  app.get("/proofs/:runId", (c) => {
    const file = proofOf(c.req.param("runId"));
    if (!file) return c.json({ error: `no .atlas.json for run ${c.req.param("runId")}` }, 404);
    // E3 review M4: a pasted round's source is the owning session's. Anyone else gets the card without it (the
    // fingerprint stays, so the card still says which code ran).
    // E3 review r2 minor 5: the source only when an owner is on record AND the header names it.
    const owner = pastedOwners.get(c.req.param("runId"));
    if (file.target.kind === "pasted" && (owner === undefined || c.req.header("x-atlas-session") !== owner)) return c.json(withheldSource(file));
    return c.json(file);
  });

  /**
   * S2 (day-6 review): a card that carries a change re-runs the change replay too (the same change on the
   * same experiment, same seed / same fork block), and compares it with the file's replay.
   */
  type ReplayAnswerChange = { replayRunId: string; measuredEqual: boolean; resultDiff: string[]; controlPassed: boolean; sameOutcomes: boolean } | { error: string };
  const rerunChange = async (file: AtlasFile, exp: Experiment, before: Run): Promise<ReplayAnswerChange | undefined> => {
    if (!file.change || !file.replay) return undefined;
    const stored = file.replay;
    try {
      const again =
        before.runner === "evm"
          ? scrubDeep(await (opts.evmReplay ?? ((r, ch, ctx) => evmRunner({ onProgress: ctx.onProgress }).replayWithChange(r, ch, ctx)))(before, file.change, { experiment: exp }))
          : await (opts.tsReplay ?? ((r, ch, ctx) => tsRunner(executor).replayWithChange(r, ch, ctx)))(before, file.change, { experiment: exp });
      // R2 review round 1: judged under the rules the file was made under, so an old file compares like with like.
      const verdicts = file.bets.map((b) => judge(b, again, { timingRule: timingRuleOf(file) }));
      return {
        replayRunId: again.id,
        measuredEqual: sameJson(stored.run.result.measured, again.result.measured),
        resultDiff: resultDiff(stored.run.result, again.result),
        controlPassed: again.controlPassed,
        sameOutcomes: verdicts.every((x) => stored.verdicts.find((y) => y.betId === x.betId)?.outcome === x.outcome),
      };
    } catch (e) {
      return { error: redactRpc(e instanceof Error ? e.message : String(e)) };
    }
  };

  // D04-04: re-execute a round from its .atlas.json. TS: the same seed; EVM: the same fork block.
  // Answers whether the replay's `measured` is deep-equal to the file's, and which result fields differ.
  app.get("/replay/:runId", async (c) => {
    const runId = c.req.param("runId");
    const stored = proofOf(runId);
    if (!stored) return c.json({ error: `no .atlas.json for run ${runId}` }, 404);
    const v = verifyAtlasFile(stored);
    if (!v.ok) return c.json({ error: `the .atlas.json does not verify: ${v.problems.join("; ")}` }, 422);
    const file = v.file;
    const exp = file.experiments[0]!;
    const before = file.runs[0]!;
    // E3 review B5: a pasted round replays only for the session that made it; every TS replay takes a sandbox slot.
    if (exp.target.kind === "pasted" && (c.req.header("x-atlas-session") === undefined || c.req.header("x-atlas-session") !== pastedOwners.get(runId))) {
      return c.json({ error: "a replay of pasted code is for the session that pasted it" }, 403);
    }
    let sbx: { release: () => void } | undefined;
    if (before.runner !== "evm") {
      // The per-address and overall caps hold whatever session is sent (pasted code also needs its owner's, above).
      const sid = sessionIdOf(c);
      if (sid === null) return c.json({ error: BAD_SESSION }, 400);
      const s = sandboxGate.take(sid, clientOf(c));
      if (!s.ok) return c.json({ error: `replay not started: ${s.reason}` }, 429);
      sbx = s;
    }
    try {
    let replay: Run;
    let changeReplay: ReplayAnswerChange | undefined;
    if (before.runner === "evm") {
      // S5: an EVM replay forks Base and makes paid RPC reads, so it is capped per session and overall.
      // The session must be sent (not made up by the server), or the per-session cap would mean nothing.
      if (c.req.header("x-atlas-session") === undefined) return c.json({ error: "an EVM replay needs the x-atlas-session header: replays are counted per session" }, 400);
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      const slot = replayGate.take(sessionId, clientOf(c));
      if (!slot.ok) return c.json({ error: `replay not started: ${slot.reason}` }, 429);
      try {
        replay = scrubDeep(await evmRun(exp, { forkBlock: before.forkBlock!, onProgress: () => {} }));
        changeReplay = await rerunChange(file, exp, before);
      } finally {
        slot.release();
      }
    } else if (exp.target.kind === "pasted") {
      // E3: the pasted source travels in the file; its language's runner runs it again. R1 (D42): with the original
      // run's seed, time zone and locale, so the replay reproduces it (a file from before R1 says "none": the default).
      if (!paste.runnable(exp.target.language ?? "js")) return c.json({ error: `this server has no runner for ${exp.target.language}` }, 422);
      replay = await runPasted(exp, before.seed);
    } else {
      const ctl = await getControl(exp.target);
      replay = await runExperiment(exp, ctl, { executor, ...(before.seed !== undefined ? { seed: before.seed } : {}) });
      changeReplay = await rerunChange(file, exp, before);
    }
    const again = file.bets.map((b) => judge(b, replay, { timingRule: timingRuleOf(file) }));
    return c.json({
      runId,
      replayRunId: replay.id,
      runner: before.runner,
      ...(before.forkBlock !== undefined ? { forkBlock: before.forkBlock, replayForkBlock: replay.forkBlock } : {}),
      ...(before.seed !== undefined ? { seed: before.seed, replaySeed: replay.seed } : {}),
      measuredEqual: sameJson(before.result.measured, replay.result.measured),
      resultDiff: resultDiff(before.result, replay.result),
      controlPassed: replay.controlPassed,
      sameOutcomes: again.every((x) => file.verdicts.find((y) => y.betId === x.betId)?.outcome === x.outcome),
      ...(changeReplay ? { changeReplay } : {}),
      replay,
    });
    } finally {
      sbx?.release();
    }
  });

  app.onError((err, c) => {
    // A log line the agent log refused is a bug in Atlas, not in the request: say so plainly (S3).
    // S1: no error body ever carries the RPC URL, its host or its key.
    if (err instanceof AgentEventError) return c.json({ error: `the server could not write its log line: ${redactRpc(err.message)}` }, 500);
    return c.json({ error: `the server could not finish the request: ${redactRpc(err.message)}` }, 500);
  });

  return app;
}

export const app = createApp();
