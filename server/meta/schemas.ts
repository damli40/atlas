// Zod schemas for what Meta models return. Shape only: the meaning checks (is the experiment
// allowed, does each bet answer a question, in the right kind and unit) happen in the role that
// uses the schema, with src/gate.ts deciding the experiment.

import { z } from "zod";

/** A bet's answer, exactly the BetAnswer union in src/types.ts. Extra keys are refused. */
export const betAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("integer"), value: z.number() }),
  z.strictObject({ kind: z.literal("number"), value: z.number(), tolerancePct: z.number(), unit: z.string().min(1).max(20) }),
  z.strictObject({ kind: z.literal("enum"), value: z.string().min(1).max(100), options: z.array(z.string().max(100)).min(1).max(20) }),
  // E3: a JSON bet (returnedJson). Its value is checked by plain code (depth, plain JSON, size) where it is used.
  z.strictObject({ kind: z.literal("json"), value: z.unknown() }),
  // A declined bet must say why in words: "unknown: <why>". Blank or only spaces is refused.
  z.strictObject({ kind: z.literal("declined"), reason: z.string().trim().min(1).max(500).regex(/\w/, "a declined bet needs a reason in words") }),
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

/**
 * The Adversary's answer (D07-02): one experiment (checked by the gate, not here) and one or two
 * sentences on what its run could show. `why` is model-panel text only.
 */
export const adversaryOutputSchema = z.strictObject({
  experiment: z.record(z.string(), z.unknown()),
  why: z.string().trim().min(1).max(600),
});

/**
 * E3: Muse Wonder's answer in the paste flow: up to 3 call-function experiments for the chosen export (each checked
 * by the gate, not here; a refused one is kept and shown) and one short claim sentence (model panel only, never in
 * any bettor's prompt, never a verdict).
 */
export const proposerOutputSchema = z.strictObject({
  claim: z.string().trim().min(1).max(400),
  experiments: z.array(z.record(z.string(), z.unknown())).min(1).max(3),
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
