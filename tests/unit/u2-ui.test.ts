// U2 (D53): the pure parts of the drawing screen's fixes: the replay script (waits, the fake network, the thrown value,
// the watch limit), the results headline and the collapsed reason, the default proposal and the waiting parts, and the
// wording rule on every new string.

import { describe, expect, it } from "vitest";
import { marksOf, playScript, thrownWords, MAX_PLAY_STEPS, type Mark } from "../../web/machines/bench/play";
import { headlineOf, sharedReason, roundUp } from "../../web/machines/bench/BenchStage";
import { defaultProposal, waitingParts } from "../../web/screens/Studio";
import { BET_WORDS, RESULT_WORDS, STAGE_WORDS, WONDER_ROLE, betterByRole } from "../../src/paste-words";
import { quizQuestionsFor } from "../../src/quiz";
import type { ExperimentShape, Run } from "../../src/types";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const run = (over: Partial<Run>): Run => ({ id: "r1", experimentId: "e1", runner: "ts", executor: "local", codeSha256: "x", startedAt: "2026-10-29T00:00:01.000Z", finishedAt: "2026-10-29T00:00:02.000Z", trace: [], result: { measured: {}, notMeasured: {} }, controlPassed: true, ...over });
const fetchTest: Call = { shape: "call-function", exportName: "fetchWithRetry", args: [{ kind: "json", value: "u" }], network: { replaces: "fetch", calls: [{ do: "respond", status: 503, body: {} }, { do: "never_answer" }, { do: "respond", status: 200, body: { ok: 1 } }], then: "repeat_last" } };

describe("U2 the replay script", () => {
  const r = run({
    trace: [
      { t: 0, event: "start", data: { exportName: "fetchWithRetry", args: 1, watchLimitMs: 30000 } },
      { t: 0, event: "stand_in_call", data: { name: "fetch", n: 1 } },
      { t: 0, event: "stand_in_returns", data: { name: "fetch", n: 1 } },
      { t: 263, event: "stand_in_call", data: { name: "fetch", n: 2 } },
      { t: 263, event: "stand_in_never_answers", data: { name: "fetch", n: 2 } },
      { t: 5263, event: "stand_in_throws", data: { name: "fetch", n: 2, errorName: "AbortError", aborted: true } },
      { t: 5710, event: "stand_in_call", data: { name: "fetch", n: 3 } },
      { t: 5710, event: "stand_in_returns", data: { name: "fetch", n: 3 } },
      { t: 5710, event: "returned", data: { type: "object" } },
      { t: 5710, event: "clock_moves", data: { at: [263, 5263, 5710] } },
    ],
    result: { measured: { outcome: "returned", virtualMs: 5710, returnedJson: '{"ok":1}', returnedType: "object", "calls:fetch": 3 }, notMeasured: {} },
  });
  it("every call of the fake network lights its device with the scripted words; waits light the waiting parts; the ending comes last", () => {
    const s = playScript(r, fetchTest, "fetchWithRetry", ["sleep"]);
    expect(s.steps.filter((x) => x.kind === "call").map((x) => x.words)).toEqual(["fetch call 1: answers 503 with {}", "fetch call 2: never answers; the code gave up (AbortError)", "fetch call 3: answers 200 with {\"ok\":1}"]);
    expect(s.steps.filter((x) => x.kind === "wait")).toEqual([expect.objectContaining({ at: 5263, parts: ["sleep"], words: "waits until 5,263 ms" })]);
    expect(s.steps[s.steps.length - 1]).toMatchObject({ kind: "end", words: expect.stringMatching(/^returned at 5,710 ms/) });
    expect(s.totals["stand-in fetch"]).toBe("3 calls");
  });
  it("a run that may not be shown as fact plays nothing", () => {
    const s = playScript(run({ result: { measured: {}, notMeasured: { wholeRun: "no" } }, trace: [{ t: 0, event: "x" }] }), fetchTest, "fetchWithRetry");
    expect(s.steps).toEqual([]);
    expect(s.notShown).not.toBeNull();
  });
  it("many waits are thinned to at most MAX_PLAY_STEPS steps", () => {
    const at = Array.from({ length: 300 }, (_, i) => (i + 1) * 10);
    const s = playScript(run({ trace: [{ t: 0, event: "start", data: { watchLimitMs: 30000 } }, { t: 3000, event: "returned" }, { t: 3000, event: "clock_moves", data: { at } }], result: { measured: { outcome: "returned", virtualMs: 3000, returnedJson: "1", returnedType: "number" }, notMeasured: {} } }), { shape: "call-function", exportName: "f", args: [] }, "f");
    expect(s.steps.length).toBeLessThanOrEqual(MAX_PLAY_STEPS + 1);
  });
  it("still running at the watch limit: the dial goes to the limit, said as such", () => {
    const s = playScript(run({ trace: [{ t: 0, event: "start", data: { watchLimitMs: 10000 } }, { t: 10000, event: "still_running_at_watch_limit" }], result: { measured: { outcome: "still_running_at_watch_limit" }, notMeasured: { virtualMs: "still running" } } }), { shape: "call-function", exportName: "f", args: [] }, "f");
    expect(s).toMatchObject({ dialEndMs: 10000, atLimit: true });
  });
  it("the thrown value is said plainly", () => {
    expect(thrownWords(run({ result: { measured: { outcome: "threw", thrownType: "undefined" }, notMeasured: {} } }))).toBe("undefined (not an Error)");
    expect(thrownWords(run({ result: { measured: { outcome: "threw", thrownType: "Error", thrownName: "TypeError", thrownMessage: "bad key" }, notMeasured: {} } }))).toBe("TypeError: bad key");
    const qs = quizQuestionsFor({ shape: "call-function", exportName: "f", args: [] });
    const m = marksOf(qs, [], [], run({ trace: [{ t: 0, event: "start" }], result: { measured: { outcome: "threw", thrownType: "undefined", virtualMs: 0 }, notMeasured: {} } }), "f");
    expect(m.find((x) => x.measures === "outcome")!.measured).toBe("throws undefined (not an Error)");
  });
  it("the dial rescales to a round number above the run's end", () => {
    expect([roundUp(5710), roundUp(10000), roundUp(263)]).toEqual([6000, 10000, 300]);
  });
});

