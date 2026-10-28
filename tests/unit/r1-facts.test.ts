// R1 (D36): the false facts bench T2 found, fixed, and what Atlas now reports instead.
//
// Plain words: tests/fixtures/r1-t2/ holds bench T2's 8 case files, copied unchanged from branch b1-bench
// (bench/truth-2/cases/). Each of its 22 tests runs here through Atlas's real local runners (Node --permission for
// JavaScript, macOS sandbox-exec for Python) and is checked against what T2's PASS-RULE.md calls honest:
// - a plain fact where one exists (compared exactly);
// - "not measured, with a reason of the registered category" where the true value depends on something outside the
//   code (the category patterns below are copied from T2's expected.json);
// - for the 4 tests whose outside thing Atlas now PINS (time zone, Math.random, crypto.randomUUID, Python's hash
//   seed): the pinned value, reported WITH its condition. T2's pass rule counts those as honest only after an
//   amendment (see tests/evidence/R1/README.md); this file asserts the label is there and the value is reproducible.
// Then: seeding reproduces, every condition kind is detected, proof files carry and verify the pins, and the D31
// control fingerprints follow the harness files.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import { CALL_PINNED_SEED, conditionKindsInTrace } from "../../src/conditions.ts";
import { PASTE_WORDS, CONDITION_WORDS } from "../../src/paste-words.ts";
import { CALL_ENV, CALL_SEED, callControlKey, callHarnessSha256, runCallControl, runCallExperiment } from "../../runners/ts/call-runner.ts";
import { pyControlKey, pyHarnessSha256, runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner.ts";
import { findPython, pythonRefusal, pythonSandboxExecutor } from "../../runners/executor/sandbox-exec-python.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import type { ArgSpec, Experiment, ExperimentShape, Run } from "../../src/types.ts";

const HAVE_PYTHON = pythonRefusal() === null && findPython() !== null;
const FIX = new URL("../fixtures/r1-t2/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, FIX), "utf8");

/** T2's registered reason categories (bench/truth-2/expected.json on b1-bench), the ones these cases use. */
const CATEGORY: Record<string, RegExp[]> = {
  clock: [/clock/i, /cpu time/i, /elapsed/i],
  "real-time": [/limit of REAL time/i, /finishes in real time/i],
  scheduling: [/order/i, /schedul/i],
  "process-lifetime": [/unref/i, /keeps? the process alive/i, /process would (exit|end|stop)/i],
};
const inCategory = (why: string | undefined, cat: string) => typeof why === "string" && CATEGORY[cat]!.some((re) => re.test(why));

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
function experiment(source: string, language: "js" | "py", exportName: string, args: ArgSpec[] = []): Experiment {
  const target = makePastedTarget(source, language);
  const params: Call = { shape: "call-function", exportName, args };
  const g = gate(params, { exportNames: exportedFunctionsFor(source, language).map((e) => e.name).concat(exportName) });
  if (!g.allowed) throw new Error(`gate refused the test's own experiment: ${g.reason}`);
  return { id: `r1-${exportName}`, target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

let jsControl: Run;
let pyControl: Run | null = null;
beforeAll(async () => {
  jsControl = (await runCallControl()).run;
  if (HAVE_PYTHON) pyControl = (await runPyCallControl()).run;
}, 60_000);

async function run(source: string, language: "js" | "py", exportName: string, args: ArgSpec[] = [], seed?: string): Promise<Run> {
  const exp = experiment(source, language, exportName, args);
  const opts = seed !== undefined ? { seed } : {};
  return language === "py" ? runPyCallExperiment(exp, pyControl!, opts) : runCallExperiment(exp, jsControl, opts);
}
const kinds = (r: Run) => (r.conditions ?? []).map((c) => c.kind);
const standIn = (name: string, calls: Extract<ArgSpec, { kind: "stand-in" }>["calls"], async = false): ArgSpec => ({ kind: "stand-in", name, async, then: "repeat_last", calls });

describe("the controls pass with the pins (C10-pins, P14-pins)", () => {
  it("JavaScript", () => expect(jsControl.controlPassed, JSON.stringify(jsControl.result.notMeasured)).toBe(true));
  it.skipIf(!HAVE_PYTHON)("Python", () => expect(pyControl!.controlPassed, JSON.stringify(pyControl!.result.notMeasured)).toBe(true));
});

// ---- the 22 T2 tests ----

/** Honest under T2's pass rule as written: how the call ends is not reported, with a reason of the category. */
function expectOutcomeNotMeasured(r: Run, cat: string) {
  expect(r.controlPassed).toBe(true);
  expect(r.result.measured.outcome, JSON.stringify(r.result.measured)).toBeUndefined();
  expect(r.result.measured.returnedJson).toBeUndefined();
  const why = r.result.notMeasured.wholeRun ?? r.result.notMeasured.outcome;
  expect(inCategory(why, cat), why).toBe(true);
}

describe("bench T2, the 13 JavaScript tests and 9 Python tests: what Atlas reports now", () => {
  const h01 = read("h01-cpu-elapsed.js");
  it("h01a timeWork (CPU work timed with Date.now / performance.now): not reported, clock reason (was: dateMs 0, a FALSE FACT)", async () => {
    const r = await run(h01, "js", "timeWork");
    expectOutcomeNotMeasured(r, "clock");
    expect(kinds(r)).toEqual(["clock", "clock-during-work"]);
  });
  it("h01b spinWait (busy-wait on Date.now): whole-run can't check, real-time reason (unchanged)", async () => {
    const r = await run(h01, "js", "spinWait");
    expect(inCategory(r.result.notMeasured.wholeRun, "real-time") || inCategory(r.result.notMeasured.wholeRun, "clock")).toBe(true);
  }, 20_000);

  const h02 = read("h02-unref.js");
  for (const name of ["unrefWait", "abortOnly"]) {
    it(`h02 ${name} (waits only on an unref'd timer): not reported, process-lifetime reason (was: returned / threw at 100 ms)`, async () => {
      const r = await run(h02, "js", name);
      expectOutcomeNotMeasured(r, "process-lifetime");
      expect(kinds(r)).toContain("unref-timer");
    });
  }

  const h03 = read("h03-order.js");
  for (const name of ["immediateVsTimeout", "tickVsPromise"]) {
    it(`h03 ${name} (an order Node leaves open): not reported, scheduling reason (was: one order as a fact)`, async () => {
      const r = await run(h03, "js", name);
      expectOutcomeNotMeasured(r, "scheduling");
      expect(kinds(r)).toContain("timer-order");
    });
  }

  const h04 = read("h04-env.js");
  it("h04a localHour: the pinned UTC answer, labelled time-zone-or-locale (was: the Mac's Africa/Lagos, unlabelled)", async () => {
    const r = await run(h04, "js", "localHour");
    expect(r.result.measured.returnedJson).toBe('{"hour":0,"offset":0,"tz":"UTC"}');
    expect(kinds(r)).toEqual(["clock", "time-zone-or-locale"]);
    expect(r.timeZone).toBe("UTC");
    expect(r.locale).toBe("en-US");
  });
  it("h04b coin (Math.random): the seed's answer, labelled randomness, the same every run (was: heads, then tails)", async () => {
    const [a, b] = [await run(h04, "js", "coin"), await run(h04, "js", "coin")];
    expect(a.result.measured.returnedJson).toBe('"tails"');
    expect(b.result.measured).toEqual(a.result.measured);
    expect(kinds(a)).toEqual(["randomness"]);
    expect(a.seed).toBe(CALL_PINNED_SEED);
  });
  it("h04c uuidPrefix (crypto.randomUUID): the seed's answer, labelled randomness, the same every run", async () => {
    const [a, b] = [await run(h04, "js", "uuidPrefix"), await run(h04, "js", "uuidPrefix")];
    expect(a.result.measured.returnedJson).toBe('"b6cb50a1"');
    expect(b.result.measured.returnedJson).toBe(a.result.measured.returnedJson);
    expect(kinds(a)).toEqual(["randomness"]);
  });

  const h05 = read("h05-interval.js");
  it("h05a ticks (setInterval 0 ms cleared after 3): 3 at 3 ms, cb x3 (correct before and after)", async () => {
    const r = await run(h05, "js", "ticks", [standIn("cb", [{ do: "return", value: null }])]);
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "3", returnedType: "number", virtualMs: 3, "calls:cb": 3 });
  });
  it("h05b refreshed (timer.refresh): 160 at 160 ms, labelled clock (correct before and after)", async () => {
    const r = await run(h05, "js", "refreshed");
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "160", returnedType: "number", virtualMs: 160 });
    expect(kinds(r)).toEqual(["clock"]);
  });

  const h06 = read("h06-inner-type.js");
  for (const [name, type, mention] of [
    ["bigInList", "array", "BigInt"],
    ["nanInList", "array", "NaN"],
    ["undefinedInObject", "object", "undefined"],
    ["dateInObject", "object", "Date"],
  ] as const) {
    it(`h06 ${name}: returnedType ${type}, the reason names the ${mention} inside (was: the inner item's type)`, async () => {
      const r = await run(h06, "js", name);
      expect(r.result.measured).toMatchObject({ outcome: "returned", returnedType: type, virtualMs: 0 });
      expect(r.result.measured.returnedJson).toBeUndefined();
      expect(r.result.notMeasured.returnedJson).toContain(mention);
    });
  }

  describe.skipIf(!HAVE_PYTHON)("Python", () => {
    const p01 = () => read("p01-set-order.py");
    it("q01a fruit_list (list of a set of text): the hash seed's order, labelled hash-seed, the same every run (was: a different order per run)", async () => {
      const [a, b] = [await run(p01(), "py", "fruit_list"), await run(p01(), "py", "fruit_list")];
      expect(a.result.measured.returnedJson).toBe('["cherry","date","banana","grape","fig","elder","apple"]');
      expect(b.result.measured.returnedJson).toBe(a.result.measured.returnedJson);
      expect(kinds(a)).toContain("hash-seed");
      expect(a.locale).toBe("C");
    });
    it("q01b int_keys: object, not JSON because of a key (correct before and after)", async () => {
      const r = await run(p01(), "py", "int_keys");
      expect(r.result.measured).toMatchObject({ outcome: "returned", returnedType: "object", virtualMs: 0 });
      expect(r.result.notMeasured.returnedJson).toContain("key");
    });
    it("q01c tuple_inside: returnedType array, the reason names the tuple inside (was: tuple, a FALSE FACT)", async () => {
      const r = await run(p01(), "py", "tuple_inside");
      expect(r.result.measured).toMatchObject({ outcome: "returned", returnedType: "array", virtualMs: 0 });
      expect(r.result.notMeasured.returnedJson).toMatch(/at \[0\], tuple.*tuple/);
    });
    it("q01d float_two: 2 (correct before and after)", async () => {
      const r = await run(p01(), "py", "float_two");
      expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "2", returnedType: "number", virtualMs: 0 });
    });
    const p02 = () => read("p02-timing.py");
    it("q02a block_then_await: ['v', 500] at 500 ms, fetch x1, labelled clock (correct before and after)", async () => {
      const r = await run(p02(), "py", "block_then_await", [standIn("fetch", [{ do: "return", value: "v", afterMs: 100 }], true)]);
      expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '["v",500]', returnedType: "array", virtualMs: 500, "calls:fetch": 1 });
      expect(kinds(r)).toEqual(["clock"]);
    });
    it("q02b deadline: 'timed out' at 100 ms, fetch x1 (correct before and after)", async () => {
      const r = await run(p02(), "py", "deadline", [standIn("fetch", [{ do: "return", value: "v", afterMs: 500 }], true)]);
      expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"timed out"', returnedType: "string", virtualMs: 100, "calls:fetch": 1 });
    });
    it("q02c cpu_elapsed (perf_counter around CPU work): not reported, clock reason (was: false, a FALSE FACT)", async () => {
      const r = await run(p02(), "py", "cpu_elapsed");
      expectOutcomeNotMeasured(r, "clock");
      expect(kinds(r)).toContain("clock-during-work");
    });
  });
});

