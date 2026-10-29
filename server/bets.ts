// Server-sealed bets (D02-04). The server, not the browser, seals every bet.
//
// Why: a seal made in the browser proves a bet was not edited, but the browser also wrote the time
// on it, so it could not prove the bet was placed BEFORE the run. Here the server writes the time
// (its own clock) and the nonce (16 random bytes it keeps to itself until the run), and it refuses
// any bet once a run of that experiment has started.
//
// The flow, per session (the `x-atlas-session` header):
// 1. POST /experiments → the gate decides; plain code writes the questions (src/gate.ts).
// 2. POST /bets (one per answer) → the server checks the answer fits the question, seals it with
//    src/seal.ts at server time, stores it, and returns the sealed bet WITHOUT its nonce. The hash
//    is shown on screen now; nobody can recompute it yet, so nobody can test guesses against it.
// 3. POST /runs → bets are frozen first (any later POST /bets gets 409), then the server checks
//    every bet's sealedAt is earlier than the run's start, runs, judges, and reveals every bet in
//    full (with its nonce) so the browser can recompute the hash itself.
//
// Everything lives in memory, bounded: at most MAX_SESSIONS sessions, MAX_EXPERIMENTS per session
// and MAX_BETS per experiment. A session is created only by POST /experiments; a request that
// fails (404, 400) never creates or reorders one. When the store is full the least recently used
// session is dropped, except one holding sealed bets that have not run yet (kept for 2 hours).
//
// One bet per bettor per question (S1): a person who has sealed a bet on a question cannot seal
// another on it in the same experiment (409). The page seals all its answers in ONE request, so
// a half-sealed attempt cannot happen: if any answer is refused, none is sealed.

import { nanoid } from "nanoid";
import { z } from "zod";
import { extraQuestionsFor, questionsFor, type GateContext, type Question } from "../src/gate";
import { jsonBetValueProblem, sealBet } from "../src/seal";
import type { JsonValue } from "../src/types";
import type { Bet, BetAnswer, Experiment, Finding, Run, RunAttempt, Verdict } from "../src/types";
import type { ClaimantMode } from "../src/claimants";
import type { ChainFactsResult } from "../src/chain-facts";
import { spenderOf } from "./access/context";

export const MAX_SESSIONS = 500;
export const MAX_EXPERIMENTS = 50;
export const MAX_BETS = 50;

/** A sealed bet as the server shows it before the run: everything except the nonce. */
export type PublicBet = Omit<Bet, "nonce">;

export const publicBet = (b: Bet): PublicBet => {
  const { nonce: _hidden, ...rest } = b;
  return rest;
};

/**
 * What anyone may see of a sealed bet before the run when the bettor is NOT the person asking:
 * who, which question, when, and the hash. Not the answer, not the rationale, not the nonce.
 * (D02-06: the page shows "Muse Spark has sealed 3 bets" + these hashes, and Spark's answers only
 * after the run.)
 */
export type SealedOnly = Pick<Bet, "id" | "experimentId" | "who" | "question" | "measures" | "sealedAt" | "sealedHash">;

export const sealedOnly = (b: Bet): SealedOnly => ({
  id: b.id,
  experimentId: b.experimentId,
  who: b.who,
  question: b.question,
  measures: b.measures,
  sealedAt: b.sealedAt,
  sealedHash: b.sealedHash,
});

/** The model's slot on one experiment (D02-06). */
export interface ModelSlot {
  model: string;
  /** "model:<id>", as on its bets. */
  who: `model:${string}`;
  /** How the screen names it, e.g. "Muse Spark 1.3 (muse-spark-1.3)". */
  display: string;
  status: "off" | "thinking" | "sealed" | "no_usable_answer";
  /**
   * Plain reason for "off" and "no_usable_answer". Before the run it never quotes the model's
   * answer: it says only what kind of problem the answer had (S2).
   */
  reason?: string;
  /** The full reason, which may quote the model's unusable answer. Shown only after the run. */
  detail?: string;
  /** Settles when the model's bets are sealed or it gave no usable answer. Never rejects. */
  settled?: Promise<void>;
}

/** The model slot as the server shows it: status and sealed hashes only (never the answers). */
export interface ModelSlotView {
  model: string;
  who: string;
  display: string;
  status: ModelSlot["status"];
  reason?: string;
  /** After the run only: the full reason, which may quote the model's unusable answer. */
  detail?: string;
  sealed: SealedOnly[];
}

export function modelSlotView(round: Round): ModelSlotView | null {
  return round.model ? slotView(round, round.model) : null;
}

