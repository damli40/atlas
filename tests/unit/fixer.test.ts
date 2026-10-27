// D06-01: the Fixer (Muse Code via `muse exec`, chat fallback) and change-and-replay, with the model
// MOCKED. Nothing here calls Meta. The TS replays run the real harness in the real sandbox.
//
// The diffs in this file are TEST DATA written for these tests (to exercise the plain-code checks
// and the replay). They are never shown as a model's work; the live run's diff is in
// tests/evidence/D06-01/.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractDiff, parseUnifiedDiff } from "../../src/diff.ts";
import type { Bet, Change, Experiment, Run, Target, Verdict } from "../../src/types.ts";
import { checkChange, moonwellChangeContext, MOONWELL_CONFIG_FILE, tsChangeContext } from "../../runners/change.ts";
import { assertSameTsReplay, runControl, runExperiment, tsRunner } from "../../runners/ts/control.ts";
import { assertSameEvmReplay } from "../../runners/evm/runner.ts";
import { evaluateReplayRule } from "../../runners/evm/level2.ts";
import { buildFixerPrompt, FIXER_INSTRUCTION, parseMuseJsonl, runFixer, towardFromBets, type MuseExec } from "../../server/meta/roles/fixer.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";

const FIXTURE_REF = "tests/fixtures/with-rpc-retry.ts";
const code = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const FIXTURE_SHA256 = "f3d2c59f05151be85d8a950c009e63de8015e638d3af6f2fd1c2a729393ad101";
const target: Target = { kind: "ts-fixture", ref: FIXTURE_REF, codeSha256: FIXTURE_SHA256 };
const s6: Experiment = { id: "exp-s6", target, runner: "ts", params: { shape: "retry-scenario", failTimes: "always", failure: "never_settles" }, proposedBy: { role: "human" }, gate: { allowed: true } };

/** A unified diff between two texts of one file, made by git (test helper). */
function diffOf(path: string, before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-difftest-"));
  try {
    writeFileSync(join(dir, "a"), before);
    writeFileSync(join(dir, "b"), after);
    let out = "";
    try {
      execFileSync("git", ["diff", "--no-index", "--no-color", "a", "b"], { cwd: dir, encoding: "utf8" });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? ""); // exit 1 = the files differ
    }
    return out.replaceAll("a/a", `a/${path}`).replaceAll("b/b", `b/${path}`).replace(/^diff --git .*\n/m, `diff --git a/${path} b/${path}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Test data: a per-call time limit through the injected sleep (2 s), so a never-answering call ends. */
const withTimeLimit = code
  .replace("  log?: (msg: string) => void;\n}", "  log?: (msg: string) => void;\n  timeoutMs?: number;\n}")
  .replace(
    "    try { return await fn(); }",
    "    try {\n      const limit = opts.timeoutMs ?? 2000;\n      return await Promise.race([fn(), sleep(limit).then(() => { throw new Error(`${label}: no answer within ${limit} ms`); })]);\n    }",
  );
const TIME_LIMIT_DIFF = diffOf(FIXTURE_REF, code, withTimeLimit);

const usagePath = join(mkdtempSync(join(tmpdir(), "atlas-fixer-usage-")), "usage.jsonl");
const fakeUsage = { promptTokens: 1000, completionTokens: 200, usd: 0.008 };
const museSays = (...answers: string[]): MuseExec & { calls: number; prompts: string[] } => {
  const f = (async ({ prompt }: { prompt: string }) => {
    f.prompts.push(prompt);
    const text = answers[Math.min(f.calls++, answers.length - 1)]!;
    return { ok: true as const, text, model: "muse-spark-1.3", usage: fakeUsage };
  }) as unknown as MuseExec & { calls: number; prompts: string[] };
  f.calls = 0;
  f.prompts = [];
  return f;
};
const noChat = async () => {
  throw new Error("the chat fallback must not be called here");
};

function bet(who: Bet["who"], measures: string, answer: Bet["answer"], question = `q ${measures}`): Bet {
  return sealBet({ id: `b-${who}-${measures}`, experimentId: s6.id, who, question, measures, answer });
}

describe("unified diff reading (offline)", () => {
  it("finds the file, added and removed lines; refuses new, renamed and binary files", () => {
    const p = parseUnifiedDiff(TIME_LIMIT_DIFF);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.files.map((f) => f.newPath)).toEqual([FIXTURE_REF]);
    expect(p.files[0]!.removed).toEqual(["    try { return await fn(); }"]);
    expect(parseUnifiedDiff("diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+hi\n").ok).toBe(false);
    expect(parseUnifiedDiff("diff --git a/x b/y\nrename from x\nrename to y\n").ok).toBe(false);
    expect(parseUnifiedDiff("Binary files a/x and b/x differ\n").ok).toBe(false);
    expect(parseUnifiedDiff("I changed the retry loop.").ok).toBe(false);
  });

  it("does not trust a hunk header's line counts (like git apply --recount): a miscounted header is still read and applied", async () => {
    const miscounted = TIME_LIMIT_DIFF.replace(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/m, "@@ -$1,99 +$3,1 @@");
    expect(miscounted).not.toBe(TIME_LIMIT_DIFF);
    const r = await checkChange(miscounted, tsChangeContext(FIXTURE_REF, code));
    expect(r.ok && r.changedFiles[FIXTURE_REF]).toBe(withTimeLimit);
  });

  it("takes only the diff out of an answer and says when there was prose around it", () => {
    const got = extractDiff(`Here is the change:\n\`\`\`diff\n${TIME_LIMIT_DIFF}\`\`\`\nThis adds a time limit.`);
    expect(got?.diff).toBe(TIME_LIMIT_DIFF);
    expect(got?.hadProse).toBe(true);
    expect(extractDiff(TIME_LIMIT_DIFF)).toEqual({ diff: TIME_LIMIT_DIFF, hadProse: false });
    expect(extractDiff("no diff here")).toBeNull();
  });
});