// ---- seeding ----

describe("seeding: same seed, same run; the seed is recorded and replays use it", () => {
  const src = "export function draw(){ const b = new Uint8Array(4); crypto.getRandomValues(b); return [Math.random(), Math.random(), [...b], crypto.randomUUID()]; }";
  it("two runs of Math.random / getRandomValues / randomUUID code give identical measurements", async () => {
    const a = await run(src, "js", "draw");
    const b = await run(src, "js", "draw");
    expect(a.result.measured.returnedJson).toBeDefined();
    expect(b.result.measured).toEqual(a.result.measured);
    expect(a.seed).toBe(CALL_SEED);
  });
  it("another seed gives other values, recorded on the run; replaying with that seed reproduces it exactly", async () => {
    const a = await run(src, "js", "draw", [], "42");
    const again = await run(src, "js", "draw", [], "42");
    const dflt = await run(src, "js", "draw");
    expect(a.seed).toBe("42");
    expect(a.result.measured.returnedJson).not.toBe(dflt.result.measured.returnedJson);
    expect(again.result.measured).toEqual(a.result.measured);
    expect(a.conditions?.[0]?.says).toContain("seed 42");
  });
  it("a seed Atlas does not use (none, 0, text) falls back to the default seed", async () => {
    for (const s of ["none", "0", "abc"]) expect((await run("export const f = () => 1;", "js", "f", [], s)).seed).toBe(CALL_SEED);
  });
  it("an invalid seed in the worker request is refused by the worker, not run unseeded", async () => {
    const { runInSandbox } = await import("../../runners/ts/call-runner.ts");
    const res = await runInSandbox(localExecutor, "export const f = () => 1;", "js", { runs: [{ id: "x", exportName: "f", args: [], watchLimitMs: 1000 }], seed: "0" }, 10_000);
    expect(res.ok).toBe(false);
  });
  it.skipIf(!HAVE_PYTHON)("Python: random, uuid4, secrets, os.urandom and Random() are the same on every run, and differ with another seed", async () => {
    const py = "import os, random, secrets, uuid\n\ndef draw():\n    return [random.random(), str(uuid.uuid4()), secrets.token_hex(4), os.urandom(2).hex(), random.Random().random(), list({'a', 'b', 'c', 'd', 'e'})]\n";
    const a = await run(py, "py", "draw");
    const b = await run(py, "py", "draw");
    const c = await run(py, "py", "draw", [], "7");
    expect(a.result.measured.returnedJson).toBeDefined();
    expect(b.result.measured).toEqual(a.result.measured);
    expect(c.result.measured.returnedJson).not.toBe(a.result.measured.returnedJson);
    expect(kinds(a)).toEqual(expect.arrayContaining(["randomness", "hash-seed"]));
  });
});

