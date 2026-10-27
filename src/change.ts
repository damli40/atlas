// Wording for a change and its replay, shared by the server and the page. No imports, no I/O.
//
// Atlas never calls a change a repair of anything: the code changed toward what the bettors
// expected, and the same experiment ran again. The verdicts say whether the same bets matched.

/** The caption under every before/after view. Templated by plain code, never a model's words. */
export const CHANGE_CAPTION = "changed toward what you expected, then re-run";
export const BEFORE_LABEL = "Before change";
export const AFTER_LABEL = "After change";
