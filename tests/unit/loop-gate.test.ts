// D04-04 loop gate, offline: both targets go link → finding → bet → run → verdict through the real
// server (createApp, in-process), and each round's .atlas.json validates and replays.
// - Fixture: the real sandbox runs withRpcRetry (no network, no model).
// - Moonwell PR #578: GitHub and the EVM runner are stand-ins here (no network, no anvil); the live
//   fork run is in tests/evidence/D04-04. Models are mocked. Nothing is written to proofs/.

import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createProofStore, cbEthConfigSpan } from "../../server/evm-round";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { FIXTURE_FILE } from "../../server/meta/roles/fixture-finding";
import type { GithubPrTarget } from "../../server/targets/github";
import { HUMAN_PICKED_CBETH_CAPTION, LEVEL2_CAPTION, level1Caption, verifyAtlasFile } from "../../src/atlasfile";
import { LEVEL2_CAPTION as RUNNER_LEVEL2_CAPTION } from "../../runners/evm/level2";
import { PR578_CODE_SHA256 } from "../../runners/evm/moonwell-base";
import type { AtlasFile, Experiment, Finding, Run, Verdict } from "../../src/types";

const ROOT = join(import.meta.dirname, "..", "..");
const COPY = join(ROOT, "contracts", "lib", "moonwell");
const usage = { promptTokens: 100, completionTokens: 10, usd: 0.001 };
const scratch = mkdtempSync(join(tmpdir(), "atlas-d0404-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function mockChat(replies: string[]) {
  const calls: ChatArgs[] = [];
  const chat = async (args: ChatArgs): Promise<ChatResult> => {
    calls.push(JSON.parse(JSON.stringify(args)));
    const r = replies[calls.length - 1];
    if (r === undefined) throw new Error("chat called more times than expected");
    return { ok: true, content: r, finishReason: "stop", usage };
  };
  return { chat, calls };
}

function client(app: ReturnType<typeof createApp>, session: string) {
  const h = { "content-type": "application/json", "x-atlas-session": session };
  return {
    post: async (path: string, body: unknown) => {
      const res = await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    },
    get: async (path: string) => {
      const res = await app.request(path, { headers: h });
      return { status: res.status, body: (await res.json()) as any };
    },
  };
}

// ---------- the fixture ----------

describe("D04-04 fixture round: finding → bet → run → verdict → .atlas.json → replay", () => {
  it("writes a file that validates (pre-existing caption, finding recorded) and replays with the same seed to a deep-equal measured", async () => {
    const LOOP = { file: FIXTURE_FILE, lineStart: 55, lineEnd: 56, kind: "retry", claim: "People expect a short wait; the code waits.", quotedSnippet: "for (let i = 1; i <= attempts; i++) {\n    try { return await fn(); }" };
    const wonder = mockChat([JSON.stringify({ findings: [LOOP] })]);
    const spark = mockChat([
      JSON.stringify({
        bets: [
          { measures: "calls", answer: { kind: "integer", value: 5 }, rationale: "r" },
          { measures: "totalWaitMs", answer: { kind: "integer", value: 12000 }, rationale: "r" },
          { measures: "outcome", answer: { kind: "enum", value: "throws", options: ["returns", "throws", "pending"] }, rationale: "r" },
        ],
      }),
    ]);
    const app = createApp({ investigator: { chat: wonder.chat }, modelBets: { chat: spark.chat } });
    const c = client(app, "fx");
    const t = (await c.post("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).body;
    const inv = (await c.post("/investigate", { target: t })).body;
    const finding: Finding = inv.findings[0];
    const e = await c.post("/experiments", { target: t, params: { shape: "retry-scenario", failTimes: 5, failure: "error" }, findingId: finding.id });
    expect(e.status).toBe(200);
    await c.post("/bets", { experimentId: e.body.experiment.id, who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 3 } }] });
    const r = await c.post("/runs", { experimentId: e.body.experiment.id });
    expect(r.status).toBe(200);
    expect(r.body.proof).toMatchObject({ ok: true, published: false });
    expect(r.body.proof.captions).toContain("Pre-existing: written before the hackathon (listed in PRE-EXISTING.md)");

    const file = (await c.get(`/proofs/${r.body.run.id}`)).body as AtlasFile;
    const v = verifyAtlasFile(file);
    expect(v.ok, v.ok ? "" : v.problems.join("; ")).toBe(true);
    expect(file.seed).toBe(r.body.run.seed);
    expect(file.findings?.[0]).toMatchObject({ id: finding.id, proposedBy: { role: "investigator", model: "muse-wonder-1.0" } });
    expect(file.bets.map((b) => b.who).sort()).toEqual(["human", "model:muse-spark-1.3", "model:muse-spark-1.3", "model:muse-spark-1.3"]);

    const rep = (await c.get(`/replay/${r.body.run.id}`)).body;
    expect(rep).toMatchObject({ runner: "ts", measuredEqual: true, resultDiff: [], sameOutcomes: true, controlPassed: true, seed: file.seed, replaySeed: file.seed });
  }, 30_000);

  it("a tampered file does not verify: a changed verdict, a changed bet, a missing caption", async () => {
    const app = createApp();
    const c = client(app, "fx2");
    const t = (await c.post("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).body;
    const e = (await c.post("/experiments", { target: t, params: { shape: "retry-scenario", failTimes: 0, failure: "error" } })).body;
    await c.post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 1 } }] });
    const r = (await c.post("/runs", { experimentId: e.experiment.id })).body;
    const good = (await c.get(`/proofs/${r.run.id}`)).body as AtlasFile;
    expect(verifyAtlasFile(good).ok).toBe(true);
    const clone = () => JSON.parse(JSON.stringify(good)) as AtlasFile;

    const a = clone();
    (a.verdicts[0] as Verdict).outcome = a.verdicts[0]!.outcome === "matched" ? "not_matched" : "matched";
    expect(JSON.stringify(verifyAtlasFile(a))).toMatch(/is not what src\/judge.ts gives/);
    const b = clone();
    b.bets[0]!.answer = { kind: "integer", value: 99 };
    expect(JSON.stringify(verifyAtlasFile(b))).toMatch(/do not hash to its sealedHash/);
    const d = clone();
    d.captions = ["something else"];
    expect(JSON.stringify(verifyAtlasFile(d))).toMatch(/missing caption/);
    const f = clone();
    f.runs[0]!.seed = "other";
    expect(JSON.stringify(verifyAtlasFile(f))).toMatch(/used seed other/);
    expect((await c.get("/proofs/nope")).status).toBe(404);
    expect((await c.get("/replay/nope")).status).toBe(404);
  }, 30_000);
});