/** D07-01: every model slot of the round, in column order (one in "spark" or "spark-open" mode, two in "both"). */
export function modelSlotViews(round: Round): ModelSlotView[] {
  return modelSlotsOf(round).map((m) => slotView(round, m));
}

/** The round's model slots: `models` when set, else the single `model`, else none. */
export function modelSlotsOf(round: Round): ModelSlot[] {
  if (round.models && round.models.length > 0) return round.models;
  return round.model ? [round.model] : [];
}

function slotView(round: Round, m: ModelSlot): ModelSlotView {
  return {
    model: m.model,
    who: m.who,
    display: m.display,
    status: m.status,
    ...(m.reason ? { reason: m.reason } : {}),
    // The model's own unusable values are part of its answer: revealed with the bets, after the run.
    ...(m.detail && round.status === "done" ? { detail: m.detail } : {}),
    sealed: round.bets.filter((b) => b.who === m.who).map(sealedOnly),
  };
}

export interface Round {
  experiment: Experiment;
  /** The questions shown to everyone (the same ones a model answers). */
  questions: Question[];
  /** Extra questions a person may also bet on (src/gate.ts extraQuestionsFor). */
  extraQuestions: Question[];
  bets: Bet[];
  /** "open": bets accepted. "running"/"done"/"stopped": bets frozen. */
  status: "open" | "running" | "done" | "stopped";
  /** Server time the bets were frozen (set before anything runs). */
  betsFrozenAt?: string;
  run?: Run;
  verdicts?: Verdict[];
  /** The model's bets on this same experiment (D02-06). Absent when the server asks no model. In "both" mode, the first slot (Muse Spark). */
  model?: ModelSlot;
  /** D07-01: every model slot, in column order. In "both" mode Muse Spark and Muse Spark Open each have one. */
  models?: ModelSlot[];
  /** D04-04: the finding the person chose for this round (an Investigator finding or lines they picked). */
  finding?: Finding;
  /** D04-04: what the gate allowed on this target (TS or EVM). */
  gateContext?: GateContext;
  /**
   * D07-02: a round the Adversary proposed and Atlas ran with no human click. No person is asked: the
   * server refuses a person's bet on it and runs it itself (POST /runs refuses it too).
   */
  autonomous?: { fromRunId: string; adversaryModel: string };
  /** D07-01 / day-7 review M4: who was asked to bet on this round (the x-atlas-claimant mode it started with). */
  claimantMode?: ClaimantMode;
  /**
   * Final review S2: run attempts that did not finish. After the first one the bets stay frozen (no new bet)
   * but the round is "open" again, so the SAME experiment can run with the SAME sealed bets.
   */
  attempts?: RunAttempt[];
  /** Why a "stopped" round stopped, in plain words (shown when POST /runs is asked again). */
  stoppedReason?: string;
  /** D22 (Moonwell rounds): the chain facts read at block 42194662 before any bet was asked for, or why there are none. */
  chainFacts?: ChainFactsResult;
  /**
   * E3 (pasted rounds): the bet screen's text (src/paste-context.ts); the page shows it and every betting model gets it
   * (D19). E3 review r2 B3: kept as its test part (`seenHead`, shared by every round with the same text) and the
   * file's key; the numbered file is joined on when the text is served (server/paste.ts fileBlock).
   */
  seenHead?: string;
  seenFile?: { codeSha256: string; exportLine: number };
  /** E3 review r2 M2: this round repeats a test already run in this session (that round's experiment id). */
  repeatOf?: string;
}

/**
 * How long a session holding sealed-but-unrun bets is kept safe from eviction. G1 review B6: counted from the OLDEST
 * sealed bet that has not run (not from the last use), so no request can keep a slot pinned: 30 minutes (was 2 hours
 * after the last use).
 */
export const PROTECT_SEALED_MS = 30 * 60 * 1000;
/** G1 review B6: sessions one dev invite code may hold; its 21st drops its own least recently used one. */
export const MAX_SESSIONS_PER_CODE = 20;

export interface BetStore {
  /** The rounds of one session, or undefined. Never creates a session and never counts as a use. */
  peek(sessionId: string): Map<string, Round> | undefined;
  /** Marks a session as just used (only after a request on it succeeded): it becomes the last to be dropped. */
  touch(sessionId: string): void;
  /**
   * The rounds of a session, creating it when absent. Only POST /experiments calls this. When the
   * store is full, the least recently USED session is dropped, but never one that holds sealed bets
   * that have not run yet, until PROTECT_SEALED_MS after its last use. If every session is
   * protected, nothing is dropped and the new session is refused with a plain reason.
   */
  open(sessionId: string): { ok: true; rounds: Map<string, Round> } | { ok: false; reason: string };
  /** How many sessions are held (tests use it). */
  size(): number;
}

