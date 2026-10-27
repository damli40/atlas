// The Moonwell (github-pr) side of a round, and the .atlas.json store (D04-04).
//
// Plain words:
// - Atlas can run one pull request on the EVM runner today: moonwell-fi/moonwell-contracts-v2#578
//   (MIP-X43), at its merge commit. The runner applies the committed copy of the PR's files
//   (contracts/lib/moonwell), so a PR target is accepted only when the files fetched from GitHub hash
//   to exactly that copy's fingerprint. Anything else is refused with that reason.
// - The fork block comes from the experiment's shape, never from the request: Level 2
//   (apply-proposal-then-read) forks one block before the proposal ran; Level 1 (price-read) forks
//   the block it ran in.
// - The round asks ONE plain-code question, about cbETH (the template in src/gate.ts). The other
//   markets are still measured and shown in the false-alarm table; nobody bets on them.
// - Every completed round becomes an .atlas.json (src/atlasfile.ts). It is kept in memory, and
//   written to <dir>/<runId>/.atlas.json + run.json only when publishing is on (ATLAS_PUBLISH_PROOFS=1).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { GateContext } from "../src/gate";
import { chosenLineCaptions, investigatorWasAsked } from "../src/atlasfile";
import type { AgentEvent, AtlasFile, ExperimentShape, Finding } from "../src/types";
import { FORK_BLOCK, PR578_CODE_SHA256, TOUCHED_MARKETS } from "../runners/evm/moonwell-base";
import { planFromPrFiles } from "../runners/evm/apply";
import { MOONWELL_PR_578 } from "./targets/github";

export const MOONWELL_PR_REF = `${MOONWELL_PR_578.owner}/${MOONWELL_PR_578.repo}#${MOONWELL_PR_578.number}`;

/** What the gate allows on the Moonwell PR: the two EVM shapes that have a runner, over the 14 markets it touches. */
export const EVM_GATE_CONTEXT: GateContext = { shapes: ["apply-proposal-then-read", "price-read"], touchedMarkets: [...TOUCHED_MARKETS] };

/** The one market a Moonwell round asks about (src/gate.ts's apply-proposal-then-read template). */
export const ASKED_FIELD = "priceUsd1e18:cbETH";

/** Why a github-pr target cannot run on the EVM runner, or undefined when it can. */
export function evmTargetRefusal(ref: string, codeSha256: string, commit: string | undefined): string | undefined {
  if (ref.toLowerCase() !== MOONWELL_PR_REF.toLowerCase()) {
    return `Atlas runs one pull request on the EVM runner today: ${MOONWELL_PR_REF} (MIP-X43). ${ref} can be read, not run.`;
  }
  if (commit !== undefined && commit !== MOONWELL_PR_578.commit) return `the PR's merge commit is ${commit}, not ${MOONWELL_PR_578.commit}, the copy Atlas applies`;
  if (codeSha256 !== PR578_CODE_SHA256) return `the PR's files hash to ${codeSha256.slice(0, 12)}…, not the copy Atlas applies (${PR578_CODE_SHA256.slice(0, 12)}…)`;
  return undefined;
}

/** The fork block for an EVM shape. Throws for a shape the EVM runner does not run. */
export function forkBlockFor(params: ExperimentShape): number {
  if (params.shape === "apply-proposal-then-read") return FORK_BLOCK.beforeProposal;
  if (params.shape === "price-read") return FORK_BLOCK.proposalExecuted;
  throw new Error(`the EVM runner does not run "${params.shape}"`);
}

/**
 * Where the cbETH oracle-feed config sits in the PR: the `push(` line the plain-code parser found
 * (never hard-coded) through the line that closes it (the statement spans 3 lines in the file).
 */
export function cbEthConfigSpan(): { file: string; from: number; to: number } | undefined {
  const a = planFromPrFiles().find((x) => x.config.mTokenKey === "MOONWELL_cbETH");
  return a ? { file: "proposals/ChainlinkOracleConfigs.sol", from: a.config.line, to: a.config.line + 2 } : undefined;
}