// ---- conditions, one per kind ----

describe("conditions are detected for each kind, and only the undecided kinds hide how the call ended", () => {
  const js: [string, string, string, string[], boolean][] = [
    ["no clock, no randomness: no conditions (the line says None)", "export const f = (a) => a + 1;", "f", [], true],
    ["clock (Date.now)", "export function f(){ return Date.now(); }", "f", ["clock"], true],
    ["clock (new Date() with no argument, performance.now, process.hrtime)", "export function f(){ new Date(); performance.now(); process.hrtime(); return 1; }", "f", ["clock"], true],
    ["a deadline loop reading the clock between waits is NOT timed work", "export async function f(){ const end = Date.now() + 500; let n = 0; while (Date.now() < end) { n++; await new Promise(r => setTimeout(r, 100)); } return n; }", "f", ["clock"], true],
    ["clock-during-work", "export function f(){ const t = Date.now(); let x = 0; for (let i = 0; i < 2e7; i++) x = (x + i) % 7; return [Date.now() - t, x]; }", "f", ["clock", "clock-during-work"], false],
    ["randomness (Math.random)", "export const f = () => Math.random() > 2;", "f", ["randomness"], true],
    ["unseeded randomness (crypto.subtle.generateKey)", "export async function f(){ await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign']); return 1; }", "f", ["unseeded-randomness"], false],
    ["time zone (getHours)", "export const f = () => new Date(0).getHours();", "f", ["time-zone-or-locale"], true],
    ["locale (toLocaleString, Intl.NumberFormat, localeCompare)", "export const f = () => [(1e3).toLocaleString(), new Intl.NumberFormat().format(2), 'a'.localeCompare('b')];", "f", ["time-zone-or-locale"], true],
    ["UTC getters and toISOString read no zone", "export const f = () => new Date(0).getUTCHours() + new Date(0).toISOString().length;", "f", [], true],
    ["timer order (setImmediate next to setTimeout 0)", "export async function f(){ const l = []; setImmediate(() => l.push(1)); setTimeout(() => l.push(2), 0); await new Promise(r => setTimeout(r, 5)); return l; }", "f", ["timer-order"], false],
    ["timer order (process.nextTick in the call's synchronous part)", "export async function f(){ const l = []; process.nextTick(() => l.push(1)); await null; l.push(2); return l; }", "f", ["timer-order"], false],
    ["console.log in the synchronous part is not a timer race", "export function f(){ console.log('hi'); return 1; }", "f", [], true],
    ["setImmediate alone is not a race", "export async function f(){ return await new Promise(r => setImmediate(() => r(1))); }", "f", [], true],
    ["unref-timer (a call waiting only on an unref'd timer)", "export async function f(){ await new Promise(r => setTimeout(r, 10).unref()); return 1; }", "f", ["unref-timer"], false],
    ["an unref'd timer next to a ref'd one is measured, and hasRef tells the truth", "export async function f(){ const t = setTimeout(() => {}, 10).unref(); await new Promise(r => setTimeout(r, 20)); return t.hasRef(); }", "f", [], true],
  ];
  for (const [what, src, name, want, decided] of js) {
    it(`JavaScript: ${what}`, async () => {
      const r = await run(src, "js", name);
      expect(r.controlPassed).toBe(true);
      expect(r.result.notMeasured.wholeRun).toBeUndefined();
      expect(kinds(r)).toEqual(want);
      expect("outcome" in r.result.measured, JSON.stringify(r.result.notMeasured)).toBe(decided);
      if (src.includes("hasRef")) expect(r.result.measured.returnedJson).toBe("false");
    });
  }
  const py: [string, string, string, string[], boolean][] = [
    ["no conditions", "def f(a):\n    return a\n", "f", [], true],
    ["clock (time.time)", "import time\n\ndef f():\n    return time.time()\n", "f", ["clock"], true],
    ["clock (datetime.now with a time zone)", "import datetime\n\ndef f():\n    return datetime.datetime.now(datetime.timezone.utc).year\n", "f", ["clock"], true],
    ["time zone (time.localtime, datetime.now() naive)", "import time, datetime\n\ndef f():\n    return [time.localtime(0).tm_hour, datetime.datetime.now().hour]\n", "f", ["clock", "time-zone-or-locale"], true],
    ["randomness (random.choice)", "import random\n\ndef f():\n    return random.choice([1, 2, 3])\n", "f", ["randomness"], true],
    ["a seeded Random(5) is the code's own choice: no condition", "import random\n\ndef f():\n    return random.Random(5).random()\n", "f", [], true],
    ["hash-seed (a set comprehension)", "def f():\n    return len({x for x in 'abc'})\n", "f", ["hash-seed"], true],
    ["clock-during-work (perf_counter around a loop)", "import time\n\ndef f():\n    t = time.perf_counter()\n    x = 0\n    for i in range(2_000_000):\n        x = (x + i) % 7\n    return time.perf_counter() - t\n", "f", ["clock", "clock-during-work"], false],
  ];
  for (const [what, src, name, want, decided] of py) {
    it.skipIf(!HAVE_PYTHON)(`Python: ${what}`, async () => {
      const r = await run(src, "py", name);
      expect(r.controlPassed).toBe(true);
      expect(r.result.notMeasured.wholeRun).toBeUndefined();
      expect(kinds(r)).toEqual(want);
      expect("outcome" in r.result.measured, JSON.stringify(r.result.notMeasured)).toBe(decided);
    });
  }
  it("every condition sentence is plain code's, from src/paste-words.ts; the clock one is D36's", async () => {
    const r = await run("export const f = () => Date.now();", "js", "f");
    expect(r.conditions).toEqual([{ kind: "clock", says: CONDITION_WORDS.clock }]);
    expect(CONDITION_WORDS.clock).toContain("Atlas's clock is simulated");
    expect(CONDITION_WORDS.clock).toContain("time-based values are Atlas's, not your machine's");
  });
});

