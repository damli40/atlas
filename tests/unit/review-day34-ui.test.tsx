// Days 3–4 review, through the real server (in-process) and the real React table. Offline: GitHub
// and the fork are stand-ins built from the live D04-04 run; no model is asked (modelBets off).

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createProofStore } from "../../server/evm-round";
import type { GithubPrTarget } from "../../server/targets/github";
import { PR578_CODE_SHA256 } from "../../runners/evm/moonwell-base";
import { falseAlarmFromRun, type FalseAlarmRow } from "../../src/falsealarm";
import { verifyAtlasFile } from "../../src/atlasfile";
import type { AtlasFile, Experiment, Run } from "../../src/types";
import { FalseAlarmTable } from "../../web/screens/Moonwell";

const ROOT = join(import.meta.dirname, "..", "..");
const COPY = join(ROOT, "contracts", "lib", "moonwell");
const LIVE: AtlasFile = JSON.parse(readFileSync(join(ROOT, "tests", "evidence", "D04-04", "moonwell-level2-fKqHGIIi2_.atlas.json"), "utf8"));

const prFile = (path: string) => {
  const content = readFileSync(join(COPY, path), "utf8");
  return { path, status: "modified", sha256: "0".repeat(64), sizeBytes: content.length, binary: false, content, lines: content.split("\n").length };
};
const PR: GithubPrTarget = {
  target: { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578", commit: "9a6738e189fa903bffa0abf10b9dd7ed2fe73a18", codeSha256: PR578_CODE_SHA256 },
  files: ["chains/8453.json", "proposals/ChainlinkOracleConfigs.sol", "proposals/mips/mip-x43/mip-x43.sol"].map(prFile),
  skipped: [],
  changedFiles: 6,
  title: "MIP-X43",
  description: "d",
  mergedAt: "2026-02-10T18:58:44Z",
};

/** The live Level 2 run, re-labelled for this experiment, with its control failed (or not). */
function liveRunFor(exp: Experiment, controlPassed: boolean): Run {
  const run = structuredClone(LIVE.runs[0]!);
  const now = new Date().toISOString();
  Object.assign(run, { id: `r${Math.random().toString(36).slice(2, 10)}`, experimentId: exp.id, startedAt: now, finishedAt: now });
  if (!controlPassed) {
    run.controlPassed = false;
    run.result.notMeasured.control = "WETH control did not match";
    const ev = run.trace.find((t) => t.event === "control_matched");
    if (ev) ev.event = "control_did_not_match";
  }
  return run;
}

async function level2Round(controlPassed: boolean) {
  const app = createApp({ fetchPr: async () => PR, evmRun: async (exp) => liveRunFor(exp, controlPassed), proofs: createProofStore({ publish: false }) });
  const h = { "content-type": "application/json", "x-atlas-session": "rv" };
  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const t = (await post("/targets", { kind: "github-pr", ref: PR.target.ref })).body;
  const f = (await post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 41, lineEnd: 43 })).body.finding;
  const e = (await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id })).body;
  await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
  const r = await post("/runs", { experimentId: e.experiment.id });
  const file = (await (await app.request(`/proofs/${r.body.run.id}`, { headers: h })).json()) as AtlasFile;
  return { r, file };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
function render(rows: FalseAlarmRow[]): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<FalseAlarmTable rows={rows} />));
  return host;
}

describe("B1 through the server and the page", () => {
  it("POST /runs and the .atlas.json: a failed control gives can't check on every flag", async () => {
    const { r, file } = await level2Round(false);
    expect(r.status).toBe(200);
    expect(r.body.verdicts.every((v: { outcome: string }) => v.outcome === "cant_check")).toBe(true);
    expect(r.body.falseAlarm).toHaveLength(14);
    expect(r.body.falseAlarm.every((x: FalseAlarmRow) => x.flagged === null)).toBe(true); // before: cbETH true
    expect(file.falseAlarm!.every((x) => x.flagged === null)).toBe(true);
    expect(verifyAtlasFile(file).ok).toBe(true);
  });

  it("a passing control still flags cbETH in the response and the file", async () => {
    const { r, file } = await level2Round(true);
    expect(r.body.falseAlarm.filter((x: FalseAlarmRow) => x.flagged).map((x: FalseAlarmRow) => x.market)).toEqual(["cbETH"]);
    expect(file.falseAlarm!.filter((x) => x.flagged).map((x) => x.market)).toEqual(["cbETH"]);
  });

  it("the table: can't check in every flag cell and in the summary, never 'yes' or '1 flagged'", () => {
    const run = structuredClone(LIVE.runs[0]!);
    run.controlPassed = false;
    run.result.notMeasured.control = "WETH control did not match";
    const el = render(falseAlarmFromRun(run));
    const text = el.textContent ?? "";
    expect(text).toContain("The control did not pass");
    expect(text).toContain("WETH control did not match");
    expect(text).not.toMatch(/\b1 flagged\b/);
    const cells = [...el.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild!.textContent);
    expect(cells).toHaveLength(14);
    expect(cells.every((c) => c === "can't check")).toBe(true);
    expect(el.querySelector("tr.flagged")).toBeNull();
  });
});
