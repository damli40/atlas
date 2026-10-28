// E3: pasted code goes ONLY to Meta models that do not train on their inputs.
//
// Plain words: a "contributor" model id (for example muse-spark-1.3-contributor) is about 95% cheaper, but Meta
// may train on what it receives. The client (server/meta/client.ts modelRefusal) already refuses such ids unless
// ATLAS_ALLOW_CONTRIBUTOR=1 is set, a switch meant for PUBLIC code only. Judges' pasted code is not public, so
// every model call that carries pasted code goes through this guard, which refuses a contributor id EVEN WHEN
// that switch is on, and refuses any id the client would refuse. The call is never made: the wrapped chat is not
// called, so nothing is sent and nothing is spent.

import { DEFAULT_MAX_TOKENS, RETRY_MAX_TOKENS, modelRefusal, priceFor, shownModelId, type ChatArgs, type ChatResult } from "./client";

/**
 * E3 review M5: the longest prompt a call carrying pasted code may send (characters, all messages together). About
 * 40k tokens; a 2,000-line paste with its numbering and the bet text fits well under it.
 */
export const MAX_PASTED_PROMPT_CHARS = 160_000;
/**
 * E3 review M5: the most one call may cost, estimated BEFORE it is sent: every prompt character counted as a token
 * (an over-count), plus the largest output the client may ask for (one retry at RETRY_MAX_TOKENS), at the model's price.
 */
export const MAX_PASTED_CALL_USD = 2;

/** The upper-bound cost of one call, before it is sent. */
export function estimatedCallUsd(args: Pick<ChatArgs, "model" | "messages" | "maxTokens">): number {
  const { price } = priceFor(args.model);
  const inTokens = args.messages.reduce((n, m) => n + m.content.length, 0);
  const outTokens = (args.maxTokens ?? DEFAULT_MAX_TOKENS) + RETRY_MAX_TOKENS;
  return (inTokens * price.inPerM + outTokens * price.outPerM) / 1_000_000;
}

/**
 * X1 (shared with E3): why this model id may not read code (null when it may). Independent of
 * ATLAS_ALLOW_CONTRIBUTOR. `what` names the code in the reason ("pasted code", "a codebase").
 */
export function codeModelRefusal(model: string, what = "code"): string | null {
  if (/contributor/i.test(model)) {
    return `${shownModelId(model)} is a contributor model (Meta may train on its inputs); ${what} is never sent to one, whatever ATLAS_ALLOW_CONTRIBUTOR says`;
  }
  // The client's own rule, with the contributor switch forced off.
  return modelRefusal(model, {});
}

/** Why this model id may not read pasted code (null when it may). */
export const pastedCodeModelRefusal = (model: string): string | null => codeModelRefusal(model, "pasted code");

export interface CodeGuardLimits {
  /** Names the code in every reason ("pasted code", "a codebase"). */
  what: string;
  maxPromptChars: number;
  maxCallUsd: number;
}

/**
 * X1 (shared with E3): wraps a chat function so a call carrying code can only reach a non-contributor Meta model,
 * with a prompt no longer than `maxPromptChars` and an upper-bound cost no higher than `maxCallUsd`. A refused call
 * is never sent: the wrapped chat is not called, so nothing is spent and no limit is counted.
 */
export function guardCodeChat(chat: (args: ChatArgs) => Promise<ChatResult>, limits: CodeGuardLimits): (args: ChatArgs) => Promise<ChatResult> {
  return async (args) => {
    const refused = codeModelRefusal(args.model, limits.what);
    if (refused) return { ok: false, reason: refused, notSent: true };
    const chars = args.messages.reduce((n, m) => n + m.content.length, 0);
    if (chars > limits.maxPromptChars) return { ok: false, reason: `the prompt would be ${chars} characters; a call carrying ${limits.what} may send at most ${limits.maxPromptChars}`, notSent: true };
    const usd = estimatedCallUsd(args);
    if (usd > limits.maxCallUsd) return { ok: false, reason: `the call could cost up to $${usd.toFixed(2)}; a call carrying ${limits.what} may cost at most $${limits.maxCallUsd}`, notSent: true };
    return chat(args);
  };
}

/** Wraps a chat function so a call carrying pasted code can only reach a non-contributor Meta model. */
export function guardPastedChat(chat: (args: ChatArgs) => Promise<ChatResult>): (args: ChatArgs) => Promise<ChatResult> {
  return guardCodeChat(chat, { what: "pasted code", maxPromptChars: MAX_PASTED_PROMPT_CHARS, maxCallUsd: MAX_PASTED_CALL_USD });
}
