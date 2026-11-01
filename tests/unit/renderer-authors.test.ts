// R3: the authors: pure functions from Atlas's data to a RenderSpec. What they refuse to claim matters most.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { betView } from "../../renderer/authors/bet-view";
import { waitingPartsOf } from "../../src/call-sites";
import { explorerSpec } from "../../renderer/authors/code-chart";
import { explorerModel } from "../../web/machines/explorer/model";
import { MOONWELL_ALLOWED_WORDS, moonwellFlow } from "../../renderer/authors/moonwell";
import { collapse, partingKey, pathItems, retryDemo, whatHappened, type WhatHappenedInput } from "../../renderer/authors/what-happened";
import { specProblems, type RenderSpec } from "../../renderer/spec";
import { fileOutline } from "../../src/file-outline";
import type { Run, TraceEvent } from "../../src/types";

const read = (rel: string) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
const twice = read("fixtures/r3/fetch-with-retry.fails-twice-then-200.run.json");
const always = read("fixtures/r3/fetch-with-retry.always-500.run.json");
const source = readFileSync(new URL("../fixtures/r3/fetch-with-retry.source.ts.txt", import.meta.url), "utf8");
const metaOutline = read("fixtures/outline/atlas-server-meta-058ab2a.outline.json");
const retryFile = read("evidence/D04-04/fixture-eRopGsrp2a.atlas.json");
const moonFile = read("evidence/D04-04/moonwell-level2-mwTaxvHFzB.atlas.json");
const allWords = (s: RenderSpec) => JSON.stringify([s.title, s.subtitle, s.kicker, s.nodes.map((n) => [n.words, n.small]), s.edges.map((e) => e.words), s.captions, s.marks, s.steps.map((x) => x.words)]);

const run = (trace: TraceEvent[], measured: Run["result"]["measured"], notMeasured: Run["result"]["notMeasured"] = {}): WhatHappenedInput["run"] => ({ id: "r1", trace, result: { measured, notMeasured }, controlPassed: true });
const net = (status: number) => ({ params: { shape: "call-function", exportName: "f", args: [], network: { replaces: "fetch", calls: [{ do: "respond", status, body: {} }], then: "repeat_last" } } }) as NonNullable<WhatHappenedInput["experiment"]>;
const loopTrace = (calls: number, waitMs: number): TraceEvent[] => {
  const t: TraceEvent[] = [{ t: 0, event: "start" }];
  for (let i = 0; i < calls; i++) {
    t.push({ t: i * waitMs, event: "stand_in_call", data: { name: "fetch", n: i + 1 } }, { t: i * waitMs, event: "stand_in_returns", data: { name: "fetch", n: i + 1 } });
  }
  t.push({ t: (calls - 1) * waitMs, event: "threw", data: { name: "Error" } });
  return t;
};

