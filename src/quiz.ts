// U1 (D48): the quiz. Plain code writes 3–4 options per question from the TEST ITSELF, plus "can't tell" on screen.
//
// Plain words:
// - A quiz question is one of the usual call-function questions (how it ends, what it returns, how many times it calls
//   each stand-in, how long it takes) with a short list of options instead of a free answer.
// - Every option comes from the gate-checked test: the four endings the runner can report; call counts from each
//   stand-in's scripted steps; time ranges from the delays the stand-ins are scripted to wait; returned values from the
//   values the stand-ins are scripted to return (and the plain JSON arguments). Nothing has run when the options are
//   written, and the builder takes no input that could carry a run: its only input is the test, and it passes that
//   through the gate first, which refuses any field a test does not have.
// - Count and time options cover every possible answer with no overlap (checked by `coverageProblem`), so exactly one
//   option holds whatever the run measures. "can't tell" is a declined bet, judged "can't check".
// - Judging is by membership: the bet matched when the measured value is inside the chosen option. Pure, no I/O.

import { CALL_DEFAULT_WATCH_LIMIT_MS, gate, questionsFor, visibleText, type Question } from "./gate";
import { canonicalJson } from "./seal";
import { alignDecimals, parseExactDecimal, type ExactDecimal } from "./units";
import type { ArgSpec, ExperimentShape, JsonValue, QuizMatch, QuizOption } from "./types";

type CallShape = Extract<ExperimentShape, { shape: "call-function" }>;
type StandIn = Extract<ArgSpec, { kind: "stand-in" }>;

/** At most this many returned-value options before "another value". */
export const QUIZ_MAX_VALUES = 3;
/** The words on screen for a declined quiz answer. */
export const CANT_TELL = "can't tell";

const IDS = "abcdefgh";
const withIds = (opts: Omit<QuizOption, "id">[]): QuizOption[] => opts.map((o, i) => ({ id: IDS[i]!, ...o }));
const ms = (n: number) => `${n.toLocaleString("en-US")} ms`;
const times = (n: number) => (n === 1 ? "once" : `${n.toLocaleString("en-US")} times`);
const shortJson = (v: JsonValue) => {
  const s = visibleText(canonicalJson(v));
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
};

/** The four endings, in the runner's words, with the watch limit stated. */
export function endingOptions(watchLimitMs: number): QuizOption[] {
  return withIds([
    { label: "returns a value", match: { kind: "word", value: "returned" } },
    { label: "throws (an Error or any other value)", match: { kind: "word", value: "threw" } },
    { label: "never finishes (waits forever, nothing left to wake it)", match: { kind: "word", value: "never_settled" } },
    { label: `still running when Atlas stops watching at ${ms(watchLimitMs)}`, match: { kind: "word", value: "still_running_at_watch_limit" } },
  ]);
}

/**
 * Call counts for one stand-in with N scripted steps: 0, then 1 (or 1 to N−1), then N, then more than N. Whole numbers
 * from 0 up, each in exactly one option. N is what the test shows: the number of answers the stand-in is scripted with.
 */
export function countOptions(steps: number): QuizOption[] {
  const n = Math.max(1, Math.floor(steps));
  const out: Omit<QuizOption, "id">[] = [{ label: "0 times (never called)", match: { kind: "count", min: 0, max: 0 } }];
  if (n === 1) out.push({ label: "once", match: { kind: "count", min: 1, max: 1 } });
  else {
    out.push(n === 2 ? { label: "once", match: { kind: "count", min: 1, max: 1 } } : { label: `1 to ${n - 1} times`, match: { kind: "count", min: 1, max: n - 1 } });
    out.push({ label: times(n), match: { kind: "count", min: n, max: n } });
  }
  out.push({ label: `${(n + 1).toLocaleString("en-US")} or more times`, match: { kind: "count", min: n + 1, max: null } });
  return withIds(out);
}

/**
 * Time ranges from the scripted waits: d = the shortest positive wait any stand-in is scripted with, S = all scripted
 * waits added up (each step once). Ranges: 0 ms; above 0 and below d; d to S; above S. With no scripted wait: 0 ms, or
 * above 0. Every time from 0 up falls in exactly one range.
 */
export function timeOptions(params: CallShape): QuizOption[] {
  const waits = [
    ...params.args.flatMap((a) => (a.kind === "stand-in" ? a.calls.map((c) => (c.do === "return" ? (c.afterMs ?? 0) : 0)) : [])),
    // U2 (D53): the fake network's scripted answer delays are scripted waits too.
    ...(params.network?.calls ?? []).map((c) => (c.do === "respond" ? (c.afterMs ?? 0) : 0)),
  ];
  const positive = waits.filter((w) => w > 0);
  const zero: Omit<QuizOption, "id"> = { label: "0 ms (no wait at all)", match: { kind: "ms", min: 0, max: 0, minOpen: false, maxOpen: false } };
  if (positive.length === 0) return withIds([zero, { label: "more than 0 ms", match: { kind: "ms", min: 0, max: null, minOpen: true, maxOpen: false } }]);
  const d = Math.min(...positive);
  const S = positive.reduce((a, b) => a + b, 0);
  return withIds([
    zero,
    { label: `more than 0 ms, less than ${ms(d)}`, match: { kind: "ms", min: 0, max: d, minOpen: true, maxOpen: true } },
    d === S ? { label: `exactly ${ms(d)}`, match: { kind: "ms", min: d, max: d, minOpen: false, maxOpen: false } } : { label: `${ms(d)} to ${ms(S)}`, match: { kind: "ms", min: d, max: S, minOpen: false, maxOpen: false } },
    { label: `more than ${ms(S)}`, match: { kind: "ms", min: S, max: null, minOpen: true, maxOpen: false } },
  ]);
}