// ---- the pins in the sandbox ----

describe("the pins are checked inside the sandbox before the code exists", () => {
  it("a sandbox started in another time zone is whole-run can't check, never this machine's hours", async () => {
    const lagos = { ...localExecutor, exec: (req: Parameters<typeof localExecutor.exec>[0]) => localExecutor.exec({ ...req, env: { ...req.env, TZ: "Africa/Lagos" } }) };
    const exp = experiment("export const f = () => new Date(0).getHours();", "js", "f");
    const r = await runCallExperiment(exp, jsControl, { executor: lagos });
    expect(r.result.measured).toEqual({});
    expect(r.result.notMeasured.wholeRun).toMatch(/could not pin the time zone to UTC \(it is Africa\/Lagos\)/);
  });
  it("the JavaScript sandbox gets TZ=UTC and a pinned locale, nothing else", () => {
    expect(CALL_ENV).toEqual({ TZ: "UTC", LC_ALL: "en_US.UTF-8" });
  });
  it.skipIf(!HAVE_PYTHON)("a Python sandbox without the pinned hash seed is whole-run can't check", async () => {
    const noSeed = { ...pythonSandboxExecutor, exec: (req: Parameters<typeof pythonSandboxExecutor.exec>[0]) => pythonSandboxExecutor.exec({ ...req, env: { TZ: "UTC" } }) };
    const r = await runPyCallExperiment(experiment("def f():\n    return 1\n", "py", "f"), pyControl!, { executor: noSeed });
    expect(r.result.notMeasured.wholeRun).toMatch(/could not pin the string-hash seed/);
  });
});

