// Copied from the day-5 review's probes (probes5/), local paths made relative. Run: npx tsx tests/evidence/D05-review/probes/p1-machines.tsx
// Probe: retry machine + scoreboard on edge runs through the real in-process server (TS runner, no model).
import { renderToStaticMarkup } from "react-dom/server";
import { createApp } from "../../../../server/app.ts";
import { playRound } from "../../../../tests/tools/machine-pages.tsx";
import { retryModel, poseAt } from "../../../../web/machines/retry/model.ts";
import { capsuleWorld, move } from "../../../../web/machines/retry/geometry.ts";
import { RetryMachine } from "../../../../web/machines/retry/RetryMachine.tsx";
import { scoreboardMarks } from "../../../../web/machines/scoreboard/marks.ts";
import { OUTCOME_OPTIONS } from "../../../../src/units.ts";
import { createElement as h } from "react";

const O = [...OUTCOME_OPTIONS];
const app = createApp();
const cases: [string, any, any][] = [
  ["attempts10", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 10 }, { calls: { kind: "integer", value: 10 } }],
  ["watchcut", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 10, delayMs: 20000 }, { calls: { kind: "integer", value: 3 } }],
  ["onecall", { shape: "retry-scenario", failTimes: 0, failure: "error" }, { calls: { kind: "integer", value: 1 }, outcome: { kind: "enum", value: "returns", options: O } }],
  ["fail0_attempts1", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 1 }, { calls: { kind: "integer", value: 1 } }],
  ["slow-resolve", { shape: "retry-scenario", failTimes: 0, failure: "error", resolveAfterMs: 45000 }, { calls: { kind: "integer", value: 1 }, outcome: { kind: "enum", value: "returns", options: O } }],
];
for (const [id, params, answers] of cases) {
  try {
    const r = await playRound(app, id, params, answers);
    const m = retryModel(r);
    const end = poseAt(m, Infinity);
    const positions = new Set(end.capsules.map((c) => move(capsuleWorld(c.where, c.n))));
    const html = renderToStaticMarkup(h(RetryMachine, { run: r.run, bets: r.bets, verdicts: r.verdicts, still: true, theme: "light" }));
    const pullOn = (html.match(/rm-pull-marks[\s\S]*?<\/g>/)?.[0].match(/data-on/g) ?? []).length;
    const turnOn = (html.match(/rm-turn-marks[\s\S]*?<\/g>/)?.[0].match(/data-on/g) ?? []).length;
    const wakes = r.run.trace.filter((e) => e.event === "wake").length;
    console.log(JSON.stringify({ id, measured: r.run.result.measured, notMeasured: Object.keys(r.run.result.notMeasured ?? {}), events: r.run.trace.map((e) => e.event).join(" "), calls: m.calls.length, distinctCapsulePositions: positions.size, pulls: m.pulls, pullMarksOn: pullOn, waits: m.waits.length, wakes, turnMarksOn: turnOn, drumTurns: end.drumTurns, readout: m.readout, endCaption: m.endCaption, ghosts: m.ghosts, verdicts: r.verdicts.map((v) => [v.outcome, v.observed]) }));
  } catch (e) {
    console.log(id, "ERR", (e as Error).message);
  }
}

// Scoreboard: two bettors on different questions; same who on same measures twice (two experiments in one list).
const v = (betId: string, outcome: string) => ({ betId, runId: "r", outcome, observed: null } as any);
const b = (id: string, who: string, measures: string, experimentId = "e1") => ({ id, who, measures, question: `${measures}?`, experimentId } as any);
console.log("diffQ", JSON.stringify(scoreboardMarks([v("h1", "matched"), v("m1", "cant_check")], [b("h1", "human", "calls"), b("m1", "model:muse-spark-1.3", "outcome")]).map((mk) => mk.dots.map((d) => [mk.measures, d.who, d.outcome, d.filled, d.line?.reachesBar ?? null]))));
console.log("twoExp", JSON.stringify(scoreboardMarks([v("h1", "not_matched"), v("h2", "matched")], [b("h1", "human", "calls", "e1"), b("h2", "human", "calls", "e2")]).map((mk) => mk.dots.map((d) => [d.who, d.outcome]))));
console.log("cant", JSON.stringify(scoreboardMarks([v("h1", "cant_check"), v("m1", "cant_check")], [b("h1", "human", "x"), b("m1", "model:s", "x")])[0]!.dots.map((d) => [d.who, d.filled, d.noReading, d.line?.reachesBar, d.line?.y2])));
process.exit(0);