describe("U2 results", () => {
  const mk = (measures: string, measured: string, picks: [string, string, Mark["picks"][number]["outcome"]][]): Mark => ({ measures, anchor: "f", question: measures, measured, picks: picks.map(([who, name, outcome]) => ({ who, name, pick: "x", outcome })) });
  it("the headline counts each bettor's matched of checkable answers, Muse Spark before Muse Spark Open", () => {
    const marks = [
      mk("outcome", "returns a value", [["human", "You", "matched"], ["model:meta-models/muse-spark-open-1026", "Muse Spark Open (meta-models/muse-spark-open-1026)", "not_matched"], ["model:muse-spark-1.3", "Muse Spark 1.3 (muse-spark-1.3)", "matched"]]),
      mk("returnedJson", "can't check: threw", [["human", "You", "cant_check"], ["model:meta-models/muse-spark-open-1026", "Muse Spark Open (meta-models/muse-spark-open-1026)", "cant_check"], ["model:muse-spark-1.3", "Muse Spark 1.3 (muse-spark-1.3)", "cant_check"]]),
      mk("virtualMs", "0 ms", [["human", "You", "not_matched"], ["model:meta-models/muse-spark-open-1026", "Muse Spark Open (meta-models/muse-spark-open-1026)", "matched"], ["model:muse-spark-1.3", "Muse Spark 1.3 (muse-spark-1.3)", "matched"]]),
    ];
    expect(headlineOf(marks)).toBe("You matched 1 of 2 checkable answers. Muse Spark 1.3 matched 2, Muse Spark Open 1.");
  });
  it("a reason every mark shares is said once", () => {
    const same = [mk("a", "can't check: fetch is blocked", []), mk("b", "can't check: fetch is blocked", [])];
    expect(sharedReason(same)).toBe("fetch is blocked");
    expect(sharedReason([...same, mk("c", "3 times", [])])).toBeNull();
  });
});

describe("U2 the default proposal and the waiting parts", () => {
  it("picks the most interesting allowed proposal; refused ones never count", () => {
    const degenerate = { id: "a", gate: { allowed: true }, params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: -1 }] } };
    const refused = { id: "b", gate: { allowed: false }, params: fetchTest };
    const good = { id: "c", gate: { allowed: true }, params: fetchTest };
    expect(defaultProposal([degenerate, refused, good])!.id).toBe("c");
    expect(defaultProposal([refused])).toBeUndefined();
  });
  it("waiting parts are the boxes whose own lines hold a timer or a sleep", () => {
    const src = "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\nexport function f() {\n  return 1;\n}\n";
    const outline = { parts: [{ name: "sleep", lineStart: 1, lineEnd: 1 }, { name: "f", lineStart: 2, lineEnd: 4 }], joins: [] } as unknown as Parameters<typeof waitingParts>[1];
    expect(waitingParts(src, outline)).toEqual(["sleep"]);
  });
});

describe("U2 words", () => {
  it("introduces each AI by role with its Meta name, and never uses the banned words", () => {
    expect(BET_WORDS.ais(["Muse Spark 1.3 (Meta)", "Muse Spark Open (Meta, open weights)"])).toBe("Two AIs bet too, without seeing your answers: Muse Spark 1.3 (Meta) and Muse Spark Open (Meta, open weights).");
    expect(betterByRole("muse-spark-1.3")).toBe("Muse Spark 1.3 (Meta)");
    expect(betterByRole("meta-models/muse-spark-open-1026")).toBe("Muse Spark Open (Meta, open weights)");
    const all = [
      WONDER_ROLE,
      ...Object.values(BET_WORDS).map((v) => (typeof v === "function" ? (v as (...a: unknown[]) => string)("x" as never, 1 as never) : v)),
      BET_WORDS.zone("py"),
      BET_WORDS.watch(10000, true),
      ...Object.values(STAGE_WORDS).map((v) => (typeof v === "function" ? (v as (a: string) => string)("fetch") : v)),
      ...Object.values(RESULT_WORDS).map((v) => (typeof v === "function" ? (v as (...a: unknown[]) => string)({ matched: 1, checkable: 2 }, []) : v)),
    ].join("\n");
    expect(all).not.toMatch(/\b(right|wrong|correct\w*|score\w*|learn\w*|teach\w*)\b/i);
  });
});
