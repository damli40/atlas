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

describe("D01-08 HTTP refusals (routes as of D02-04)", () => {
  const exp = (target: Target, params: unknown = { shape: "retry-scenario", failTimes: 0, failure: "error" }) => ({
    id: "e1", target: { ref: target.ref, codeSha256: target.codeSha256 }, params,
  });

  it("POST /targets: bad body or a path outside tests/fixtures → 400 with a reason", async () => {
    const request = requester();
    for (const body of ["not json", { kind: "github-pr", ref: "x" }, { kind: "ts-fixture", ref: "../../package.json" }, { kind: "ts-fixture", ref: "nope.ts" }]) {
      const res = await post(request, "/targets", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    }
  });

  it("POST /experiments: unknown target or wrong runner → 400", async () => {
    const request = requester();
    const target = (await (await post(request, "/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json()) as Target;
    const cases = [exp({ ...target, codeSha256: "0".repeat(64) }), { ...exp(target), runner: "evm" }];
    for (const experiment of cases) {
      const res = await post(request, "/experiments", experiment);
      expect(res.status, JSON.stringify(experiment)).toBe(400);
    }
  });

  it("POST /experiments: misspelt, out-of-bounds or unknown-shape params → 422 from the gate, returned with its reason; no bets, never run", async () => {
    let execs = 0;
    const app = createApp({ executor: { kind: "local", exec: async () => { execs++; throw new Error("must not run"); } } });
    const headers = { "content-type": "application/json", "x-atlas-session": "gate-refusals" };
    const request: Requester = async (path, init) => app.request(path, { ...init, headers });
    const target = (await (await post(request, "/targets", { kind: "ts-fixture", ref: "with-rpc-retry.ts" })).json()) as Target;
    const cases: [unknown, RegExp][] = [
      [{ shape: "retry-scenario", failtimes: 0, failure: "error" }, /no field "failtimes"/],
      [{ shape: "retry-scenario", failTimes: 0, failure: "error", errorKind: "500" }, /errorKind must be one of/],
      [{ shape: "retry-scenario", failTimes: 999, failure: "error" }, /failTimes 999 is outside/],
      [{ shape: "retry-scenario", failTimes: 0, failure: "error", attempts: 1000 }, /attempts 1000 is outside/],
      [{ shape: "concurrency-sweep", callers: 5, failTimes: 0, failure: "error" }, /cannot run on this target/],
      [{ shape: "fetch-url", url: "https://example.com" }, /unknown shape/],
    ];
    let n = 0;
    for (const [params, why] of cases) {
      const id = `refused-${n++}`;
      const res = await post(request, "/experiments", { ...exp(target, params), id });
      expect(res.status, JSON.stringify(params)).toBe(422);
      const body = (await res.json()) as { error: string; experiment: { gate: { allowed: boolean; reason?: string }; params: unknown } };
      expect(body.experiment.gate.allowed).toBe(false);
      expect(body.experiment.gate.reason).toMatch(why);
      expect(body.experiment.params).toEqual(params);
      // A refused experiment takes no bets and never runs.
      expect((await post(request, "/bets", { experimentId: id, who: "human", measures: "calls", answer: { kind: "integer", value: 1 } })).status).toBe(422);
      expect((await post(request, "/runs", { experimentId: id })).status).toBe(422);
    }
    expect(execs).toBe(0);
  });

  it("POST /runs: the old body (client-sealed bets) is refused with 400; nothing runs", async () => {
    let execs = 0;
    const app = createApp({ executor: { kind: "local", exec: async () => { execs++; throw new Error("must not run"); } } });
    const request: Requester = async (path, init) => app.request(path, init);
    const target = (await (await post(request, "/targets", { kind: "ts-fixture", ref: "with-rpc-retry.ts" })).json()) as Target;
    const good = sealBet({ experimentId: "e1", who: "human", question: QUESTIONS.calls, measures: "calls", answer: { kind: "integer", value: 1 } });
    const res = await post(request, "/runs", { experiment: { ...exp(target), runner: "ts", proposedBy: { role: "human" } }, bets: [good] });
    expect(res.status).toBe(400);
    expect(execs).toBe(0);
  });
});
