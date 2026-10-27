// The Moonwell level captions, in a module with no Node imports (the web page imports it through
// src/bet-context.ts; src/atlasfile.ts re-exports both, so every caller sees the same text).

/** Caption for a Level 2 run (fork before the proposal, actions applied). Same text as runners/evm/level2.ts LEVEL2_CAPTION. */
export const LEVEL2_CAPTION = "fork of Base one block before MIP-X43 ran; Atlas applied the proposal's oracle-feed actions as the governor";
/** Caption for a Level 1 run (read after the proposal ran). Never "caught before shipping". */
export const level1Caption = (forkBlock: number) => `re-run after the fact, on a fork of Base at block ${forkBlock}`;

/**
 * Final review S5: the header every Level 2 screen and proof card shows. It names what Atlas applied on the
 * fork: the proposal's oracle-feed actions, counted from the run (14 for MIP-X43), and nothing else of the
 * proposal (runners/evm/level2.ts LEVEL2_NOT_APPLIED). A header is drawn from the run each time it is shown and
 * is not stored in the .atlas.json, so files written before this wording verify unchanged.
 */
export const level2Header = (applied?: number) =>
  `Level 2: fork one block before the proposal ran; the proposal's ${applied !== undefined ? `${applied} ` : ""}oracle-feed actions applied`;

/** How many oracle-feed actions a Level 2 run applied, from the run's own record (undefined when it does not say). */
export function appliedFeedActions(run: { result: { measured: Record<string, unknown> }; trace: { event: string; data?: Record<string, unknown> }[] }): number | undefined {
  const m = run.result.measured.appliedFeedActions;
  if (typeof m === "number" && Number.isSafeInteger(m) && m >= 0) return m;
  const ev = run.trace.find((t) => t.event === "proposal_derived")?.data?.count;
  return typeof ev === "number" && Number.isSafeInteger(ev) && ev >= 0 ? ev : undefined;
}

/**
 * Final review M5: shown when a Level 2 run's fork recorded different FeedSet events than the actions Atlas
 * derived from the proposal's files (`forkEventsEqualDerived: false`). The control and verdicts do not read
 * that field; this line makes sure a person does.
 */
export const FORK_EVENTS_WARNING =
  "warning: the oracle-feed changes the fork recorded are not the ones Atlas derived from the proposal's files, so this run may not show what the proposal does";
export const forkEventsWarning = (run: { result: { measured: Record<string, unknown> } }): string | null =>
  run.result.measured.forkEventsEqualDerived === false ? FORK_EVENTS_WARNING : null;

/**
 * D21: shown under the scoreboard wherever it is drawn (verdict screens, proof card, any end frame). The mark is
 * the Atlas logo, which existed before the hackathon (PRE-EXISTING.md); the code that draws it from the
 * verdicts was built during it. Rendered by web/machines/scoreboard/Scoreboard.tsx, so no screen can leave it out.
 */
export const MARK_PRE_EXISTING_CAPTION =
  "Mark: the Atlas logo, designed Oct 26 (pre-existing). The scoreboard that draws it from the verdicts was built during the hackathon.";
