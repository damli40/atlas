// The call timeline's model (E3). A pure function from ONE run to the state of every part the figure draws, and to
// the words its card prints. It reads only the run: its trace (what the harness recorded while the function ran),
// its measured fields and its not-measured reasons. It never reads the experiment, a bet or a model's words
// (tests/unit/call-timeline.test.tsx checks the imports).
//
// The figure, in one sentence: a timing bench whose front rail is the called function's own lane and whose ruler
// is Atlas's virtual clock; behind it stands one rail per stand-in the run recorded, with one peg per call at the
// virtual moment it was made, its cap marked by how that call answered; the function's own end token sits on the
// front rail at the moment the call ended.
//
// When the run may not be shown as fact (src/trust.ts: the known-case check did not match, the sandbox did not
// finish, or the whole run is "can't check"), the model is EMPTY: no lanes, no pegs, no end token, no numbers, and
// `notShown` holds the reason the card prints instead.

import type { Run } from "../../../src/types";
import { notShownAsFact } from "../../../src/trust";

/** How one stand-in call answered, from the trace. */
export type CallAnswer = "returned" | "threw" | "never_answered" | "no_answer_seen";

export interface LaneCall {
  n: number;
  /** Virtual ms the call was made. */
  t: number;
  answer: CallAnswer;
  /** A returned call that answered later (an async stand-in's afterMs): when it answered. */
  answeredAt?: number;
  /** The error name the stand-in threw (from its own step, recorded in the trace). */
  errorName?: string;
  /** Made after the function had already ended. */
  afterEnd: boolean;
}

export interface Lane {
  name: string;
  calls: LaneCall[];
  /** The measured count, or null when Atlas did not claim one (with why). */
  measured: number | null;
  notMeasured?: string;
}

export type End =
  | { kind: "returned"; t: number; json: string | null; type: string | null }
  | { kind: "threw"; t: number; name: string | null }
  | { kind: "never_settled"; t: number }
  | { kind: "still_running"; t: number }
  /** Atlas stopped watching before the call ended: no end token is drawn (the code's end was not seen). */
  | { kind: "not_seen"; reason: string };

export interface TimelineModel {
  notShown: string | null;
  lanes: Lane[];
  end: End | null;
  /** The ruler's span in virtual ms (the latest moment anything was recorded; at least 1 so the scale exists). */
  span: number;
  /** Ruler ticks: a minor tick every `minor` ms, a major every `major` ms. */
  ticks: { minor: number; major: number };
  /** True when every recorded moment is 0 ms (a function that never waited). */
  allAtZero: boolean;
  /**
   * E3 review B4: set when the run's trace was cut (too many events to keep). The counts are still exact, but the
   * pegs would be incomplete, so the bench is not drawn and the card says why.
   */
  traceCut: string | null;
  /** Short: how the call ended (the card's corner readout). */
  readout: string;
  /** Each stand-in's calls, in words (printed under the figure). */
  detail: string;
  caption: string;
}

