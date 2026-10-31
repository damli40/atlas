// U3 item 2: a test may make two or three calls on the same loaded file (`calls`), so a cache or a counter can be
// tested the only way it can: call twice. Run end to end in the real sandboxes (TypeScript and Python), gate-checked,
// described the same way to every bettor (D19), with the quiz about the LAST call.

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gate, describeCall, questionsFor } from "../../src/gate";
import { quizQuestionsFor } from "../../src/quiz";
import { makePastedTarget } from "../../src/pasted-code";
import { pyTopLevelFunctions } from "../../src/pasted-python";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile";
import { judge } from "../../src/judge";
import { sealBet } from "../../src/seal";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import { findPython } from "../../runners/executor/sandbox-exec-python";
import type { ArgSpec, Experiment, ExperimentShape, Run } from "../../src/types";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const PLAN = readFileSync(new URL("../evidence/U3/inputs/plan_cache.py", import.meta.url), "utf8");
const HAVE_PYTHON = findPython() !== null;
const j = (value: ArgSpec extends infer A ? (A extends { kind: "json"; value: infer V } ? V : never) : never): ArgSpec => ({ kind: "json", value });

const TS_CACHE = `const cache = new Map<number, string>();
let loads = 0;
export async function getPlan(id: number, load: (id: number) => Promise<string>): Promise<string> {
  if (cache.has(id)) return cache.get(id)!;
  loads++;
  const plan = await load(id);
  cache.set(id, plan);
  return plan;
}
export function loadCount(): number {
  return loads;
}
`;

