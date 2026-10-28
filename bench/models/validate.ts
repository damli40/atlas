// B1 (D35) bench M: checks a model's answer for one pasted test. Pure.
//
// Plain words: the product's bet-only check (server/meta/roles/claimant-bets.ts validateBetOnlyOutput) uses the
// schema in server/meta/schemas.ts, whose answer kinds are integer, number, enum and declined. It has NO "json"
// kind, so it refuses every bet on returnedJson, the question pasted rounds ask (found while building this bench;
// reported for batch E3). This check is the same in every other way (same zod schemas for the other kinds, the
// same one-bet-per-question / kind / unit / tolerance / options rules via validateBetsFor) and adds the "json"
// kind, with the same value limits a person's json bet has (jsonBetValueProblem: plain JSON, depth, size).

import { z } from "zod";
import { betAnswerSchema, zodReason } from "../../server/meta/schemas.ts";
import { validateBetsFor, zodSafeReason } from "../../server/meta/roles/claimant.ts";
import { jsonBetValueProblem } from "../../src/seal.ts";
import type { Question } from "../../src/gate.ts";

const jsonAnswerSchema = z.strictObject({ kind: z.literal("json"), value: z.unknown() }).superRefine((a, ctx) => {
  if (!Object.prototype.hasOwnProperty.call(a, "value")) {
    ctx.addIssue({ code: "custom", message: "a json bet needs a value" });
    return;
  }
  const why = jsonBetValueProblem(a.value);
  if (why) ctx.addIssue({ code: "custom", message: why });
});

export const pastedBetsSchema = z.strictObject({
  bets: z
    .array(
      z.strictObject({
        measures: z.string().min(1).max(100),
        answer: z.union([betAnswerSchema, jsonAnswerSchema]),
        rationale: z.string().min(1).max(1000),
      }),
    )
    .min(1)
    .max(20),
});

export function validatePastedBets(content: string, questions: readonly Question[]) {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false as const, error: "the answer is not valid JSON", safe: "the answer is not valid JSON" };
  }
  const parsed = pastedBetsSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false as const, error: `the answer does not match the schema (${zodReason(parsed.error)})`, safe: `the answer does not match the schema (${zodSafeReason(parsed.error)})` };
  }
  return validateBetsFor(questions, parsed.data.bets as Parameters<typeof validateBetsFor>[1]);
}
