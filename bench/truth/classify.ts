// B1 (D35) bench T: compares what Atlas measured with the facts written by hand before any run, and names the
// result. The rules are the ones in bench/truth/PASS-RULE.md; this file is pure (no I/O, no clock).
//
// Plain words on the five names a test can get:
// - "correct fact": every field we wrote down was measured, and measured exactly as written.
// - "FALSE FACT": Atlas reported a value that differs from the true one (or claimed a value that does not exist,
//   such as a settle time for a call that never settled). This is the result Atlas must never produce.
// - "correct can't-check": we said Atlas cannot honestly measure this (network, files, imports, eval, ...), and it
//   measured nothing about how the call ended.
// - "wrong can't-check (over-refusal)": the facts exist and are measurable, but Atlas did not measure one or more of
//   them. Safe, but unhelpful.
// - "missed can't-check": we said Atlas should refuse, but it reported how the call ended anyway.
// A run whose known-case control did not pass is "control failed" and is not counted under any of the five.
// Added after the B1 review (bench/truth/AMENDMENT-2026-10-28.md, bench/truth-2/PASS-RULE.md):
// - "can't-check, wrong reason": Atlas refused (a whole run, or a field), but its reason does not belong to the
//   registered reason category (a trap refused for the wrong reason is not a correct can't-check).
// - A field expected as { dependsOn: "<category>" }: its true value depends on something outside the code (Atlas's
//   simulated clock, randomness, scheduling, the host). Reporting it as a plain measured value is a FALSE FACT; not
//   measuring it, with a reason of that category, is correct.

import { canonicalJson } from "../../src/seal.ts";
import { CHANGED_BETWEEN_RUNS_REASON, isCallSeed } from "../../src/conditions.ts";
import type { RunResult } from "../../src/types.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** A field whose true value depends on something outside the code; the category names what. */
export interface DependsOn { dependsOn: string }

/** Reason categories: category -> regular expressions (case-insensitive); a reason belongs if any one matches. */
export type ReasonCategories = Record<string, string[]>;

export type TruthExpect =
  | { cantCheck: true; because: string; reasonCategory?: string | string[] }
  | {
      cantCheck?: undefined;
      /** How the call ends; { dependsOn } when even that depends on something outside the code (bench T2, h02). */
      outcome: "returned" | "threw" | "never_settled" | "still_running_at_watch_limit" | DependsOn;
      /** The returned value; compared as canonical JSON text (keys sorted, JavaScript number forms). */
      returnedJson?: JsonValue | DependsOn;
      returnedType?: string;
      /** A whole-run "can't check" with a reason of this category is also an honest answer for this test. */
      wholeRunCantCheckOk?: string | string[];
      /** The value is not plain JSON: returnedJson must be absent, returnedType must equal `type`. */
      returnedNotJson?: { type: string; reasonMentions: string };
      /** null = must NOT be measured (for example a thrown string has no name). */
      thrownName?: string | null;
      thrownType?: string;
      thrownMessage?: string | null;
      /** null = must NOT be measured (a call that never settled has no settle time). */
      virtualMs?: number | null;
      /** stand-in name -> exact count, or null = the final count must NOT be claimed. */
      calls?: Record<string, number | null>;
    };

export const CLASSES = ["correct fact", "correct (labelled)", "FALSE FACT", "correct can't-check", "can't-check, wrong reason", "wrong can't-check (over-refusal)", "missed can't-check", "control failed"] as const;
export type TruthClass = (typeof CLASSES)[number];

export type FieldVerdict = "correct" | "correct (labelled)" | "correct (double run)" | "FALSE" | "not measured (over-refusal)" | "not measured, wrong reason";

export interface FieldCheck {
  field: string;
  expected: unknown;
  measured: unknown;
  verdict: FieldVerdict;
  /** Why it was not measured, when Atlas said so. */
  notMeasured?: string;
  /** For "correct (labelled)": the condition kind that labels it (T2 amendment 1). */
  label?: string;
}

export interface Classified {
  classification: TruthClass;
  fields: FieldCheck[];
  /** Things worth a look that do not change the classification (a not-JSON reason without the expected words). */
  notes: string[];
  /** For can't-check results: Atlas's reason (whole-run, or the outcome's not-measured reason). */
  cantCheckReason?: string;
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const isDependsOn = (v: unknown): v is DependsOn => typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as DependsOn).dependsOn === "string" && Object.keys(v).length === 1;