function experiment(source: string, language: "py" | "ts", params: Call): Experiment {
  const names = language === "py" ? pyTopLevelFunctions(source).map((e) => e.name) : ["getPlan", "loadCount"];
  const g = gate(params, { exportNames: names, language });
  if (!g.allowed) throw new Error(`gate refused the test's own experiment: ${g.reason}`);
  return { id: "exp1", target: makePastedTarget(source, language), runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}
const twice = (exportName: string, args: ArgSpec[], waitMs?: number, watchLimitMs?: number): Call => ({
  shape: "call-function",
  exportName,
  args,
  calls: [{ exportName, args }, { exportName, args, ...(waitMs ? { waitMs } : {}) }],
  ...(watchLimitMs ? { watchLimitMs } : {}),
});

describe("U3 sequences: the gate", () => {
  const ctx = { exportNames: ["f", "g"] };
  const s = (calls: number): ArgSpec => ({ kind: "stand-in", name: "load", async: true, then: "repeat_last", calls: Array.from({ length: calls }, () => ({ do: "return" as const, value: 1 })) });
  it("allows two or three calls whose last is the experiment's own call", () => {
    expect(gate(twice("f", [j(1)]), ctx).allowed).toBe(true);
    expect(gate({ shape: "call-function", exportName: "f", args: [], calls: [{ exportName: "g", args: [] }, { exportName: "f", args: [] }] }, ctx).allowed).toBe(true);
  });
  it("refuses what would not run as written, with a plain reason", () => {
    const why = (p: unknown) => {
      const d = gate(p, ctx);
      return d.allowed ? "allowed" : d.reason;
    };
    expect(why({ shape: "call-function", exportName: "f", args: [j(1)], calls: [{ exportName: "f", args: [j(1)] }, { exportName: "f", args: [j(2)] }] })).toMatch(/last entry of calls must be exactly/);
    expect(why({ shape: "call-function", exportName: "f", args: [], calls: [{ exportName: "f", args: [] }] })).toMatch(/2 to 3 calls/);
    expect(why({ shape: "call-function", exportName: "f", args: [], calls: [0, 1, 2, 3].map(() => ({ exportName: "f", args: [] })) })).toMatch(/2 to 3 calls/);
    expect(why({ shape: "call-function", exportName: "f", args: [], calls: [{ exportName: "f", args: [], waitMs: 5 }, { exportName: "f", args: [] }] })).toMatch(/first call has no wait/);
    expect(why({ shape: "call-function", exportName: "f", args: [s(1)], calls: [{ exportName: "f", args: [s(2)] }, { exportName: "f", args: [s(1)] }] })).toMatch(/written differently in two calls/);
    expect(why(twice("f", [], 30_000))).toMatch(/not less than Atlas's watch limit/);
    expect(why({ shape: "call-function", exportName: "f", args: [], calls: [{ exportName: "nope", args: [] }, { exportName: "f", args: [] }] })).toMatch(/does not export "nope"/);
    expect(why({ shape: "call-function", exportName: "f", args: [], calls: [{ exportName: "f", args: [], extra: 1 }, { exportName: "f", args: [] }] })).toMatch(/has no field "extra"/);
  });
});

describe("U3 sequences: what every bettor reads", () => {
  it("says the calls in order, what carries over, and that the questions are about the last call", () => {
    const t = twice("get_user_plan", [j(true)], 61_000, 120_000);
    const d = describeCall(t, "py");
    expect(d).toBe("Atlas calls get_user_plan(True), then waits 61,000 ms, then calls get_user_plan(True): 2 calls in a row on the same loaded file, so anything the code keeps between calls (a cache, a counter) carries over. If an earlier call throws, Atlas notes it and still makes the next. The questions are about the 2nd (last) call; call counts are totals over all 2 calls.");
    const qs = questionsFor(t, { language: "py" });
    expect(qs.map((q) => q.text.slice(d.length + 1))).toEqual([
      "What does the 2nd call (get_user_plan) do?",
      "If the 2nd call (get_user_plan) returns, what value does it return, as JSON?",
      "How long does the 2nd call (get_user_plan) take, from its start until it returns or throws, in ms of Atlas's virtual clock?",
    ]);
    const withLoad = twice("f", [{ kind: "stand-in", name: "load", async: true, then: "repeat_last", calls: [{ do: "return", value: "pro" }] }]);
    const quiz = quizQuestionsFor(withLoad, ["f"], "ts");
    expect(quiz.find((q) => q.measures === "calls:load")!.text).toContain("In all 2 calls together, how many times is load called?");
  });
});

describe.skipIf(!HAVE_PYTHON)("U3 sequences: Python, the walkthrough's cache", () => {
  let control: Run;
  beforeAll(async () => {
    control = (await runPyCallControl()).run;
  }, 60_000);

  it("the control (with its three sequence cases) passes", () => {
    expect(control.controlPassed).toBe(true);
  });

  it("call twice: the 2nd call finds the cache and takes 0 ms", async () => {
    const r = await runPyCallExperiment(experiment(PLAN, "py", twice("get_user_plan", [j(1)])), control);
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"pro"', virtualMs: 0 });
    const ev = r.trace.filter((e) => ["call_start", "call_returned", "call_threw"].includes(e.event)).map((e) => [e.event, e.t, (e.data as { n: number }).n]);
    expect(ev).toEqual([
      ["call_start", 0, 1],
      ["call_returned", 500, 1],
      ["call_start", 500, 2],
    ]);
  }, 60_000);

  it("a sequence's proof file verifies, its time measured from the last call's start; a quiz time bet is judged on it", async () => {
    const exp = experiment(PLAN, "py", twice("get_user_plan", [j(1)]));
    const q = quizQuestionsFor(exp.params, ["get_user_plan"], "py").find((x) => x.measures === "virtualMs")!;
    const b = sealBet({ who: "human", experimentId: exp.id, question: q.text, measures: "virtualMs", answer: { kind: "quiz", choice: "a", options: [...q.quiz!] } });
    await new Promise((res) => setTimeout(res, 5));
    const r = await runPyCallExperiment(exp, control);
    expect(q.quiz![0]!.label).toBe("0 ms (no wait at all)");
    expect(judge(b, r).outcome).toBe("matched");
    const file = buildAtlasFile({ target: exp.target, experiment: exp, bets: [b], run: r, verdicts: [judge(b, r)], agentLog: [], createdAt: new Date().toISOString() });
    const v = verifyAtlasFile(JSON.parse(JSON.stringify(file)));
    expect(v.ok ? [] : v.problems).toEqual([]);
    // Tampering with the time is caught: the trace says the 2nd call started at 500 and ended at 500.
    const bad = JSON.parse(JSON.stringify(file));
    bad.runs[0].result.measured.virtualMs = 500;
    expect(verifyAtlasFile(bad).ok).toBe(false);
  }, 60_000);

  it("wait past the TTL between the calls: the 2nd call loads again and takes 500 ms", async () => {
    const r = await runPyCallExperiment(experiment(PLAN, "py", twice("get_user_plan", [j(1)], 61_000, 120_000)), control);
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"pro"', virtualMs: 500 });
  }, 60_000);

  it("an earlier call that throws is noted; the next call is still made and measured", async () => {
    const r = await runPyCallExperiment(experiment(PLAN, "py", { shape: "call-function", exportName: "get_user_plan", args: [j(2)], calls: [{ exportName: "get_user_plan", args: [j("x")] }, { exportName: "get_user_plan", args: [j(2)] }] }), control);
    expect(r.trace.find((e) => e.event === "call_threw")?.data).toMatchObject({ n: 1, name: "TypeError" });
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"free"', virtualMs: 500 });
  }, 60_000);

  it("an earlier call that never ends: the last call never starts, and nothing about it is reported", async () => {
    const src = "import asyncio\n\nasync def wait_forever(x):\n    await asyncio.Future()\n";
    const r = await runPyCallExperiment(experiment(src, "py", twice("wait_forever", [j(1)])), control);
    expect(r.result.measured).toEqual({});
    expect(r.result.notMeasured.outcome).toMatch(/call 1 of 2 did not finish \(it never settled\), so the last call never started/);
  }, 60_000);
});

describe("U3 sequences: TypeScript", () => {
  let control: Run;
  beforeAll(async () => {
    control = (await runCallControl()).run;
  }, 60_000);

  it("the control (with its sequence cases) passes", () => {
    expect(control.controlPassed).toBe(true);
  });

  it("call twice: the stand-in is called once over both calls; the 2nd call's own time is 0 ms", async () => {
    const load: ArgSpec = { kind: "stand-in", name: "load", async: true, then: "repeat_last", calls: [{ do: "return", value: "pro", afterMs: 300 }] };
    const r = await runCallExperiment(experiment(TS_CACHE, "ts", twice("getPlan", [j(7), load])), control);
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"pro"', virtualMs: 0, "calls:load": 1 });
  }, 60_000);

  it("two different functions in a row share the module: loadCount() after getPlan() is 1", async () => {
    const load: ArgSpec = { kind: "stand-in", name: "load", async: true, then: "repeat_last", calls: [{ do: "return", value: "pro" }] };
    const r = await runCallExperiment(experiment(TS_CACHE, "ts", { shape: "call-function", exportName: "loadCount", args: [], calls: [{ exportName: "getPlan", args: [j(7), load] }, { exportName: "loadCount", args: [] }] }), control);
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "1", virtualMs: 0, "calls:load": 1 });
  }, 60_000);
});

