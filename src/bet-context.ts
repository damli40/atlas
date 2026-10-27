// D19: on the Moonwell pull request, Muse Spark gets exactly what the person sees on screen before
// betting. No more, no less.
//
// Plain words:
// - This file builds that "what the bettor sees" text ONCE. The web bet screen renders it, and the
//   server puts the same string in Spark's bet-only prompt, so the two cannot drift apart.
// - It holds: what the experiment does (Level 2 or Level 1), the fork block number and the time that
//   block was made, the question and its unit, the tolerance rule, and the code lines of the chosen
//   finding (file, line numbers, the lines themselves).
// - It never holds a model's claim sentence (D18), a live price, a reference value or a feed answer:
//   the person sees none of those before the run either. It takes no input that could carry them.
// - The block times were read once from Base (eth_getBlockByNumber, field `timestamp`) on 2026-10-27
//   through the RPC in ~/.config/atlas/rpc.env. They are fixed facts of the chain, so they are stored
//   here, never guessed and never read at run time.

import type { Finding } from "./types";

export type MoonwellLevel = "level2" | "level1";

/** The two fork blocks a Moonwell round can use, with each block's on-chain timestamp (Unix seconds). */
export const MOONWELL_FORK_BLOCKS = {
  /** One block before MIP-X43 ran (Level 2). Timestamp read from Base on 2026-10-27. */
  level2: { block: 42194662, timestamp: 1771178671 },
  /** The block MIP-X43 ran in (Level 1). Timestamp read from Base on 2026-10-27. */
  level1: { block: 42194663, timestamp: 1771178673 },
} as const;

/** What each level does, in the words the screen shows beside its radio button. */
export const MOONWELL_LEVEL_SAYS: Record<MoonwellLevel, string> = {
  level2: `Fork Base at block ${MOONWELL_FORK_BLOCKS.level2.block}, one block before the proposal ran, apply the proposal's oracle-feed actions as the governor, then read the prices.`,
  level1: `Fork Base at block ${MOONWELL_FORK_BLOCKS.level1.block}, the block the proposal ran in, and read the price.`,
};

/** The level an EVM experiment shape belongs to, or undefined for a shape that is not a Moonwell level. */
export function moonwellLevelOf(shape: string): MoonwellLevel | undefined {
  if (shape === "apply-proposal-then-read") return "level2";
  if (shape === "price-read") return "level1";
  return undefined;
}

/** "2026-02-15 18:04:31 UTC" for a Unix timestamp in seconds. */
export function blockTimeUtc(timestamp: number): string {
  return `${new Date(timestamp * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")} UTC`;
}

export interface BetContextInput {
  level: MoonwellLevel;
  /** The plain-code question (src/gate.ts): its text, unit and tolerance. */
  question: { text: string; unit?: string; tolerancePct?: number };
  /** The chosen finding: where it is, the exact lines and who chose it. Its claim sentence is never read. */
  finding: Pick<Finding, "file" | "lineStart" | "lineEnd" | "quotedSnippet" | "proposedBy">;
}

/** Who chose the lines, in the same words for the screen and the prompt. Never a claim. */
export function chosenBy(f: Pick<Finding, "proposedBy">): string {
  return f.proposedBy.role === "human" ? "picked by a person" : `found by ${f.proposedBy.model}`;
}

/** The finding's own lines, numbered like the file: "42| <line>". */
function numberedLines(f: BetContextInput["finding"]): string {
  return f.quotedSnippet
    .split("\n")
    .map((l, i) => `${f.lineStart + i}| ${l}`)
    .join("\n");
}

/**
 * The text a person sees on the Moonwell bet screen before sealing a bet, and the only context about
 * the round that Spark's bet-only prompt gets. Pure: the same input always gives the same string.
 */
export function moonwellBetContext(input: BetContextInput): string {
  const fork = MOONWELL_FORK_BLOCKS[input.level];
  const f = input.finding;
  const lines = f.lineStart === f.lineEnd ? `line ${f.lineStart}` : `lines ${f.lineStart}-${f.lineEnd}`;
  const unit = input.question.unit ?? "USD";
  return [
    `What will run: ${MOONWELL_LEVEL_SAYS[input.level]}`,
    `Fork block: ${fork.block} on Base, made at ${blockTimeUtc(fork.timestamp)}.`,
    `Question: ${input.question.text}`,
    `Answer in: ${unit}.`,
    `Matched means within ${input.question.tolerancePct ?? 10}% of what the run reads.`,
    `The code this round works on (${chosenBy(f)}): ${f.file}, ${lines}`,
    numberedLines(f),
  ].join("\n");
}
