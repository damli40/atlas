// Day-5 review, minors m1–m3 (m4–m7 are tested beside the items they touch:
// review-day5-why, review-day5-m7, review-day5-scoreboard).
// m1: a wait Atlas's watch limit cut off is described as unfinished. Before (probes5/p1, on the old figure):
//     "waits 2 × 20,000 ms", "it waited 2 times".
// m2: the watch limit is never called "pending" (pending is a bet outcome).
// m3: the never-settled sentence no longer says "nothing was pending".
// A real run through the real server (TS runner, no model).

import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import type { Run } from "../../src/types";
import { linkSentences, templatedSentences } from "../../src/why";
import { retryDemo } from "../../renderer/authors/what-happened";
import { playRound, type Round } from "../tools/machine-pages";

let cut: Round;
beforeAll(async () => {
  cut = await playRound(createApp(), "watchcut", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 10, delayMs: 20000 }, { calls: { kind: "integer", value: 3 } });
}, 60_000);

describe("m1 + m2: a wait cut off by the watch limit", () => {
  it("the trace: 2 sleeps, 1 wake, then Atlas stopped watching", () => {
    const ev = cut.run.trace.map((e) => e.event);
    expect(ev.filter((e) => e === "sleep")).toHaveLength(2);
    expect(ev.filter((e) => e === "wake")).toHaveLength(1);
    expect(ev.at(-1)).toBe("stopped_watching");
  });

  it("the retry demo: 2 calls; never 2 finished waits; the watch limit named as Atlas's; never 'pending' and no ending claimed", () => {
    const s = retryDemo({ run: cut.run, bets: cut.bets, verdicts: cut.verdicts });
    expect(s.nodes.filter((n) => n.words === "called the RPC")).toHaveLength(2);
    const words = JSON.stringify([s.nodes.map((n) => n.words), s.captions.map((c) => c.words), s.marks.map((m) => m.words)]);
    // The second wait was cut off by the watch limit: at most the first may read as a wait that finished.
    expect(s.nodes.filter((n) => n.words === "waited 20,000 ms").length).toBe(1);
    expect(s.nodes.map((n) => n.words)).toContain("asked to wait 20,000 ms; Atlas stopped during it");
    expect(words).not.toMatch(/2 × /);
    expect(s.nodes.at(-1)!.words).toMatch(/^Atlas can't say how it ended: Atlas's watch limit \(30000 ms of virtual time, Atlas's limit, not the code's\) ended the run/);
    expect(s.nodes.some((n) => /^(returned|threw)/.test(n.words))).toBe(false);
    expect(words).not.toMatch(/pending/i);
    expect(s.marks.map((m) => m.kind)).toEqual(["cant-check"]);
  });

  it("Ask why: 'it waited 1 time', and the cut-off wait said apart; both linked", () => {
    const t = templatedSentences(cut.run).map((s) => s.text);
    expect(t[0]).toMatch(/^it waited 1 time, 20000 ms each \(trace #\d+\)$/);
    expect(t[1]).toMatch(/^it asked to wait 20000 ms more, and Atlas's watch limit ended the run during that wait \(trace #\d+, #\d+\)$/);
    expect(linkSentences(templatedSentences(cut.run), cut.run, []).dropped).toEqual([]);
  });
});

describe("m3: the never-settled sentence", () => {
  it("says nothing outside it was left to run", () => {
    const run = { runner: "ts", controlPassed: true, result: { measured: {}, notMeasured: {} }, trace: [{ t: 0, event: "call", data: { n: 1 } }, { t: 0, event: "no_answer", data: { n: 1 } }, { t: 0, event: "pending" }] } as unknown as Run;
    expect(templatedSentences(run).map((s) => s.text)).toEqual(["the call never settled: no timers were left and nothing outside it was left to run (trace #2)"]);
  });
});
