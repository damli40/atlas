// Shared stand-ins for the days 3–4 review tests: the Moonwell PR (from the committed copy), the
// live D04-04 Level 2 file, and one Level 2 round driven through the real server in-process.
// No network, no anvil, no model (modelBets off).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, type AppOptions } from "../../server/app";
import { createProofStore } from "../../server/evm-round";
import { createAgentLog } from "../../server/log/agentlog";
import type { GithubPrTarget } from "../../server/targets/github";
import { PR578_CODE_SHA256 } from "../../runners/evm/moonwell-base";
import type { AtlasFile, Experiment, Run } from "../../src/types";

const ROOT = join(import.meta.dirname, "..", "..");
const COPY = join(ROOT, "contracts", "lib", "moonwell");
export const LIVE_LEVEL2_PATH = join(ROOT, "tests", "evidence", "D04-04", "superseded", "moonwell-level2-fKqHGIIi2_.json");
export const liveLevel2 = (): AtlasFile => JSON.parse(readFileSync(LIVE_LEVEL2_PATH, "utf8"));

const prFile = (path: string) => {
  const content = readFileSync(join(COPY, path), "utf8");
  return { path, status: "modified", sha256: "0".repeat(64), sizeBytes: content.length, binary: false, content, lines: content.split("\n").length };
};
export const PR: GithubPrTarget = {
  target: { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578", commit: "9a6738e189fa903bffa0abf10b9dd7ed2fe73a18", codeSha256: PR578_CODE_SHA256 },
  files: ["chains/8453.json", "proposals/ChainlinkOracleConfigs.sol", "proposals/mips/mip-x43/mip-x43.sol"].map(prFile),
  skipped: [],
  changedFiles: 6,
  title: "MIP-X43",
  description: "d",
  mergedAt: "2026-02-10T18:58:44Z",
};

let n = 0;
/** The live Level 2 run, re-labelled for this experiment, with its control failed (or not). */
export function liveRunFor(exp: Experiment, controlPassed = true): Run {
  const run = structuredClone(liveLevel2().runs[0]!);
  const now = new Date().toISOString();
  Object.assign(run, { id: `rv${++n}x${Date.now().toString(36)}`, experimentId: exp.id, startedAt: now, finishedAt: now });
  if (!controlPassed) {
    run.controlPassed = false;
    run.result.notMeasured.control = "WETH control did not match";
    const ev = run.trace.find((t) => t.event === "control_matched");
    if (ev) ev.event = "control_did_not_match";
  }
  return run;
}

export type Answer = { status: number; body: any; text: string };

/** One Level 2 round on the PR through the real server. `evmRun` stands in for the fork. */
export async function level2Round(evmRun: NonNullable<AppOptions["evmRun"]>, extra: Partial<AppOptions> = {}, session = "rv") {
  const agentLog = createAgentLog();
  const app = createApp({ fetchPr: async () => PR, evmRun, proofs: createProofStore({ publish: false }), agentLog, ...extra });
  const h = { "content-type": "application/json", "x-atlas-session": session };
  const ask = async (path: string, body?: unknown): Promise<Answer> => {
    const res = await app.request(path, body === undefined ? { headers: h } : { method: "POST", headers: h, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed, text };
  };
  const t = (await ask("/targets", { kind: "github-pr", ref: PR.target.ref })).body;
  const f = (await ask("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 41, lineEnd: 43 })).body.finding;
  const e = (await ask("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id })).body;
  await ask("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
  const r = await ask("/runs", { experimentId: e.experiment.id });
  const file = r.status === 200 ? ((await ask(`/proofs/${r.body.run.id}`)).body as AtlasFile) : undefined;
  return { app, ask, r, file, agentLog, session };
}
