// D01-08 day gate in CI: the same flow as `pnpm gate:day1`, through app.request (no port needed).
// Also checks the HTTP refusals: bad input → 400, a bet whose seal does not verify → 409, not judged.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app.ts";
import { sealBet } from "../../src/seal.ts";
import type { Target } from "../../src/types.ts";
import { CASES, QUESTIONS, runSixCases, type Requester } from "../gate/six-cases.ts";

const oracle = JSON.parse(readFileSync(new URL("../oracle/retry-oracle.json", import.meta.url), "utf8")) as {
  cases: { id: string; input: Record<string, unknown>; expected: { calls: number; totalWaitMs: number; outcome: string } }[];
};

function requester(): Requester {
  const app = createApp();
  return async (path, init) => app.request(path, init);
}

const post = (request: Requester, path: string, body: unknown) =>
  request(path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("D01-08 day gate: six known cases end to end", () => {
  it("the hard-coded bets and experiments are the oracle table's rows", () => {
    for (const c of CASES) {
      const row = oracle.cases.find((r) => r.id === c.id)!;
      expect(c.expected, c.id).toEqual({ calls: row.expected.calls, totalWaitMs: row.expected.totalWaitMs, outcome: row.expected.outcome });
      const { shape: _shape, errorKind, ...rest } = c.params as Record<string, unknown>;
      const { distinctErrors: _d, error, ...rowInput } = row.input;
      expect({ ...rest, ...(errorKind ? { error: errorKind } : {}) }, c.id).toEqual({ ...rowInput, ...(error ? { error } : {}) });
    }
  });

  it("every oracle bet matched; the off bet didn't match; the unmeasured bet can't be checked; under 5 s", async () => {
    const out = await runSixCases(requester());
    expect(out.target.preExisting).toEqual({ label: "Pre-existing: written before the hackathon", listedIn: "PRE-EXISTING.md" });
    expect(out.results.map((r) => r.caseId)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
    for (const r of out.results) {
      expect(r.run.controlPassed, r.caseId).toBe(true);
      const plain = r.rows.filter((x) => !x.note);
      expect(plain.map((x) => x.verdict), r.caseId).toEqual(["matched", "matched", "matched"]);
    }
    const extra = out.results.flatMap((r) => r.rows.filter((x) => x.note));
    expect(extra.map((x) => [x.caseId, x.measures, x.verdict])).toEqual([
      ["S3", "calls", "not_matched"],
      ["S6", "settleTime", "cant_check"],
    ]);
    expect(extra[1]!.reason).toMatch(/never settled/);
    // The control ran once and was reused.
    expect(new Set(out.results.map((r) => r.run.controlRunId)).size).toBe(1);
    // The new shape fields reached the sandbox (counts alone would not show it).
    const s4 = out.results.find((r) => r.caseId === "S4")!.run;
    expect(JSON.stringify(s4.trace.find((t) => t.event === "reject")?.data?.error)).toContain("429");
    expect(out.results.find((r) => r.caseId === "S5")!.run.result.measured.returned).toBe('{"status":429}');
    expect(out.totalMs).toBeLessThan(5000);
  });
});

describe("D01-08 HTTP refusals", () => {
  const exp = (target: Target, params: unknown = { shape: "retry-scenario", failTimes: 0, failure: "error" }) => ({
    id: "e1", target, runner: "ts", params, proposedBy: { role: "human" },
  });

  it("POST /targets: bad body or a path outside tests/fixtures → 400 with a reason", async () => {
    const request = requester();
    for (const body of ["not json", { kind: "github-pr", ref: "x" }, { kind: "ts-fixture", ref: "../../package.json" }, { kind: "ts-fixture", ref: "nope.ts" }]) {
      const res = await post(request, "/targets", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    }
  });

  it("POST /runs: unknown target, misspelt or out-of-bounds params → 400", async () => {
    const request = requester();
    const target = (await (await post(request, "/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json()) as Target;
    const cases = [
      exp({ ...target, codeSha256: "0".repeat(64) }),
      exp(target, { shape: "retry-scenario", failtimes: 0, failure: "error" }),
      exp(target, { shape: "retry-scenario", failTimes: 0, failure: "error", errorKind: "500" }),
      exp(target, { shape: "retry-scenario", failTimes: 999, failure: "error" }),
      { ...exp(target), runner: "evm" },
    ];
    for (const experiment of cases) {
      const res = await post(request, "/runs", { experiment });
      expect(res.status, JSON.stringify(experiment.params)).toBe(400);
    }
  });

  it("POST /runs: a bet whose seal does not verify → 409, nothing judged, nothing run", async () => {
    let execs = 0;
    const app = createApp({ executor: { kind: "local", exec: async () => { execs++; throw new Error("must not run"); } } });
    const request: Requester = async (path, init) => app.request(path, init);
    const target = (await (await post(request, "/targets", { kind: "ts-fixture", ref: "with-rpc-retry.ts" })).json()) as Target;
    const good = sealBet({ experimentId: "e1", who: "human", question: QUESTIONS.calls, measures: "calls", answer: { kind: "integer", value: 1 } });
    const tampered = { ...sealBet({ experimentId: "e1", who: "human", question: QUESTIONS.calls, measures: "calls", answer: { kind: "integer", value: 1 } }), answer: { kind: "integer", value: 2 } };
    const res = await post(request, "/runs", { experiment: exp(target), bets: [good, tampered] });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; betIds: string[]; verdicts?: unknown };
    expect(body.betIds).toEqual([tampered.id]);
    expect(body.verdicts).toBeUndefined();
    expect(execs).toBe(0);
  });
});
