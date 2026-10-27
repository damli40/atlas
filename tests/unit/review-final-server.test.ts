// Final review (Oct 27), server findings. Mocked models only; no live model call. Each test failed on the
// code before its fix (tests/evidence/final-review/*-tests-on-old-code.txt).
// - S2: a run that did not finish (the sandbox could not start; anvil failed) keeps the experiment and its
//   sealed bets: the answer is 503 "the run did not finish: <reason>", nothing is judged, new bets are
//   refused, and the SAME experiment runs again with the SAME bets. The attempt is in the agent log and in
//   the .atlas.json (`attempts`), never as a verdict. One test needs BASE_RPC_URL and anvil (skipped without).
// - M3: "the Investigator was not asked" is decided for the round's own code, not for the whole session.
// - M4 (D18): Muse Spark's bet prompt holds the place (file + lines) and the code only: no model name, no kind.
// - M7: a call refused before it was sent (no key, refused model id) does not use up the hourly call limit.
// - M12: the strip line for a model's second try says "asks again", never "repair".

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createApp, TS_GATE_CONTEXT } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createProofStore } from "../../server/evm-round";
import { createModelBudget } from "../../server/meta/budget";
import { createMetaClient, type ChatArgs, type ChatResult } from "../../server/meta/client";
import { buildBetOnlyMessages } from "../../server/meta/roles/claimant-bets";
import { FIXTURE_FILE } from "../../server/meta/roles/fixture-finding";
import { localExecutor } from "../../runners/executor/local";
import { evmRunner } from "../../runners/evm/runner";
import type { Executor } from "../../runners/runner";
import { CBETH_PICKED_BY_PERSON, INVESTIGATOR_NOT_ASKED, LEVEL2_CAPTION, verifyAtlasFile } from "../../src/atlasfile";
import { questionsFor } from "../../src/gate";
import type { AtlasFile, Experiment, Finding, Run } from "../../src/types";
import { liveRunFor, PR } from "../tools/review-fixtures";

const HAS_RPC = Boolean(process.env.BASE_RPC_URL);
const HAS_ANVIL = spawnSync("anvil", ["--version"]).status === 0;

