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
import { sealBet } from "../src/seal";
import type { Bet, BetAnswer, Experiment, Finding, Run, Verdict } from "../src/types";

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
  const m = round.model;
  if (!m) return null;
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
  /** The model's bets on this same experiment (D02-06). Absent when the server asks no model. */
  model?: ModelSlot;
  /** D04-04: the finding the person chose for this round (an Investigator finding or lines they picked). */
  finding?: Finding;
  /** D04-04: what the gate allowed on this target (TS or EVM). */
  gateContext?: GateContext;
  /**
   * D07-02: a round the Adversary proposed and Atlas ran with no human click. No person is asked: the
   * server refuses a person's bet on it and runs it itself (POST /runs refuses it too).
   */
  autonomous?: { fromRunId: string; adversaryModel: string };
}

/** How long a session holding sealed-but-unrun bets is kept safe from eviction, after its last use. */
export const PROTECT_SEALED_MS = 2 * 60 * 60 * 1000;

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

/** True while a session holds bets that are sealed but not yet judged (or a run in progress). */
function holdsUnrunBets(rounds: Map<string, Round>): boolean {
  for (const r of rounds.values()) {
    if (r.status === "running") return true;
    if (r.status === "open" && r.bets.length > 0) return true;
  }
  return false;
}

export function createBetStore(opts: { maxSessions?: number; protectMs?: number; now?: () => number } = {}): BetStore {
  const maxSessions = opts.maxSessions ?? MAX_SESSIONS;
  const protectMs = opts.protectMs ?? PROTECT_SEALED_MS;
  const now = opts.now ?? Date.now;
  // Insertion order = least recently used first. Only touch() and open() reorder it.
  const sessions = new Map<string, { rounds: Map<string, Round>; lastUsed: number }>();

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
      if (sessions.size >= maxSessions) {
        const t = now();
        for (const [id, s] of sessions) {
          if (sessions.size < maxSessions) break;
          const protectedNow = holdsUnrunBets(s.rounds) && t - s.lastUsed < protectMs;
          if (!protectedNow) sessions.delete(id);
        }
        if (sessions.size >= maxSessions) {
          return { ok: false, reason: `the server is holding ${maxSessions} rounds with sealed bets that have not run yet; try again later` };
        }
      }
      const rounds = new Map<string, Round>();
      sessions.set(sessionId, { rounds, lastUsed: now() });
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
      if (answer.unit !== undefined && answer.unit !== question.unit) return bad(`"${question.measures}" is in ${question.unit}; the bet said ${answer.unit}`);
      const tolerancePct = question.tolerancePct ?? 0;
      if (answer.tolerancePct !== undefined && answer.tolerancePct !== tolerancePct) return bad(`"${question.measures}" uses a ${tolerancePct}% tolerance; the bet said ${answer.tolerancePct}%`);
      return { ok: true, answer: { kind: "number", value: answer.value, tolerancePct, unit: question.unit } };
    }
  }
}

/** Seal a checked human bet with the SERVER's clock and a fresh server nonce. */
export function sealHumanBet(round: Round, question: Question, answer: BetAnswer, now: Date = new Date()): Bet {
  return sealBet({ experimentId: round.experiment.id, who: "human", question: question.text, measures: question.measures, answer }, now);
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
