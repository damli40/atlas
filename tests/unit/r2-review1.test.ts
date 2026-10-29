// R2 review round 1: the rules marker in the proof file (B1, B2), every committed proof file verifies, negative and
// whole-number timing bets (m1, m2).
//
// Plain words: a proof file now says which rules made it (`rules: { timing: "d46", conditions: "r2" }`). Verify judges
// every verdict in the file under those rules and checks every label against them, both ways. A file without the
// marker was made before R2 and is judged by the rules before R2. No date decides it any more.
// What verify still cannot do: tell where a file came from. Someone who rewrites a whole file consistently (marker,
// labels, outcomes, re-sealed bets) makes a file that is consistent with itself. Only a stored hash can catch that.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { TIMING_RULE, judge } from "../../src/judge.ts";
import { gate } from "../../src/gate.ts";
import { computeSealHash, sealBet } from "../../src/seal.ts";
import { CURRENT_RULES, buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile.ts";
import { PRE_R1_RUNS_AFTER_CUTOFF, R1_SINCE } from "../../src/conditions.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import { checkAnswer } from "../../server/bets.ts";
import { questionsFor } from "../../src/gate.ts";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner.ts";
import type { Bet, BetAnswer, Experiment, ExperimentShape, Run } from "../../src/types.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const problems = (f: unknown) => {
  const v = verifyAtlasFile(f);
  return v.ok ? [] : v.problems;
};