/**
 * G1 review B6: the time protection started for a session: now while a run is in progress, the oldest sealed bet that
 * has not run yet, or undefined when there is nothing to protect.
 */
function protectedSince(rounds: Map<string, Round>, t: number): number | undefined {
  let since: number | undefined;
  for (const r of rounds.values()) {
    if (r.status === "running") return t;
    if (r.status === "open") for (const b of r.bets) {
      const at = Date.parse(b.sealedAt);
      if (Number.isFinite(at)) since = since === undefined ? at : Math.min(since, at);
    }
  }
  return since;
}

export function createBetStore(opts: { maxSessions?: number; protectMs?: number; perCode?: number; now?: () => number } = {}): BetStore {
  const maxSessions = opts.maxSessions ?? MAX_SESSIONS;
  const protectMs = opts.protectMs ?? PROTECT_SEALED_MS;
  const perCode = opts.perCode ?? MAX_SESSIONS_PER_CODE;
  const now = opts.now ?? Date.now;
  // Insertion order = least recently used first. Only touch() and open() reorder it.
  const sessions = new Map<string, { rounds: Map<string, Round>; lastUsed: number; who: string }>();
  const isProtected = (s: { rounds: Map<string, Round> }, t: number) => {
    const since = protectedSince(s.rounds, t);
    return since !== undefined && t - since < protectMs;
  };

  const touch = (sessionId: string) => {
    const s = sessions.get(sessionId);
    if (!s) return;
    sessions.delete(sessionId);
    s.lastUsed = now();
    sessions.set(sessionId, s);
  };

  return {
    peek: (sessionId) => sessions.get(sessionId)?.rounds,
    touch,
    open(sessionId) {
      const found = sessions.get(sessionId);
      if (found) {
        touch(sessionId);
        return { ok: true, rounds: found.rounds };
      }
      const who = spenderOf();
      if (who.kind === "dev") {
        // G1 review B6: a dev code holds at most `perCode` sessions; past it, its OWN least recently used one goes.
        const mine = [...sessions.entries()].filter(([, s]) => s.who === who.key);
        if (mine.length >= perCode) sessions.delete(mine[0]![0]);
      }
      if (sessions.size >= maxSessions) {
        const t = now();
        for (const [id, s] of sessions) {
          if (sessions.size < maxSessions) break;
          if (!isProtected(s, t)) sessions.delete(id);
        }
        if (sessions.size >= maxSessions) {
          return { ok: false, reason: `the server is holding ${maxSessions} rounds with sealed bets that have not run yet; try again later` };
        }
      }
      const rounds = new Map<string, Round>();
      sessions.set(sessionId, { rounds, lastUsed: now(), who: who.key });
      return { ok: true, rounds };
    },
    size: () => sessions.size,
  };
}

export function newRound(experiment: Experiment, ctx: GateContext): Round {
  const allowed = experiment.gate.allowed;
  return {
    experiment,
    questions: allowed ? questionsFor(experiment.params, ctx) : [],
    extraQuestions: allowed ? extraQuestionsFor(experiment.params) : [],
    bets: [],
    status: "open",
  };
}

export const newExperimentId = () => nanoid(10);

// ---------- checking a human bet ----------

const humanAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("integer"), value: z.number() }).strict(),
  z.object({ kind: z.literal("number"), value: z.number(), unit: z.string().optional(), tolerancePct: z.number().optional() }).strict(),
  z.object({ kind: z.literal("enum"), value: z.string(), options: z.array(z.string()).optional() }).strict(),
  z.object({ kind: z.literal("declined"), reason: z.string().trim().min(1).max(300).regex(/\w/, "a declined bet needs a reason in words") }).strict(),
  // E1: a json bet (returnedJson). The value is checked by plain code in checkAnswer (depth first, without recursion).
  z.object({ kind: z.literal("json"), value: z.unknown() }).strict(),
  // U1 (D48): one tap on a quiz question, by the option's letter. The options come from the question, never the browser.
  z.object({ kind: z.literal("quiz"), choice: z.string().min(1).max(8) }).strict(),
]);

/** What the browser sends for ONE bet. The server fills question, options, unit and tolerance from the question itself. */
export const humanBetBody = z
  .object({
    experimentId: z.string().min(1).max(64),
    who: z.literal("human"),
    measures: z.string().min(1).max(100),
    answer: humanAnswer,
  })
  .strict();