import { interestScoreWhy, pickDefaultTest } from "../../src/default-test";
import { keptState, smallLimits } from "../../src/code-facts";
import { fileOutline } from "../../src/file-outline";
import { benchModel, deviceId } from "../../web/machines/bench/model";
import { playScript } from "../../web/machines/bench/play";
import { formFromParams, paramsFromForm } from "../../web/screens/TestForm";

const ORDERS = readFileSync(new URL("../evidence/U3/inputs/orders.ts", import.meta.url), "utf8");

describe("U3 item 2: the default test hits an edge (plain-code rule)", () => {
  it("reads kept state and small limits from the text", () => {
    expect(keptState(PLAN, "py").map((k) => k.what)).toEqual(["a module-level dict (_cache)", "a caching decorator (@cached)"]);
    expect(smallLimits(ORDERS, "ts")).toEqual([3, 5]);
    expect(keptState(ORDERS, "ts")).toEqual([]);
  });

  it("on the cache, a second call beats a single call, and a wait past the TTL beats both", () => {
    const one: Call = { shape: "call-function", exportName: "get_user_plan", args: [j(1)] };
    const two = twice("get_user_plan", [j(1)]);
    const expiry = twice("get_user_plan", [j(1)], 61_000, 120_000);
    const code = { source: PLAN, language: "py" as const };
    expect(pickDefaultTest([one, two], code)).toBe(1);
    expect(pickDefaultTest([one, two, expiry], code)).toBe(2);
    expect(interestScoreWhy(expiry, code).edges).toEqual(["calls twice on code that keeps state", "waits between the calls (an expiry)"]);
  });

  it("on the walkthrough's paging code, the failure count that reaches the retry limit beats '429 twice then 200'", () => {
    const fake = (n429: number) => ({ replaces: "fetch" as const, then: "repeat_last" as const, calls: [...Array.from({ length: n429 }, () => ({ do: "respond" as const, status: 429, body: {} })), { do: "respond" as const, status: 200, body: { items: [{ id: "o1" }], nextCursor: null } }] });
    const twice429: Call = { shape: "call-function", exportName: "fetchAllOrders", args: [j("https://example.com/orders")], network: fake(2) };
    const limit429: Call = { ...twice429, network: fake(4) };
    const code = { source: ORDERS, language: "ts" as const };
    expect(pickDefaultTest([twice429, limit429], code)).toBe(1);
    // A fake that repeats its 429 fails on every call: it reaches the limit too, and beats "429 twice then 200".
    const forever: Call = { ...twice429, network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 429, body: {} }] } };
    expect(pickDefaultTest([twice429, forever], code)).toBe(1);
    expect(interestScoreWhy(limit429, code).edges).toContain("fails as many times as the code's limit");
    // A truncation: the fake keeps saying there is a next page while the test passes a page limit.
    const pages: Call = { shape: "call-function", exportName: "fetchAllOrders", args: [j("https://example.com/orders"), j(2)], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: { items: [{ id: "o1" }], nextCursor: "c2" } }] } };
    expect(interestScoreWhy(pages, code).edges).toContain("keeps saying there is another page");
  });

  it("without the file's text the rule is U2's (no edge points)", () => {
    expect(interestScoreWhy(twice("get_user_plan", [j(1)])).edges).toEqual([]);
  });
});

