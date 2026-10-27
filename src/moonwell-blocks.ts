// The two Base fork blocks a Moonwell round can use, as plain numbers. No imports: the runner
// (runners/evm/moonwell-base.ts), the bet screen (src/bet-context.ts) and the pure price-pipe model
// (web/machines/pricepipe/model.ts) all read them from here, so the three cannot drift apart.
// A fork "at N" holds the state AFTER block N. MIP-X43 executed on Base in block 42194663.

/** One block before the proposal ran: Level 2 ("before ship"). */
export const MOONWELL_LEVEL2_BLOCK = 42194662;
/** The block the proposal ran in: Level 1 ("after the fact"). */
export const MOONWELL_LEVEL1_BLOCK = 42194663;