function wire(opts: Parameters<typeof createApp>[0], session: string) {
  const agentLog = createAgentLog();
  const app = createApp({ agentLog, proofs: createProofStore({ publish: false }), ...opts });
  const h = { "content-type": "application/json", "x-atlas-session": session };
  const ask = async (path: string, body?: unknown) => {
    const res = await app.request(path, body === undefined ? { headers: h } : { method: "POST", headers: h, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { app, ask, agentLog, session };
}

/** An executor that throws ONCE when asked to run experiment `id` (as if the sandbox could not start). */
function flakyExecutor(id: string) {
  const state = { failNext: false };
  const exec: Executor = {
    kind: "local",
    exec: async (req) => {
      if (state.failNext && req.files["request.json"]?.includes(`"id":"${id}"`)) {
        state.failNext = false;
        throw new Error("spawn node EAGAIN (forced for this test)");
      }
      return localExecutor.exec(req);
    },
  };
  return { exec, state };
}

/** A folder holding a fake `anvil` that exits at once with an error (a forced anvil failure). */
function fakeAnvilDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-anvil-"));
  const bin = join(dir, "anvil");
  writeFileSync(bin, '#!/bin/sh\necho "fake anvil: forced failure for the test" >&2\nexit 1\n');
  chmodSync(bin, 0o755);
  return dir;
}
async function withPath<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.env.PATH;
  process.env.PATH = `${dir}:${old}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = old;
  }
}

describe("S2: a TS run that did not finish keeps the experiment and its sealed bets", () => {
  it("503 'the run did not finish', bets frozen, the same experiment re-runs with the same bets, the attempt is recorded", async () => {
    const flaky = flakyExecutor("e-ts");
    const s = wire({ executor: flaky.exec }, "s2-ts");
    const t = (await s.ask("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).body;
    expect((await s.ask("/experiments", { id: "e-ts", target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } })).status).toBe(200);
    const sealed = (await s.ask("/bets", { experimentId: "e-ts", who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }, { measures: "outcome", answer: { kind: "enum", value: "throws" } }] })).body.bets;
    expect(sealed).toHaveLength(2);

    flaky.state.failNext = true;
    const failed = await s.ask("/runs", { experimentId: "e-ts" });
    expect(failed.status).toBe(503);
    expect(failed.body.error).toMatch(/^the run did not finish: the sandbox could not start: spawn node EAGAIN/);
    expect(failed.body.didNotFinish.attempts).toHaveLength(1);
    expect(failed.body).not.toHaveProperty("verdicts");

    // Bets stay frozen: no new bet, no second bet on a question.
    const late = await s.ask("/bets", { experimentId: "e-ts", who: "human", bets: [{ measures: "totalWaitMs", answer: { kind: "integer", value: 1 } }] });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/frozen/);

    // The log says what happened, as a runner line; no judge line, no verdict.
    const afterFail = s.agentLog.history(s.session).map((e) => e.event);
    const stop = afterFail.filter((e) => e.role === "runner" && /did not finish/.test(e.action));
    expect(stop).toHaveLength(1);
    expect(stop[0]!.action).toMatch(/the run did not finish \(attempt 1\): the sandbox could not start/);
    expect(afterFail.some((e) => e.role === "judge")).toBe(false);

    // Try again: the SAME experiment, the SAME sealed bets.
    const ok = await s.ask("/runs", { experimentId: "e-ts" });
    expect(ok.status).toBe(200);
    expect(ok.body.bets.map((b: { id: string; sealedHash: string }) => [b.id, b.sealedHash])).toEqual(sealed.map((b: { id: string; sealedHash: string }) => [b.id, b.sealedHash]));
    for (const b of ok.body.bets) expect(Date.parse(b.sealedAt)).toBeLessThan(Date.parse(ok.body.run.startedAt));
    expect(ok.body.verdicts.map((v: { outcome: string }) => v.outcome)).toEqual(["matched", "matched"]);
    expect(ok.body.proof.ok).toBe(true);

    const file = (await s.ask(`/proofs/${ok.body.run.id}`)).body as AtlasFile;
    expect(file.attempts).toHaveLength(1);
    expect(file.attempts![0]!.reason).toMatch(/^the sandbox could not start: spawn node EAGAIN/);
    expect(Date.parse(file.attempts![0]!.stoppedAt)).toBeLessThan(Date.parse(file.runs[0]!.startedAt));
    for (const b of file.bets) expect(Date.parse(b.sealedAt)).toBeLessThan(Date.parse(file.attempts![0]!.startedAt));
    expect(verifyAtlasFile(file).ok).toBe(true);
    // The attempt is not a verdict: one verdict per bet, all from the successful run.
    expect(file.verdicts).toHaveLength(2);
    expect(new Set(file.verdicts.map((v) => v.runId))).toEqual(new Set([ok.body.run.id]));

    // Verify refuses an attempt that ended after the run started, or one that began before a seal.
    const lateAttempt = structuredClone(file);
    lateAttempt.attempts![0]!.stoppedAt = new Date(Date.parse(file.runs[0]!.startedAt) + 1000).toISOString();
    expect(verifyAtlasFile(JSON.parse(JSON.stringify(lateAttempt))).ok).toBe(false);
    const earlyAttempt = structuredClone(file);
    earlyAttempt.attempts![0]!.startedAt = new Date(Date.parse(file.bets[0]!.sealedAt) - 1000).toISOString();
    expect(verifyAtlasFile(JSON.parse(JSON.stringify(earlyAttempt))).ok).toBe(false);
  }, 30000);
});

/** One Level 2 round up to its sealed bet; `evmRun` decides what each run attempt does. */
async function sealedLevel2(evmRun: NonNullable<Parameters<typeof createApp>[0]>["evmRun"], session: string) {
  const s = wire({ fetchPr: async () => PR, evmRun }, session);
  const t = (await s.ask("/targets", { kind: "github-pr", ref: PR.target.ref })).body;
  const f = (await s.ask("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).body.finding;
  const e = (await s.ask("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id })).body;
  const sealed = (await s.ask("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] })).body.bets;
  return { ...s, experimentId: e.experiment.id as string, sealed };
}

describe("S2: an EVM run whose anvil fails keeps the experiment and its sealed bets", () => {
  it("forced anvil failure (a fake anvil that exits 1): 503 with the plain reason, then the same experiment runs", async () => {
    const dir = fakeAnvilDir();
    let n = 0;
    const evmRun = async (exp: Experiment, o: { forkBlock: number; onProgress: (s: string) => void }): Promise<Run> => {
      if (n++ === 0) return withPath(dir, () => evmRunner({ onProgress: o.onProgress, rpcUrl: "http://127.0.0.1:9/never-used" }).run(exp, { forkBlock: o.forkBlock }));
      return liveRunFor(exp); // the D04-04 live run, as the stand-in for a fork that worked
    };
    const s = await sealedLevel2(evmRun, "s2-evm");
    const failed = await s.ask("/runs", { experimentId: s.experimentId });
    expect(failed.status).toBe(503);
    expect(failed.body.error).toMatch(/^the run did not finish: anvil exited before it was ready \(code 1/);
    expect(failed.body.error).not.toContain("127.0.0.1:9"); // the RPC URL is redacted
    // Not "already ran": the same experiment runs again.
    const ok = await s.ask("/runs", { experimentId: s.experimentId });
    expect(ok.status).toBe(200);
    expect(ok.body.bets.map((b: { sealedHash: string }) => b.sealedHash)).toEqual(s.sealed.map((b: { sealedHash: string }) => b.sealedHash));
    const file = (await s.ask(`/proofs/${ok.body.run.id}`)).body as AtlasFile;
    expect(file.attempts?.map((a) => a.reason)).toEqual([expect.stringMatching(/^anvil exited before it was ready/)]);
    expect(file.captions).toContain(LEVEL2_CAPTION);
    expect(verifyAtlasFile(file).ok).toBe(true);
    // A third POST /runs: it ran, so now it is "already ran" (one run per experiment still holds).
    expect((await s.ask("/runs", { experimentId: s.experimentId })).status).toBe(409);
  }, 30000);
});

describe.skipIf(!HAS_RPC || !HAS_ANVIL)("S2 on a real Base fork (needs BASE_RPC_URL and anvil)", () => {
  it("first attempt: forced anvil failure; second attempt: the real fork at 42194662; the file verifies with its attempt", async () => {
    const dir = fakeAnvilDir();
    let n = 0;
    const evmRun = (exp: Experiment, o: { forkBlock: number; onProgress: (s: string) => void }): Promise<Run> => {
      const go = () => evmRunner({ onProgress: o.onProgress }).run(exp, { forkBlock: o.forkBlock });
      return n++ === 0 ? withPath(dir, go) : go();
    };
    const s = await sealedLevel2(evmRun, "s2-rpc");
    const failed = await s.ask("/runs", { experimentId: s.experimentId });
    expect(failed.status).toBe(503);
    expect(failed.body.error).toMatch(/^the run did not finish: anvil exited before it was ready/);
    const ok = await s.ask("/runs", { experimentId: s.experimentId });
    expect(ok.status).toBe(200);
    expect(ok.body.run.forkBlock).toBe(42194662);
    expect(ok.body.run.controlPassed).toBe(true);
    for (const b of ok.body.bets) expect(Date.parse(b.sealedAt)).toBeLessThan(Date.parse(ok.body.run.startedAt));
    const file = (await s.ask(`/proofs/${ok.body.run.id}`)).body as AtlasFile;
    expect(file.attempts).toHaveLength(1);
    expect(verifyAtlasFile(file).ok).toBe(true);
    const text = JSON.stringify(file);
    expect(text).not.toContain(process.env.BASE_RPC_URL!);
  }, 240000);
});

// ---------- M3 ----------

const fixtureWonder = async (_a: ChatArgs): Promise<ChatResult> => ({
  ok: true,
  content: JSON.stringify({ findings: [{ file: FIXTURE_FILE, lineStart: 55, lineEnd: 56, kind: "retry", claim: "c", quotedSnippet: "for (let i = 1; i <= attempts; i++) {\n    try { return await fn(); }" }] }),
  finishReason: "stop",
  usage: { promptTokens: 100, completionTokens: 10, usd: 0.001 },
});

describe("M3: 'the Investigator was not asked' is decided for the round's own code", () => {
  it("Investigator asked on the TS fixture, NOT on the PR, same session: the Moonwell round says 'was not asked'", async () => {
    const s = wire({ fetchPr: async () => PR, investigator: { chat: fixtureWonder, fallbackModel: null }, evmRun: async (exp) => liveRunFor(exp) }, "m3");
    const ft = (await s.ask("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).body;
    const inv = await s.ask("/investigate", { target: { ref: ft.ref, codeSha256: ft.codeSha256 } });
    expect(inv.body.ok).toBe(true);
    const t = (await s.ask("/targets", { kind: "github-pr", ref: PR.target.ref })).body;
    const f = (await s.ask("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).body.finding;
    const e = (await s.ask("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id })).body;
    await s.ask("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
    const r = await s.ask("/runs", { experimentId: e.experiment.id });
    expect(r.body.proof.captions).toEqual([LEVEL2_CAPTION, `${CBETH_PICKED_BY_PERSON}; ${INVESTIGATOR_NOT_ASKED}`]);
    const file = (await s.ask(`/proofs/${r.body.run.id}`)).body as AtlasFile;
    expect(verifyAtlasFile(file).ok).toBe(true);
  });
});

// ---------- M4 ----------

describe("M4 (D18): Spark's bet prompt holds the place and the code only", () => {
  it("no 'found by muse-wonder-1.0', no Investigator kind label", () => {
    const target = { kind: "ts-fixture" as const, ref: FIXTURE_FILE, codeSha256: "a".repeat(64) };
    const finding: Finding = { id: "f1", file: FIXTURE_FILE, lineStart: 55, lineEnd: 56, kind: "retry", claim: "Okapi-claim", quotedSnippet: "x", verified: true, proposedBy: { role: "investigator", model: "muse-wonder-1.0" } };
    const params = { shape: "retry-scenario" as const, failTimes: 5, failure: "error" as const };
    const experiment: Experiment = { id: "e1", target, runner: "ts", params, proposedBy: { role: "human" }, gate: { allowed: true } };
    const fileText = Array.from({ length: 90 }, (_, i) => `line ${i + 1}`).join("\n");
    const prompt = buildBetOnlyMessages({ experiment, questions: questionsFor(params, TS_GATE_CONTEXT), finding, findingLabel: "found by muse-wonder-1.0; file, lines and quote checked by plain code", fileText, gateContext: TS_GATE_CONTEXT })
      .map((m) => m.content)
      .join("\n");
    expect(prompt).toContain(`file: ${FIXTURE_FILE}, lines 55-56`);
    expect(prompt).toContain("55| line 55");
    expect(prompt).not.toContain("muse-wonder-1.0");
    expect(prompt).not.toContain("found by");
    expect(prompt).not.toMatch(/kind: retry/);
    expect(prompt).not.toContain("Okapi-claim");
  });
});

// ---------- M7 ----------

describe("M7: the hourly call limit counts only calls that were sent", () => {
  it("a keyless client's refusals and a refused model id leave the counter at 0; a sent call counts", async () => {
    const budget = createModelBudget({ callsPerHour: 2 });
    const keyless = budget.wrap(createMetaClient({ apiKey: "", usagePath: join(mkdtempSync(join(tmpdir(), "m7-")), "u.jsonl") }).chat);
    for (let i = 0; i < 4; i++) expect(await keyless({ role: "claimant", model: "muse-spark-1.3", messages: [] })).toMatchObject({ ok: false, reason: expect.stringMatching(/^no Meta API key/) });
    expect(await keyless({ role: "claimant", model: "muse-spark-1.3-contributor", messages: [] })).toMatchObject({ ok: false });
    expect(budget.callsLastHour()).toBe(0);
    const sent = budget.wrap(async () => ({ ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 } }) as ChatResult);
    await sent({ role: "claimant", model: "muse-spark-1.3", messages: [] });
    expect(budget.callsLastHour()).toBe(1);
  });
});

// ---------- M12 ----------

describe("M12: a model's second try is 'asks again' on the strip", () => {
  it("Spark's first answer is not JSON: the claimant line says 'asks again', never 'repair'", async () => {
    let i = 0;
    const replies = ["not json", JSON.stringify({ bets: [{ measures: "calls", answer: { kind: "integer", value: 5 }, rationale: "r" }, { measures: "totalWaitMs", answer: { kind: "integer", value: 12000 }, rationale: "r" }, { measures: "outcome", answer: { kind: "enum", value: "throws", options: ["returns", "throws", "pending"] }, rationale: "r" }] })];
    const chat = async (): Promise<ChatResult> => ({ ok: true, content: replies[i++] ?? "", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.0001 } });
    process.env.ATLAS_USAGE_PATH = join(mkdtempSync(join(tmpdir(), "m12-")), "u.jsonl");
    const s = wire({ modelBets: { chat } }, "m12");
    const t = (await s.ask("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).body;
    const e = (await s.ask("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } })).body;
    await s.ask(`/experiments/${e.experiment.id}/model-bets`, {});
    const lines = s.agentLog.history(s.session).map((x) => x.event.action);
    expect(lines.some((l) => /asks again/.test(l))).toBe(true);
    expect(lines.some((l) => /repair/i.test(l))).toBe(false);
  });
});
