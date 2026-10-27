// The retry machine's model. A pure function from { run, bets, verdicts } to the state of every
// moving part, and to the words the card prints. It reads ONLY the run's trace (what the harness
// recorded while withRpcRetry ran), the bets, and the verdicts. It imports nothing but types
// (tests/unit/machines-retry.test.ts checks that).
//
// The machine, in one sentence: a dispatch station sends one capsule up a tube for every call;
// what comes back down the return chute is what that call did (returned, or threw); the retry
// lever is pulled once for every call after the first; the wait drum turns once for every wait.
//
// Two clocks, kept apart:
// - "virtual ms" are the run's own times, from the trace (the drum is engraved with them).
// - "story seconds" are only how long the page takes to show each step. They are not run times.

import type { Bet, Run, Verdict } from "../../../src/types";

export interface RetryInput {
  run: Run;
  bets: Bet[];
  verdicts: Verdict[];
}

/** What one call's capsule brought back, read from the trace. */
export type CallAnswer = "returned" | "threw" | "no_answer" | "unseen";

export interface CallPart {
  n: number;
  /** Virtual ms at which the call was made. */
  t: number;
  answer: CallAnswer;
  /** The error text for a call that threw, as the trace recorded it. */
  error?: string;
}

export interface WaitPart {
  i: number;
  /** The wait the code asked for, in virtual ms. */
  ms: number;
  t: number;
}

export type Ending =
  | { kind: "returned"; value: string }
  | { kind: "threw"; error: string; fromCall: number | null }
  | { kind: "pending"; reason: string }
  | { kind: "stopped"; reason: string };

export type Step =
  | { kind: "pull"; n: number; dur: number }
  | { kind: "send"; n: number; dur: number }
  | { kind: "back"; n: number; answer: "returned" | "threw"; dur: number }
  | { kind: "lost"; n: number; dur: number }
  | { kind: "wait"; i: number; ms: number; dur: number };

export interface Ghost {
  who: string;
  kind: "person" | "model";
  /** The number of calls this bettor bet on (the slot on the rack's ruler). */
  value: number;
  /** The slot drawn: the value, kept on the ruler (0 … RULER_SLOTS). */
  slot: number;
  offScale: boolean;
  /** The judged outcome of this bet, once the run is over. */
  outcome: Verdict["outcome"] | null;
}

export interface RetryModel {
  calls: CallPart[];
  waits: WaitPart[];
  /** Retry-lever pulls: one for every call after the first (calls − 1, counted from the trace). */
  pulls: number;
  ending: Ending | null;
  steps: Step[];
  /** Story seconds for the whole sequence. */
  total: number;
  readout: string;
  /** Text that goes under the card about how the run ended, never a part of the machine. */
  endCaption: string;
  /** The wait engraved on the drum: "3 s (virtual)" when every wait was 3,000 ms. */
  engraving: string;
  ghosts: Ghost[];
}

/** The rack's ruler holds this many call slots. */
export const RULER_SLOTS = 8;

