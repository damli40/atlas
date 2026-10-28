// Turns what the PERSON typed into a bet Atlas can seal, by plain code.
//
// Why this exists: the bet must be the person's, never the coding agent's. So `atlas_seal_bet` does not take a
// ready-made answer object from the agent. It takes the person's words exactly as they typed them, one per
// question, and this file reads them with fixed rules:
// - a choice question: one of the listed options (any case, spaces or _ / - between words), or its number in the list;
// - a whole-number question: digits only ("3", "3 calls" is refused: plain code does not guess what the words mean);
//   "ms" may follow a number of milliseconds;
// - a number question: a number, optionally followed by the question's unit;
// - a "what does it return" question: JSON (true, 3, "text", {"ok": true}); bare words are refused;
// - "skip", "pass", "don't know", "no bet" (or an empty answer) seals a decline, which Atlas judges as "can't check".
// Anything else is refused with the reason, and nothing is sealed: the agent must ask the person again.
// The tool also returns the typed words next to what was sealed, so the person can see their own words were used.

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

export const DECLINE_WORDS = /^(skip|pass|no bet|none|don'?t know|do not know|dunno|not sure|no idea|-)$/i;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

export function parseTypedAnswer(q: QuestionView, typedRaw: string): { ok: true; answer: ParsedAnswer } | { ok: false; reason: string } {
  const typed = typedRaw.trim().replace(/^["'`]+|["'`]+$/g, (m) => (q.kind === "json" ? m : "")).trim();
  if (typed === "" || DECLINE_WORDS.test(typed)) return { ok: true, answer: { kind: "declined", reason: "the person chose not to bet on this question" } };
  const bad = (why: string) => ({ ok: false as const, reason: `"${typedRaw}" for "${q.measures}": ${why}` });
  switch (q.kind) {
    case "enum": {
      const options = q.options ?? [];
      const n = /^\d+$/.test(typed) ? Number(typed) : NaN;
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return { ok: true, answer: { kind: "enum", value: options[n - 1]! } };
      const hit = options.find((o) => norm(o) === norm(typed));
      if (hit) return { ok: true, answer: { kind: "enum", value: hit } };
      return bad(`type one of ${options.map((o, i) => `${i + 1}) ${o}`).join(", ")}, or "skip"`);
    }
    case "integer": {
      const m = /^(\d{1,15})\s*(ms|calls?|times?)?$/i.exec(typed);
      if (!m) return bad("type a whole number (for example 3), or \"skip\"");
      return { ok: true, answer: { kind: "integer", value: Number(m[1]) } };
    }
    case "number": {
      const unit = q.unit ? q.unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
      const m = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*(${unit || "(?!)"})?$`, "i").exec(typed);
      if (!m) return bad(`type a number${q.unit ? ` in ${q.unit}` : ""} (for example 700), or "skip"`);
      return { ok: true, answer: { kind: "number", value: Number(m[1]) } };
    }
    case "json": {
      try {
        return { ok: true, answer: { kind: "json", value: JSON.parse(typed) } };
      } catch {
        return bad('type a JSON value, for example true, 3, "done" (with the quotes) or {"ok": true}; or "skip"');
      }
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