const rec = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const own = (o: Record<string, unknown>, k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
export const grouped = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${grouped(n)} ${n === 1 ? one : many}`;

/** A "nice" tick step (1, 2 or 5 × 10^k) so the ruler has at most `most` major ticks. */
export function niceStep(span: number, most: number): number {
  if (span <= 0) return 1;
  const raw = span / most;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

const EMPTY = (notShown: string): TimelineModel => ({
  notShown,
  lanes: [],
  end: null,
  span: 1,
  ticks: { minor: 1, major: 1 },
  allAtZero: true,
  traceCut: null,
  readout: "",
  detail: "",
  caption: "",
});

export function timelineModel(run: Run): TimelineModel {
  const why = notShownAsFact(run);
  if (why !== null) return EMPTY(why);
  const measured = rec(run.result?.measured);
  const notMeasured = rec(run.result?.notMeasured);
  const trace = Array.isArray(run.trace) ? run.trace : [];

  // Lanes: every stand-in the run recorded, by name, in the order first seen (counts first, then the trace).
  const names: string[] = [];
  const add = (n: string) => {
    if (n && !names.includes(n)) names.push(n);
  };
  for (const k of [...Object.keys(measured), ...Object.keys(notMeasured)]) if (k.startsWith("calls:")) add(k.slice(6));
  for (const e of trace) if (e.event === "stand_in_call") add(str(rec(e.data).name) ?? "");

  let endAt: number | null = null;
  const outcome = str(own(measured, "outcome"));
  const virtualMs = num(own(measured, "virtualMs"));
  let watchLimit: number | null = null;
  let lastT = 0;
  for (const e of trace) {
    if (e.event === "call_checks" || e.event === "trace_cut") continue; // Atlas's own bookkeeping lines, not moments of the code
    if (typeof e.t === "number" && Number.isFinite(e.t)) lastT = Math.max(lastT, e.t);
    if (e.event === "start") watchLimit = num(rec(e.data).watchLimitMs);
    if ((e.event === "returned" || e.event === "threw") && endAt === null) endAt = e.t;
  }

  const lanes: Lane[] = names.map((name) => {
    const calls: LaneCall[] = [];
    for (const e of trace) {
      const d = rec(e.data);
      if (str(d.name) !== name) continue;
      const n = num(d.n);
      if (n === null) continue;
      if (e.event === "stand_in_call") calls.push({ n, t: e.t, answer: "no_answer_seen", afterEnd: d.afterSettle === true });
      const c = calls.find((x) => x.n === n);
      if (!c) continue;
      if (e.event === "stand_in_returns") {
        c.answer = "returned";
        if (num(d.afterMs) !== null && e.t > c.t) c.answeredAt = e.t;
      } else if (e.event === "stand_in_throws") {
        c.answer = "threw";
        const en = str(d.errorName);
        if (en) c.errorName = en;
      } else if (e.event === "stand_in_never_answers") c.answer = "never_answered";
    }
    const m = num(own(measured, `calls:${name}`));
    const nm = str(own(notMeasured, `calls:${name}`));
    return { name, calls, measured: m, ...(m === null && nm ? { notMeasured: nm } : {}) };
  });

  let end: End;
  if (outcome === "returned" && virtualMs !== null) {
    end = { kind: "returned", t: virtualMs, json: str(own(measured, "returnedJson")), type: str(own(measured, "returnedType")) };
  } else if (outcome === "threw" && virtualMs !== null) {
    end = { kind: "threw", t: virtualMs, name: str(own(measured, "thrownName")) };
  } else if (outcome === "never_settled") {
    end = { kind: "never_settled", t: lastT };
  } else if (outcome === "still_running_at_watch_limit") {
    end = { kind: "still_running", t: watchLimit ?? lastT };
  } else {
    end = { kind: "not_seen", reason: str(own(notMeasured, "outcome")) ?? "the run recorded no ending" };
  }

  const span0 = Math.max(lastT, "t" in end ? end.t : 0);
  const allAtZero = span0 === 0;
  const span = allAtZero ? 1 : span0;
  const major = niceStep(span, 6);
  const minor = major / 5;

  // ---- words ----
  // E3 review r2 B1: when the trace was cut, the kept events miss answers (and calls), so the breakdown by answer
  // would state false facts ("not answered"). Then only the exact measured counts are printed.
  const wasCut = trace.some((e) => e.event === "trace_cut");
  const laneWords = lanes.map((l) => {
    if (wasCut) return `${l.name}: ${l.measured !== null ? plural(l.measured, "call") : "final count not claimed"}`;
    const by = (a: CallAnswer) => l.calls.filter((c) => c.answer === a).length;
    const parts = [
      by("returned") ? `${by("returned")} returned` : "",
      by("threw") ? `${by("threw")} threw` : "",
      by("never_answered") ? `${by("never_answered")} never answered` : "",
      by("no_answer_seen") ? `${by("no_answer_seen")} not answered before Atlas stopped watching` : "",
    ].filter(Boolean);
    const count = l.measured !== null ? plural(l.measured, "call") : `${plural(l.calls.length, "call")} seen (final count not claimed)`;
    return `${l.name}: ${count}${parts.length ? ` (${parts.join(", ")})` : ""}`;
  });
  const endWords =
    end.kind === "returned"
      ? `returned at ${grouped(end.t)} ms${end.json !== null ? `: ${end.json.length > 40 ? `${end.json.slice(0, 39)}…` : end.json}` : end.type ? ` (a ${end.type}, not plain JSON)` : ""}`
      : end.kind === "threw"
        ? `threw${end.name ? ` ${end.name}` : ""} at ${grouped(end.t)} ms`
        : end.kind === "never_settled"
          ? `never settled (still waiting at ${grouped(end.t)} ms, with nothing left to wake it)`
          : end.kind === "still_running"
            ? `still running when Atlas stopped watching at ${grouped(end.t)} ms`
            : `end not seen: ${end.reason}`;
  const readout = endWords;
  const detail = laneWords.length ? laneWords.join(" · ") : "no stand-in was called";
  const caption = [
    `Drawn from run ${run.id}'s trace and measured fields only.`,
    allAtZero
      ? "Everything happened at 0 ms of virtual time: no wait ran, so every peg stands at the start of the ruler, side by side in call order."
      : `The ruler is Atlas's virtual clock, 0 to ${grouped(span)} ms, a major tick every ${grouped(major)} ms; nothing waited for real.`,
    lanes.length
      ? `Back rails: one per stand-in the run recorded, from the front: ${lanes.map((l) => l.name).join(", ")}; a peg per call; pegs made at the same moment stand side by side in call order.`
      : "The run recorded no stand-in, so only the function's own rail is drawn.",
    end.kind === "not_seen" ? "No end token: the end of the call was not seen." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cut = trace.find((e) => e.event === "trace_cut");
  const traceCut = cut
    ? `the run made more events than Atlas keeps (${grouped(num(rec(cut.data).kept) ?? 0)} kept, ${grouped(num(rec(cut.data).dropped) ?? num(rec(cut.data).eventsNotKept) ?? 0)} more counted but not kept), so not every call has its own moment on record; the counts are still exact`
    : null;
  return { notShown: null, lanes, end, span, ticks: { minor, major }, allAtZero, traceCut, readout, detail, caption };
}
