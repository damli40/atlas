// Day-5 review, minors m1–m3 (m4–m7 are tested beside the items they touch:
// review-day5-why, review-day5-m7, review-day5-scoreboard).
// m1: a wait Atlas's watch limit cut off is drawn and described as unfinished. Before (probes5/p1):
//     "waits 2 × 20,000 ms", the drum turned twice, both turn marks lit, "it waited 2 times".
// m2: the watch-limit caption says "Still running", not "Still pending" (pending is a bet outcome).
// m3: the never-settled sentence no longer says "nothing was pending".
// A real run through the real server (TS runner, no model).

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import type { Run } from "../../src/types";
import { linkSentences, templatedSentences } from "../../src/why";
import { poseAt, retryModel } from "../../web/machines/retry/model";
import { RetryMachine } from "../../web/machines/retry/RetryMachine";
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

  it("the machine: 1 finished wait, 1 cut off (half a turn, no counter mark); the caption says 'Still running'", () => {
    const m = retryModel(cut);
    expect(m.waits.map((w) => w.finished)).toEqual([true, false]);
    expect(m.readout).toBe("calls 2 · waits 1 × 20,000 ms + 1 cut off · still waiting when Atlas stopped watching");
    expect(poseAt(m, Infinity).drumTurns).toBe(1.5);
    expect(poseAt(m, Infinity).waitsDone).toBe(1);
    expect(m.endCaption).toMatch(/^Still running at Atlas's watch limit: /);
    const html = renderToStaticMarkup(<RetryMachine run={cut.run} bets={cut.bets} verdicts={cut.verdicts} still theme="light" />);
    const turns = html.slice(html.indexOf("rm-turn-marks"), html.indexOf("</g>", html.indexOf("rm-turn-marks")));
    expect((turns.match(/data-on/g) ?? []).length).toBe(1);
    expect(html).toContain("that Atlas&#x27;s watch limit cut off (half a turn, never counted)");
    expect(html).not.toContain("Still pending");
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