// ---- proof files ----

describe("proof files record the seed, time zone, locale and conditions, and verify checks them", () => {
  async function file(src: string, language: "js" | "py" = "js") {
    const exp = experiment(src, language, "f");
    const b = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "returnedJson", answer: { kind: "json", value: 1 } });
    await new Promise((r) => setTimeout(r, 5));
    const r = language === "py" ? await runPyCallExperiment(exp, pyControl!) : await runCallExperiment(exp, jsControl);
    return JSON.parse(JSON.stringify(buildAtlasFile({ target: exp.target, experiment: exp, bets: [b], run: r, verdicts: [judge(b, r)], agentLog: [], createdAt: new Date().toISOString() })));
  }
  it("a run with conditions verifies; editing the conditions, the time zone, the locale or the seed is caught", async () => {
    const f = await file("export const f = () => [Math.random(), new Date().getHours()];");
    expect(f.seed).toBe(CALL_SEED);
    expect(f.runs[0].timeZone).toBe("UTC");
    expect(f.runs[0].locale).toBe("en-US");
    expect(f.runs[0].conditions.map((c: { kind: string }) => c.kind)).toEqual(["clock", "randomness", "time-zone-or-locale"]);
    expect(verifyAtlasFile(f).ok).toBe(true);
    const edits: [string, (x: typeof f) => void, RegExp][] = [
      ["a condition removed", (x) => x.runs[0].conditions.pop(), /conditions are not the ones its trace records/],
      ["a condition's words changed", (x) => (x.runs[0].conditions[0].says = "nothing to see"), /conditions are not the ones/],
      ["the trace's conditions removed too", (x) => { x.runs[0].trace = x.runs[0].trace.filter((t: { event: string }) => t.event !== "conditions"); }, /conditions are not the ones/],
      ["the time zone", (x) => (x.runs[0].timeZone = "Africa/Lagos"), /time zone is "Africa\/Lagos"/],
      ["the locale", (x) => (x.runs[0].locale = "fr-FR"), /locale is "fr-FR"/],
      ["the seed (file and run)", (x) => { x.seed = "0"; x.runs[0].seed = "0"; }, /not a seed Atlas uses/],
    ];
    for (const [what, edit, re] of edits) {
      const x = JSON.parse(JSON.stringify(f));
      edit(x);
      const v = verifyAtlasFile(x);
      expect(v.ok, what).toBe(false);
      if (!v.ok) expect(v.problems.join("; "), what).toMatch(re);
    }
  });
  it("an undecided run that claims an outcome is caught", async () => {
    const f = await file("export function f(){ const t = performance.now(); let x = 0; for (let i = 0; i < 2e7; i++) x = (x + i) % 7; return performance.now() - t + x; }");
    expect(verifyAtlasFile(f).ok).toBe(true);
    expect(conditionKindsInTrace(f.runs[0].trace)).toContain("clock-during-work");
    f.runs[0].trace = f.runs[0].trace.filter((t: { event: string }) => t.event !== "stopped_watching");
    f.runs[0].result.measured.outcome = "returned";
    const v = verifyAtlasFile(f);
    expect(v.ok).toBe(false);
  });
  it("a file from before R1 (seed none, no pins, no conditions) still verifies; one that mixes them does not", async () => {
    const f = await file("export const f = () => 1;");
    delete f.runs[0].timeZone;
    delete f.runs[0].locale;
    delete f.runs[0].conditions;
    f.seed = "none";
    f.runs[0].seed = "none";
    expect(verifyAtlasFile(f).ok).toBe(true);
    f.runs[0].locale = "en-US";
    expect(verifyAtlasFile(f).ok).toBe(false);
  });
  it.skipIf(!HAVE_PYTHON)("a Python run verifies with locale C and its hash-seed condition", async () => {
    const f = await file("def f():\n    return sorted({1, 2})\n", "py");
    expect(f.runs[0].locale).toBe("C");
    expect(f.runs[0].conditions.map((c: { kind: string }) => c.kind)).toEqual(["hash-seed"]);
    expect(verifyAtlasFile(f).ok).toBe(true);
  });
});

