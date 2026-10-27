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

import { canonicalJson } from "../../src/seal.ts";
import type { RunResult } from "../../src/types.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type TruthExpect =
  | { cantCheck: true; because: string }
  | {
      cantCheck?: undefined;
      outcome: "returned" | "threw" | "never_settled" | "still_running_at_watch_limit";
      /** The returned value; compared as canonical JSON text (keys sorted, JavaScript number forms). */
      returnedJson?: JsonValue;
      returnedType?: string;
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

export const CLASSES = ["correct fact", "FALSE FACT", "correct can't-check", "wrong can't-check (over-refusal)", "missed can't-check", "control failed"] as const;
export type TruthClass = (typeof CLASSES)[number];

export type FieldVerdict = "correct" | "FALSE" | "not measured (over-refusal)";

export interface FieldCheck {
  field: string;
  expected: unknown;
  measured: unknown;
  verdict: FieldVerdict;
  /** Why it was not measured, when Atlas said so. */
  notMeasured?: string;
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

/** One field compared. `want` null means "must not be measured". */
function field(name: string, want: unknown, r: RunResult): FieldCheck {
  const measured = has(r.measured, name) ? r.measured[name] : undefined;
  const why = r.notMeasured[name];
  if (want === null) {
    return measured === undefined
      ? { field: name, expected: null, measured: null, verdict: "correct", ...(why ? { notMeasured: why } : {}) }
      : { field: name, expected: null, measured, verdict: "FALSE" };
  }
  if (measured === undefined) return { field: name, expected: want, measured: null, verdict: "not measured (over-refusal)", ...(why ? { notMeasured: why } : {}) };
  return { field: name, expected: want, measured, verdict: measured === want ? "correct" : "FALSE" };
}

export function classify(expect: TruthExpect, result: RunResult, controlPassed: boolean): Classified {
  const notes: string[] = [];
  if (!controlPassed) return { classification: "control failed", fields: [], notes: [result.notMeasured.control ?? "the known-case control did not pass"] };
  const outcomeMeasured = has(result.measured, "outcome");
  const cantReason = result.notMeasured.wholeRun ?? result.notMeasured.outcome;

  if (expect.cantCheck) {
    if (outcomeMeasured) {
      return { classification: "missed can't-check", fields: [{ field: "outcome", expected: "can't check", measured: result.measured.outcome, verdict: "FALSE" }], notes };
    }
    return { classification: "correct can't-check", fields: [], notes, ...(cantReason ? { cantCheckReason: cantReason } : {}) };
  }

  if (!outcomeMeasured) {
    return {
      classification: "wrong can't-check (over-refusal)",
      fields: [{ field: "outcome", expected: expect.outcome, measured: null, verdict: "not measured (over-refusal)", ...(cantReason ? { notMeasured: cantReason } : {}) }],
      notes,
      ...(cantReason ? { cantCheckReason: cantReason } : {}),
    };
  }

  const fields: FieldCheck[] = [field("outcome", expect.outcome, result)];
  if (expect.returnedJson !== undefined) fields.push(field("returnedJson", canonicalJson(expect.returnedJson), result));
  if (expect.returnedType !== undefined) fields.push(field("returnedType", expect.returnedType, result));
  if (expect.returnedNotJson) {
    fields.push(field("returnedJson", null, result));
    fields.push(field("returnedType", expect.returnedNotJson.type, result));
    const why = result.notMeasured.returnedJson ?? "";
    if (!why.includes(expect.returnedNotJson.reasonMentions)) notes.push(`returnedJson's not-measured reason does not mention "${expect.returnedNotJson.reasonMentions}": ${JSON.stringify(why)}`);
  }
  if (expect.thrownName !== undefined) fields.push(field("thrownName", expect.thrownName, result));
  if (expect.thrownType !== undefined) fields.push(field("thrownType", expect.thrownType, result));
  if (expect.thrownMessage !== undefined) fields.push(field("thrownMessage", expect.thrownMessage, result));
  if (expect.virtualMs !== undefined) fields.push(field("virtualMs", expect.virtualMs, result));
  for (const [name, n] of Object.entries(expect.calls ?? {})) fields.push(field(`calls:${name}`, n, result));

  const classification: TruthClass = fields.some((f) => f.verdict === "FALSE")
    ? "FALSE FACT"
    : fields.some((f) => f.verdict === "not measured (over-refusal)")
      ? "wrong can't-check (over-refusal)"
      : "correct fact";
  return { classification, fields, notes };
}