/** Returned values: each distinct value a stand-in is scripted to return, then each plain JSON argument, then "another value". */
export function valueOptions(params: CallShape): QuizOption[] {
  const seen = new Set<string>();
  const picked: { value: JsonValue; label: string }[] = [];
  const add = (value: JsonValue, label: string) => {
    const key = canonicalJson(value);
    if (seen.has(key) || picked.length >= QUIZ_MAX_VALUES) return;
    seen.add(key);
    picked.push({ value, label });
  };
  for (const a of params.args) if (a.kind === "stand-in") for (const c of a.calls) if (c.do === "return") add(c.value, `${shortJson(c.value)} (what ${visibleText(a.name)} is scripted to return)`);
  // U2 (D53): the body of each successful (2xx) answer the fake network is scripted to give.
  for (const c of params.network?.calls ?? []) if (c.do === "respond" && c.status >= 200 && c.status <= 299) add(c.body, `${shortJson(c.body)} (the body the fake ${params.network!.replaces} answers with)`);
  params.args.forEach((a, i) => {
    if (a.kind === "json") add(a.value, `${shortJson(a.value)} (the same as argument ${i + 1})`);
  });
  if (picked.length === 0) return [];
  // Review m5: values cut to the same words get their length and a number, so no two options read alike.
  const seenLabels = new Map<string, number>();
  for (const p of picked) seenLabels.set(p.label, (seenLabels.get(p.label) ?? 0) + 1);
  const nth = new Map<string, number>();
  for (const p of picked) {
    if ((seenLabels.get(p.label) ?? 0) < 2) continue;
    const k = (nth.get(p.label) ?? 0) + 1;
    nth.set(p.label, k);
    p.label = `${p.label} [${canonicalJson(p.value).length} characters as JSON; value ${k} of ${seenLabels.get(p.label)} that start alike]`;
  }
  return withIds([
    ...picked.map((p) => ({ label: p.label, match: { kind: "json" as const, value: p.value } })),
    { label: "another value", match: { kind: "json-other" as const, not: picked.map((p) => p.value) } },
  ]);
}

/**
 * The quiz questions for a test. Its only input is the test: it is passed through the gate first, so anything a test
 * does not have (a run, a measured value, a model's words) is refused, and the options are built from the gate's copy.
 * The question texts are the usual call-function texts (src/gate.ts), so a person and every model read the same words.
 */
export function quizQuestionsFor(test: unknown, exportNames?: readonly string[], language?: "js" | "ts" | "py"): Question[] {
  const decision = gate(test, { shapes: ["call-function"], ...(exportNames ? { exportNames } : {}), ...(language ? { language } : {}) });
  if (!decision.allowed) throw new Error(`no quiz for a test the gate refuses: ${decision.reason}`);
  const params = decision.params as CallShape;
  const usual = questionsFor(params);
  const byField = new Map(usual.map((q) => [q.measures, q]));
  const out: Question[] = [];
  const as = (measures: string, quiz: QuizOption[]) => {
    const q = byField.get(measures);
    if (q && quiz.length >= 2) out.push({ measures: q.measures, text: q.text, kind: "quiz", unit: q.unit, quiz });
  };
  as("outcome", endingOptions(params.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS));
  as("returnedJson", valueOptions(params));
  for (const a of params.args) if (a.kind === "stand-in") as(`calls:${a.name}`, countOptions((a as StandIn).calls.length));
  if (params.network) as(`calls:${params.network.replaces}`, countOptions(params.network.calls.length));
  as("virtualMs", timeOptions(params));
  return out;
}

// ---------- coverage (tests and the builder's own guard) ----------

