// The model-call budget (S5). Every experiment a person creates asks Muse Spark for its bets, and
// every call costs money, so the server limits them in three plain ways:
// 1. Calls per hour, across everyone (ATLAS_MODEL_CALLS_PER_HOUR, default 60). Each Meta call counts,
//    the repair try included.
// 2. Experiments per session that ask the model (ATLAS_MODEL_EXPERIMENTS_PER_SESSION, default 10).
// 3. Total spend (ATLAS_SPEND_CEILING_USD, default $100): what usage.jsonl already holds when the
//    server starts, plus what this server has spent since. Past the ceiling, no model is asked.
//
// When a limit is reached the model is simply not asked: its slot says "not asked (<reason>)" and
// the person's own round goes on as usual. The spend comes from the usage the Meta API reported.
// G1 review B1: a call that was SENT but reported no usage (a timeout, a network error mid-call) is counted at its
// worst case, because the provider may still bill it; only a call proven not sent costs $0.

import { existsSync, readFileSync } from "node:fs";
import type { ChatArgs, ChatResult } from "./client";
import { estimatedCallUsd } from "./pasted-guard";
import { currentPrincipal } from "../access/context";

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
  /** G1: the per-invite ledger. */
  guard?: SpendGuard;
  /** G1 review B2: model calls an hour for ONE dev code (default a quarter of callsPerHour). The owner has its own callsPerHour. */
  devCallsPerHour?: number;
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

/**
 * G1 (D33): a second check every model call must pass, per invite code (server/access/ledger.ts). `precheck` says
 * whether an experiment may ask a model at all; `reserve` holds the call's worst case before it is sent and is settled
 * with the real cost after. Absent = no per-code accounting (tests, scripts).
 */
export interface SpendGuard {
  precheck(): BudgetCheck;
  reserve(r: { kind: "model"; usd: number; what: string }): { ok: true; settle(actualUsd: number | undefined, extra?: { what?: string; unknown?: boolean }): void } | { ok: false; reason: string };
}

/**
 * G1: the worst case held for a call whose prompt the budget cannot see (Muse Code's `muse exec`, the fixer's chat
 * fallback): $1.50. A chat call wrapped by `wrap` holds its exact worst case instead (estimatedCallUsd).
 */
export const UNKNOWN_CALL_RESERVE_USD = 1.5;

export interface ModelBudget {
  /** May this session's new experiment ask the model? Counts the experiment when it may. */
  startExperiment(sessionId: string): BudgetCheck;
  /** Wraps a chat function: each call is checked and counted, and its reported cost is added. */
  wrap(chat: (args: ChatArgs) => Promise<ChatResult>, opts?: { reserveWorstCase?: boolean }): (args: ChatArgs) => Promise<ChatResult>;
  /**
   * D06-01: the same check and count for a model call that is not a chat() (Muse Code via `muse exec`).
   * `refused` builds the answer when a limit is reached (the call is then not made).
   */
  track<R extends { usage?: { usd: number } }>(call: () => Promise<R>, refused: (reason: string) => R, reserveUsd?: number, guardInfo?: { usd: number; what: string }): Promise<R>;
  /** Dollars spent: at start plus since. */
  spentUsd(): number;
  /** Calls made in the last hour. */
  callsLastHour(): number;
}

/**
 * G1 review B2: who a call or an experiment is counted for. The owner's code has its own counters (devs can never use
 * them up); each dev code has its own share; every dev and any request without a code (a local server) also count in
 * the shared counter.
 */
function spender(): { kind: "owner" | "dev" | "other"; key: string } {
  const p = currentPrincipal();
  if (p?.kind === "invite") return p.role === "owner" ? { kind: "owner", key: `owner:${p.id}` } : { kind: "dev", key: `dev:${p.id}` };
  return { kind: "other", key: p?.kind === "system" ? "system" : "anonymous" };
}

