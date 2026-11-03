// R10 (D72): the open example. Anyone on the hosted site can play the first screen's example with no invite code.
//
// Plain words on how it stays safe:
// - The gate (gate.ts EXAMPLE_ROUTES) lets a request with no code reach only the few routes the example's round uses, and
//   runs it as the "example" principal (context.ts). Nothing the browser sends can make a request "the example".
// - Each of those routes then checks the CONTENT against what the server holds itself: the example file's fingerprint
//   (sha256 of its exact bytes), its one function, the kept test set, the default question, and the recorded AI answers
//   (each replayed only when the prompt it would get now is byte for byte the prompt it was recorded from). Anything
//   else is refused with OWN_CODE_NEEDS_INVITE before any model is asked or anything runs.
// - If the recorded answers no longer replay (the example's text changed), the round is refused with REPLAY_MISMATCH.
//   It never falls through to a live model call.
// - Behind all of that, the ledger (ledger.ts) refuses the "example" principal any model call or EVM run, and caps its
//   sandboxes at once. The example's runs are also limited per address and per hour in total (server/app.ts).

import type { Context } from "hono";
import { currentPrincipal } from "./context";
import { makePastedTarget } from "../../src/pasted-code";
import { U1_EXAMPLE } from "../../web/u1-example";

/** The example file's fingerprint: the server's own copy, never the request's word. */
export const EXAMPLE_SHA = makePastedTarget(U1_EXAMPLE, "ts").codeSha256;
/** The one function the example's round is about (a test holds this to the page's own default). */
export const EXAMPLE_FUNCTION = "fetchWithRetry";

// DAMI: placeholder wording (all three sentences). The facts each must keep: nothing ran, no AI was asked, and why.
/** A visitor with no code asked for something beyond the example. The page adds "Join the waitlist" and "I have a code". */
export const OWN_CODE_NEEDS_INVITE = "Your own code, and anything beyond the example, needs an invite code, so nothing was run and no AI was asked.";
/** The example's recorded AI answers do not fit the text the bettors would get now. */
export const REPLAY_MISMATCH = "The AI answers recorded for the example no longer match its question, so Atlas stopped here: no AI was asked and nothing ran. With an invite code the AIs answer live.";

/** The 401 a visitor with no code gets when they reach past the example. Same shape as the gate's own 401. */
export const refuseOwnCode = (c: Context, words: string = OWN_CODE_NEEDS_INVITE) => {
  // A code was sent but no longer works (revoked, made up): say why, as the gate's own 401 does.
  const p = currentPrincipal();
  const problem = p?.kind === "example" ? p.codeProblem : undefined;
  return c.json({ error: problem ? `${words} (${problem})` : words, invite: { required: true, page: "/invite" } }, 401);
};
/** The example's recorded answers do not replay: 503, nothing asked, nothing run. */
export const refuseMismatch = (c: Context) => c.json({ error: REPLAY_MISMATCH }, 503);