/** For count and time options: a reason when some value from 0 up is in no option or in two; null when each is in exactly one. */
export function coverageProblem(options: readonly QuizOption[]): string | null {
  const ranges = options.map((o) => o.match).filter((m): m is Extract<QuizMatch, { kind: "count" | "ms" }> => m.kind === "count" || m.kind === "ms");
  if (ranges.length === 0) return null;
  if (ranges.length !== options.length) return "a question mixes ranges with other options";
  // Turn each into [lo, hi] with open flags; counts are whole numbers, so [a, b] covers a..b and the next starts at b + 1.
  const iv = ranges
    .map((m) => (m.kind === "count" ? { lo: m.min, hi: m.max === null ? Infinity : m.max + 1, loOpen: false, hiOpen: true } : { lo: m.min, hi: m.max === null ? Infinity : m.max, loOpen: m.minOpen, hiOpen: m.max === null ? true : m.maxOpen }))
    .sort((a, b) => a.lo - b.lo || Number(a.loOpen) - Number(b.loOpen));
  if (iv[0]!.lo !== 0 || iv[0]!.loOpen) return "nothing covers 0";
  for (let i = 1; i < iv.length; i++) {
    const p = iv[i - 1]!;
    const c = iv[i]!;
    if (p.hi !== c.lo) return p.hi < c.lo ? `a gap between ${p.hi} and ${c.lo}` : `two options overlap near ${c.lo}`;
    // touching ends: exactly one of the two may include the shared point
    if (p.hiOpen === c.loOpen) return p.hiOpen ? `nothing covers ${c.lo}` : `two options both hold ${c.lo}`;
  }
  if (iv[iv.length - 1]!.hi !== Infinity) return "nothing covers the largest values";
  return null;
}

// ---------- judging (src/judge.ts calls this for a quiz bet) ----------

const DECIMAL_INTEGER_RE = /^-?\d+$/;
const cmp = (a: ExactDecimal, b: ExactDecimal) => {
  const [x, y] = alignDecimals(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The kind of option each measured unit takes. */
const KINDS_FOR_UNIT: Record<string, readonly QuizMatch["kind"][]> = { enum: ["word"], count: ["count"], ms: ["ms"], json: ["json", "json-other"] };

/**
 * Whether the measured value is inside the chosen option: { matched } or { cantCheck: reason }. Exact: whole numbers
 * as integers, times as exact decimals, JSON as canonical JSON text.
 */
export function quizMembership(choice: string, options: readonly QuizOption[], unit: string, observed: string | number | boolean | null): { matched: boolean } | { cantCheck: string } {
  if (!Array.isArray(options) || options.length === 0) return { cantCheck: "the quiz bet has no options" };
  const kinds = KINDS_FOR_UNIT[unit];
  if (!kinds || options.some((o) => !o || typeof o !== "object" || !o.match || !kinds.includes(o.match.kind))) return { cantCheck: `the quiz options do not fit the measured unit "${unit}"` };
  const picked = options.find((o) => o.id === choice);
  if (!picked) return { cantCheck: "the bet's choice is not one of its own options" };
  // Review m4: a measured value that no option holds is "can't check" (as the enum judge says), never "didn't match".
  if (!options.some((o) => holds(o.match, observed) === true)) {
    const any = holds(picked.match, observed);
    return { cantCheck: typeof any === "string" ? any : "the measured value is in none of the options" };
  }
  return { matched: holds(picked.match, observed) === true };
}

/** true / false: whether the option holds the value; a string: why it cannot be read. */
function holds(m: QuizMatch, observed: string | number | boolean | null): boolean | string {
  switch (m.kind) {
    case "word":
      if (typeof observed !== "string") return "the runner did not store this field as a word";
      return observed === m.value;
    case "count": {
      let v: bigint;
      if (typeof observed === "number" && Number.isSafeInteger(observed)) v = BigInt(observed);
      else if (typeof observed === "string" && DECIMAL_INTEGER_RE.test(observed)) v = BigInt(observed);
      else return "the runner did not store this field as a whole number";
      return v >= BigInt(m.min) && (m.max === null || v <= BigInt(m.max));
    }
    case "ms": {
      let v: ExactDecimal;
      try {
        if (typeof observed !== "number" && typeof observed !== "string") throw new Error();
        v = parseExactDecimal(observed);
      } catch {
        return "the runner did not store this field as a number";
      }
      const lo = cmp(v, parseExactDecimal(m.min));
      const aboveLo = m.minOpen ? lo > 0 : lo >= 0;
      if (!aboveLo) return false;
      if (m.max === null) return true;
      const hi = cmp(v, parseExactDecimal(m.max));
      return m.maxOpen ? hi < 0 : hi <= 0;
    }
    case "json":
    case "json-other": {
      if (typeof observed !== "string") return "the runner did not store this field as JSON text";
      try {
        if (m.kind === "json") return observed === canonicalJson(m.value);
        return !m.not.some((v: JsonValue) => canonicalJson(v) === observed);
      } catch {
        return "the quiz option is not plain JSON";
      }
    }
    default:
      return "the quiz option has an unknown kind";
  }
}

/** The label of a quiz choice, for screens ("can't tell" when declined). */
export function quizChoiceLabel(options: readonly QuizOption[] | undefined, choice: string | null): string {
  if (choice === null) return CANT_TELL;
  return options?.find((o) => o.id === choice)?.label ?? choice;
}

/** Which option holds a measured value (for marking the drawing), or null. */
export function optionHolding(options: readonly QuizOption[], unit: string, observed: string | number | boolean | null): QuizOption | null {
  for (const o of options) {
    const r = quizMembership(o.id, options, unit, observed);
    if ("matched" in r && r.matched) return o;
  }
  return null;
}
