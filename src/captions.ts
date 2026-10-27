// The Moonwell level captions, in a module with no Node imports (the web page imports it through
// src/bet-context.ts; src/atlasfile.ts re-exports both, so every caller sees the same text).

/** Caption for a Level 2 run (fork before the proposal, actions applied). Same text as runners/evm/level2.ts LEVEL2_CAPTION. */
export const LEVEL2_CAPTION = "fork of Base one block before MIP-X43 ran; Atlas applied the proposal's oracle-feed actions as the governor";
/** Caption for a Level 1 run (read after the proposal ran). Never "caught before shipping". */
export const level1Caption = (forkBlock: number) => `re-run after the fact, on a fork of Base at block ${forkBlock}`;