// ---- D31 fingerprints ----

describe("D31: the reused-control fingerprints follow the harness files", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const own = (dir: string, f: string) => readFileSync(new URL(`../../runners/${dir}/${f}`, import.meta.url), "utf8");
  it("the JavaScript harness hash is the SHA-256 of the files the sandbox runs, read from disk now", () => {
    const files = ["call-worker.ts", "call-harness.ts", "call-words.ts", "primordials.ts", "harness.ts", "shapes.ts"];
    expect(callHarnessSha256()).toBe(sha(files.map((f) => own("ts", f)).join("\n")));
    expect(callControlKey(localExecutor)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the Python harness hash is the SHA-256 of boot.py, harness.py and exposed.py, read from disk now", () => {
    expect(pyHarnessSha256()).toBe(sha(["boot.py", "harness.py", "exposed.py"].map((f) => own("py", f)).join("\n")));
    expect(pyControlKey(pythonSandboxExecutor)).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---- the paste screen's words ----

describe("the paste screen's words (src/paste-words.ts)", () => {
  it("no longer says Atlas does not seed randomness; the intro names Python; the conditions words are there", () => {
    const all = JSON.stringify(PASTE_WORDS);
    expect(all).not.toMatch(/does not seed/);
    expect(PASTE_WORDS).not.toHaveProperty("randomNote");
    expect(PASTE_WORDS.intro).toMatch(/Python/);
    expect(PASTE_WORDS.replayDiffers).toMatch(/pins the seed, the time zone and the locale/);
    expect(CONDITION_WORDS.heading).toBe("Conditions");
  });
});