describe("every committed proof file (*.atlas.json) verifies", () => {
  const files = execFileSync("git", ["ls-files", "*.atlas.json"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  it("there are some", () => expect(files.length).toBeGreaterThanOrEqual(14));
  for (const f of files) it(f, () => expect(problems(read(f))).toEqual([]));
});

describe("the main-made file: made with main's code (a39abb4) before R2, it verifies after R2", () => {
  const P = "tests/fixtures/r2/main-made-a39abb4.atlas.json";
  it("has no rules marker, a timing verdict judged by the old rule (1 ms vs 0 ms: not matched), and R1's timed-work words", () => {
    const f = read(P);
    expect(f.rules).toBeUndefined();
    expect(f.verdicts.find((v: { betId: string }) => v.betId === f.bets[0].id)).toMatchObject({ outcome: "not_matched" });
    expect(f.verdicts[0].timingRule).toBeUndefined();
    expect(f.runs[0].conditions.find((c: { kind: string }) => c.kind === "timed-work").says).toMatch(/Elapsed times read 0 ms here/);
    expect(problems(f)).toEqual([]);
  });
  it("reviewer attack B1: add the D46 label and flip to matched: refused", () => {
    const f = read(P);
    f.verdicts[0].timingRule = TIMING_RULE;
    f.verdicts[0].outcome = "matched";
    expect(problems(f).join("; ")).toMatch(/not what src\/judge.ts gives/);
  });
  it("adding the rules marker as well (relabel the whole file up) is refused: its conditions are in R1's words", () => {
    const f = read(P);
    f.rules = { ...CURRENT_RULES };
    f.verdicts[0].timingRule = TIMING_RULE;
    f.verdicts[0].outcome = "matched";
    expect(problems(f).join("; ")).toMatch(/conditions are not the ones its trace records/);
  });
});

describe("a fresh R2 file", () => {
  let control: Run;
  beforeAll(async () => {
    control = (await runCallControl()).run;
  }, 60_000);
  type Call = Extract<ExperimentShape, { shape: "call-function" }>;
  async function file(source: string, answer: BetAnswer) {
    const target = makePastedTarget(source, "js");
    const params: Call = { shape: "call-function", exportName: "f", args: [] };
    const g = gate(params, { exportNames: exportedFunctionsFor(source, "js").map((e) => e.name) });
    if (!g.allowed) throw new Error(g.reason);
    const exp: Experiment = { id: "r2r-f", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
    const b = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "virtualMs", answer });
    await new Promise((r) => setTimeout(r, 5));
    const r = await runCallExperiment(exp, control);
    return JSON.parse(JSON.stringify(buildAtlasFile({ target: exp.target, experiment: exp, bets: [b], run: r, verdicts: [judge(b, r)], agentLog: [], createdAt: new Date().toISOString() })));
  }
  const ms = (value: number): BetAnswer => ({ kind: "number", value, tolerancePct: 10, unit: "ms" });
  it("carries the rules marker and verifies; its timing verdict says d46", async () => {
    const f = await file("export function f(){ return 1; }", ms(1));
    expect(f.rules).toEqual({ timing: "d46", conditions: "r2" });
    expect(f.verdicts[0]).toMatchObject({ outcome: "matched", timingRule: "d46" });
    expect(problems(f)).toEqual([]);
  });
  it("reviewer attack A1 / A3: drop the label and flip to not matched (with or without moving every date): refused while the marker stays", async () => {
    const f = await file("export function f(){ return 1; }", ms(1));
    const a = JSON.parse(JSON.stringify(f));
    delete a.verdicts[0].timingRule;
    a.verdicts[0].outcome = "not_matched";
    expect(problems(a).join("; ")).toMatch(/not what src\/judge.ts gives/);
    // A3: every date moved back to 2026-10-28 and the bet re-sealed (the seal is a public hash).
    const day = "2026-10-28";
    const shift = (iso: string) => day + iso.slice(10);
    const b = JSON.parse(JSON.stringify(a));
    for (const bb of b.bets as Bet[]) {
      bb.sealedAt = shift(bb.sealedAt);
      bb.sealedHash = computeSealHash(bb);
    }
    for (const rr of b.runs) {
      rr.startedAt = shift(rr.startedAt);
      rr.finishedAt = shift(rr.finishedAt);
    }
    b.createdAt = shift(b.createdAt);
    expect(problems(b).join("; ")).toMatch(/not what src\/judge.ts gives/);
  });
  it("a file that timed its own work cannot be relabelled down: dropping the marker leaves R2-only marks in its runs", async () => {
    const f = await file("export function f(){ const t = Date.now(); for (let i = 0; i < 1e4; i++); return Date.now() - t; }", ms(1));
    const x = JSON.parse(JSON.stringify(f));
    delete x.rules;
    for (const v of x.verdicts) delete v.timingRule;
    expect(problems(x).join("; ")).toMatch(/only Atlas's R2 rules write|R1's|words Atlas used before R2/);
  });
  it("the limit, stated: a file with nothing R2-only in it, rewritten consistently (marker, label, outcome), verifies", async () => {
    const f = await file("export function f(){ return 1; }", ms(1));
    const x = JSON.parse(JSON.stringify(f));
    delete x.rules;
    delete x.verdicts[0].timingRule;
    x.verdicts[0].outcome = "not_matched";
    expect(problems(x)).toEqual([]); // consistent with itself; only a stored hash (the proof URL's) can catch this
  });
  it("a marker with an unknown value is refused by the schema", async () => {
    const f = await file("export function f(){ return 1; }", ms(1));
    f.rules = { timing: "d47", conditions: "r2" };
    expect(problems(f).length).toBeGreaterThan(0);
  });
});

describe("the E5 proof: restored source, named pre-R1 run; R1_SINCE unchanged", () => {
  it("is the only named run, by run id and code fingerprint", () => {
    expect(R1_SINCE).toBe("2026-10-28T00:00:00.000Z");
    const f = read("tests/evidence/E5/live/proof-Ehs2a0hAe8.atlas.json");
    expect(PRE_R1_RUNS_AFTER_CUTOFF.map((x) => [x.runId, x.codeSha256])).toEqual([[f.runs[0].id, f.codeSha256]]);
    expect(f.sourceWithheld).toBeUndefined();
    expect(problems(f)).toEqual([]);
  });
  it("another pre-R1-looking run after R1_SINCE is still refused, and so is the E5 run with other code", () => {
    const f = read("tests/evidence/E5/live/proof-Ehs2a0hAe8.atlas.json");
    const other = JSON.parse(JSON.stringify(f));
    other.runs[0].id = "someOther1";
    for (const v of other.verdicts) v.runId = "someOther1";
    expect(problems(other).join("; ")).toMatch(/started after Atlas began pinning every run/);
  });
  it("a marker on it is refused: the current rules pin every run", () => {
    const f = read("tests/evidence/E5/live/proof-Ehs2a0hAe8.atlas.json");
    f.rules = { ...CURRENT_RULES };
    expect(problems(f).join("; ")).toMatch(/current rules, which pin every run/);
  });
});

describe("m1 and m2: negative timing bets, whole-number timing bets", () => {
  const bet = (measures: string, answer: BetAnswer): Bet => ({ id: "b", experimentId: "e", who: "human", question: "q", measures, answer, nonce: "00".repeat(16), sealedAt: "2026-10-27T00:00:00.000Z", sealedHash: "0".repeat(64) });
  const run = (measured: Run["result"]["measured"]): Run => ({ id: "r", experimentId: "e", runner: "ts", executor: "local", codeSha256: "x", startedAt: "2026-10-27T00:00:01.000Z", finishedAt: "2026-10-27T00:00:02.000Z", trace: [], result: { measured, notMeasured: {} }, controlPassed: true });
  it("a bet below 0 ms is can't check under D46 (number and whole number); the old rule keeps its old answer", () => {
    expect(judge(bet("virtualMs", { kind: "number", value: -1, tolerancePct: 10, unit: "ms" }), run({ virtualMs: 0 }))).toMatchObject({ outcome: "cant_check", reason: "a timing bet cannot be below 0 ms" });
    expect(judge(bet("virtualMs", { kind: "number", value: -0.5, tolerancePct: 10, unit: "ms" }), run({ virtualMs: 0 })).outcome).toBe("cant_check");
    expect(judge(bet("totalWaitMs", { kind: "integer", value: -1 }), run({ totalWaitMs: 0 })).outcome).toBe("cant_check");
    expect(judge(bet("virtualMs", { kind: "number", value: -1, tolerancePct: 10, unit: "ms" }), run({ virtualMs: 0 }), { timingRule: null }).outcome).toBe("not_matched");
  });
  it("the server refuses a negative ms number bet", () => {
    const q = questionsFor({ shape: "call-function", exportName: "f", args: [] }).find((x) => x.measures === "virtualMs")!;
    expect(checkAnswer(q, { kind: "number", value: -1 } as never)).toMatchObject({ ok: false });
    expect(checkAnswer(q, { kind: "number", value: 0 } as never)).toMatchObject({ ok: true });
  });
  it("a whole-number ms bet matches within 10% or 1 ms under D46 and records it; exact under the old rule", () => {
    const cases: [number, number, string, string][] = [
      [12001, 12000, "matched", "not_matched"],
      [13200, 12000, "matched", "not_matched"],
      [13201, 12000, "not_matched", "not_matched"],
      [1, 0, "matched", "not_matched"],
      [2, 0, "not_matched", "not_matched"],
      [3000, 3000, "matched", "matched"],
    ];
    for (const [b, m, now, before] of cases) {
      const v = judge(bet("totalWaitMs", { kind: "integer", value: b }), run({ totalWaitMs: m }));
      expect(v.outcome, `${b} vs ${m}`).toBe(now);
      expect(v.timingRule).toBe(TIMING_RULE);
      expect(judge(bet("totalWaitMs", { kind: "integer", value: b }), run({ totalWaitMs: m }), { timingRule: null }).outcome, `${b} vs ${m} old`).toBe(before);
    }
  });
  it("whole-number counts stay exact and record no rule", () => {
    const v = judge(bet("calls", { kind: "integer", value: 4 }), run({ calls: 5 }));
    expect(v.outcome).toBe("not_matched");
    expect("timingRule" in v).toBe(false);
  });
});