/**
 * What the page sends: ALL of a person's answers in one request. Every answer is checked first;
 * if any is refused, none is sealed, so the person can fix it and send them again.
 */
export const humanBetsBody = z
  .object({
    experimentId: z.string().min(1).max(64),
    who: z.literal("human"),
    bets: z.array(z.object({ measures: z.string().min(1).max(100), answer: humanAnswer }).strict()).min(1).max(20),
  })
  .strict();

export type HumanBetBody = z.infer<typeof humanBetBody>;

/**
 * Turn the browser's answer into the exact BetAnswer for this question, or say plainly why not.
 * The unit and options come from the question (src/gate.ts, src/units.ts), never from the browser;
 * if the browser sent them, they must agree.
 */
export function checkAnswer(question: Question, answer: HumanBetBody["answer"]): { ok: true; answer: BetAnswer } | { ok: false; reason: string } {
  const bad = (reason: string) => ({ ok: false as const, reason });
  if (answer.kind === "declined") return { ok: true, answer: { kind: "declined", reason: answer.reason } };
  if (answer.kind !== question.kind) return bad(`"${question.measures}" takes a ${question.kind} answer; got ${answer.kind}`);
  switch (answer.kind) {
    case "integer": {
      if (!Number.isSafeInteger(answer.value)) return bad(`"${question.measures}" needs a whole number; got ${answer.value}`);
      if (answer.value < 0) return bad(`"${question.measures}" counts ${question.unit === "ms" ? "milliseconds" : "calls"}, so it cannot be below 0`);
      return { ok: true, answer: { kind: "integer", value: answer.value } };
    }
    case "enum": {
      const options = [...(question.options ?? [])];
      if (answer.options !== undefined && JSON.stringify(answer.options) !== JSON.stringify(options)) {
        return bad(`"${question.measures}" has the options ${options.join(", ")}; the bet listed others`);
      }
      if (!options.includes(answer.value)) return bad(`"${question.measures}" must be one of ${options.join(", ")}; got "${answer.value}"`);
      return { ok: true, answer: { kind: "enum", value: answer.value, options } };
    }
    case "number": {
      if (!Number.isFinite(answer.value)) return bad(`"${question.measures}" needs a finite number`);
      // R2 review round 1 (m1): a time cannot be below 0 ms.
      if (question.unit === "ms" && answer.value < 0) return bad(`"${question.measures}" is a time in ms, so it cannot be below 0`);
      if (answer.unit !== undefined && answer.unit !== question.unit) return bad(`"${question.measures}" is in ${question.unit}; the bet said ${answer.unit}`);
      const tolerancePct = question.tolerancePct ?? 0;
      if (answer.tolerancePct !== undefined && answer.tolerancePct !== tolerancePct) return bad(`"${question.measures}" uses a ${tolerancePct}% tolerance; the bet said ${answer.tolerancePct}%`);
      return { ok: true, answer: { kind: "number", value: answer.value, tolerancePct, unit: question.unit } };
    }
    case "json": {
      // E1 review round 2 (MAJOR-1): a hostile value (nested thousands deep) is refused here, never crashes sealing.
      const why = jsonBetValueProblem(answer.value);
      if (why) return bad(`"${question.measures}" needs a JSON value Atlas can compare: ${why}`);
      return { ok: true, answer: { kind: "json", value: answer.value as JsonValue } };
    }
    case "quiz": {
      const options = [...(question.quiz ?? [])];
      if (!options.some((o) => o.id === answer.choice)) return bad(`"${question.measures}" has the options ${options.map((o) => o.id).join(", ")}; got "${answer.choice}"`);
      return { ok: true, answer: { kind: "quiz", choice: answer.choice, options } };
    }
  }
}

/** Seal a checked human bet with the SERVER's clock and a fresh server nonce. */
export function sealHumanBet(round: Round, question: Question, answer: BetAnswer, now: Date = new Date()): Bet {
  return sealBet({ experimentId: round.experiment.id, who: "human", question: question.text, measures: question.measures, answer, ...(round.repeatOf ? { repeat: true as const } : {}) }, now);
}

/**
 * The ordering check: every bet was sealed strictly before the run started. Returns the ids of
 * bets that were not (empty when all is well). Compared as numbers (ms since 1970), not as text.
 */
export function sealedAfter(bets: readonly Bet[], startedAt: string): string[] {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return bets.map((b) => b.id);
  return bets.filter((b) => !(Date.parse(b.sealedAt) < start)).map((b) => b.id);
}
