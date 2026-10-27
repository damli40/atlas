// D19: on the Moonwell pull request, Muse Spark gets exactly what the person sees on screen before
// betting. No more, no less.
//
// Plain words:
// - This file builds that "what the bettor sees" text ONCE. The web bet screen renders it, and the
//   server puts the same string in Spark's bet-only prompt, so the two cannot drift apart.
// - It holds everything the screen shows or lets the person open before sealing: the pull request
//   line (ref, title, merge commit, file count, fingerprint, licences), what the experiment does
//   (Level 2 or Level 1) and its caption, the fork block number and the time that block was made, the
//   question and its unit, the tolerance rule, and the WHOLE chosen file with line numbers, the
//   chosen lines marked (v2, after the first version gave only the chosen lines).
// - It never holds a model's claim sentence (D18), any value after the proposal is applied, the run's own
//   reads, or the reference the judge compares against. It takes no input that could carry them.
// - D22: it does hold a small fixed set of chain facts read by plain code at block 42194662, BEFORE the
//   proposal ran (src/chain-facts.ts): the oracle's cbETH price then, the feed it was wired to, the raw
//   Chainlink answers with their decimals, and the block's timestamp. The person sees them on screen and
//   every model gets them in its prompt, from the same object. Plus one bet instruction, the same for all.
// - The block times were read once from Base (eth_getBlockByNumber, field `timestamp`) on 2026-10-27
//   through the RPC in ~/.config/atlas/rpc.env. They are fixed facts of the chain, so they are stored
//   here, never guessed and never read at run time.

import { LEVEL2_CAPTION, level1Caption } from "./captions";
import { BET_INSTRUCTION, chainFactsLines, type ChainFactsResult } from "./chain-facts";
import { MOONWELL_LEVEL1_BLOCK, MOONWELL_LEVEL2_BLOCK } from "./moonwell-blocks";
import type { Finding } from "./types";
import { plural } from "./words";

export type MoonwellLevel = "level2" | "level1";

/** The two fork blocks a Moonwell round can use, with each block's on-chain timestamp (Unix seconds). */
export const MOONWELL_FORK_BLOCKS = {
  /** One block before MIP-X43 ran (Level 2). Timestamp read from Base on 2026-10-27. */
  level2: { block: MOONWELL_LEVEL2_BLOCK, timestamp: 1771178671 },
  /** The block MIP-X43 ran in (Level 1). Timestamp read from Base on 2026-10-27. */
  level1: { block: MOONWELL_LEVEL1_BLOCK, timestamp: 1771178673 },
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

/** The caption each level carries on screen (and in its .atlas.json). */
export const MOONWELL_LEVEL_CAPTION: Record<MoonwellLevel, string> = {
  level2: LEVEL2_CAPTION,
  level1: level1Caption(MOONWELL_FORK_BLOCKS.level1.block),
};

/** The licence line the screen shows under the pull request. */
export const MOONWELL_LICENCE_LINE = "Moonwell's files: BSD-3-Clause; mip-x43.sol GPL-3.0-or-later (notices kept in contracts/lib/moonwell).";

export interface BetContextInput {
  level: MoonwellLevel;
  /** The pull request line the screen shows: ref, title, merge commit, file count, fingerprint. Never its description (not on screen). */
  pr: { ref: string; title: string; commit?: string; fileCount: number; codeSha256: string };
  /** The whole text of the chosen finding's file, exactly as Atlas read it (the screen's file viewer shows it all). */
  fileText: string;
  /** The plain-code question (src/gate.ts): its text, unit and tolerance. */
  question: { text: string; unit?: string; tolerancePct?: number };
  /** The chosen finding: where it is and who chose it. Its claim sentence is never read. */
  finding: Pick<Finding, "file" | "lineStart" | "lineEnd" | "proposedBy">;
  /**
   * D22: the chain facts read at block 42194662 before the proposal ran (or why there are none). Always from
   * that block, whatever the level: src/chain-facts.ts refuses facts from any other block.
   */
  chainFacts?: ChainFactsResult;
}

/** Who chose the lines, in the same words for the screen and the prompt. Never a claim. */
export function chosenBy(f: Pick<Finding, "proposedBy">): string {
  return f.proposedBy.role === "human" ? "picked by a person" : `found by ${f.proposedBy.model}`;
}

/**
 * The whole chosen file, one line per file line, as the screen's file viewer numbers it. The chosen
 * lines are marked with ">" (the viewer highlights them); every other line starts with two spaces.
 * The viewer drops the empty piece after a final newline, and so does this.
 */
export function numberedFile(fileText: string, chosen: { lineStart: number; lineEnd: number }): string {
  const lines = fileText.split("\n");
  if (fileText.endsWith("\n")) lines.pop();
  return lines.map((l, i) => `${i + 1 >= chosen.lineStart && i + 1 <= chosen.lineEnd ? ">" : " "} ${i + 1}| ${l}`).join("\n");
}

/**
 * The text a person sees on the Moonwell screen (or can open there) before sealing a bet, and the
 * only context about the round that Spark's bet-only prompt gets. Pure: the same input always gives
 * the same string.
 */
export function moonwellBetContext(input: BetContextInput): string {
  const fork = MOONWELL_FORK_BLOCKS[input.level];
  const f = input.finding;
  const p = input.pr;
  const lines = f.lineStart === f.lineEnd ? `line ${f.lineStart}` : `lines ${f.lineStart}-${f.lineEnd}`;
  const unit = input.question.unit ?? "USD";
  const commit = p.commit ? ` · merge commit ${p.commit.slice(0, 10)}` : "";
  return [
    `Pull request: ${p.ref} · ${p.title}${commit} · ${plural(p.fileCount, "file")} · code fingerprint ${p.codeSha256.slice(0, 12)}…`,
    MOONWELL_LICENCE_LINE,
    `What will run: ${MOONWELL_LEVEL_SAYS[input.level]}`,
    `Read with this run: ${MOONWELL_LEVEL_CAPTION[input.level]}`,
    `Fork block: ${fork.block} on Base, made at ${blockTimeUtc(fork.timestamp)}.`,
    ...chainFactsLines(input.chainFacts),
    `Question: ${input.question.text}`,
    `Answer in: ${unit}.`,
    `Matched means within ${input.question.tolerancePct ?? 10}% of what the run reads.`,
    `How to bet: ${BET_INSTRUCTION}`,
    `The code this round works on (${chosenBy(f)}): ${f.file}, ${lines}, marked ">" below.`,
    `The whole file, ${f.file}, numbered as on screen:`,
    numberedFile(input.fileText, f),
  ].join("\n");
}