const DUR = { pull: 0.55, send: 1.0, back: 1.15, lost: 0.9, wait: 1.25 } as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** 1 → "1st", 2 → "2nd", 5 → "5th", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** 3000 → "3,000". */
export function grouped(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function waitsText(waits: WaitPart[]): string {
  if (waits.length === 0) return "waits 0";
  const first = waits[0]!.ms;
  if (waits.every((w) => w.ms === first)) return `waits ${waits.length} × ${grouped(first)} ms`;
  return `waits ${waits.map((w) => grouped(w.ms)).join(" + ")} ms`;
}

function endingText(e: Ending | null): string {
  if (!e) return "no ending in the trace";
  if (e.kind === "returned") return "returned";
  if (e.kind === "threw") return e.fromCall ? `threw the ${ordinal(e.fromCall)} error` : "threw an error";
  if (e.kind === "pending") return "still pending";
  return "still waiting when Atlas stopped watching";
}

/** Reads the trace once, in order. Nothing is guessed: an event the trace lacks is not drawn. */
export function retryModel({ run, bets, verdicts }: RetryInput): RetryModel {
  const calls: CallPart[] = [];
  const waits: WaitPart[] = [];
  const steps: Step[] = [];
  let ending: Ending | null = null;
  for (const ev of run.trace) {
    const d = ev.data ?? {};
    if (ev.event === "call") {
      const n = num(d.n) ?? calls.length + 1;
      if (calls.length > 0) steps.push({ kind: "pull", n, dur: DUR.pull });
      calls.push({ n, t: ev.t, answer: "unseen" });
      steps.push({ kind: "send", n, dur: DUR.send });
    } else if (ev.event === "reject" || ev.event === "resolve" || ev.event === "no_answer") {
      const n = num(d.n);
      const c = calls.find((x) => x.n === n);
      if (!c) continue;
      if (ev.event === "no_answer") {
        c.answer = "no_answer";
        steps.push({ kind: "lost", n: c.n, dur: DUR.lost });
      } else {
        c.answer = ev.event === "reject" ? "threw" : "returned";
        const err = str(d.error);
        if (err !== null) c.error = err;
        steps.push({ kind: "back", n: c.n, answer: c.answer, dur: DUR.back });
      }
    } else if (ev.event === "sleep") {
      const ms = num(d.ms) ?? 0;
      const w = { i: waits.length + 1, ms, t: ev.t };
      waits.push(w);
      steps.push({ kind: "wait", i: w.i, ms, dur: DUR.wait });
    } else if (ev.event === "returns") {
      ending = { kind: "returned", value: str(d.value) ?? "" };
    } else if (ev.event === "throws") {
      const error = str(d.error) ?? "";
      // The call whose own error is the one thrown: matched on the exact error text in the trace.
      const from = [...calls].reverse().find((c) => c.answer === "threw" && c.error === error);
      ending = { kind: "threw", error, fromCall: from ? from.n : null };
    } else if (ev.event === "pending") {
      ending = { kind: "pending", reason: str(d.reason) ?? "" };
    } else if (ev.event === "stopped_watching") {
      ending = { kind: "stopped", reason: str(d.reason) ?? "" };
    }
  }
  const pulls = Math.max(0, calls.length - 1);
  const total = steps.reduce((a, s) => a + s.dur, 0);
  const readout = `calls ${calls.length} · ${waitsText(waits)} · ${endingText(ending)}`;
  let endCaption = "";
  if (ending?.kind === "pending") {
    endCaption = `Still pending when Atlas stopped watching: nothing was left that could wake it (the trace says "${ending.reason}"). ${pulls} ${pulls === 1 ? "retry" : "retries"}.`;
  } else if (ending?.kind === "stopped") {
    const atLimit = /watch limit/.test(ending.reason);
    endCaption = `${atLimit ? "Still pending at Atlas's watch limit" : "Still waiting when Atlas stopped watching"}: ${ending.reason}. ${pulls} ${pulls === 1 ? "retry" : "retries"} so far.`;
  }
  const first = waits[0]?.ms;
  const engraving =
    waits.length === 0 ? "no waits" : waits.every((w) => w.ms === first) ? `${grouped(first! / 1000)} s (virtual)` : "per wait (virtual)";

  const verdictOf = (id: string) => verdicts.find((v) => v.betId === id && v.runId === run.id) ?? verdicts.find((v) => v.betId === id);
  const ghosts: Ghost[] = [];
  for (const b of bets) {
    if (b.measures !== "calls" || b.experimentId !== run.experimentId) continue;
    if (b.answer.kind !== "integer" && b.answer.kind !== "number") continue;
    const value = b.answer.value;
    const slot = Math.max(0, Math.min(RULER_SLOTS, Math.round(value)));
    ghosts.push({ who: b.who, kind: b.who === "human" ? "person" : "model", value, slot, offScale: slot !== value, outcome: verdictOf(b.id)?.outcome ?? null });
  }
  ghosts.sort((a, b) => (a.kind === b.kind ? a.who.localeCompare(b.who) : a.kind === "person" ? -1 : 1));
  return { calls, waits, pulls, ending, steps, total, readout, endCaption, engraving, ghosts };
}

// ---- the pose at one moment of the story ----

/** Where one capsule is. `p` is the progress through the current leg, 0 … 1. */
export type CapsuleAt =
  | { at: "cradle"; appear: number }
  | { at: "rising"; p: number }
  | { at: "gone" }
  | { at: "falling"; p: number }
  | { at: "lane"; p: number }
  | { at: "slot"; p: number };

export interface CapsulePose {
  n: number;
  where: CapsuleAt;
  /** What it brought back, once it is on its way down (nothing for a call still out). */
  shows: "returned" | "threw" | null;
  /** The one lit accent: the capsule moving now, or at the end the one whose answer was the outcome. */
  lit: boolean;
}

export interface Pose {
  capsules: CapsulePose[];
  /** Lever travel, 0 (rest) … 1 (pulled all the way). */
  lever: number;
  pullsDone: number;
  /** Drum turns so far (fractional while turning). */
  drumTurns: number;
  waitsDone: number;
  callsDone: number;
  /** The readout for this moment (the final readout once the story is over). */
  readout: string;
  done: boolean;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The pose at story time `s` (seconds). At or past `model.total` it is the end state. */
export function poseAt(model: RetryModel, s: number): Pose {
  const done = s >= model.total;
  const caps = new Map<number, CapsulePose>();
  let lever = 0;
  let pullsDone = 0;
  let drumTurns = 0;
  let waitsDone = 0;
  let callsDone = 0;
  let clock = 0;
  for (const st of model.steps) {
    const p = done ? 1 : clamp01((s - clock) / st.dur);
    const started = done || s >= clock;
    clock += st.dur;
    if (!started) continue;
    if (st.kind === "pull") {
      // Out and back in one pull: a smooth bump.
      lever = p < 1 ? Math.sin(Math.PI * ease(p)) : 0;
      if (p >= 1) pullsDone++;
    } else if (st.kind === "send") {
      callsDone++;
      // The first third places the capsule in the cradle, the rest lifts it into the tube.
      const where: CapsuleAt = p < 0.35 ? { at: "cradle", appear: ease(p / 0.35) } : p < 1 ? { at: "rising", p: ease((p - 0.35) / 0.65) } : { at: "gone" };
      caps.set(st.n, { n: st.n, where, shows: null, lit: p < 1 });
    } else if (st.kind === "back") {
      const where: CapsuleAt = p < 0.4 ? { at: "falling", p: (p / 0.4) ** 2 } : p < 0.8 ? { at: "lane", p: ease((p - 0.4) / 0.4) } : { at: "slot", p: ease((p - 0.8) / 0.2) };
      caps.set(st.n, { n: st.n, where, shows: st.answer, lit: p < 1 });
    } else if (st.kind === "lost") {
      const c = caps.get(st.n);
      if (c) c.lit = false;
    } else if (st.kind === "wait") {
      drumTurns = waitsDone + ease(p);
      if (p >= 1) waitsDone++;
    }
  }
  // At the end, the one lit capsule is the call whose answer the function ended with.
  if (done) {
    const e = model.ending;
    const litN = e?.kind === "threw" ? e.fromCall : e?.kind === "returned" ? [...model.calls].reverse().find((c) => c.answer === "returned")?.n ?? null : null;
    for (const c of caps.values()) c.lit = c.n === litN;
  }
  const readout = done
    ? model.readout
    : `calls ${callsDone} · ${waitsDone === 0 ? "waits 0" : `waits ${model.waits.slice(0, waitsDone).every((w) => w.ms === model.waits[0]!.ms) ? `${waitsDone} × ${grouped(model.waits[0]!.ms)} ms` : model.waits.slice(0, waitsDone).map((w) => grouped(w.ms)).join(" + ") + " ms"}`} · running`;
  return { capsules: [...caps.values()].sort((a, b) => a.n - b.n), lever, pullsDone, drumTurns, waitsDone, callsDone, readout, done };
}