export function createModelBudget(opts: BudgetOptions = {}): ModelBudget {
  const callsPerHour = opts.callsPerHour ?? DEFAULT_CALLS_PER_HOUR;
  const devCallsPerHour = opts.devCallsPerHour ?? Math.max(1, Math.ceil(callsPerHour / 4));
  const perSession = opts.experimentsPerSession ?? DEFAULT_EXPERIMENTS_PER_SESSION;
  const ceiling = opts.spendCeilingUsd ?? DEFAULT_SPEND_CEILING_USD;
  const now = opts.now ?? Date.now;
  let spent = opts.spentAtStartUsd ?? 0;
  /** X1 review round 3 (minor 4): worst-case dollars held for calls in flight (only for calls that reserve). */
  let reserved = 0;
  /** Call times per counter: "shared" (devs and no-code requests), "dev:<id>", "owner:<id>". */
  const callTimes = new Map<string, number[]>();
  const experiments = new Map<string, number>();

  const times = (k: string) => {
    let t = callTimes.get(k);
    if (!t) callTimes.set(k, (t = []));
    const from = now() - HOUR_MS;
    while (t.length > 0 && t[0]! <= from) t.shift();
    return t;
  };
  /** The counters this spender's call is counted in. */
  const countersOf = (who: ReturnType<typeof spender>): { key: string; cap: number }[] =>
    who.kind === "owner" ? [{ key: who.key, cap: callsPerHour }] : who.kind === "dev" ? [{ key: who.key, cap: devCallsPerHour }, { key: "shared", cap: callsPerHour }] : [{ key: "shared", cap: callsPerHour }];
  const spendCheck = (): BudgetCheck =>
    spent >= ceiling ? { ok: false, reason: `spend limit reached: $${spent.toFixed(2)} of the $${ceiling} ceiling is used` } : { ok: true };
  const callCheck = (who: ReturnType<typeof spender>): BudgetCheck => {
    for (const c of countersOf(who)) {
      if (times(c.key).length >= c.cap) return { ok: false, reason: c.key.startsWith("dev:") ? `call limit reached: this invite may make ${c.cap} model calls an hour` : "call limit reached" };
    }
    return { ok: true };
  };

  const guard = opts.guard;
  const track: ModelBudget["track"] = async (call, refused, reserveUsd = 0, guardInfo) => {
    const money = spendCheck();
    if (!money.ok) return refused(money.reason);
    // A reserving call holds its worst case before it is sent, so calls running at once can never pass the ceiling.
    if (reserveUsd > 0 && spent + reserved + reserveUsd > ceiling) {
      return refused(`spend limit reached: $${spent.toFixed(2)} spent and $${reserved.toFixed(2)} held for calls in flight; this call could cost up to $${reserveUsd.toFixed(2)} of the $${ceiling} ceiling`);
    }
    const who = spender();
    const calls = callCheck(who);
    if (!calls.ok) return refused(calls.reason);
    /** G1 review B1: what a call that was sent but reported no usage is counted at: its worst case. */
    const worst = guardInfo?.usd ?? Math.max(reserveUsd, UNKNOWN_CALL_RESERVE_USD);
    // G1: the invite's own budget, the owner's reserve and the "at once" limit, checked and held in the same step.
    const held = guard?.reserve({ kind: "model", usd: worst, what: guardInfo?.what ?? "fixer (muse exec or its chat fallback)" });
    if (held && !held.ok) return refused(held.reason);
    const at = now();
    const counted = countersOf(who).map((c) => times(c.key));
    for (const t of counted) t.push(at);
    reserved += reserveUsd;
    const res = await call()
      .catch((e: unknown) => {
        // G1 review B1: a call that threw may have been sent and billed: counted at its worst case, never $0.
        spent += worst;
        if (held?.ok) held.settle(worst, { what: guardInfo?.what ?? "unknown", unknown: true });
        throw e;
      })
      .finally(() => {
        reserved -= reserveUsd; // settled: the real cost is added below
      });
    const r = res as { notSent?: true; costUnknown?: true; model?: unknown };
    // Final review M7: a call refused before it was sent (no key, refused model id) used nothing: it does not
    // count against the hourly limit, so a keyless server does not run out of calls without making one.
    if (r.notSent === true) {
      for (const t of counted) {
        const i = t.indexOf(at);
        if (i >= 0) t.splice(i, 1);
      }
    }
    const reported = res.usage && Number.isFinite(res.usage.usd) && res.usage.usd > 0 ? res.usage.usd : 0;
    // G1 review B1: sent, but some or all of its cost was not reported (a timeout, a killed muse exec, a 200 with no
    // usage): counted at its worst case. Only a call proven not sent (notSent) is free.
    const unknown = r.notSent !== true && r.costUnknown === true;
    const charge = unknown ? Math.max(reported, worst) : reported;
    spent += charge;
    if (held?.ok) held.settle(charge, { ...(typeof r.model === "string" ? { what: r.model } : {}), ...(unknown ? { unknown: true } : {}) });
    return res;
  };

  return {
    startExperiment(sessionId) {
      const money = spendCheck();
      if (!money.ok) return money;
      // G1: an invite with less left than one model call's worst case is not asked at all ("not asked: ...").
      const mine = guard?.precheck();
      if (mine && !mine.ok) return mine;
      const who = spender();
      const calls = callCheck(who);
      if (!calls.ok) return calls;
      // G1 review B2: a session id is whatever the client sends, so the count is per spender AND session: a dev who
      // sends the owner's session id uses up only the dev's own count.
      const key = `${who.key}\u0000${sessionId}`;
      const n = experiments.get(key) ?? 0;
      if (n >= perSession) return { ok: false, reason: `call limit reached: this session already asked the model on ${perSession} experiments` };
      experiments.set(key, n + 1);
      return { ok: true };
    },
    wrap(chat, wrapOpts) {
      return (args) => {
        const worst = estimatedCallUsd(args);
        return track(() => chat(args), (reason): ChatResult => ({ ok: false, reason }), wrapOpts?.reserveWorstCase ? worst : 0, { usd: worst, what: `${args.role} ${args.model}` });
      };
    },
    track,
    spentUsd: () => spent,
    callsLastHour: () => times("shared").length + [...callTimes.keys()].filter((k) => k.startsWith("owner:")).reduce((n, k) => n + times(k).length, 0),
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