// ---------- the Moonwell pull request (stand-ins for GitHub and the fork) ----------

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
  description: "test description",
  mergedAt: "2026-02-10T18:58:44Z",
};

/** A stand-in for the fork: the values D04-02 read live, in the Run shape level2Run makes. */
function fakeEvmRun(calls: { forkBlock: number }[]) {
  return async (exp: Experiment, opts: { forkBlock: number; onProgress: (s: string) => void }): Promise<Run> => {
    calls.push({ forkBlock: opts.forkBlock });
    opts.onProgress(`forks Base @ ${opts.forkBlock}`);
    opts.onProgress("applies 2 oracle-feed actions as the governor");
    const level2 = exp.params.shape === "apply-proposal-then-read";
    const now = new Date().toISOString();
    return {
      id: `run${calls.length}x${opts.forkBlock}`,
      experimentId: exp.id,
      runner: "evm",
      executor: "local",
      codeSha256: exp.target.codeSha256,
      forkBlock: opts.forkBlock,
      chainId: 8453,
      startedAt: now,
      finishedAt: now,
      // The trace holds what the measured values claim (src/atlasfile.ts checks they agree).
      trace: [
        { t: 0, event: "fork_started", data: { forkBlock: opts.forkBlock, chainId: 8453 } },
        { t: 1, event: "control_matched", data: {} },
        ...(level2
          ? [
              { t: 2, event: "proposal_derived", data: { count: 2, actions: [{ symbol: "USDC" }, { symbol: "cbETH" }] } },
              { t: 3, event: "price_read", data: { phase: "pre-apply", symbol: "USDC", priceUsd1e18: "999900000000000000" } },
              { t: 4, event: "price_read", data: { phase: "pre-apply", symbol: "cbETH", priceUsd1e18: "2206683650838065175827" } },
              { t: 5, event: "price_read", data: { phase: "post-apply", symbol: "USDC", priceUsd1e18: "999900000000000000" } },
            ]
          : []),
        { t: 6, event: "price_read", data: { ...(level2 ? { phase: "post-apply" } : {}), symbol: "cbETH", priceUsd1e18: "1122662744874806300" } },
        { t: 7, event: "reference", data: { key: "refUsd1e18:cbETH", value: "2206683650838065175827", method: "ETH/USD × cbETH/ETH, raw Chainlink, same block", inputs: { ethUsd: { decimals: 8, answer: "196558018952" }, cbEthEth: { decimals: 18, answer: "1122662744874806300" } } } },
      ],
      result: {
        measured: {
          "priceUsd1e18:cbETH": "1122662744874806300",
          ...(level2 ? { "preApplyPriceUsd1e18:cbETH": "2206683650838065175827", "priceUsd1e18:USDC": "999900000000000000", "preApplyPriceUsd1e18:USDC": "999900000000000000" } : {}),
        },
        notMeasured: {},
        references: { "refUsd1e18:cbETH": { value: "2206683650838065175827", method: "ETH/USD × cbETH/ETH, raw Chainlink, same block" } },
      },
      controlPassed: true,
    };
  };
}