/** True when `reason` belongs to one of `wanted` (a category name or a list of them). Unknown category: false. */
export function reasonInCategory(reason: string | undefined, wanted: string | string[] | undefined, cats: ReasonCategories): boolean {
  if (wanted === undefined) return true; // nothing registered: any reason is accepted (bench T before its amendment)
  if (!reason) return false;
  return (Array.isArray(wanted) ? wanted : [wanted]).some((c) => (cats[c] ?? []).some((re) => new RegExp(re, "i").test(reason)));
}

/** One field compared. `want` null means "must not be measured"; { dependsOn } means "must not be a plain fact". */
function field(name: string, want: unknown, r: RunResult, cats: ReasonCategories, opts: ClassifyOptions = {}): FieldCheck {
  const measured = has(r.measured, name) ? r.measured[name] : undefined;
  const why = r.notMeasured[name];
  if (isDependsOn(want)) {
    if (measured !== undefined) {
      // T2 amendment 1: measured AND labelled AND the twin agrees = "correct (labelled)"; otherwise a FALSE FACT.
      const label = opts.labels && opts.run ? labelFor(want.dependsOn, opts.run) : null;
      const twinSame = opts.run?.twinMeasured !== undefined && has(opts.run.twinMeasured, name) && opts.run.twinMeasured[name] === measured;
      if (label && twinSame) return { field: name, expected: want, measured, verdict: "correct (labelled)", label };
      return { field: name, expected: want, measured, verdict: "FALSE", ...(label && !twinSame ? { label: `${label} (twin differs or missing)` } : {}) };
    }
    if (opts.labels && why === CHANGED_BETWEEN_RUNS_REASON) return { field: name, expected: want, measured: null, verdict: "correct (double run)", notMeasured: why };
    return { field: name, expected: want, measured: null, verdict: reasonInCategory(why, want.dependsOn, cats) ? "correct" : "not measured, wrong reason", ...(why ? { notMeasured: why } : {}) };
  }
  if (want === null) {
    return measured === undefined
      ? { field: name, expected: null, measured: null, verdict: "correct", ...(why ? { notMeasured: why } : {}) }
      : { field: name, expected: null, measured, verdict: "FALSE" };
  }
  if (measured === undefined) return { field: name, expected: want, measured: null, verdict: "not measured (over-refusal)", ...(why ? { notMeasured: why } : {}) };
  return { field: name, expected: want, measured, verdict: measured === want ? "correct" : "FALSE" };
}

/** What the run says about its conditions and pins (batch R1), as stored with a result. */
export interface RunInfo {
  language?: string;
  conditions?: { kind: string; says: string }[];
  seed?: string;
  timeZone?: string;
  locale?: string;
  /** The second run's measured fields (R1's double run). */
  twinMeasured?: Record<string, string | number | boolean | null>;
}

/**
 * Bench T2 amendment 1 (bench/truth-2/AMENDMENT-1.md): does the run carry a label for this dependsOn category, with
 * the pin it needs? Pure.
 */
export function labelFor(category: string, run: RunInfo): string | null {
  const conds = run.conditions ?? [];
  const has = (k: string) => conds.find((c) => c.kind === k);
  if (category === "randomness") {
    if ((has("randomness") || has("hash-seed")) && isCallSeed(run.seed)) return has("randomness") ? "randomness" : "hash-seed";
    if (has("memory-address")) return "memory-address"; // E1: no pin exists; the twin rule still applies
    return null;
  }
  if (category === "host") {
    const locale = run.language === "py" ? "C" : "en-US";
    if (has("time-zone-or-locale") && run.timeZone === "UTC" && run.locale === locale) return "time-zone-or-locale";
    const h = has("host");
    if (h && /\(([^)]*\S[^)]*)\)/.test(h.says)) return "host"; // E2: the sentence names at least one read
    return null;
  }
  if (category === "clock") return has("timed-work") ? "timed-work" : null;
  if (category === "scheduling") return has("tick-order") ? "tick-order" : null;
  return null; // process-lifetime and anything else: not covered
}

export interface ClassifyOptions {
  /** Bench T2 amendment 1 is in force: a measured { dependsOn } field may be "correct (labelled)". */
  labels?: boolean;
  /** The run's conditions, pins and twin (from batch R1). */
  run?: RunInfo;
  /** The registered reason categories (bench T: its amendment; bench T2: its expected.json). */
  categories?: ReasonCategories;
  /** For a trap whose expectation has no reasonCategory (bench T), the category registered for it elsewhere. */
  reasonCategory?: string | string[];
}

