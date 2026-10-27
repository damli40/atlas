// The model-call budget (S5). Every experiment a person creates asks Muse Spark for its bets, and
// every call costs money, so the server limits them in three plain ways:
// 1. Calls per hour, across everyone (ATLAS_MODEL_CALLS_PER_HOUR, default 60). Each Meta call counts,
//    the repair try included.
// 2. Experiments per session that ask the model (ATLAS_MODEL_EXPERIMENTS_PER_SESSION, default 10).
// 3. Total spend (ATLAS_SPEND_CEILING_USD, default $100): what usage.jsonl already holds when the
//    server starts, plus what this server has spent since. Past the ceiling, no model is asked.
//
// When a limit is reached the model is simply not asked: its slot says "not asked (<reason>)" and
// the person's own round goes on as usual. Nothing here is guessed: the spend comes from the usage
// the Meta API reported. A call that reported no usage cannot be added (its cost is unknown).

import { existsSync, readFileSync } from "node:fs";
import type { ChatArgs, ChatResult } from "./client";

export const DEFAULT_CALLS_PER_HOUR = 60;
export const DEFAULT_EXPERIMENTS_PER_SESSION = 10;
export const DEFAULT_SPEND_CEILING_USD = 100;
const HOUR_MS = 60 * 60 * 1000;

export interface BudgetOptions {
  callsPerHour?: number;
  experimentsPerSession?: number;
  spendCeilingUsd?: number;
  /** Dollars already spent before this server started (read from usage.jsonl by readUsageTotal). */
  spentAtStartUsd?: number;
  now?: () => number;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

export interface ModelBudget {
  /** May this session's new experiment ask the model? Counts the experiment when it may. */
  startExperiment(sessionId: string): BudgetCheck;
  /** Wraps a chat function: each call is checked and counted, and its reported cost is added. */
  wrap(chat: (args: ChatArgs) => Promise<ChatResult>): (args: ChatArgs) => Promise<ChatResult>;
  /** Dollars spent: at start plus since. */
  spentUsd(): number;
  /** Calls made in the last hour. */
  callsLastHour(): number;
}

export function createModelBudget(opts: BudgetOptions = {}): ModelBudget {
  const callsPerHour = opts.callsPerHour ?? DEFAULT_CALLS_PER_HOUR;
  const perSession = opts.experimentsPerSession ?? DEFAULT_EXPERIMENTS_PER_SESSION;
  const ceiling = opts.spendCeilingUsd ?? DEFAULT_SPEND_CEILING_USD;
  const now = opts.now ?? Date.now;
  let spent = opts.spentAtStartUsd ?? 0;
  const callTimes: number[] = [];
  const experiments = new Map<string, number>();

  const prune = () => {
    const from = now() - HOUR_MS;
    while (callTimes.length > 0 && callTimes[0]! <= from) callTimes.shift();
  };
  const spendCheck = (): BudgetCheck =>
    spent >= ceiling ? { ok: false, reason: `spend limit reached: $${spent.toFixed(2)} of the $${ceiling} ceiling is used` } : { ok: true };
  const callCheck = (): BudgetCheck => {
    prune();
    return callTimes.length >= callsPerHour ? { ok: false, reason: "call limit reached" } : { ok: true };
  };

  return {
    startExperiment(sessionId) {
      const money = spendCheck();
      if (!money.ok) return money;
      const calls = callCheck();
      if (!calls.ok) return calls;
      const n = experiments.get(sessionId) ?? 0;
      if (n >= perSession) return { ok: false, reason: `call limit reached: this session already asked the model on ${perSession} experiments` };
      experiments.set(sessionId, n + 1);
      return { ok: true };
    },
    wrap(chat) {
      return async (args) => {
        const money = spendCheck();
        if (!money.ok) return { ok: false, reason: money.reason };
        const calls = callCheck();
        if (!calls.ok) return { ok: false, reason: calls.reason };
        callTimes.push(now());
        const res = await chat(args);
        if (res.usage && Number.isFinite(res.usage.usd) && res.usage.usd > 0) spent += res.usage.usd;
        return res;
      };
    },
    spentUsd: () => spent,
    callsLastHour: () => {
      prune();
      return callTimes.length;
    },
  };
}

/**
 * The dollars recorded in a usage.jsonl file (one JSON object per line, each with `usd`). A missing
 * file is $0. A line that is not JSON or has no finite `usd` is skipped and counted in `skipped`.
 */
export function readUsageTotal(path: string): { usd: number; lines: number; skipped: number } {
  if (!existsSync(path)) return { usd: 0, lines: 0, skipped: 0 };
  let usd = 0;
  let lines = 0;
  let skipped = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const v = (JSON.parse(line) as { usd?: unknown }).usd;
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        usd += v;
        lines++;
      } else skipped++;
    } catch {
      skipped++;
    }
  }
  return { usd, lines, skipped };
}

/** A number of 0 or more from an environment variable, or the default when unset or not one. */
export function envNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