describe("D04-04 Moonwell round (GitHub and the fork are stand-ins)", () => {
  const forkCalls: { forkBlock: number }[] = [];
  const WONDER_PLACE = { file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 44, lineEnd: 46, kind: "price", claim: "Camel-claim: commented lines", quotedSnippet: "// Composite oracles don't support latestRound(), deferred to follow-up" };
  const wonder = mockChat([JSON.stringify({ findings: [WONDER_PLACE] })]);
  const spark = mockChat([JSON.stringify({ bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200, tolerancePct: 10, unit: "USD" }, rationale: "r" }] }), JSON.stringify({ bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 1.12, tolerancePct: 10, unit: "USD" }, rationale: "r" }] })]);
  const dir = join(scratch, "proofs");
  const app = createApp({ fetchPr: async () => PR, investigator: { chat: wonder.chat }, modelBets: { chat: spark.chat }, evmRun: fakeEvmRun(forkCalls), proofs: createProofStore({ publish: true, dir }) });
  const c = client(app, "mw");

  it("only PR #578 (with the copy's fingerprint) is accepted for running", async () => {
    const other = createApp({ fetchPr: async () => ({ ...PR, target: { ...PR.target, ref: "o/r#1" } }) });
    const res = await client(other, "x").post("/targets", { kind: "github-pr", ref: "o/r#1" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/one pull request on the EVM runner today/);
    const wrongSha = createApp({ fetchPr: async () => ({ ...PR, target: { ...PR.target, codeSha256: "f".repeat(64) } }) });
    expect((await client(wrongSha, "y").post("/targets", { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578" })).body.error).toMatch(/not the copy Atlas applies/);
  });

  it("Level 2: Wonder points elsewhere, the person picks the cbETH lines, Spark bets blind, the fork run is judged, the file replays", async () => {
    const t = (await c.post("/targets", { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578" })).body;
    expect(t.files.map((f: { path: string }) => f.path)).toContain("proposals/ChainlinkOracleConfigs.sol");
    const inv = (await c.post("/investigate", { target: { ref: t.ref, codeSha256: t.codeSha256 } })).body;
    expect(inv.ok).toBe(true);
    expect(wonder.calls[0]!.messages[1]!.content).toContain("title: <<<MIP-X43>>>");

    const span = cbEthConfigSpan()!;
    expect(span).toEqual({ file: "proposals/ChainlinkOracleConfigs.sol", from: 41, to: 43 });
    const bad = await c.post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "nope.sol", lineStart: 1, lineEnd: 1 });
    expect(bad.status).toBe(400);
    const picked = (await c.post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: span.file, lineStart: 42, lineEnd: 42 })).body.finding as Finding;
    expect(picked).toMatchObject({ proposedBy: { role: "human" }, claim: "", verified: true, lineStart: 42 });
    expect(picked.quotedSnippet).toContain('OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")');

    const e = await c.post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: picked.id });
    expect(e.status).toBe(200);
    expect(e.body.experiment.runner).toBe("evm");
    expect(e.body.questions.map((q: { text: string }) => q.text)).toEqual(["After this proposal is applied, what will Moonwell's oracle report for 1 cbETH, in USD?"]);
    expect(e.body.questions[0]).toMatchObject({ measures: "priceUsd1e18:cbETH", tolerancePct: 10, unit: "USD" });
    const slot = (await c.post(`/experiments/${e.body.experiment.id}/model-bets`, {})).body.model;
    expect(slot.status).toBe("sealed");
    expect(JSON.stringify(slot)).not.toContain("2200"); // values hidden until the run
    const prompt = spark.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain('OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")');
    expect(prompt).toContain("picked by a person");
    expect(prompt).not.toContain("Camel-claim");

    const bets = await c.post("/bets", { experimentId: e.body.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
    expect(bets.status).toBe(200);
    const r = await c.post("/runs", { experimentId: e.body.experiment.id });
    expect(r.status).toBe(200);
    expect(forkCalls.at(-1)).toEqual({ forkBlock: 42194662 });
    expect(r.body.verdicts.map((v: Verdict) => v.outcome)).toEqual(["not_matched", "not_matched"]);
    expect(r.body.verdicts[0].reference.value).toBe("2206683650838065175827");
    expect(r.body.falseAlarm.map((x: { market: string; flagged: boolean }) => [x.market, x.flagged])).toEqual([["USDC", false], ["cbETH", true]]);
    expect(r.body.proof.captions).toEqual([LEVEL2_CAPTION, HUMAN_PICKED_CBETH_CAPTION]);
    expect(r.body.proof.published).toBe(true);
    const actions = (await c.get(`/proofs/${r.body.run.id}`)).body.agentLog.map((x: { action: string }) => x.action);
    expect(actions).toContain("forks Base @ 42194662");
    expect(actions).toContain("applies 2 oracle-feed actions as the governor");

    // Written to the given folder only, and it validates as written.
    const onDisk = JSON.parse(readFileSync(join(dir, r.body.run.id, ".atlas.json"), "utf8"));
    expect(verifyAtlasFile(onDisk).ok).toBe(true);
    expect(existsSync(join(dir, r.body.run.id, "run.json"))).toBe(true);
    expect(onDisk.forkBlock).toBe(42194662);
    expect(onDisk.findings[0].proposedBy).toEqual({ role: "human", model: "none: picked by a person" });

    const rep = (await c.get(`/replay/${r.body.run.id}`)).body;
    expect(rep).toMatchObject({ runner: "evm", forkBlock: 42194662, replayForkBlock: 42194662, measuredEqual: true, resultDiff: [] });
    expect(forkCalls.at(-1)).toEqual({ forkBlock: 42194662 });
  });

  it("Level 1: price-read forks the block the proposal ran in and carries the after-the-fact caption", async () => {
    const t = (await c.post("/targets", { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578" })).body;
    const picked = (await c.post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 41, lineEnd: 43 })).body.finding as Finding;
    const e = (await c.post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "price-read", markets: ["cbETH"] }, findingId: picked.id })).body;
    expect(e.questions[0].text).toBe("At the fork block, what will Moonwell's oracle report for 1 cbETH, in USD?");
    await c.post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 1.1 } }] });
    const r = (await c.post("/runs", { experimentId: e.experiment.id })).body;
    expect(forkCalls.at(-1)).toEqual({ forkBlock: 42194663 });
    expect(r.proof.captions).toContain(level1Caption(42194663));
    expect(r.proof.captions).not.toContain(LEVEL2_CAPTION);
    expect(r.falseAlarm).toBeUndefined();
    expect(r.verdicts.map((v: Verdict) => v.outcome)).toEqual(["matched", "matched"]);
  });

  it("the caption text is the same in src/atlasfile.ts and the runner", () => {
    expect(LEVEL2_CAPTION).toBe(RUNNER_LEVEL2_CAPTION);
  });

  it("publishing off (the default): nothing is written", () => {
    const off = createProofStore({ publish: false, dir: join(scratch, "off") });
    expect(off.publishing).toBe(false);
    expect(existsSync(join(scratch, "off"))).toBe(false);
  });
});