export function classify(expect: TruthExpect, result: RunResult, controlPassed: boolean, opts: ClassifyOptions = {}): Classified {
  const cats = opts.categories ?? {};
  const notes: string[] = [];
  if (!controlPassed) return { classification: "control failed", fields: [], notes: [result.notMeasured.control ?? "the known-case control did not pass"] };
  const outcomeMeasured = has(result.measured, "outcome");
  const cantReason = result.notMeasured.wholeRun ?? result.notMeasured.outcome;

  if (expect.cantCheck) {
    if (outcomeMeasured) {
      return { classification: "missed can't-check", fields: [{ field: "outcome", expected: "can't check", measured: result.measured.outcome, verdict: "FALSE" }], notes };
    }
    const wanted = expect.reasonCategory ?? opts.reasonCategory;
    const ok = reasonInCategory(cantReason, wanted, cats);
    if (!ok) notes.push(`the reason is not in the registered category ${JSON.stringify(wanted)}`);
    return { classification: ok ? "correct can't-check" : "can't-check, wrong reason", fields: [], notes, ...(cantReason ? { cantCheckReason: cantReason } : {}) };
  }

  if (!outcomeMeasured) {
    const anyDepends = Object.values(expect).some((v) => isDependsOn(v));
    if (opts.labels && anyDepends && cantReason === CHANGED_BETWEEN_RUNS_REASON) {
      return { classification: "correct can't-check", fields: [], notes: ["refused by the double run (T2 amendment 1)"], cantCheckReason: cantReason };
    }
    if (expect.wholeRunCantCheckOk !== undefined && reasonInCategory(cantReason, expect.wholeRunCantCheckOk, cats)) {
      return { classification: "correct can't-check", fields: [], notes, ...(cantReason ? { cantCheckReason: cantReason } : {}) };
    }
    return {
      classification: "wrong can't-check (over-refusal)",
      fields: [{ field: "outcome", expected: expect.outcome, measured: null, verdict: "not measured (over-refusal)", ...(cantReason ? { notMeasured: cantReason } : {}) }],
      notes,
      ...(cantReason ? { cantCheckReason: cantReason } : {}),
    };
  }

  const fields: FieldCheck[] = [field("outcome", expect.outcome, result, cats, opts)];
  if (expect.returnedJson !== undefined) fields.push(field("returnedJson", isDependsOn(expect.returnedJson) ? expect.returnedJson : canonicalJson(expect.returnedJson), result, cats, opts));
  if (expect.returnedType !== undefined) fields.push(field("returnedType", expect.returnedType, result, cats, opts));
  if (expect.returnedNotJson) {
    fields.push(field("returnedJson", null, result, cats, opts));
    fields.push(field("returnedType", expect.returnedNotJson.type, result, cats, opts));
    const why = result.notMeasured.returnedJson ?? "";
    if (!why.includes(expect.returnedNotJson.reasonMentions)) notes.push(`returnedJson's not-measured reason does not mention "${expect.returnedNotJson.reasonMentions}": ${JSON.stringify(why)}`);
  }
  if (expect.thrownName !== undefined) fields.push(field("thrownName", expect.thrownName, result, cats, opts));
  if (expect.thrownType !== undefined) fields.push(field("thrownType", expect.thrownType, result, cats, opts));
  if (expect.thrownMessage !== undefined) fields.push(field("thrownMessage", expect.thrownMessage, result, cats, opts));
  if (expect.virtualMs !== undefined) fields.push(field("virtualMs", expect.virtualMs, result, cats, opts));
  for (const [name, n] of Object.entries(expect.calls ?? {})) fields.push(field(`calls:${name}`, n, result, cats, opts));

  const classification: TruthClass = fields.some((f) => f.verdict === "FALSE")
    ? "FALSE FACT"
    : fields.some((f) => f.verdict === "not measured (over-refusal)")
      ? "wrong can't-check (over-refusal)"
      : fields.some((f) => f.verdict === "not measured, wrong reason")
        ? "can't-check, wrong reason"
        : fields.some((f) => f.verdict === "correct (labelled)")
          ? "correct (labelled)"
          : "correct fact";
  return { classification, fields, notes };
}
