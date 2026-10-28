// Turns what the PERSON typed into a bet Atlas can seal, by plain code.
//
// Why this exists: the bet must be the person's, never the coding agent's. So `atlas_seal_bet` does not take a
// ready-made answer object from the agent. It takes the person's words exactly as they typed them, one per
// question, and this file reads them with fixed rules. Anything it would have to interpret is refused, nothing is
// sealed, and the agent must ask the person again (review M4: no guessing, ever).
// - A choice question: the option's own word, exactly (any case; spaces, _ or - between words). A bare number is
//   refused: "2" could mean the second question, a list the agent drew, or this plugin's order.
// - A whole-number question: digits, optionally followed by the question's own unit ("3", "3 calls" or "3 times" for
//   a count of calls). Another unit is refused ("3 ms" on a calls question). At most 2^53.
// - A number question: a number, optionally followed by the question's own unit; another unit is refused.
// - A "what does it return" question: JSON (true, 3, "text", {"ok": true}). Python's None and the word null are the
//   JSON value null; True / False are refused with "type true / false". Whole numbers beyond 2^53 are refused (they
//   cannot be held exactly; the server has the same rule).
// - "skip" or "no bet", as the WHOLE answer, seals a decline (judged "can't check"). Nothing else declines: an empty
//   answer, "none", "don't know" are refused, so a word like "None" is never silently turned into "no bet".

export interface QuestionView {
  measures: string;
  text: string;
  kind: "integer" | "number" | "enum" | "json";
  unit?: string;
  options?: readonly string[];
  tolerancePct?: number;
}

export type ParsedAnswer =
  | { kind: "integer"; value: number }
  | { kind: "number"; value: number }
  | { kind: "enum"; value: string }
  | { kind: "json"; value: unknown }
  | { kind: "declined"; reason: string };

export const DECLINE_WORDS = /^(skip|no bet)$/i;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The question's unit (src/units.ts: count, ms, USD) as the words a person may type after the number. A count
 * question takes "calls" or "times" (it counts calls); "ms" takes "ms" or "milliseconds". Nothing else.
 */
function unitPattern(unit: string | undefined): string | null {
  switch (unit) {
    case "count":
      return "calls?|times?";
    case "ms":
      return "ms|milliseconds?";
    case "USD":
      return "usd|dollars?";
    default:
      return null;
  }
}

/** The unit as shown in a hint. */
const unitWords = (unit: string | undefined) => (unit === "count" ? "calls" : unit === "ms" ? "ms" : unit === "USD" ? "USD" : "");

/** The first whole number in a JSON value that cannot be held exactly (beyond 2^53), or null. */
function unsafeInteger(v: unknown): number | null {
  const stack: unknown[] = [v];
  while (stack.length > 0) {
    const x = stack.pop();
    if (typeof x === "number" && Number.isInteger(x) && !Number.isSafeInteger(x)) return x;
    if (x && typeof x === "object") for (const y of Object.values(x)) stack.push(y);
  }
  return null;
}

export function parseTypedAnswer(q: QuestionView, typedRaw: string): { ok: true; answer: ParsedAnswer } | { ok: false; reason: string } {
  const typed = typedRaw.trim();
  const bad = (why: string) => ({ ok: false as const, reason: `"${typedRaw}" for "${q.measures}": ${why}` });
  if (typed === "") return bad('nothing was typed; type an answer, or "skip"');
  if (DECLINE_WORDS.test(typed)) return { ok: true, answer: { kind: "declined", reason: "the person chose not to bet on this question" } };
  switch (q.kind) {
    case "enum": {
      const options = q.options ?? [];
      const word = typed.replace(/^["'`]|["'`]$/g, "");
      const hit = options.find((o) => norm(o) === norm(word));
      if (hit) return { ok: true, answer: { kind: "enum", value: hit } };
      return bad(`type one of the options by its word: ${options.join(", ")}; or "skip"`);
    }
    case "integer": {
      const units = unitPattern(q.unit);
      const m = new RegExp(`^(\\d{1,20})(?:\\s*(${units ?? "(?!)"}))?$`, "i").exec(typed);
      if (!m) return bad(`type a whole number${units ? ` (optionally followed by ${unitWords(q.unit)}, no other unit)` : ""}, for example 3; or "skip"`);
      const n = Number(m[1]);
      if (!Number.isSafeInteger(n)) return bad("that whole number is beyond 2^53, which cannot be stored exactly");
      return { ok: true, answer: { kind: "integer", value: n } };
    }
    case "number": {
      const units = unitPattern(q.unit);
      const m = new RegExp(`^(-?\\d+(?:\\.\\d+)?)(?:\\s*(${units ?? "(?!)"}))?$`, "i").exec(typed);
      if (!m) return bad(`type a number${units ? ` in ${unitWords(q.unit)}` : ""} (for example 700), with no other unit; or "skip"`);
      const n = Number(m[1]);
      if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) return bad("that number cannot be stored exactly");
      return { ok: true, answer: { kind: "number", value: n } };
    }
    case "json": {
      if (/^(none|null)$/i.test(typed)) return { ok: true, answer: { kind: "json", value: null } };
      if (/^(true|false)$/.test(typed) === false && /^(true|false)$/i.test(typed)) return bad(`type ${typed.toLowerCase()} in lower case (JSON spelling)`);
      let value: unknown;
      try {
        value = JSON.parse(typed);
      } catch {
        return bad('type a JSON value, for example true, 3, "done" (with the quotes), null or {"ok": true}; or "skip"');
      }
      const big = unsafeInteger(value);
      if (big !== null) return bad(`the value holds a whole number beyond 2^53 (${typed.match(/\d{16,}/)?.[0] ?? big}), which cannot be stored exactly`);
      return { ok: true, answer: { kind: "json", value } };
    }
  }
}

/** The body Atlas's POST /bets takes for one parsed answer (the server re-checks every field; this only shapes it). */
export function toServerAnswer(q: QuestionView, a: ParsedAnswer): Record<string, unknown> {
  switch (a.kind) {
    case "declined":
      return { kind: "declined", reason: a.reason };
    case "enum":
      return { kind: "enum", value: a.value };
    case "integer":
      return { kind: "integer", value: a.value };
    case "number":
      return { kind: "number", value: a.value, ...(q.unit ? { unit: q.unit } : {}) };
    case "json":
      return { kind: "json", value: a.value };
  }
}
