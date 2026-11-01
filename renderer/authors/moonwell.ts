// R3 author (e): the Moonwell price flow, from one recorded run only.
//
// Plain words: the run says which feed the price came through, how many price sources it counted, the price the oracle
// reported, and a reference plain code computed at the same block. The drawing is exactly that. The multiply step is shown
// as missing only because the run counted one price source; the dashed outline is what the bettors expected and says
// nothing about the code (the same rule as the old price pipe). The caption is the allowed wording in CLAUDE.md.
// Pure; imports types, src/trust.ts and src/units.ts.

import { LEVEL2_CAPTION, level1Caption } from "../../src/captions";
import { MOONWELL_LEVEL1_BLOCK, MOONWELL_LEVEL2_BLOCK } from "../../src/moonwell-blocks";
import { notShownAsFact } from "../../src/trust";
import type { Bet, Run, Verdict } from "../../src/types";
import { formatUsd1e18 } from "../../src/units";
import type { RenderSpec, SpecMark, SpecNode, SpecStep } from "../spec";

/** The only allowed sentence about the incident (CLAUDE.md). */
export const MOONWELL_ALLOWED_WORDS = "Moonwell took $1.78M in bad debt from one oracle setting that skipped a multiplication. The pull request that shipped it had commits co-authored by an AI model.";

export interface MoonwellInput {
  run: Pick<Run, "id" | "trace" | "result" | "controlPassed" | "forkBlock" | "experimentId">;
  bets?: Pick<Bet, "id" | "who" | "measures" | "answer">[];
  verdicts?: Pick<Verdict, "betId" | "outcome" | "reason">[];
  symbol?: string;
  /** Captions the proof file says must be shown ("fork of Base one block before…"). */
  fileCaptions?: string[];
  seed?: string;
  /** Where the run came from, only when the caller knows (review B5). */
  origin?: "this-run" | "proof-file";
  /** D20's file: this run is from before the change, and the file's captions are about the re-run. The drawing says which it shows. */
  beforeChange?: boolean;
}

const isUint = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

