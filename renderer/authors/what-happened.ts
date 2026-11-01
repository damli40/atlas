// R3 author (c), and (d) the retry demo: the "what happened" path, from the measured trace only (D54).
//
// Plain words: walk the run's events in the order they happened. Each call of a stand-in or a network fake becomes a pinned
// ticket; a gap on Atlas's virtual clock becomes a clock; the ending comes from the measured fields, not from a guess.
//
// An answer is drawn when it ARRIVED, not beside the call that asked for it (R3 review B1, B2):
// - answered at once: on the thread leaving the call;
// - answered later, with nothing else going on: call, then the wait, then the answer on the thread leaving the wait;
// - calls started together, or while another was still out: one "together" ticket, or "while x was still waiting", and
//   each answer gets its own ticket at its own time;
// - after the code ended: a dashed note, never a wait and never on the thread. A call still out at the end says so.
// The trace says when an answer arrived, not whether the code used it, so when calls overlap a caption says that too.
// Python's harness writes a delayed answer at the moment of the call, with `afterMs`, and writes its ending after the event
// loop drains. `inTimeOrder` puts both where they happened, from the same trace and the measured time.
//
// What it refuses to do:
// - A run that may not be shown as fact (src/trust.ts) draws nothing; the spec carries the reason.
// - A cut trace (Atlas keeps only so many events) stops at the last event kept: no wait across the gap, no invented
//   "no answer", the exact measured counts in a note, and then the known ending, joined by a dashed line (review B7).
// - If the second run of the double run went differently, the path stops at the first difference and says so.
// - A wait whose time was not reported says "time not reported". A count not claimed says so in a caption.
// - A verdict of can't check gets a can't-check mark with the reason, never a place on the path.
// - The ring "the run parts ways here" goes only on the first step that really departs from the answer (`partingKey`).
//   If no such step is on the path, there is no ring and the words say so (review B3).
// Loops: past a few calls, anything that repeats (x; x, wait; x, y, x, y…) folds into one ticket with exact counts.
//
// Pure; imports types and the pure src/trust.ts rule only.

import type { Bet, Experiment, JsonValue, NetworkStep, Run, StandInStep, TraceEvent, Verdict } from "../../src/types";
import type { HelperStep } from "../../src/helper-steps";
import { notShownAsFact } from "../../src/trust";
import { cleanWords } from "../words";
import type { RenderSpec, SpecMark, SpecNode, SpecStep } from "../spec";