describe("U3 sequences on the drawing and in the form", () => {
  it("the replay says each call of the sequence, and how call 1 ended, before the ending", () => {
    const t = twice("get_user_plan", [j(1)]);
    const run = {
      id: "r", experimentId: "e", runner: "ts", executor: "local", codeSha256: "x", startedAt: "", finishedAt: "", controlPassed: true,
      trace: [
        { t: 0, event: "start", data: { exportName: "get_user_plan", calls: 2 } },
        { t: 0, event: "call_start", data: { n: 1, exportName: "get_user_plan" } },
        { t: 500, event: "call_returned", data: { n: 1, type: "string", json: '"pro"' } },
        { t: 500, event: "call_start", data: { n: 2, exportName: "get_user_plan" } },
        { t: 500, event: "returned", data: { type: "string" } },
      ],
      result: { measured: { outcome: "returned", virtualMs: 0, returnedJson: '"pro"', returnedType: "string" }, notMeasured: {} },
    } as unknown as Run;
    const o = fileOutline(PLAN, "py");
    const s = playScript(run, t, "get_user_plan", [], { outline: o, callers: {}, language: "py" });
    expect(s.steps.map((x) => x.words)).toEqual(["Atlas makes call 1 of 2: get_user_plan", 'call 1 returned "pro"', "Atlas makes call 2 of 2: get_user_plan", expect.stringMatching(/^returned/)]);
    // Calling the decorated function lights its decorator's wrapper too (it runs first).
    expect(s.steps[0]!.parts).toEqual(["get_user_plan", "cached"]);
  });

  it("a stand-in passed to every call of a sequence is one device, wired once", () => {
    const load: ArgSpec = { kind: "stand-in", name: "load", async: true, then: "repeat_last", calls: [{ do: "return", value: "pro" }] };
    const o = fileOutline(TS_CACHE, "ts");
    const m = benchModel({ fileName: "pasted.ts", outline: o, test: twice("getPlan", [j(7), load]), source: TS_CACHE, language: "ts" });
    expect(m.lines.filter((l) => l.to === deviceId("load")).map((l) => l.from)).toEqual(["getPlan"]);
    expect(Object.keys(m.parts).filter((k) => k.startsWith("stand-in "))).toEqual(["stand-in load"]);
  });

  it("editing a sequence test keeps its earlier calls and its fake network (the form edits the last call)", () => {
    const t = { ...twice("f", [j(1)], 50), network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: {} }] } };
    const f = formFromParams(t);
    expect(f.kept).toEqual({ network: t.network, earlier: [t.calls![0]], lastWaitMs: 50 });
    f.args = [{ kind: "json", value: "2" }];
    const r = paramsFromForm("f", f);
    expect(r.ok && r.params).toEqual({ shape: "call-function", exportName: "f", args: [j(2)], network: t.network, calls: [t.calls![0], { exportName: "f", args: [j(2)], waitMs: 50 }] });
    expect(gate(r.ok ? r.params : null, { exportNames: ["f"] }).allowed).toBe(true);
  });
});

import { lastCallStartOf, quizBeyondLimit } from "../../src/judge";

describe("U3 sequences: a last call still running at the watch limit", () => {
  it("has run for the limit minus its own start, and timing options are judged on that", () => {
    const run = { trace: [{ t: 0, event: "start", data: { watchLimitMs: 3000, calls: 2 } }, { t: 0, event: "call_start", data: { n: 1 } }, { t: 1000, event: "call_start", data: { n: 2 } }, { t: 3000, event: "still_running_at_watch_limit" }] } as unknown as Run;
    expect(lastCallStartOf(run)).toBe(1000);
    expect(lastCallStartOf({ trace: [{ t: 0, event: "start", data: { watchLimitMs: 3000 } }] } as unknown as Run)).toBe(0);
    const options = [
      { id: "a", label: "0 ms", match: { kind: "ms" as const, min: 0, max: 0, minOpen: false, maxOpen: false } },
      { id: "b", label: "more than 0 ms, less than 2,500 ms", match: { kind: "ms" as const, min: 0, max: 2500, minOpen: true, maxOpen: true } },
      { id: "c", label: "more than 2,500 ms", match: { kind: "ms" as const, min: 2500, max: null, minOpen: true, maxOpen: false } },
    ];
    // The last call has run for 2,000 ms: "more than 2,500" holds some of those times, so it stays can't check (null).
    expect(quizBeyondLimit("c", options, 3000 - lastCallStartOf(run))).toBeNull();
    expect(quizBeyondLimit("a", options, 3000 - lastCallStartOf(run))).toBe(false);
  });
});