/**
 * M7: the findings an .atlas.json records: the round's finding first, then every verified Investigator
 * finding on the same code (not the chosen one twice). src/atlasfile.ts chosenLineCaptions decides the
 * caption from exactly this list, here and again when the file is verified.
 */
export function recordedFindings(finding: Finding | undefined, investigatorFindings: readonly Finding[]): Finding[] {
  if (!finding) return [];
  return [finding, ...investigatorFindings.filter((f) => f.id !== finding.id && f.proposedBy.role === "investigator" && f.verified)];
}

/** `agentLog` is the log the .atlas.json will carry: "the Investigator was not asked" is read from it, as verify reads it. */
export const extraCaptionsFor = (finding: Finding | undefined, investigatorFindings: readonly Finding[], agentLog: readonly Pick<AgentEvent, "role" | "model">[]) =>
  chosenLineCaptions(recordedFindings(finding, investigatorFindings), investigatorWasAsked(agentLog));

/** The most lines a person may pick (the same limit the Investigator's places have). */
export const MAX_PICKED_LINES = 41;

/** A finding a person picked: file and lines checked against the file Atlas read; no claim. */
export function humanFinding(files: ReadonlyArray<{ path: string; text: string }>, file: string, lineStart: number, lineEnd: number): { ok: true; finding: Finding } | { ok: false; reason: string } {
  const f = files.find((x) => x.path === file);
  if (!f) return { ok: false, reason: `${file} is not a file of this target` };
  const lines = f.text.split("\n");
  const count = f.text.endsWith("\n") ? lines.length - 1 : lines.length;
  if (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart || lineEnd > count) {
    return { ok: false, reason: `lines ${lineStart}–${lineEnd} are not inside 1–${count} of ${file}` };
  }
  if (lineEnd - lineStart + 1 > MAX_PICKED_LINES) return { ok: false, reason: `pick at most ${MAX_PICKED_LINES} lines` };
  const quoted = lines.slice(lineStart - 1, lineEnd).join("\n");
  return {
    ok: true,
    finding: {
      id: nanoid(10),
      file,
      lineStart,
      lineEnd,
      kind: "other",
      claim: "",
      verified: true, // the quote IS those lines of the file Atlas read
      quotedSnippet: quoted,
      proposedBy: { role: "human", model: "none: picked by a person" },
    },
  };
}

// ---------- the .atlas.json store ----------

export interface ProofStore {
  put(file: AtlasFile, runJson: unknown): { published: boolean; error?: string };
  get(runId: string): AtlasFile | undefined;
  readonly publishing: boolean;
}

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * In memory always (the last MAX_KEPT files); on disk at <dir>/<runId>/.atlas.json and run.json only
 * when `publish` is true. Reads look in memory first, then on disk.
 */
export function createProofStore(opts: { publish: boolean; dir?: string; max?: number }): ProofStore {
  const kept = new Map<string, AtlasFile>();
  const max = opts.max ?? 200;
  return {
    publishing: opts.publish,
    put(file, runJson) {
      const runId = file.runs[0]!.id;
      kept.set(runId, file);
      while (kept.size > max) kept.delete(kept.keys().next().value!);
      if (!opts.publish || !opts.dir) return { published: false };
      if (!RUN_ID.test(runId)) return { published: false, error: `run id ${runId} is not safe as a folder name` };
      try {
        const d = join(opts.dir, runId);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, ".atlas.json"), JSON.stringify(file, null, 2) + "\n");
        writeFileSync(join(d, "run.json"), JSON.stringify(runJson, null, 2) + "\n");
        return { published: true };
      } catch (e) {
        return { published: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    get(runId) {
      if (!RUN_ID.test(runId)) return undefined;
      const mem = kept.get(runId);
      // Published files are read back from disk, so a replay starts from exactly what was written.
      if (mem && !(opts.publish && opts.dir)) return mem;
      if (!opts.dir) return undefined;
      const p = join(opts.dir, runId, ".atlas.json");
      if (!existsSync(p)) return mem;
      try {
        return JSON.parse(readFileSync(p, "utf8")) as AtlasFile;
      } catch {
        return mem;
      }
    },
  };
}