describe("toward: written by plain code from the sealed bets that did not match", () => {
  it("lists each not-matched bet with who, question, sealed answer and what the run measured; null when all matched", () => {
    const b1 = bet("human", "outcome", { kind: "enum", value: "throws", options: ["returns", "throws", "pending"] }, "What will it do at the end?");
    const b2 = bet("model:muse-spark-1.3", "outcome", { kind: "enum", value: "pending", options: ["returns", "throws", "pending"] });
    const v: Verdict[] = [
      { betId: b1.id, runId: "r", outcome: "not_matched", observed: "pending", judgedBy: "src/judge.ts" },
      { betId: b2.id, runId: "r", outcome: "matched", observed: "pending", judgedBy: "src/judge.ts" },
    ];
    expect(towardFromBets([b1, b2], v)).toBe('- The person bet on "What will it do at the end?" (outcome): throws. The run measured: pending.');
    expect(towardFromBets([b2], v)).toBeNull();
  });
});

describe("the Fixer with a mocked Muse Code", () => {
  const input = { context: tsChangeContext(FIXTURE_REF, code), finding: { file: FIXTURE_REF, lineStart: 49, lineEnd: 66 }, toward: "- The person bet on \"q\" (outcome): throws. The run measured: pending.", experiment: s6 };

  it("the prompt carries the instruction, the editable file, the finding's lines and toward, and no other file", () => {
    const p = buildFixerPrompt(input);
    expect(p.startsWith(FIXER_INSTRUCTION)).toBe(true);
    expect(p).toContain("Files you may change: tests/fixtures/with-rpc-retry.ts.");
    expect(p).toContain("56|     try { return await fn(); }");
    expect(p).toContain(input.toward);
    expect(p).toContain("30000 ms of virtual time");
  });

  it("a valid diff (inside a fence, with prose) is accepted by plain code; only the diff is kept; usage is logged with the model id", async () => {
    const muse = museSays(`Sure.\n\`\`\`diff\n${TIME_LIMIT_DIFF}\`\`\``);
    const r = await runFixer(input, { museExec: muse, chat: noChat, usagePath });
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe("muse-exec");
    expect(r.model).toBe("muse-spark-1.3");
    expect(r.diff).toBe(TIME_LIMIT_DIFF);
    expect(r.checked.changedFiles[FIXTURE_REF]).toBe(withTimeLimit);
    expect(muse.calls).toBe(1);
    const lines = readFileSync(usagePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.at(-1)).toMatchObject({ role: "fixer", model: "muse-spark-1.3", via: "muse exec", usd: 0.008 });
  });

  it("a diff that touches another file is refused, repaired once, then 'Muse Code: no usable change (<reason>)'", async () => {
    const other = TIME_LIMIT_DIFF.replaceAll(FIXTURE_REF, "server/app.ts");
    const muse = museSays(other, other);
    const r = await runFixer(input, { museExec: muse, chat: noChat, usagePath });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(muse.calls).toBe(2);
    expect(muse.prompts[1]).toContain("Your previous answer could not be used: the diff touches server/app.ts, which is not a file of this target");
    expect(r.reason).toMatch(/^Muse Code: no usable change \(the diff touches server\/app\.ts/);
    expect(r.attempts.map((a) => a.ok)).toEqual([false, false]);
  });

  it("a TS diff that adds a network or file import is refused", async () => {
    const withImport = TIME_LIMIT_DIFF.replace("+  timeoutMs?: number;", '+  timeoutMs?: number;\n+  // import { request } from "node:http";');
    // A comment line is still an added line: the check is on text, so it refuses (plain and strict).
    const bad = diffOf(FIXTURE_REF, code, withTimeLimit.replace("// ---- BEGIN VERBATIM", 'import { readFileSync } from "node:fs";\n// ---- BEGIN VERBATIM'));
    const r1 = await checkChange(bad, tsChangeContext(FIXTURE_REF, code));
    expect(r1).toEqual({ ok: false, reason: 'the change adds an import of "node:fs" in tests/fixtures/with-rpc-retry.ts (network, file-system and process modules are not allowed)' });
    expect(withImport).toContain("node:http");
    const fetchy = diffOf(FIXTURE_REF, code, code.replace("    try { return await fn(); }", "    try { await fetch(\"https://example.com\"); return await fn(); }"));
    expect((await checkChange(fetchy, tsChangeContext(FIXTURE_REF, code))).ok).toBe(false);
  });

  it("over 200 changed lines is refused", async () => {
    const big = diffOf(FIXTURE_REF, code, code.replace("// ---- BEGIN VERBATIM", `${Array.from({ length: 201 }, (_, i) => `// line ${i}`).join("\n")}\n// ---- BEGIN VERBATIM`));
    expect(await checkChange(big, tsChangeContext(FIXTURE_REF, code))).toMatchObject({ ok: false, reason: expect.stringMatching(/changes 201 lines; at most 200/) });
  });

  it("when muse exec gives no answer, the muse-spark-1.3 chat fallback runs and the log names both", async () => {
    const events: { role: string; model?: string; action: string }[] = [];
    const log = { emit: (e: never) => e, model: (e: { role: string; model: string; action: string }) => (events.push(e), e) } as never;
    const failing: MuseExec = async () => ({ ok: false, reason: "muse exec could not start: spawn ENOENT" });
    const chat = async () => ({ ok: true as const, content: TIME_LIMIT_DIFF, finishReason: "stop", usage: fakeUsage });
    const r = await runFixer(input, { museExec: failing, chat, log, usagePath });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("chat-fallback");
    expect(r.model).toBe("muse-spark-1.3");
    expect(events[0]!.action).toMatch(/^Muse Code gave no answer \(muse exec could not start: spawn ENOENT\); falls back to muse-spark-1.3 chat/);
    expect(events[1]!.action).toMatch(/^muse-spark-1.3 \(chat fallback\) proposes a change to tests\/fixtures\/with-rpc-retry.ts/);
  });

  it("parses muse exec JSON lines: final text, model id and usage", () => {
    const out = [
      JSON.stringify({ payload_type: "run.usage", payload: { models: [{ model: "muse-spark-1.3", input_tokens: 45534, output_tokens: 372, reasoning_tokens: 272 }] } }),
      JSON.stringify({ payload_type: "run.terminal.completed", payload: { terminal: "completed", text: "hello", reason: null } }),
    ].join("\n");
    const r = parseMuseJsonl(out);
    expect(r).toMatchObject({ ok: true, text: "hello", model: "muse-spark-1.3", usage: { promptTokens: 45534, completionTokens: 372, reasoningTokens: 272 } });
    expect(parseMuseJsonl("").ok).toBe(false);
    expect(parseMuseJsonl(JSON.stringify({ payload_type: "run.terminal.failed", payload: { terminal: "failed", reason: "max steps" } }))).toMatchObject({ ok: false, reason: 'muse exec ended "failed" (max steps)' });
  });
});

describe("Moonwell: only the proposal's config may change, and every name must be in chains/8453.json", () => {
  const ctx = moonwellChangeContext();
  const config = ctx.files[MOONWELL_CONFIG_FILE]!;
  const line42 = '            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")';

  it("a diff touching chains/8453.json (the address book) is refused", async () => {
    const book = ctx.files["chains/8453.json"]!;
    const d = diffOf("chains/8453.json", book, book.replace('"name": "cbETH_ORACLE",', '"name": "cbETH_ORACLE_OEV_WRAPPER",'));
    expect(await checkChange(d, ctx)).toEqual({ ok: false, reason: `the diff touches chains/8453.json, which may not change (only ${MOONWELL_CONFIG_FILE} may)` });
  });

  it("an unknown oracle name is 'no usable change' (cbETH_ORACLE has no _OEV_WRAPPER entry), through the Fixer too", async () => {
    const d = diffOf(MOONWELL_CONFIG_FILE, config, config.replace(line42, line42.replace("cbETHETH_ORACLE", "cbETH_ORACLE")));
    const checked = await checkChange(d, ctx);
    expect(checked).toEqual({ ok: false, reason: "the changed config cannot be wired: chains/8453.json has no address named cbETH_ORACLE_OEV_WRAPPER (wrapper for cbETH_ORACLE)" });
    const exp: Experiment = { ...s6, id: "exp-l2", runner: "evm", target: { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578", codeSha256: "x" }, params: { shape: "apply-proposal-then-read", markets: "touched" } };
    const r = await runFixer({ context: ctx, finding: { file: MOONWELL_CONFIG_FILE, lineStart: 42, lineEnd: 42 }, toward: "- The person bet 2200 USD.", experiment: exp, forkBlock: 42194662 }, { museExec: museSays(d), chat: noChat, usagePath });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("Muse Code: no usable change (the changed config cannot be wired: chains/8453.json has no address named cbETH_ORACLE_OEV_WRAPPER (wrapper for cbETH_ORACLE))");
  });

  it("a config edit with known names is re-derived by the same parser (one fewer action when a push is commented out)", async () => {
    const d = diffOf(MOONWELL_CONFIG_FILE, config, config.replace(`        _oracleConfigs[BASE_CHAIN_ID].push(\n${line42}\n        );`, `        // _oracleConfigs[BASE_CHAIN_ID].push(\n        // ${line42.trim()}\n        // );`));
    const checked = await checkChange(d, ctx);
    expect(checked.ok, checked.ok ? "" : checked.reason).toBe(true);
    expect(checked.ok && checked.planned!.length).toBe(13);
    expect(checked.ok && checked.planned!.some((p) => p.config.mTokenKey === "MOONWELL_cbETH")).toBe(false);
  });
});

describe("replay: same experiment, SAME seed (TS) / SAME fork block (EVM)", () => {
  it("TS: the time-limit change replays S6 with the same seed; the outcome is measured (throws); the harness check ran on the original code", async () => {
    const ctl = await runControl(code, { expectedSha256: FIXTURE_SHA256 });
    const original = await runExperiment(s6, ctl.run, { seed: "seed-d06" });
    expect(original.result.measured.outcome).toBe("pending");
    const change: Change = { id: "chg1", runId: original.id, diff: TIME_LIMIT_DIFF, proposedBy: { role: "fixer", model: "muse-spark-1.3" }, toward: "x" };
    const replay = await tsRunner().replayWithChange(original, change, { experiment: s6 });
    expect(replay.seed).toBe(original.seed);
    expect(replay.replayOf).toEqual({ runId: original.id, changeId: "chg1" });
    expect(replay.codeSha256).not.toBe(original.codeSha256);
    expect(replay.controlPassed).toBe(true);
    expect(replay.result.measured.outcome).toBe("throws");
    expect(replay.result.measured.calls).toBe(5);
    expect(replay.result.measured.totalWaitMs).toBe(5 * 2000 + 4 * 3000);
    const checks = replay.trace.at(-1)!;
    expect(checks.event).toBe("replay_checks");
    expect(checks.data).toMatchObject({ sameSeed: true, seed: "seed-d06", harnessCheck: { on: "original code", passed: true }, changedCodeOnKnownRows: { allStillMatch: false } });
    // The SAME bet, judged before and after.
    const b = bet("human", "outcome", { kind: "enum", value: "throws", options: ["returns", "throws", "pending"] });
    expect(judge(b, original).outcome).toBe("not_matched");
    expect(judge(b, replay).outcome).toBe("matched");
  });

  it("TS: refuses a replay without the original seed, of another experiment, or for another run's change", () => {
    const run = { id: "r1", runner: "ts", experimentId: s6.id, seed: "s" } as Run;
    const change = { id: "c", runId: "r1" } as Change;
    expect(() => assertSameTsReplay({ ...run, seed: undefined } as unknown as Run, s6, change)).toThrow(/no seed/);
    expect(() => assertSameTsReplay({ ...run, experimentId: "other" }, s6, change)).toThrow(/ran experiment other/);
    expect(() => assertSameTsReplay(run, s6, { ...change, runId: "r2" })).toThrow(/is for run r2/);
    expect(() => assertSameTsReplay(run, s6, change)).not.toThrow();
  });

  it("EVM: refuses a replay without the original fork block; the replay rule reads the same block, 2% and 2 sources", () => {
    const exp = { ...s6, id: "l2", runner: "evm" } as Experiment;
    const change = { id: "c", runId: "r1" } as Change;
    expect(() => assertSameEvmReplay({ id: "r1", runner: "evm", experimentId: "l2" } as Run, exp, change)).toThrow(/forkBlock is required/);
    const replay = (over: Partial<Run>, measured: Run["result"]["measured"], ref = "2206683650838065175827") =>
      ({ id: "rp", runner: "evm", forkBlock: 42194662, controlPassed: true, result: { measured, notMeasured: {}, references: { "refUsd1e18:cbETH": { value: ref, method: "m" } } }, ...over }) as Run;
    const original = { id: "r1", forkBlock: 42194662 };
    const near = replay({}, { "priceUsd1e18:cbETH": "2206683650838065175827", "priceSources:cbETH": 2 });
    expect(evaluateReplayRule(near, original).map((l) => l.outcome)).toEqual(["matched", "matched", "matched"]);
    const far = replay({}, { "priceUsd1e18:cbETH": "1122662744874806300", "priceSources:cbETH": 1 });
    expect(evaluateReplayRule(far, original).map((l) => l.outcome)).toEqual(["matched", "didn't match", "didn't match"]);
    const otherBlock = replay({ forkBlock: 42194663 }, { "priceUsd1e18:cbETH": "2206683650838065175827", "priceSources:cbETH": 2 });
    expect(evaluateReplayRule(otherBlock, original).map((l) => l.outcome)).toEqual(["didn't match", "can't check", "can't check"]);
    const noControl = replay({ controlPassed: false }, { "priceUsd1e18:cbETH": "2206683650838065175827", "priceSources:cbETH": 2 });
    expect(evaluateReplayRule(noControl, original).slice(1).map((l) => l.outcome)).toEqual(["can't check", "can't check"]);
    // Exactly 2% off is within; just over is not.
    expect(evaluateReplayRule(replay({}, { "priceUsd1e18:cbETH": "102", "priceSources:cbETH": 2 }, "100"), original)[1]!.outcome).toBe("matched");
    expect(evaluateReplayRule(replay({}, { "priceUsd1e18:cbETH": "10201", "priceSources:cbETH": 2 }, "10000"), original)[1]!.outcome).toBe("didn't match");
  });
});

// ── with BASE_RPC_URL and anvil only: a real EVM replay on a fresh fork at the original block ─────
const HAS_RPC = Boolean(process.env.BASE_RPC_URL);
let HAS_ANVIL = false;
try {
  execFileSync("anvil", ["--version"], { stdio: "ignore" });
  HAS_ANVIL = true;
} catch {
  HAS_ANVIL = false;
}

describe.skipIf(!HAS_RPC || !HAS_ANVIL)("EVM replayWithChange on a real Base fork (needs BASE_RPC_URL)", () => {
  it("re-derives the actions from the changed config and replays at the SAME block 42194662 (test-data diff: the cbETH push commented out)", async () => {
    const { evmRunner } = await import("../../runners/evm/runner.ts");
    const { level2Experiment } = await import("../tools/level2-run.ts");
    const exp = level2Experiment();
    const original = await evmRunner().run(exp, { forkBlock: 42194662 });
    expect(original.controlPassed).toBe(true);
    const ctx = moonwellChangeContext();
    const config = ctx.files[MOONWELL_CONFIG_FILE]!;
    const line42 = '            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")';
    const diff = diffOf(MOONWELL_CONFIG_FILE, config, config.replace(`        _oracleConfigs[BASE_CHAIN_ID].push(\n${line42}\n        );`, `        // _oracleConfigs[BASE_CHAIN_ID].push(\n        // ${line42.trim()}\n        // );`));
    const change: Change = { id: "chg-evm", runId: original.id, diff, proposedBy: { role: "fixer", model: "test-data" }, toward: "x" };
    const replay = await evmRunner().replayWithChange(original, change, { experiment: exp });
    expect(replay.forkBlock).toBe(original.forkBlock);
    expect(replay.replayOf).toEqual({ runId: original.id, changeId: "chg-evm" });
    expect(replay.controlPassed).toBe(true);
    expect(replay.result.measured.appliedFeedActions).toBe(13);
    const checks = replay.trace.at(-1)!;
    expect(checks.event).toBe("replay_checks");
    expect(checks.data).toMatchObject({ sameForkBlock: true, forkBlock: 42194662, marketsNotRewired: ["cbETH"] });
    expect(evaluateReplayRule(replay, original).map((l) => l.outcome)).toEqual(["matched", "matched", "matched"]);
  }, 400_000);
});

describe("contributor models are refused unless ATLAS_ALLOW_CONTRIBUTOR=1", () => {
  it("contributorRefusal: refuses '-contributor' ids by default, allows them only with the env set", async () => {
    const { contributorRefusal } = await import("../../server/meta/client.ts");
    expect(contributorRefusal("muse-spark-1.3", {})).toBeNull();
    expect(contributorRefusal("muse-spark-1.3-contributor", {})).toMatch(/is a contributor model .* unless ATLAS_ALLOW_CONTRIBUTOR=1/);
    expect(contributorRefusal("muse-spark-1.3-contributor", { ATLAS_ALLOW_CONTRIBUTOR: "1" })).toBeNull();
    expect(contributorRefusal("muse-spark-1.3-contributor", { ATLAS_ALLOW_CONTRIBUTOR: "true" })).not.toBeNull();
  });

  it("chat() never sends a request for a contributor model", async () => {
    const { createMetaClient } = await import("../../server/meta/client.ts");
    let sent = 0;
    const client = createMetaClient({ apiKey: "k", usagePath, fetchImpl: (async () => (sent++, new Response("{}"))) as unknown as typeof fetch });
    const r = await client.chat({ role: "claimant", model: "muse-spark-1.3-contributor", messages: [{ role: "user", content: "x" }] });
    expect(r.ok).toBe(false);
    expect(sent).toBe(0);
  });

  it("the Fixer does not use an answer that muse exec reports from a contributor model, logs that model id, and falls back", async () => {
    const before = process.env.ATLAS_ALLOW_CONTRIBUTOR;
    delete process.env.ATLAS_ALLOW_CONTRIBUTOR;
    try {
      const events: { model?: string; action: string }[] = [];
      const log = { emit: (e: never) => e, model: (e: { model: string; action: string }) => (events.push(e), e) } as never;
      const contrib: MuseExec = async () => ({ ok: true, text: TIME_LIMIT_DIFF, model: "muse-spark-1.3-contributor", usage: fakeUsage });
      const chat = async () => ({ ok: true as const, content: TIME_LIMIT_DIFF, finishReason: "stop", usage: fakeUsage });
      const ctxIn = { context: tsChangeContext(FIXTURE_REF, code), finding: { file: FIXTURE_REF, lineStart: 49, lineEnd: 66 }, toward: "- x", experiment: s6 };
      const r = await runFixer(ctxIn, { museExec: contrib, chat, log, usagePath });
      expect(r.path).toBe("chat-fallback");
      expect(r.attempts[0]).toMatchObject({ ok: false, model: "muse-spark-1.3-contributor", reason: expect.stringMatching(/contributor model/) });
      expect(events[0]!.model).toBe("muse-spark-1.3-contributor");
      const lines = readFileSync(usagePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.some((l) => l.model === "muse-spark-1.3-contributor" && l.via === "muse exec")).toBe(true);
    } finally {
      if (before !== undefined) process.env.ATLAS_ALLOW_CONTRIBUTOR = before;
    }
  });
});

describe("Moonwell prompt: the address book's oracle names, as plain data", () => {
  it("lists every oracle name in chains/8453.json in file order, names only, with no other hint", async () => {
    const { oracleNamesIn } = await import("../../server/meta/roles/fixer.ts");
    const ctx = moonwellChangeContext();
    const names = oracleNamesIn(ctx.files["chains/8453.json"]!);
    expect(names.length).toBeGreaterThan(50);
    const exp: Experiment = { ...s6, id: "exp-l2", runner: "evm", target: { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578", codeSha256: "x" }, params: { shape: "apply-proposal-then-read", markets: "touched" } };
    const p = buildFixerPrompt({ context: ctx, finding: { file: MOONWELL_CONFIG_FILE, lineStart: 42, lineEnd: 42 }, toward: "- t", experiment: exp, forkBlock: 42194662 });
    expect(p).toContain(`Oracle names that exist in chains/8453.json (${names.length}, names only, in file order):\n${names.join("\n")}`);
    expect(p).not.toMatch(/bad debt|incident|exploit|loss|post-mortem/i);
  });
});

describe("repairWith: chat-fallback (one Muse Code try, then one Spark chat with the same inputs)", () => {
  it("a refused Muse Code diff is followed by ONE chat call with the base prompt, not a second muse exec", async () => {
    const other = TIME_LIMIT_DIFF.replaceAll(FIXTURE_REF, "server/app.ts");
    const muse = museSays(other);
    const prompts: string[] = [];
    const chat = async (a: { messages: { content: string }[] }) => (prompts.push(a.messages[1]!.content), { ok: true as const, content: TIME_LIMIT_DIFF, finishReason: "stop", usage: fakeUsage });
    const ctxIn = { context: tsChangeContext(FIXTURE_REF, code), finding: { file: FIXTURE_REF, lineStart: 49, lineEnd: 66 }, toward: "- x", experiment: s6 };
    const r = await runFixer(ctxIn, { museExec: muse, chat: chat as never, usagePath, repairWith: "chat-fallback" });
    expect(muse.calls).toBe(1);
    expect(prompts).toEqual([muse.prompts[0]]);
    expect(r.ok && r.path).toBe("chat-fallback");
  });
});

describe("zero-context hunks (git apply --unidiff-zero)", () => {
  it("a one-line hunk with no context lines is applied and then checked like any other", async () => {
    const ctx = moonwellChangeContext();
    const d = `--- a/${MOONWELL_CONFIG_FILE}\n+++ b/${MOONWELL_CONFIG_FILE}\n@@ -42,1 +42,1 @@\n-            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")\n+            OracleConfig("cbETH_ORACLE", "cbETH", "MOONWELL_cbETH")\n`;
    expect(await checkChange(d, ctx)).toEqual({ ok: false, reason: "the changed config cannot be wired: chains/8453.json has no address named cbETH_ORACLE_OEV_WRAPPER (wrapper for cbETH_ORACLE)" });
  });
});
