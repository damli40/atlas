// Zod schemas for what Meta models return. Shape only: the meaning checks (is the experiment
// allowed, does each bet answer a question, in the right kind and unit) happen in the role that
// uses the schema, with src/gate.ts deciding the experiment.

import { z } from "zod";

/** A bet's answer, exactly the BetAnswer union in src/types.ts. Extra keys are refused. */
export const betAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("integer"), value: z.number() }),
  z.strictObject({ kind: z.literal("number"), value: z.number(), tolerancePct: z.number(), unit: z.string().min(1).max(20) }),
  z.strictObject({ kind: z.literal("enum"), value: z.string().min(1).max(100), options: z.array(z.string().max(100)).min(1).max(20) }),
  z.strictObject({ kind: z.literal("declined"), reason: z.string().min(1).max(500) }),
]);

/** One model bet before sealing: which field, the answer, and why (shown in the model panel). */
export const claimantBetSchema = z.strictObject({
  measures: z.string().min(1).max(100),
  answer: betAnswerSchema,
  rationale: z.string().min(1).max(1000),
});

/**
 * The Claimant's whole answer. `experiment` is only checked to be an object here: the gate
 * (src/gate.ts) decides whether it is allowed, so a refusal carries the gate's own reason.
 */
export const claimantOutputSchema = z.strictObject({
  experiment: z.record(z.string(), z.unknown()),
  bets: z.array(claimantBetSchema).min(1).max(20),
});

/**
 * The Claimant's answer in bet-only mode: the experiment is already chosen (and allowed by the
 * gate), so the model returns only its bets, in the same bet schema.
 */
export const claimantBetsOnlySchema = z.strictObject({
  bets: z.array(claimantBetSchema).min(1).max(20),
});

export type ClaimantOutput = z.infer<typeof claimantOutputSchema>;
export type ClaimantBetOut = z.infer<typeof claimantBetSchema>;

/** A zod error as one plain sentence (at most three issues), for logs and the repair message. */
export function zodReason(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join(".") : "answer"}: ${i.message}`)
    .join("; ");
}