describe("R3 author (a): the explorer's chart", () => {
  const s = explorerSpec(explorerModel(metaOutline));
  it("server/meta: folders are regions; Wonder-only joins are dotted, never threads; only confirmed parts", () => {
    expect(specProblems(s)).toEqual([]);
    expect(s.regions.some((r) => r.words === "roles/")).toBe(true);
    expect(s.nodes.length).toBe(metaOutline.verified.counts.confirmedParts);
    expect(s.edges.filter((e) => e.provenance === "wonder-words").every((e) => e.kind === "dashed-note")).toBe(true);
    const m = explorerModel(metaOutline);
    const withChalk = explorerSpec({ ...m, chalk: [{ id: "x", from: m.boxes[0]!.id, to: m.boxes[1]!.id, kind: "calls", words: "w", reason: "r", noLinkFound: false }] });
    expect(withChalk.edges.find((e) => e.id === "chalk:x")).toMatchObject({ kind: "dashed-note", provenance: "wonder-words" });
    expect(s.captions.map((c) => c.words).join()).toMatch(/never that the name or purpose is true/);
  });
  it("does not repeat itself: one legend line, words only where they say something new, parallel links are one thicker line", () => {
    expect(s.legend).toMatch(/A solid line: plain code found that one part imports the other; thicker means more links/);
    expect(s.quiet).toBe(true);
    const threads = s.edges.filter((e) => e.kind === "thread");
    expect(threads.filter((e) => e.words === "imports").length).toBe(0);
    expect(threads.filter((e) => e.words).length).toBeLessThan(threads.length / 2);
    expect(Math.max(...threads.map((e) => e.weight ?? 1))).toBeGreaterThan(1);
    const pairs = threads.map((e) => `${e.from}|${e.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
  it("draws nothing and says why when the model has nothing to draw", () => {
    expect(explorerSpec(explorerModel({ ...metaOutline, verified: null, wonder: { ...metaOutline.wonder, failure: "no answer" } })).notShown).toMatch(/no usable outline/);
    expect(explorerSpec(explorerModel({ ...metaOutline, verified: { ...metaOutline.verified, cantCheck: "too large" } })).notShown).toMatch(/too large/);
  });
});

describe("R3 author (b): the chart and the bet view use U3's call sites", () => {
  const spec = betView({ fileName: "f.ts", outline: fileOutline(source, "ts"), source, language: "ts", test: twice.experiment.params, tested: "fetchWithRetry" });
  const wire = (s: RenderSpec, from: string, to: string) => s.edges.some((e) => e.from === from && e.to === to);
  it("has no run values, and validates as pre-bet", () => {
    expect(spec.stage).toBe("pre-bet");
    expect(specProblems(spec)).toEqual([]);
    const words = allWords(spec);
    for (const leaked of ["710", "263", "447", "called fetch", "returned"]) expect(words).not.toContain(leaked);
  });
  it("wires the fake only from the function whose own lines call it", () => {
    expect(wire(spec, "fetchWithRetry", "stand-in fetch")).toBe(true);
    expect(wire(spec, "sleep", "stand-in fetch")).toBe(false);
  });
  it("a string or a comment containing fetch( draws no wire", () => {
    const src = 'export function a() {\n  const s = "fetch(url)";\n  // fetch(other)\n  return s;\n}\nexport async function b() {\n  return fetch("https://x.test");\n}\n';
    const test = { shape: "call-function" as const, exportName: "a", args: [], network: { replaces: "fetch" as const, then: "repeat_last" as const, calls: [{ do: "respond" as const, status: 200, body: {} }] } };
    const s = betView({ fileName: "f.ts", outline: fileOutline(src, "ts"), source: src, language: "ts", test });
    expect(wire(s, "a", "stand-in fetch")).toBe(false);
    expect(wire(s, "b", "stand-in fetch")).toBe(true);
  });
  it("an abort timer is not a wait; a Promise a timer resolves is, and so is a Python sleep", () => {
    expect(wire(spec, "fetchWithRetry", "clock housing")).toBe(false);
    expect(wire(spec, "sleep", "clock housing")).toBe(true);
    const o = (src: string, lang: "js" | "py") => waitingPartsOf(fileOutline(src, lang));
    expect(o("export function a() {\n  setTimeout(() => go(), 100);\n}\n", "js")).toEqual([]);
    expect(o('export function a() {\n  const s = "new Promise((r) => setTimeout(r, 1))";\n  return s;\n}\n', "js")).toEqual([]);
    expect(o("export function a() {\n  return new Promise((resolve) => setTimeout(resolve, 100));\n}\n", "js")).toEqual(["a"]);
    expect(o("import time\ndef a():\n    time.sleep(1)\n", "py")).toEqual(["a"]);
    expect(o('def a():\n    return "time.sleep(1)"\n', "py")).toEqual([]);
  });
  it("a stand-in is wired only if plain code finds a line calling it; otherwise a caption says why", () => {
    const src = "export async function go(load, n) {\n  return load(n);\n}\nexport async function no(load) {\n  return 1;\n}\n";
    const standIn = { kind: "stand-in" as const, name: "lookup", async: true, then: "repeat_last" as const, calls: [{ do: "return" as const, value: 1 }] };
    const yes = betView({ fileName: "f.js", outline: fileOutline(src, "js"), source: src, language: "js", test: { shape: "call-function", exportName: "go", args: [standIn, { kind: "json", value: 1 }] } });
    expect(wire(yes, "go", "stand-in lookup")).toBe(true);
    const no = betView({ fileName: "f.js", outline: fileOutline(src, "js"), source: src, language: "js", test: { shape: "call-function", exportName: "no", args: [standIn] } });
    expect(no.edges.some((e) => e.to === "stand-in lookup")).toBe(false);
    expect(no.captions.map((c) => c.words).join()).toMatch(/no line/);
  });
  it("a function calling itself gets a self-loop from U3's reading; a mention in a comment does not", () => {
    const src = "export function a(n) {\n  return n ? a(n - 1) : b();\n}\nexport function b() {\n  // b() mentioned here\n  return 1;\n}\n";
    const s = betView({ fileName: "x.js", outline: fileOutline(src, "js"), source: src, language: "js", test: null });
    expect(s.edges.find((e) => e.id === "self:a")?.words).toBe("calls itself");
    expect(s.edges.find((e) => e.id === "self:b")).toBeUndefined();
    expect(s.edges.find((e) => e.from === "a" && e.to === "b")?.words).toBe("calls");
    expect(s.nodes.every((n) => n.provenance === "plain-code")).toBe(true);
  });
  it("failure labels are tags on their parts, allowed before a bet; a run tag is refused", () => {
    const s = betView({ fileName: "f.ts", outline: fileOutline(source, "ts"), source, language: "ts", test: null, labels: [{ anchor: "fetchWithRetry", text: "found in this code: no overall timeout" }] });
    expect(s.tags).toEqual([{ on: "fetchWithRetry", words: "found in this code: no overall timeout", provenance: "plain-code" }]);
    expect(specProblems(s)).toEqual([]);
    expect(specProblems({ ...s, tags: [{ on: "fetchWithRetry", words: "x", provenance: "run" }] }).join()).toMatch(/pre-bet but holds run data/);
  });
  it("an empty file says why instead of drawing", () => {
    const s = betView({ fileName: "x.js", outline: fileOutline("const a = 1;\n", "js"), source: "const a = 1;\n", language: "js", test: null });
    expect(s.notShown).toBeTruthy();
  });
});

describe("R3 author (c): what happened", () => {
  it("a real run: calls, answers from the script, waits from the clock, the ending from the measured fields", () => {
    const s = whatHappened({ run: twice.run, experiment: twice.experiment });
    expect(specProblems(s)).toEqual([]);
    expect(s.nodes.map((n) => n.words)).toEqual(["called fetch", "waited 263 ms", "called fetch", "waited 447 ms", "called fetch", 'returned {"price":42}']);
    expect(s.edges.map((e) => e.words).filter(Boolean)).toEqual(["answered 503 (scripted)", "answered 503 (scripted)", "answered 200 (scripted)"]);
    expect(s.path?.edges.length).toBe(s.edges.length);
    expect(s.edges.every((e) => e.provenance === "run" && e.kind === "thread")).toBe(true);
    expect(s.captions.map((c) => c.words).join()).toMatch(/pins it to seed/);
  });
  it("never drawn: failed control, whole-run can't check, no trace", () => {
    expect(whatHappened({ run: { ...twice.run, controlPassed: false } }).notShown).toMatch(/known-case check/);
    expect(whatHappened({ run: { ...twice.run, result: { measured: {}, notMeasured: { wholeRun: "needs a package" } } } }).notShown).toMatch(/needs a package/);
    expect(whatHappened({ run: { ...twice.run, trace: [] } }).notShown).toMatch(/no trace/);
    const s = whatHappened({ run: { ...twice.run, controlPassed: false } });
    expect(s.nodes).toEqual([]);
  });
  it("loops collapse with the exact count, and only past the limit", () => {
    const many = whatHappened({ run: run(loopTrace(48, 100), { outcome: "threw", virtualMs: 4700, thrownName: "Error", "calls:fetch": 48 }), experiment: net(500) });
    const t = many.nodes.find((n) => n.words.includes("48 times"));
    expect(t?.small).toBe("calls 1 to 48");
    expect(many.edges.find((e) => e.from === t?.id)?.words).toBe("each answered 500 (scripted), waits 100 ms");
    expect(many.nodes.length).toBeLessThan(5);
    const few = whatHappened({ run: run(loopTrace(3, 100), { outcome: "threw", virtualMs: 200, thrownName: "Error", "calls:fetch": 3 }), experiment: net(500) });
    expect(few.nodes.filter((n) => n.words === "called fetch").length).toBe(3);
  });
  it("a loop keeps the step where a bettor parts ways on its own ticket", () => {
    const items = pathItems({ run: run(loopTrace(20, 10), { outcome: "threw" }), experiment: net(500) }).items;
    const key = partingKey(items, { measures: "calls:fetch", answer: { kind: "integer", value: 7 } });
    expect(key).toBe("fetch:8");
    const c = collapse(items, 6, new Set([key]));
    expect(c.some((i) => i.kind === "call" && i.n === 8)).toBe(true);
    expect(c.filter((i) => i.kind === "loop").map((i) => i.kind === "loop" && i.count)).toEqual([7, 12]);
  });
  it("different answers are not collapsed together", () => {
    const items = [...Array(10).keys()].map((n) => ({ kind: "call" as const, name: "f", n: n + 1, t: n, answer: n % 2 ? "answered 200" : "answered 500", good: false }));
    expect(collapse(items, 6).length).toBe(10);
  });
  it("a cut trace stops and says so; the ending still comes from the measured fields", () => {
    const tr = [...loopTrace(3, 10).slice(0, 5), { t: 20, event: "trace_cut", data: { kept: 5, dropped: 900 } }] as TraceEvent[];
    const s = whatHappened({ run: run(tr, { outcome: "threw", thrownName: "Error", virtualMs: 9000 }), experiment: net(500) });
    const words = s.nodes.map((n) => n.words).join(" | ");
    expect(words).toMatch(/5 kept, 900 more counted/);
    expect(words).toMatch(/threw Error at 9,000 ms/);
  });
  it("can't-check fields say so instead of guessing", () => {
    const tr = loopTrace(2, 100).slice(0, -1);
    const s = whatHappened({ run: run(tr, {}, { outcome: "the run was stopped", virtualMs: "Atlas's clock is simulated", "calls:fetch": "the count so far was 2" }), experiment: net(500) });
    const words = allWords(s);
    expect(words).toMatch(/can't say how it ended: the run was stopped/);
    expect(words).toMatch(/time not reported/);
    expect(words).not.toMatch(/waited 100 ms/);
    expect(words).toMatch(/does not claim a final count of fetch/);
  });
  it("the second run going differently stops the path at the first difference", () => {
    const a = loopTrace(3, 100);
    const b = [...a.slice(0, 5), { t: 150, event: "stand_in_call", data: { name: "fetch", n: 3 } }, ...a.slice(6)] as TraceEvent[];
    const base = run(a, { outcome: "threw", thrownName: "Error" });
    const s = whatHappened({ run: { ...base, twin: { trace: b, result: base.result } }, experiment: net(500) });
    expect(allWords(s)).toMatch(/second run of this test went differently/);
    expect(s.nodes.filter((n) => n.words === "called fetch").length).toBe(2);
  });
  it("marks: from verdicts only, in 'matched / didn't match / can't check' words, never right or wrong", () => {
    const b = (measures: string, value: number, id = "b") => ({ id, who: "human" as const, measures, answer: { kind: "integer" as const, value } });
    const miss = whatHappened({ run: twice.run, experiment: twice.experiment, bets: [b("calls:fetch", 2)], verdicts: [{ betId: "b", outcome: "not_matched" }] });
    expect(miss.marks[0]?.kind).toBe("didnt-match");
    expect(miss.path?.partsWaysAt).toBe(miss.nodes.find((n) => n.small === "3rd call")?.id);
    const hit = whatHappened({ run: twice.run, experiment: twice.experiment, bets: [b("calls:fetch", 3)], verdicts: [{ betId: "b", outcome: "matched" }] });
    expect(hit.marks[0]?.kind).toBe("matched");
    expect(hit.path?.partsWaysAt).toBeUndefined();
    const cant = whatHappened({ run: twice.run, experiment: twice.experiment, bets: [b("thing", 3)], verdicts: [{ betId: "b", outcome: "cant_check", reason: "not measured" }] });
    expect(cant.marks[0]?.kind).toBe("cant-check");
    expect(cant.path?.partsWaysAt).toBeUndefined();
    const none = whatHappened({ run: twice.run, experiment: twice.experiment, bets: [b("x", 1)], verdicts: [] });
    expect(none.marks).toEqual([]);
    for (const s of [miss, hit, cant]) {
      expect(allWords(s)).not.toMatch(/\b(right|wrong|correct|incorrect)\b/i);
    }
  });
  it("too few calls bet: parts at the ending; too many: the same", () => {
    const items = pathItems({ run: always.run, experiment: always.experiment }).items;
    expect(partingKey(items, { measures: "calls:fetch", answer: { kind: "integer", value: 9 } })).toBe("end");
    expect(partingKey(items, { measures: "outcome", answer: { kind: "enum", value: "returned", options: [] } })).toBe("end");
    expect(partingKey(items, { measures: "virtualMs", answer: { kind: "number", value: 100, tolerancePct: 10, unit: "ms" } })).toBe("wait:263");
  });
  it("a code that threw after retries: real fixture", () => {
    const s = whatHappened({ run: always.run, experiment: always.experiment });
    expect(s.nodes[s.nodes.length - 1]?.words).toBe("threw Error at 3,173 ms");
    expect(s.edges.filter((e) => e.words === "answered 500 (scripted)").length).toBe(4);
  });
});

describe("R3 author (c): a test of several calls", () => {
  const seq = (t: TraceEvent[], m: Run["result"]["measured"]) => run(t, m);
  const params = { params: { shape: "call-function", exportName: "get_user_plan", args: [], calls: [{ exportName: "get_user_plan", args: [] }, { exportName: "get_user_plan", args: [], waitMs: 61000 }] } } as unknown as NonNullable<WhatHappenedInput["experiment"]>;
  it("the path shows each call: its start, its end, and Atlas's own scripted wait between them, kept apart from the code's waits", () => {
    const t: TraceEvent[] = [
      { t: 0, event: "start", data: { exportName: "get_user_plan", calls: 2 } },
      { t: 0, event: "call_start", data: { n: 1, exportName: "get_user_plan" } },
      { t: 500, event: "call_returned", data: { n: 1, type: "string", json: '"pro"' } },
      { t: 61500, event: "call_start", data: { n: 2, exportName: "get_user_plan" } },
      { t: 62000, event: "returned", data: { type: "string" } },
    ];
    const s = whatHappened({ run: seq(t, { outcome: "returned", returnedJson: '"pro"', virtualMs: 500 }), experiment: params });
    const w = s.nodes.map((n) => `${n.small ?? ""}|${n.words}`);
    expect(w).toEqual(["Atlas's call 1 of 2|get_user_plan", "|waited 500 ms", 'end of call 1|call 1 returned "pro"', "|Atlas waited 61,000 ms, as the test says", "Atlas's call 2 of 2|get_user_plan", "|waited 500 ms", 'the end|returned "pro"']);
    expect(specProblems(s)).toEqual([]);
  });
  it("a sequence's ending time is the whole run's clock, not the last call's own", () => {
    const t: TraceEvent[] = [
      { t: 0, event: "start", data: { calls: 2 } },
      { t: 0, event: "call_start", data: { n: 1, exportName: "f" } },
      { t: 100, event: "call_threw", data: { n: 1, name: "Boom" } },
      { t: 100, event: "call_start", data: { n: 2, exportName: "f" } },
      { t: 300, event: "threw", data: { name: "Error" } },
    ];
    const s = whatHappened({ run: seq(t, { outcome: "threw", thrownName: "Error", virtualMs: 200 }) });
    expect(s.nodes[s.nodes.length - 1]?.words).toBe("threw Error at 300 ms");
    expect(s.nodes.map((n) => n.words)).toContain("call 1 threw Boom");
  });
  it("a single-call run is unchanged: no turn tickets", () => {
    expect(whatHappened({ run: twice.run, experiment: twice.experiment }).nodes.some((n) => /Atlas's call/.test(n.small ?? ""))).toBe(false);
  });
});

describe("R3 author (d): the retry demo", () => {
  const s = retryDemo({ run: retryFile.runs[0], experiment: retryFile.experiments[0], bets: retryFile.bets, verdicts: retryFile.verdicts });
  it("draws the recorded scenario, and labels the code pre-existing", () => {
    expect(specProblems(s)).toEqual([]);
    expect(s.nodes.filter((n) => n.small?.endsWith("call")).length).toBe(5);
    expect(s.nodes.filter((n) => n.words === "waited 3,000 ms").length).toBe(4);
    expect(s.captions.map((c) => c.words).join()).toMatch(/Pre-existing/);
    expect(s.captions.map((c) => c.words).join()).toMatch(/replays from a saved file/);
  });
  it("never claims what CLAUDE.md forbids", () => {
    expect(allWords(s)).not.toMatch(/hang|hammer|forever|live\b/i);
  });
});

describe("R3 author (e): Moonwell", () => {
  const s = moonwellFlow({ run: moonFile.runs[0], bets: moonFile.bets, verdicts: moonFile.verdicts, fileCaptions: moonFile.captions });
  it("draws only what the run recorded: $1.12, reference $2,206.68, one price source", () => {
    expect(specProblems(s)).toEqual([]);
    const words = allWords(s);
    expect(words).toContain("$1.12");
    expect(words).toContain("$2,206.68");
    expect(words).toContain("1 price source");
    expect(s.nodes.find((n) => n.id === "gear")?.missing).toBe(true);
  });
  it("uses the allowed wording exactly, and no forbidden claim", () => {
    expect(s.captions[0]?.words).toBe(MOONWELL_ALLOWED_WORDS);
    expect(allWords(s)).not.toMatch(/caused|Claude wrote|caught before shipping|\blive\b/i);
  });
  it("no thread runs through the missing step: the feed's thread goes straight to the price", () => {
    expect(s.edges.find((e) => e.from === "feed")?.to).toBe("price");
    expect(s.edges.find((e) => e.from === "gear")?.kind).toBe("dashed-note");
  });
  it("two price sources: no missing step; failed control: nothing", () => {
    const run2 = { ...moonFile.runs[0], result: { ...moonFile.runs[0].result, measured: { ...moonFile.runs[0].result.measured, "priceSources:cbETH": 2 } } };
    expect(moonwellFlow({ run: run2 }).nodes.some((n) => n.id === "gear")).toBe(false);
    expect(moonwellFlow({ run: { ...moonFile.runs[0], controlPassed: false } }).nodes).toEqual([]);
  });
  it("a declined bet is a can't-check, with no guess", () => {
    expect(s.marks.find((m) => m.who.includes("muse-spark"))?.kind).toBe("cant-check");
  });
});