export function moonwellFlow(input: MoonwellInput): RenderSpec {
  const symbol = input.symbol ?? "cbETH";
  const base: RenderSpec = {
    version: 1,
    stage: "after-run",
    seed: input.seed ?? `moonwell:${input.run.id}`,
    kicker: input.beforeChange ? "Moonwell, MIP-X43, on a fork, before the change" : "Moonwell, MIP-X43, replayed on a fork",
    title: `1 ${symbol}`,
    subtitle: "what the oracle reported, and how it got there",
    nodes: [],
    edges: [],
    regions: [],
    marks: [],
    captions: [],
    steps: [],
  };
  const why = notShownAsFact(input.run);
  if (why !== null) return { ...base, notShown: why };
  const m = input.run.result.measured;
  const priceRaw = m[`priceUsd1e18:${symbol}`];
  const refRaw = input.run.result.references?.[`refUsd1e18:${symbol}`];
  if (!isUint(priceRaw)) return { ...base, notShown: `this run did not read a price for ${symbol}: ${input.run.result.notMeasured[`priceUsd1e18:${symbol}`] ?? "not measured"}` };
  const count = typeof m[`priceSources:${symbol}`] === "number" ? (m[`priceSources:${symbol}`] as number) : null;
  const feedWords = typeof m[`feedDescription:${symbol}`] === "string" ? (m[`feedDescription:${symbol}`] as string) : "the feed this read went through";
  const price = formatUsd1e18(BigInt(priceRaw));

  const usdBets = (input.bets ?? []).filter((b) => b.measures === `priceUsd1e18:${symbol}`);
  // The note goes first, so the feed sits in the middle of the top row and its thread runs straight down.
  const nodes: SpecNode[] = [];
  // Only an answer that expected the multiply step can say it is missing: the 2-source price, or any price but the one read.
  const expectedStep = usdBets.some((b) => b.answer.kind !== "declined" && (input.verdicts ?? []).find((v) => v.betId === b.id)?.outcome === "not_matched");
  if (count === 1 && expectedStep) nodes.push({ id: "gear", kind: "note", words: "the multiply step the bettors expected is not there", provenance: "run", missing: true });
  nodes.push({ id: "feed", kind: "device", words: feedWords, provenance: "run" });
  const edges: RenderSpec["edges"] = [];
  const steps: SpecStep[] = [{ id: "s0", nodes: ["feed"], edges: [], provenance: "run", beat: "start", words: `the price read went through ${feedWords}` }];
  const sourceWords = count === null ? `the source count was not measured: ${clipReason(input.run.result.notMeasured[`priceSources:${symbol}`])}` : `${count} price source${count === 1 ? "" : "s"}`;
  nodes.push({ id: "price", kind: "ticket", words: `the oracle reported ${price}`, small: `at block ${input.run.forkBlock ?? "?"}`, provenance: "run", pin: count === 1 ? "red" : "blue" });
  edges.push({ id: "e-price", from: "feed", to: "price", words: sourceWords, kind: "thread", provenance: "run" });
  steps.push({ id: "s1", nodes: ["price"], edges: ["e-price"], provenance: "run", beat: "end", words: `the oracle reported ${price}` });
  if (count === 1 && expectedStep) {
    edges.push({ id: "e-gear", from: "gear", to: "price", kind: "dashed-note", provenance: "run" });
    steps.push({ id: "s2", nodes: ["gear"], edges: ["e-gear"], provenance: "run", beat: "note" });
  }
  if (isUint(refRaw?.value)) {
    const refWords = formatUsd1e18(BigInt(refRaw.value));
    nodes.push({ id: "ref", kind: "ticket", words: `reference ${refWords}`, small: "plain code, same block", provenance: "run", pin: "blue" });
    edges.push({ id: "e-ref", from: "ref", to: "price", words: clipMethod(refRaw.method), kind: "dashed-note", provenance: "run" });
    steps.push({ id: "s3", nodes: ["ref"], edges: ["e-ref"], provenance: "run", beat: "note", words: `reference ${refWords}` });
  }
  const level = levelCaption(input.run.forkBlock);
  const marks: SpecMark[] = [];
  for (const b of usdBets) {
    const v = (input.verdicts ?? []).find((x) => x.betId === b.id);
    const who = b.who === "human" ? "you" : b.who.replace(/^model:/, "").replace(/^meta-models\//, "");
    if (!v) continue;
    if (v.outcome === "cant_check") marks.push({ on: "price", kind: "cant-check", who, words: b.answer.kind === "declined" ? "declined to guess" : `can't check: ${v.reason ?? "not measured"}` });
    else {
      const said = b.answer.kind === "number" || b.answer.kind === "integer" ? `said $${b.answer.value.toLocaleString("en-US")}` : "answered";
      marks.push({ on: "price", kind: v.outcome === "matched" ? "matched" : "didnt-match", who, words: said });
    }
  }
  return {
    ...base,
    nodes,
    edges,
    steps,
    marks,
    path: { edges: ["e-price"], provenance: "run", ...(marks.some((k) => k.kind === "didnt-match") ? { partsWaysAt: "price" } : {}) },
    captions: [
      { words: MOONWELL_ALLOWED_WORDS, provenance: "plain-code" },
      // The file's captions already hold the Level words on a proof card, so they appear once.
      ...[...new Set([...(level !== null ? [level] : []), ...(input.fileCaptions ?? [])])].map((words) => ({ words, provenance: "run" as const })),
      { words: `Every number comes from run ${input.run.id}.${input.origin === "proof-file" ? " Read back from its saved proof file." : input.origin === "this-run" ? " This run just happened on a fork." : ""} Atlas shows what the code did; it does not judge it.`, provenance: "run" },
    ],
  };
}

const clipReason = (why: string | undefined) => {
  const w = why ?? "the run did not report it";
  return w.length > 80 ? `${w.slice(0, 79)}…` : w;
};

/** The Level words come from the run's fork block, never from which button was pressed or from its trace. */
function levelCaption(block: number | undefined): string | null {
  if (block === MOONWELL_LEVEL2_BLOCK) return LEVEL2_CAPTION;
  if (block === MOONWELL_LEVEL1_BLOCK) return level1Caption(MOONWELL_LEVEL1_BLOCK);
  return null;
}

function clipMethod(method: string): string {
  const short = method.split(" at block")[0]!;
  return short.length > 44 ? `${short.slice(0, 43)}…` : short;
}