const rec = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const own = (o: Record<string, unknown>, k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const grouped = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const clip = (s: string, n = 44) => {
  const c = Array.from(s);
  return c.length > n ? `${c.slice(0, n - 1).join("")}…` : s;
};
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** One thing on the path. */
export type PathItem =
  /** `answer` null: no answer yet when the thread moved on. `whileOpen`: others were still waiting when this call began. */
  | { kind: "call"; name: string; n: number; t: number; answer: string | null; good: boolean; whileOpen?: string[] }
  /** Calls begun at the same moment, none answered when the next began (Promise.all, gather). */
  | { kind: "together"; calls: { name: string; n: number }[]; t: number }
  /** An answer that came on its own, while other things were going on. */
  | { kind: "answer"; name: string; n: number; t: number; words: string; good: boolean }
  | { kind: "loop"; name: string; from: number; to: number; count: number; t: number; answer: string | null; waits: { min: number; max: number } | null; good: boolean }
  /** A repeating pattern folded: exact rounds, and the exact count for each name. */
  | { kind: "cycle"; rounds: number; counts: { name: string; count: number }[]; t: number; pattern: string; waits: { min: number; max: number } | null; good: boolean }
  /** `answerWords`: the answer that ended this wait, written on the thread leaving it. */
  | { kind: "wait"; ms: number | null; t: number; cut?: boolean; answerWords?: string }
  /** `dashed`: past a gap in the trace, so it is not joined to the path as if it followed. `open`: calls still out at this ending. */
  | { kind: "end"; words: string; t: number | null; good: boolean; dashed?: boolean; open?: string }
  | { kind: "stop"; words: string; cut?: boolean }
  /** One of the code's own functions ran (from the third run). `value`: what it returned, as JSON text. */
  | { kind: "helper"; name: string; t: number; value?: string; threw?: boolean; inner: number }
  /** After the code ended: a call or an answer. Never part of the path's order of cause. */
  | { kind: "late"; words: string; t: number; keys: string[] }
  /** A sequence: Atlas makes call n of m. */
  | { kind: "turn"; n: number; of: number; fn: string; t: number }
  /** A sequence: how an earlier call ended. */
  | { kind: "turn-end"; n: number; words: string; t: number; good: boolean }
  /** A sequence: Atlas's own scripted wait between calls, not the code's. */
  | { kind: "atlas-wait"; ms: number; t: number };

export interface WhatHappenedInput {
  run: Pick<Run, "id" | "trace" | "result" | "controlPassed" | "twin" | "conditions" | "forkBlock">;
  /** The test that was run: gives the scripted answers (the trace says a call answered; the script says what with). */
  experiment?: Pick<Experiment, "params">;
  bets?: Pick<Bet, "id" | "who" | "measures" | "answer">[];
  verdicts?: Pick<Verdict, "betId" | "outcome" | "reason">[];
  title?: string;
  kicker?: string;
  seed?: string;
  /** A label the entry must show (PRE-EXISTING.md). */
  preExisting?: string;
  /** Collapse loops past this many calls. */
  collapseOver?: number;
  /**
   * R3: what the code's own helpers did, from a separate third run made only for this drawing (server/helpers.ts). Never
   * from a sealed run, never in a verdict. `none`: why there are no helper steps, said in a caption.
   */
  helpers?: { steps: readonly HelperStep[]; more: number } | { none: string };
  /** Where the run came from, only when the caller knows. Absent: the drawing says nothing about it (review B5). */
  origin?: RunOrigin;
}

/** "this-run": it just ran here. "proof-file": it is read back from a saved proof file. */
export type RunOrigin = "this-run" | "proof-file";

/** What the n-th call was scripted to answer, in words; null when the script does not say. */
function scripted(input: WhatHappenedInput, name: string, n: number): { words: string; good: boolean } | null {
  const p = input.experiment?.params;
  if (!p || p.shape !== "call-function") return null;
  const pick = <T,>(calls: T[], then: string): T | undefined => (n <= calls.length ? calls[n - 1] : then === "repeat_last" ? calls[calls.length - 1] : undefined);
  if (p.network && p.network.replaces === name) {
    const s = pick<NetworkStep>(p.network.calls, p.network.then);
    if (s?.do === "respond") return { words: `answered ${s.status} (scripted)`, good: s.status < 400 };
    return null;
  }
  for (const a of p.args) {
    if (a.kind !== "stand-in" || a.name !== name) continue;
    const s = pick<StandInStep>(a.calls, a.then);
    if (s?.do === "return") return { words: `returned ${clip(JSON.stringify(s.value as JsonValue), 26)} (scripted)`, good: true };
  }
  return null;
}

/** Trace events compared across the two runs of the double run: what happened, when, to whom. */
const fingerprint = (e: TraceEvent) => {
  const d = rec(e.data);
  return `${e.t}|${e.event}|${str(d.name) ?? ""}|${num(d.n) ?? ""}|${str(d.errorName) ?? ""}`;
};
const BOOKKEEPING = new Set(["call_checks", "clock_moves", "conditions", "log", "control"]);
/** Both harnesses keep these past the event cap, so they say nothing about where the kept part ended. */
const ALWAYS_KEPT = new Set(["clock_moves", "python", "start", "call_start", "call_returned", "call_threw", "returned", "threw", "never_settled", "still_running_at_watch_limit", "stopped_watching", "stopped_watching_after_settle", "trace_cut", "conditions"]);
const END_EVENTS = new Set(["returned", "threw", "returns", "throws", "pending", "stopped_watching", "never_settled", "still_running", "still_running_at_watch_limit"]);
const ANSWER_EVENTS = new Set(["stand_in_returns", "resolve", "stand_in_throws", "reject", "stand_in_never_answers", "no_answer"]);

/**
 * The events as they happened. JavaScript's trace already is. Python's writes a delayed answer at the call, with `afterMs`
 * (the answer is due that long after the call), and its ending after the event loop drains, at the clock's last value; the
 * measured time says when the call really settled. Each entry keeps its original event, for comparing the double run.
 */
function inTimeOrder(trace: readonly TraceEvent[], measured: Record<string, unknown>, lastStart: number): { e: TraceEvent; raw: TraceEvent }[] {
  const isPython = trace.some((e) => e.event === "python");
  const list = trace.map((raw) => ({ e: raw, raw }));
  if (!isPython) return list;
  const settled = num(own(measured, "virtualMs"));
  const moved = list.map(({ e, raw }) => {
    const d = rec(e.data);
    if (e.event === "stand_in_returns" && (num(d.afterMs) ?? 0) > 0) return { e: { ...e, t: e.t + num(d.afterMs)! }, raw };
    if ((e.event === "returned" || e.event === "threw") && settled !== null) return { e: { ...e, t: lastStart + settled }, raw };
    return { e, raw };
  });
  return moved.map((x, i) => ({ x, i })).sort((a, b) => a.x.e.t - b.x.e.t || a.i - b.i).map(({ x }) => x);
}

const helperList = (input: Pick<WhatHappenedInput, "helpers">) => (input.helpers && "steps" in input.helpers ? input.helpers.steps : []);
const names = (list: readonly string[]) => (list.length <= 3 ? list.join(list.length === 2 ? " and " : ", ") : `${list.slice(0, 3).join(", ")} and ${list.length - 3} more`);
const unique = (list: readonly string[]) => [...new Set(list)];

/** The path items, in the order things happened. Exported for the tests. */
export function pathItems(input: WhatHappenedInput): { items: PathItem[]; notes: string[] } {
  const { run } = input;
  const measured = rec(run.result?.measured);
  const notMeasured = rec(run.result?.notMeasured);
  const trace = Array.isArray(run.trace) ? run.trace : [];
  const items: PathItem[] = [];
  const notes: string[] = [];
  let lastT = 0;
  let ended = false;
  const timeOk = !("virtualMs" in notMeasured) && !("totalWaitMs" in notMeasured);
  if (!timeOk) notes.push(`Time is not reported: ${str(own(notMeasured, "virtualMs")) ?? str(own(notMeasured, "totalWaitMs")) ?? "Atlas did not measure it"}.`);

  // Where the two runs of the double run part, if they do.
  let divergeAt: TraceEvent | null = null;
  const twin = run.twin?.trace;
  if (Array.isArray(twin)) {
    const a = trace.filter((e) => !BOOKKEEPING.has(e.event) && e.event !== "start");
    const b = twin.filter((e) => !BOOKKEEPING.has(e.event) && e.event !== "start");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (!a[i] || !b[i] || fingerprint(a[i]!) !== fingerprint(b[i]!)) {
        divergeAt = a[i] ?? null;
        break;
      }
    }
  }

  const addGap = (t: number) => {
    if (t > lastT) {
      items.push({ kind: "wait", ms: timeOk ? t - lastT : null, t });
      lastT = t;
    }
  };
  // A sequence measures the last call's own time; the path's clock is the whole run's, so the ending adds where that call began.
  const lastStart = [...trace].reverse().find((e) => e.event === "call_start")?.t ?? 0;
  const startData = rec(trace.find((e) => e.event === "start")?.data);
  const seqCalls = input.experiment?.params.shape === "call-function" ? input.experiment.params.calls : undefined;
  const nCalls = num(startData.calls) ?? seqCalls?.length ?? 0;
  const endItem = (): PathItem => {
    const outcome = str(own(measured, "outcome"));
    const raw = num(own(measured, "virtualMs")) ?? num(own(measured, "settledAtMs"));
    const v = raw === null ? null : raw + lastStart;
    // A two-call test's question is about the last call; the path's clock is the whole test's. Say which is which.
    const at = v === null ? "" : nCalls > 1 ? ` ${grouped(raw!)} ms into call ${nCalls} (${grouped(v)} ms into the test)` : ` at ${grouped(v)} ms`;
    if (outcome === "returned" || outcome === "returns") {
      const j = str(own(measured, "returnedJson")) ?? str(own(measured, "returned"));
      return { kind: "end", words: j !== null ? `returned ${clip(j, 40)}` : "returned", t: v, good: true };
    }
    if (outcome === "threw" || outcome === "throws") {
      const name = str(own(measured, "thrownName")) ?? str(own(measured, "thrown"))?.split(":")[0] ?? null;
      return { kind: "end", words: `threw${name ? ` ${clip(name, 36)}` : ""}${at}`, t: v, good: false };
    }
    if (outcome === "never_settled" || outcome === "pending") return { kind: "end", words: "still waiting when Atlas stopped: nothing was left to wake it", t: null, good: false };
    if (outcome === "still_running_at_watch_limit" || outcome === "stopped") return { kind: "end", words: "still running when Atlas stopped watching", t: null, good: false };
    return { kind: "stop", words: `Atlas can't say how it ended: ${str(own(notMeasured, "outcome")) ?? "the run recorded no ending"}` };
  };

  const events = inTimeOrder(trace, measured, lastStart);
  // A cut trace: the last event kept, past which nothing but the ending is known.
  const cutEvent = trace.find((e) => e.event === "trace_cut");
  let lastKept = events.length - 1;
  if (cutEvent) {
    lastKept = -1;
    events.forEach(({ e }, i) => {
      if (!ALWAYS_KEPT.has(e.event) && !BOOKKEEPING.has(e.event)) lastKept = i;
    });
  }

  /** Calls asked, not yet answered, in the order they were asked. */
  const open = new Map<string, { name: string; n: number; item: Extract<PathItem, { kind: "call" }> | null }>();
  const answerOf = (e: TraceEvent, name: string, n: number): { words: string; good: boolean } => {
    const d = rec(e.data);
    if (e.event === "stand_in_never_answers" || e.event === "no_answer") return { words: "never answered", good: false };
    if (e.event === "stand_in_throws" || e.event === "reject") return { words: `threw ${clip(str(d.errorName) ?? str(d.error)?.split(":")[0] ?? "an error", 30)}`, good: false };
    const s = scripted(input, name, n);
    return s ?? { words: "answered", good: true };
  };

  // Helper steps go in before the event they came before. `at` counts the events the drawing reads, in the trace's own order.
  const shownHelpers = helperList(input);
  let nextHelper = 0;
  const rawPlace = new Map<TraceEvent, number>();
  {
    let n = 0;
    for (const e of trace) {
      rawPlace.set(e, n);
      if (!BOOKKEEPING.has(e.event) && e.event !== "start" && e.event !== "python") n++;
    }
  }
  const helpersBefore = (place: number) => {
    while (nextHelper < shownHelpers.length && shownHelpers[nextHelper]!.at <= place) {
      const h = shownHelpers[nextHelper++]!;
      if (ended) continue;
      addGap(h.t);
      items.push({ kind: "helper", name: h.name, t: h.t, inner: h.inner, ...(h.value !== undefined ? { value: h.value } : {}), ...(h.threw ? { threw: true } : {}) });
    }
  };

  for (let idx = 0; idx <= lastKept; idx++) {
    const { e, raw } = events[idx]!;
    if (!BOOKKEEPING.has(e.event) && e.event !== "start" && e.event !== "python" && e.event !== "trace_cut") helpersBefore(rawPlace.get(raw) ?? 0);
    if (raw === divergeAt) {
      items.push({ kind: "stop", words: "the second run of this test went differently from here, so Atlas does not claim what came next" });
      break;
    }
    if (BOOKKEEPING.has(e.event) || e.event === "start" || e.event === "python" || e.event === "wake" || e.event === "trace_cut") continue;
    const d = rec(e.data);
    if (e.event === "call_start" && nCalls > 1) {
      const n = num(d.n) ?? 1;
      const scriptedWait = seqCalls?.[n - 1]?.waitMs ?? 0;
      if (scriptedWait > 0 && e.t - lastT >= scriptedWait) {
        addGap(e.t - scriptedWait);
        items.push({ kind: "atlas-wait", ms: scriptedWait, t: e.t });
        lastT = e.t;
      } else addGap(e.t);
      items.push({ kind: "turn", n, of: nCalls, fn: str(d.exportName) ?? "the function", t: e.t });
      continue;
    }
    if (e.event === "call_returned" || e.event === "call_threw") {
      addGap(e.t);
      const json = str(d.json);
      const name = str(d.name) ?? str(d.type);
      items.push({ kind: "turn-end", n: num(d.n) ?? 1, t: e.t, good: e.event === "call_returned", words: e.event === "call_returned" ? (json !== null ? `call ${num(d.n) ?? 1} returned ${clip(json, 30)}` : `call ${num(d.n) ?? 1} returned`) : `call ${num(d.n) ?? 1} threw${name ? ` ${clip(name, 30)}` : ""}` });
      continue;
    }
    if (e.event === "stand_in_call" || e.event === "call") {
      const name = str(d.name) ?? "the RPC";
      const n = num(d.n) ?? 1;
      if (e.event === "stand_in_call" && d.afterSettle === true && !ended) {
        ended = true;
        items.push(endItem());
      }
      if (ended) {
        items.push({ kind: "late", words: `${name} was called at ${grouped(e.t)} ms, after the code had ended`, t: e.t, keys: [`${name}:${n}`] });
        open.set(`${name}:${n}`, { name, n, item: null });
        continue;
      }
      addGap(e.t);
      const prev = items[items.length - 1];
      const stillOut = [...open.values()];
      // The call before it began at this same moment and has no answer yet: they began together.
      if (prev && (prev.kind === "together" || (prev.kind === "call" && prev.answer === null)) && prev.t === e.t && stillOut.length > 0) {
        if (prev.kind === "together") prev.calls.push({ name, n });
        else {
          const first: PathItem = { kind: "together", calls: [{ name: prev.name, n: prev.n }, { name, n }], t: e.t };
          items[items.length - 1] = first;
          for (const o of stillOut) if (o.item === prev) o.item = null;
        }
        open.set(`${name}:${n}`, { name, n, item: null });
        continue;
      }
      const item: Extract<PathItem, { kind: "call" }> = { kind: "call", name, n, t: e.t, answer: null, good: false, ...(stillOut.length ? { whileOpen: unique(stillOut.map((o) => o.name)) } : {}) };
      items.push(item);
      open.set(`${name}:${n}`, { name, n, item });
      continue;
    }
    if (ANSWER_EVENTS.has(e.event)) {
      const name = str(d.name) ?? "the RPC";
      const n = num(d.n) ?? 1;
      const asked = open.get(`${name}:${n}`);
      if (!asked) continue;
      open.delete(`${name}:${n}`);
      const a = answerOf(e, name, n);
      const never = e.event === "stand_in_never_answers" || e.event === "no_answer";
      if (ended) {
        if (!never) items.push({ kind: "late", words: `${name} ${a.words} at ${grouped(e.t)} ms, after the code had ended`, t: e.t, keys: [] });
        continue;
      }
      const last = items[items.length - 1];
      // Straight after the call, at the same moment: the thread leaving the call carries it.
      if (asked.item && last === asked.item && (e.t === asked.item.t || never)) {
        asked.item.answer = a.words;
        asked.item.good = a.good;
        continue;
      }
      if (never) continue;
      addGap(e.t);
      const afterGap = items[items.length - 1];
      const beforeGap = items[items.length - 2];
      // Only this call was out, and nothing happened but the wait: the wait ends with the answer.
      if (asked.item && afterGap?.kind === "wait" && beforeGap === asked.item && open.size === 0 && afterGap.t === e.t && afterGap.answerWords === undefined) {
        afterGap.answerWords = a.words;
        asked.item.good = a.good;
        continue;
      }
      if (asked.item && afterGap === asked.item && e.t === asked.item.t) {
        asked.item.answer = a.words;
        asked.item.good = a.good;
        continue;
      }
      items.push({ kind: "answer", name, n, t: e.t, words: a.words, good: a.good });
      continue;
    }
    if (e.event === "sleep") {
      // Retry scenario: the code asked for this wait; the following "wake" finishes it.
      const ms = num(d.ms);
      const woke = trace.slice(trace.indexOf(raw) + 1).some((x) => x.event === "wake");
      items.push({ kind: "wait", ms: timeOk ? ms : null, t: e.t + (ms ?? 0), ...(woke ? {} : { cut: true }) });
      lastT = e.t + (ms ?? 0);
      continue;
    }
    if (END_EVENTS.has(e.event) && !ended) {
      if (e.event === "returned" || e.event === "threw" || e.event === "returns" || e.event === "throws") addGap(e.t);
      ended = true;
      const end = endItem();
      if (end.kind === "end" && open.size > 0) {
        const out = [...open.values()];
        end.open = out.length === 1 && out[0]!.item && items[items.length - 1] === out[0]!.item ? "no answer before the end" : `no answer yet from ${names(unique(out.map((o) => o.name)))}`;
      }
      items.push(end);
    }
  }

  if (cutEvent) {
    const d = rec(cutEvent.data);
    const kept = num(d.kept);
    const more = num(d.eventsNotKept) ?? num(d.dropped);
    const counts = Object.keys(measured)
      .filter((k) => k.startsWith("calls:") && num(measured[k]) !== null)
      .map((k) => `${k.slice(6)} ${grouped(num(measured[k])!)} times`);
    // The call the kept part ended on may have answered in the part not kept: it says that, never "no answer".
    const lastItem = items[items.length - 1];
    if (lastItem?.kind === "call" && lastItem.answer === null) lastItem.answer = "its answer is past what Atlas kept";
    items.push({
      kind: "stop",
      cut: true,
      words: `Atlas kept the first ${kept !== null ? grouped(kept) : "part of the"} events${more !== null ? ` and counted ${grouped(more)} more without keeping them` : ""}, so the path stops here.${counts.length ? ` In all, the code called ${names(counts)}.` : ""}`,
    });
    if (!ended) {
      const end = endItem();
      if (end.kind === "end") items.push({ ...end, dashed: true });
      else items.push(end);
      ended = true;
    }
  }
  if (!ended && !items.some((i) => i.kind === "stop")) items.push(endItem());
  if (!ended && items[items.length - 1]?.kind === "stop" && items.filter((i) => i.kind === "stop").length === 1 && str(own(measured, "outcome"))) {
    const e = endItem();
    if (e.kind === "end") items.push({ ...e, dashed: true });
  }
  for (const k of Object.keys(notMeasured)) if (k.startsWith("calls:")) notes.push(`Atlas does not claim a final count of ${k.slice(6)}: ${str(notMeasured[k]) ?? "not measured"}.`);
  // After the end, a few notes say it; many become one, with exact counts.
  const lateItems = items.filter((i): i is Extract<PathItem, { kind: "late" }> => i.kind === "late");
  if (lateItems.length > 3) {
    const first = items.indexOf(lateItems[0]!);
    const callsAfter = lateItems.filter((i) => i.keys.length > 0).length;
    const answersAfter = lateItems.length - callsAfter;
    const words = [answersAfter ? `${grouped(answersAfter)} answer${answersAfter === 1 ? "" : "s"}` : "", callsAfter ? `${grouped(callsAfter)} call${callsAfter === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    const merged: PathItem = { kind: "late", words: `${words} came after the code had ended, the first at ${grouped(lateItems[0]!.t)} ms`, t: lateItems[0]!.t, keys: lateItems.flatMap((i) => i.keys) };
    const rest: PathItem[] = items.filter((i) => i.kind !== "late");
    rest.splice(first, 0, merged);
    return { items: rest, notes };
  }
  return { items, notes };
}

/** What identifies an item as the same step when a pattern repeats. Times differ across rounds; a wait's length does not count. */
function foldSig(i: PathItem): string | null {
  switch (i.kind) {
    case "call":
      return `c|${i.name}|${i.answer}|${(i.whileOpen ?? []).join()}`;
    case "together":
      return `t|${i.calls.map((c) => c.name).join()}`;
    case "answer":
      return `a|${i.name}|${i.words}`;
    case "helper":
      return `h|${i.name}|${i.value ?? ""}|${i.threw ? 1 : 0}`;
    case "wait":
      return i.cut ? null : `w|${i.ms === null ? "?" : ""}|${i.answerWords ?? ""}`;
    default:
      return null;
  }
}

const itemKeys = (i: PathItem): string[] => {
  if (i.kind === "call") return [`${i.name}:${i.n}`];
  if (i.kind === "together") return i.calls.map((c) => `${c.name}:${c.n}`);
  if (i.kind === "wait") return [`wait:${i.t}`];
  if (i.kind === "helper") return [`helper:${i.name}:${i.t}:${i.value ?? ""}`];
  if (i.kind === "end") return ["end"];
  if (i.kind === "late") return i.keys;
  return [];
};

const FOLD_PERIOD = 8;

/**
 * Anything that repeats at least three times folds into one ticket, past `over` calls in all, with exact counts: one name
 * called again and again, or a pattern such as x, y, x, y (review B4). It never folds across a step in `keep`: the step a
 * ring needs stays on its own (review B3), calls and waits alike.
 */
export function collapse(items: PathItem[], over: number, keep: Set<string> = new Set()): PathItem[] {
  const callsIn = (i: PathItem) => (i.kind === "call" || i.kind === "helper" ? 1 : i.kind === "together" ? i.calls.length : 0);
  if (items.reduce((n, i) => n + callsIn(i), 0) <= over) return items;
  const sigs = items.map((i) => (itemKeys(i).some((k) => keep.has(k)) ? null : foldSig(i)));
  const out: PathItem[] = [];
  let i = 0;
  while (i < items.length) {
    const a = items[i]!;
    let best: { len: number; period: number } | null = null;
    if ((a.kind === "call" || a.kind === "together" || a.kind === "helper") && sigs[i] !== null) {
      for (let period = 1; period <= FOLD_PERIOD && i + period < items.length; period++) {
        let end = i + period;
        while (end < items.length && sigs[end] !== null && sigs[end] === sigs[end - period]) end++;
        // Never end on a wait: the wait after the last round belongs to what follows.
        while (end > i && items[end - 1]!.kind === "wait") end--;
        const len = end - i;
        // At least three rounds, counting a last round cut short by that wait.
        if (Math.ceil(len / period) >= 3 && (!best || period < best.period)) best = { len, period };
      }
    }
    if (!best) {
      out.push(a);
      i++;
      continue;
    }
    const span = items.slice(i, i + best.len);
    const waits = span.filter((x): x is Extract<PathItem, { kind: "wait" }> => x.kind === "wait");
    const waitRange = waits.length && waits.every((w) => w.ms !== null) ? { min: Math.min(...waits.map((w) => w.ms!)), max: Math.max(...waits.map((w) => w.ms!)) } : null;
    const calls = span.filter((x): x is Extract<PathItem, { kind: "call" }> => x.kind === "call");
    const allOneName = calls.length === span.filter((x) => x.kind !== "wait").length && unique(calls.map((c) => c.name)).length === 1 && unique(calls.map((c) => c.answer ?? "")).length === 1 && calls.every((c) => c.answer !== null);
    if (allOneName && !waits.some((w) => w.answerWords !== undefined)) {
      const first = calls[0]!;
      const last = calls[calls.length - 1]!;
      out.push({ kind: "loop", name: first.name, from: first.n, to: last.n, count: calls.length, t: first.t, answer: first.answer, waits: waitRange, good: first.good });
    } else {
      const counted = new Map<string, number>();
      for (const x of span) {
        if (x.kind === "call" || x.kind === "helper") counted.set(x.name, (counted.get(x.name) ?? 0) + 1);
        if (x.kind === "together") for (const c of x.calls) counted.set(c.name, (counted.get(c.name) ?? 0) + 1);
      }
      const round = span.slice(0, best.period);
      const pattern = round
        .map((x) => (x.kind === "helper" ? `${x.name}${x.value !== undefined ? ` → ${x.value}` : ""}` : x.kind === "call" ? `${x.name}${x.answer ? ` ${x.answer}` : ""}` : x.kind === "together" ? `${names(unique(x.calls.map((c) => c.name)))} together` : x.kind === "answer" ? `${x.name} ${x.words}` : x.kind === "wait" && x.answerWords ? x.answerWords : ""))
        .filter(Boolean)
        .join("; ");
      out.push({ kind: "cycle", rounds: Math.ceil(best.len / best.period), counts: [...counted].map(([name, count]) => ({ name, count })), t: (a as { t: number }).t, pattern, waits: waitRange, good: !span.some((x) => (x.kind === "call" || x.kind === "answer") && !x.good) });
    }
    i += best.len;
  }
  return out;
}

/** What a bet expected, as a range of counts or times, when it was about one. */
function expectedRange(bet: Pick<Bet, "answer">): { min: number; max: number } | null {
  const a = bet.answer;
  if (a.kind === "integer") return { min: a.value, max: a.value };
  if (a.kind === "number") return { min: a.value * (1 - a.tolerancePct / 100), max: a.value * (1 + a.tolerancePct / 100) };
  if (a.kind === "quiz") {
    const o = a.options.find((x) => x.id === a.choice);
    if (o?.match.kind === "count" || o?.match.kind === "ms") return { min: o.match.min, max: o.match.max ?? Infinity };
  }
  return null;
}

/** What the bettor said, in their option's words. */
function expectedWords(bet: Pick<Bet, "answer" | "measures">): string {
  const a = bet.answer;
  if (a.kind === "quiz") return a.options.find((x) => x.id === a.choice)?.label ?? a.choice;
  if (a.kind === "integer" || a.kind === "number") return bet.measures.startsWith("calls") ? `${grouped(a.value)} call${a.value === 1 ? "" : "s"}` : bet.measures.endsWith("Ms") ? `${grouped(a.value)} ms` : grouped(a.value);
  if (a.kind === "enum") return a.value;
  if (a.kind === "json") return clip(JSON.stringify(a.value), 30);
  return "nothing";
}

/** What a question is about, in plain words. */
function measureWords(measures: string): string {
  if (measures.startsWith("calls:")) return `calls to ${measures.slice(6)}`;
  return ({ calls: "calls", outcome: "how it ends", returnedJson: "what it returns", virtualMs: "how long it takes", totalWaitMs: "the total wait" } as Record<string, string>)[measures] ?? measures;
}

const whoWords = (who: string) => (who === "human" ? "you" : who.replace(/^model:/, "").replace(/^meta-models\//, ""));

/**
 * The first step on the path that really departs from the bettor's answer, or null when no step honestly does. Exported for
 * the tests.
 * - A count too low: the first call past it. Too high: the ending, where the run stopped sooner.
 * - A time ("how long it takes"): only the last call of a two-call test counts, because that is what is measured, and only
 *   steps up to its ending. The first step past the range; if none, the ending, where it finished sooner.
 * - A total wait: the wait that pushed the sum past the range; if none, the ending.
 * - What it returned, when the code's own steps are drawn: if one of them produced the value the bettor said, the step after
 *   it is where the run moved on from that answer. Otherwise the ending.
 * - How it ended: the ending.
 * - The step is past what Atlas kept, or the path has no ending: null.
 */
export function partingKey(items: PathItem[], bet: Pick<Bet, "measures" | "answer">): string | null {
  const endAt = items.findIndex((i) => i.kind === "end");
  const end = endAt >= 0 ? "end" : null;
  const wasCut = items.some((i) => i.kind === "stop");
  const range = expectedRange(bet);
  if (range && bet.measures.startsWith("calls")) {
    const name = bet.measures.startsWith("calls:") ? bet.measures.slice(6) : null;
    let seen = 0;
    for (const it of items) {
      const refs = it.kind === "call" ? [{ name: it.name, n: it.n }] : it.kind === "together" ? it.calls : it.kind === "late" ? it.keys.map((k) => ({ name: k.slice(0, k.lastIndexOf(":")), n: Number(k.slice(k.lastIndexOf(":") + 1)) })) : [];
      for (const r of refs) {
        if (name !== null && r.name !== name) continue;
        seen = name !== null ? r.n : seen + 1;
        if (seen > range.max) return `${r.name}:${r.n}`;
      }
    }
    // Too few calls on the path. A cut path cannot say whether the run really stopped short.
    return wasCut ? null : end;
  }
  if (range && (bet.measures === "virtualMs" || bet.measures === "totalWaitMs")) {
    const lastTurn = items.reduce((at, it, i) => (it.kind === "turn" ? i : at), -1);
    const from = lastTurn + 1;
    const stopAt = endAt >= 0 ? endAt : items.length;
    const lastStart = lastTurn >= 0 ? (items[lastTurn] as { t: number }).t : 0;
    if (bet.measures === "virtualMs") {
      for (let i = from; i < stopAt; i++) {
        const it = items[i]!;
        if ((it.kind === "call" || it.kind === "wait" || it.kind === "together") && it.t - lastStart > range.max) return itemKeys(it)[0]!;
      }
    } else {
      let sum = 0;
      for (let i = from; i < stopAt; i++) {
        const it = items[i]!;
        if (it.kind === "wait") {
          sum += it.ms ?? 0;
          if (sum > range.max) return itemKeys(it)[0]!;
        }
      }
    }
    return wasCut ? null : end;
  }
  const saidValue = bet.answer.kind === "json" ? bet.answer.value : bet.answer.kind === "quiz" ? (() => {
    const a = bet.answer as Extract<Bet["answer"], { kind: "quiz" }>;
    const m = a.options.find((o) => o.id === a.choice)?.match;
    return m?.kind === "json" ? m.value : undefined;
  })() : undefined;
  if (bet.measures === "returnedJson" && saidValue !== undefined) {
    const said = JSON.stringify(saidValue);
    let last = -1;
    items.forEach((it, i) => {
      if (it.kind === "helper" && it.value === said) last = i;
    });
    if (last >= 0) {
      const stopAt = endAt >= 0 ? endAt : items.length;
      for (let i = last + 1; i < stopAt; i++) {
        const it = items[i]!;
        if (it.kind === "helper" || it.kind === "call" || it.kind === "together") return itemKeys(it)[0]!;
      }
    }
  }
  return end;
}

export function whatHappened(input: WhatHappenedInput): RenderSpec {
  const base: RenderSpec = {
    version: 1,
    stage: "after-run",
    seed: input.seed ?? `run:${input.run.id}`,
    kicker: input.kicker ?? "what happened",
    title: input.title ?? "The run",
    subtitle: "from the measured trace, step by step",
    nodes: [],
    edges: [],
    regions: [],
    marks: [],
    captions: [],
    steps: [],
  };
  const why = notShownAsFact(input.run);
  if (why !== null) return { ...base, notShown: why };

  const { items: raw, notes } = pathItems(input);
  const bets = input.bets ?? [];
  const verdicts = input.verdicts ?? [];
  const verdictOf = (id: string) => verdicts.find((v) => v.betId === id);
  const parting = new Map<string, string | null>();
  for (const b of bets) if (verdictOf(b.id)?.outcome === "not_matched") parting.set(b.id, partingKey(raw, b));
  const keep = new Set([...parting.values()].filter((k): k is string => k !== null));
  const items = collapse(raw, input.collapseOver ?? 6, keep);

  const nodes: SpecNode[] = [];
  const edges: RenderSpec["edges"] = [];
  const steps: SpecStep[] = [];
  const keyToNode = new Map<string, string>();
  const itemNode = new Map<PathItem, string>();
  let prev: string | null = null;
  let pendingWords: string | undefined;
  /** The last node on the unbroken thread. Notes past the end, or past a gap in the trace, hang off it with a dashed line. */
  let threadEnd: string | null = null;
  const pathEdges: string[] = [];
  const add = (node: SpecNode, step: Omit<SpecStep, "id" | "nodes" | "edges" | "provenance">, off = false) => {
    nodes.push(node);
    const edgeIds: string[] = [];
    if (prev) {
      const id = `e${edges.length}`;
      edges.push({ id, from: prev, to: node.id, ...(pendingWords ? { words: pendingWords } : {}), kind: off ? "dashed-note" : "thread", provenance: "run" });
      edgeIds.push(id);
      if (!off) pathEdges.push(id);
    }
    steps.push({ id: `s${steps.length}`, nodes: [node.id], edges: edgeIds, provenance: "run", ...step, ...(step.words !== undefined ? { words: cleanWords(step.words) } : {}) });
    prev = node.id;
    if (!off) threadEnd = node.id;
    pendingWords = undefined;
  };
  for (const it of items) {
    const id = `p${nodes.length}`;
    for (const key of itemKeys(it)) keyToNode.set(key, id);
    itemNode.set(it, id);
    if (it.kind === "call") {
      const small = it.whileOpen ? `${ordinal(it.n)} call, while ${names(it.whileOpen)} still had no answer` : `${ordinal(it.n)} call`;
      add({ id, kind: "ticket", words: `called ${clip(it.name, 30)}`, small: clip(small, 60), provenance: "run", pin: it.answer === null ? "ochre" : it.good ? "blue" : "red" }, { beat: "call", device: it.name, words: `called ${it.name}${it.answer ? `, ${it.answer}` : ""}` });
      if (it.answer) pendingWords = it.answer;
    } else if (it.kind === "helper") {
      const words = `${clip(it.name, 30)}${it.threw ? " threw" : it.value !== undefined ? ` → ${clip(it.value, 30)}` : ""}`;
      add({ id, kind: "ticket", words, small: it.inner > 0 ? `your code, and ${grouped(it.inner)} call${it.inner === 1 ? "" : "s"} inside it` : "your code", provenance: "run", pin: it.threw ? "red" : "ochre" }, { beat: "call", words });
    } else if (it.kind === "together") {
      const nameList = names(unique(it.calls.map((c) => c.name)));
      const sameName = unique(it.calls.map((c) => c.name)).length === 1;
      const words = sameName ? `called ${clip(it.calls[0]!.name, 24)} ${grouped(it.calls.length)} times together` : `called ${clip(nameList, 34)} together`;
      add({ id, kind: "ticket", words, small: `${grouped(it.calls.length)} calls, none waiting for another`, provenance: "run", pin: "ochre" }, { beat: "call", device: it.calls[0]!.name, words: `${words}, at ${grouped(it.t)} ms` });
    } else if (it.kind === "answer") {
      add({ id, kind: "ticket", words: `${clip(it.name, 22)} ${clip(it.words, 28)}`, small: `its answer arrived at ${grouped(it.t)} ms`, provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "call", device: it.name, words: `${it.name} ${it.words}, at ${grouped(it.t)} ms` });
    } else if (it.kind === "loop") {
      add({ id, kind: "ticket", words: `called ${clip(it.name, 24)} ${grouped(it.count)} times`, small: `calls ${grouped(it.from)} to ${grouped(it.to)}`, provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "call", device: it.name, words: `called ${it.name} ${it.count} times` });
      pendingWords = it.waits ? `each ${it.answer}, waits ${it.waits.min === it.waits.max ? `${grouped(it.waits.min)} ms` : `${grouped(it.waits.min)} to ${grouped(it.waits.max)} ms`}` : `each ${it.answer}`;
    } else if (it.kind === "cycle") {
      const counts = it.counts.map((c) => `${clip(c.name, 18)} ${grouped(c.count)} times`);
      const words = `called ${names(counts)}`;
      add({ id, kind: "ticket", words: clip(words, 70), small: `the same pattern, ${grouped(it.rounds)} rounds`, provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "call", device: it.counts[0]?.name ?? "the code", words: `${words}: ${it.rounds} rounds` });
      pendingWords = clip(`each round: ${it.pattern}${it.waits ? `; waits ${it.waits.min === it.waits.max ? `${grouped(it.waits.min)} ms` : `${grouped(it.waits.min)} to ${grouped(it.waits.max)} ms`}` : ""}`, 90);
    } else if (it.kind === "wait") {
      const ms = it.ms;
      const words = ms === null ? "waited (time not reported)" : it.cut ? `was waiting ${grouped(ms)} ms when Atlas stopped` : `waited ${grouped(ms)} ms`;
      // The sweep is on a log scale: enough to feel longer waits without any one filling the dial.
      add({ id, kind: "clock", words, provenance: "run", sweep: ms === null ? 0.05 : Math.max(0.06, Math.min(0.92, Math.log10(1 + ms) / 5)) }, { beat: "wait", device: "clock", words, ...(ms === null ? {} : { ms }) });
      if (it.answerWords) pendingWords = it.answerWords;
    } else if (it.kind === "turn") {
      add({ id, kind: "ticket", words: `${clip(it.fn, 26)}`, small: `Atlas's call ${it.n} of ${it.of}`, provenance: "run", pin: "ochre" }, { beat: "start", words: `Atlas makes call ${it.n} of ${it.of}: ${it.fn}` });
    } else if (it.kind === "turn-end") {
      add({ id, kind: "ticket", words: it.words, small: `end of call ${it.n}`, provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "end", words: it.words });
    } else if (it.kind === "atlas-wait") {
      const words = `Atlas waited ${grouped(it.ms)} ms, as the test says`;
      add({ id, kind: "clock", words, provenance: "plain-code", sweep: Math.max(0.06, Math.min(0.92, Math.log10(1 + it.ms) / 5)) }, { beat: "wait", device: "clock", words, ms: it.ms });
    } else if (it.kind === "end") {
      if (it.open) pendingWords = pendingWords ? `${pendingWords}; ${it.open}` : it.open;
      add({ id, kind: "ticket", words: it.words, small: "the end", provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "end", words: it.words }, it.dashed === true);
    } else if (it.kind === "late") {
      prev = prev ?? threadEnd;
      add({ id, kind: "note", words: it.words, provenance: "run" }, { beat: "note", words: it.words }, true);
    } else {
      add({ id, kind: "note", words: it.words, provenance: "run" }, { beat: "note", words: it.words }, it.cut === true);
    }
  }
  // Words waiting for a thread that never came (a call that is the last thing on the path) go on the ticket itself.
  if (pendingWords && nodes.length > 0) {
    const last = nodes[nodes.length - 1]!;
    last.small = last.small ? `${last.small}: ${pendingWords}` : pendingWords;
  }

  // ---- marks, from the verdicts only ----
  const marks: SpecMark[] = [];
  const lastNode = nodes[nodes.length - 1]?.id;
  let partsWaysAt: string | undefined;
  for (const b of bets) {
    const v = verdictOf(b.id);
    if (!v || !lastNode) continue;
    if (b.answer.kind === "declined" && b.who === "human") continue; // no answer, nothing to mark
    const who = whoWords(b.who);
    if (v.outcome === "cant_check") {
      marks.push({ on: lastNode, kind: "cant-check", who, words: `can't check ${measureWords(b.measures)}, ${clip(v.reason ?? "not measured", 80)}` });
    } else if (v.outcome === "matched") {
      const name = b.measures.startsWith("calls:") ? b.measures.slice(6) : null;
      const lastCall = [...items].reverse().find((i) => ((i.kind === "call" || i.kind === "loop") && (name === null || i.name === name)) || (i.kind === "cycle" && i.counts.some((c) => name === null || c.name === name)) || (i.kind === "together" && i.calls.some((c) => name === null || c.name === name)));
      const on = bets.length === 1 && lastCall && b.measures.startsWith("calls") ? (itemNode.get(lastCall) ?? lastNode) : lastNode;
      marks.push({ on, kind: "matched", who, words: `said ${expectedWords(b)} for ${measureWords(b.measures)}, and it matched` });
    } else {
      const key = parting.get(b.id) ?? null;
      const on = key !== null ? keyToNode.get(key) : undefined;
      if (on !== undefined) {
        partsWaysAt ??= on;
        marks.push({ on, kind: "didnt-match", who, words: `said ${expectedWords(b)} for ${measureWords(b.measures)}. The run parts ways here.` });
      } else {
        // No step on this path honestly shows where: no ring, and the sentence says so, with the exact number where there is one.
        const n = num(own(rec(input.run.result?.measured), b.measures));
        const count = n !== null && b.measures.startsWith("calls:") ? `; the run made ${grouped(n)}, past what Atlas kept` : ", and it did not match. No step on this path shows where";
        marks.push({ on: lastNode, kind: "didnt-match", noStep: true, who, words: `said ${expectedWords(b)} for ${measureWords(b.measures)}${count}.` });
      }
    }
  }

  // Several bettors on one step share one mark: fewer words, on clean paper.
  const merged: SpecMark[] = [];
  for (const m of marks) {
    const same = merged.find((x) => x.on === m.on && x.kind === m.kind && !x.noStep === !m.noStep);
    if (!same) merged.push({ ...m });
    else same.words = `${(same.words ?? "").replace(/\.$/, "")}; ${m.who} ${m.words}`;
  }
  const conditions = (input.run.conditions ?? []).map((c) => ({ words: c.says, provenance: "run" as const }));
  const overlapped = raw.some((i) => i.kind === "together" || i.kind === "answer" || i.kind === "late" || (i.kind === "call" && i.whileOpen !== undefined));
  const originWords = input.origin === "proof-file" ? " Read back from a saved proof file." : input.origin === "this-run" ? " This run just happened here." : "";
  const captions = [
    { words: `Every step comes from run ${clip(input.run.id, 24)}'s trace. Atlas's clock is virtual: nothing waited for real.${originWords}`, provenance: "run" as const },
    ...(input.helpers && "none" in input.helpers ? [{ words: input.helpers.none, provenance: "run" as const }] : []),
    ...(helperList(input).length ? [{ words: `Your code's own steps come from a third run made only for this drawing, and it matched the two sealed runs exactly. They count toward no verdict.${input.helpers && "more" in input.helpers && input.helpers.more > 0 ? ` ${grouped(input.helpers.more)} more were not drawn.` : ""}`, provenance: "run" as const }] : []),
    ...(overlapped ? [{ words: "Calls overlapped here. The drawing shows when each answer arrived; the trace does not say whether the code used it.", provenance: "run" as const }] : []),
    ...notes.map((words) => ({ words, provenance: "run" as const })),
    ...conditions,
    ...(input.preExisting ? [{ words: input.preExisting, provenance: "plain-code" as const }] : []),
  ];
  return { ...base, nodes, edges, steps, marks: merged, captions, path: { edges: pathEdges, provenance: "run", ...(partsWaysAt ? { partsWaysAt } : {}) }, ...(nodes.length === 0 ? { notShown: "the run recorded no step that can be drawn" } : {}) };
}

/** The label PRE-EXISTING.md requires wherever withRpcRetry appears, and the line that keeps "still waiting" from reading as "hangs for ever". */
export const RETRY_PRE_EXISTING = "Pre-existing: withRpcRetry was written before the hackathon (listed in PRE-EXISTING.md). Atlas checks it; it is not part of Atlas.";
export const RETRY_VIEM_CAP = " In production, viem's 10 s default caps this at about 62 s.";

/** Author (d): the retry demo. The code is pre-existing, so the drawing says so (PRE-EXISTING.md). */
export function retryDemo(input: Omit<WhatHappenedInput, "preExisting" | "title" | "kicker"> & { preExisting?: string }): RenderSpec {
  const outcome = input.run.result?.measured?.outcome;
  return whatHappened({
    ...input,
    title: "withRpcRetry",
    kicker: "the retry demo",
    preExisting: `${input.preExisting ?? RETRY_PRE_EXISTING}${outcome === "pending" || outcome === "never_settled" ? RETRY_VIEM_CAP : ""}`,
  });
}
