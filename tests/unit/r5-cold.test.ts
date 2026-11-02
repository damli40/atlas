// Cold test items, the parts plain code decides. The page itself: tests/evidence/R5/coldtest.mjs.
import { describe, expect, it } from "vitest";
import { helperSteps } from "../../src/helper-steps";
import { fileOutline } from "../../src/file-outline";
import { PROPOSE_INSTRUCTION } from "../../server/meta/roles/proposer";
import { absentBettors } from "../../web/screens/Claimant";
import { differOnlyInSpaces, unusedFakes } from "../../web/machines/bench/play";
import { litWithNoThread } from "../../web/machines/bench/BenchStage";
import { drawAt, ranParts, machinePartsOfFile } from "../../renderer/authors/machine";
import { machineScript } from "../../renderer/authors/machine-script";

const test = (exportName: string) => ({ shape: "call-function", exportName, args: [] }) as never;

describe("two values that look the same", () => {
  it("only real differences in spaces count", () => {
    expect(differOnlyInSpaces('["/a p50"]', '["/a   p50"]')).toBe(true);
    expect(differOnlyInSpaces('["/a p50"]', '["/a p50"]')).toBe(false);
    expect(differOnlyInSpaces('["/a p50"]', '["/a p51"]')).toBe(false);
  });
});

describe("a bettor is never dropped in silence", () => {
  const slot = (status: string, reason?: string) => ({ who: "model:m", model: "m", display: "M", status, ...(reason ? { reason } : {}), sealed: [] }) as never;
  it("a refused bettor is named with its reason", () => {
    expect(absentBettors([slot("off", "call limit reached.")], [])).toEqual(["M did not bet on this round: call limit reached."]);
  });
  it("no usable answer and still thinking are said too", () => {
    expect(absentBettors([slot("no_usable_answer", "bad JSON")], [])[0]).toMatch(/no usable answer/);
    expect(absentBettors([slot("thinking")], [])[0]).toMatch(/had not answered/);
  });
  it("one that bet is not listed", () => {
    expect(absentBettors([slot("sealed")], [{ who: "model:m" }])).toEqual([]);
  });
});

describe("a function known to have run keeps its lit lamp", () => {
  const events = [
    { k: 0, name: "count", t: 0, at: 0 },
    { k: 0, name: "dedupe", t: 0, at: 0 },
    { k: 0, name: "norm", t: 0, at: 0 },
    { k: 1, name: "norm", t: 0, at: 0 },
    { k: 1, name: "dedupe", t: 0, at: 0 },
    { k: 1, name: "count", t: 0, at: 0 },
  ];
  const py = `def count(xs):\n    return len(dedupe(xs))\n\ndef dedupe(xs):\n    return [norm(x) for x in xs]\n\ndef norm(s):\n    return s.strip()\n`;
  const outline = fileOutline(py, "py");
  const parts = machinePartsOfFile(py, "py", test("count"), outline);
  it("the trace names what a helper called in turn", () => {
    const { steps } = helperSteps(events, { tested: ["count"], trace: [] });
    expect(steps.map((s) => s.name)).toEqual(["dedupe"]);
    expect(steps[0]!.within).toEqual(["norm"]);
  });
  it("a name that is not in the file is dropped by the reader's own rule, not lit", () => {
    const { steps } = helperSteps([...events.slice(0, 2), { k: 0, name: "evil", t: 0, at: 0 }, { k: 1, name: "evil", t: 0, at: 0 }, events[4], events[5]], { tested: ["count"], trace: [], allowed: (n) => n !== "evil" });
    expect(steps[0]!.within).toBeUndefined();
  });
  it("it is lit, and its thread drawn where the way there is the only one", () => {
    const steps = [{ name: "dedupe", within: ["norm"] }];
    expect([...ranParts({ tested: "count", steps, parts, called: () => false })].sort()).toEqual(["count", "dedupe", "norm"]);
    const beats = machineScript({ steps: [{ part: "dedupe", nodes: [] }], nodes: [] } as never, parts, outline, "count", new Map([["dedupe", ["norm"]]]));
    expect(beats[0]!.lamps).toEqual(["dedupe", "norm"]);
    expect(beats[0]!.routes).toEqual(["count->dedupe", "dedupe->norm"]);
  });
  it("with two possible callers it is lit, with no thread, and the sentence says so", () => {
    const two = `def f(x):\n    return g(x) + h(x)\n\ndef g(x):\n    return n(x)\n\ndef h(x):\n    return n(x)\n\ndef n(x):\n    return x\n`;
    const o = fileOutline(two, "py");
    const p = machinePartsOfFile(two, "py", test("f"), o);
    const beats = machineScript({ steps: [{ part: "g", nodes: [] }], nodes: [] } as never, p, o, "f", new Map([["g", ["n"]]]));
    expect(beats[0]!.routes).not.toContain("g->n");
    expect(litWithNoThread(beats, "f")).toBe(true);
  });
});

describe("a scripted answer nobody asked for", () => {
  const si = { kind: "stand-in", name: "fetchIt" };
  it("is said, for a stand-in and for the network fake", () => {
    expect(unusedFakes({ args: [si] }, { "calls:fetchIt": 0 })).toBe("The scripted answer was never used: fetchIt was called 0 times.");
    expect(unusedFakes({ args: [], network: { replaces: "fetch" } }, { "calls:fetch": 0 })).toBe("The scripted answer was never used: fetch was called 0 times.");
    expect(unusedFakes({ args: [si], network: { replaces: "fetch" } }, { "calls:fetchIt": 0, "calls:fetch": 0 })).toMatch(/fetchIt and fetch were each called 0 times/);
  });
  it("is not said when it was used, or when the count is not known", () => {
    expect(unusedFakes({ args: [si] }, { "calls:fetchIt": 2 })).toBeNull();
    expect(unusedFakes({ args: [si] }, {})).toBeNull();
    expect(unusedFakes(null, {})).toBeNull();
  });
});

describe("the fallback's words", () => {
  it("say the file's true count when the outline kept fewer", () => {
    const many = Array.from({ length: 301 }, (_, i) => `export function s${i}() { return ${i}; }`).join("\n");
    const o = fileOutline(many, "ts");
    expect(o.partsInFile).toBe(301);
    const p = machinePartsOfFile(many, "ts", test("s0"), o);
    expect(drawAt(p, { seed: "s" }, 1).tooMany).toBe("This file defines 301 functions and classes, more than the 8 parts the machine can draw and still be read. Here are the first 40.");
  });
  it("a Python part is never called exported", () => {
    const py = `def a():\n    return b()\n\ndef b():\n    return 1\n`;
    const d = drawAt(machinePartsOfFile(py, "py", test("a"), fileOutline(py, "py")), { seed: "s" }, 1.3);
    expect(d.svg).not.toMatch(/exported/);
  });
});

describe("Wonder's sentence", () => {
  it("the prompt gives no letter a model can copy", () => {
    expect(PROPOSE_INSTRUCTION).not.toMatch(/does Y|expect X/);
  });
});

describe("the first bet can fail", () => {
  it("Wonder is told to make its first test show the flaw its sentence names", () => {
    expect(PROPOSE_INSTRUCTION).toMatch(/FIRST experiment must make exactly that flaw visible/);
  });
  it("a weak kind is a tie-break only", async () => {
    const { weakSpotSummary } = await import("../../src/track-record");
    const words = weakSpotSummary({ lines: [{ type: "timing", n: 7, notMatched: 5, under: 4, over: 1 }] } as never);
    expect(words).toMatch(/only to choose between tests that show the flaw equally well/);
  });
});

describe("what a file's first screen says", () => {
  it("names a language Atlas doesn't read, and stays quiet on one it does", async () => {
    const { foreignLanguage } = await import("../../src/paste-language");
    expect(foreignLanguage("use std::io;\nfn main() {\n  let mut x = 1;\n}\n")).toBe("Rust");
    expect(foreignLanguage("package main\n\nfunc main() {\n}\n")).toBe("Go");
    expect(foreignLanguage("#include <stdio.h>\nint main() { return 0; }\n")).toBe("C or C++");
    expect(foreignLanguage("const a = 1;\n")).toBeNull();
    expect(foreignLanguage("def f(x):\n    return x\n")).toBeNull();
    expect(foreignLanguage("// fn main() in a comment\nexport const fn2 = 1;\n")).toBeNull();
  });
});

describe("the helper order is call order", () => {
  it("a helper that finishes after a later one started is still listed where it started", () => {
    const e = (k: number, name: string, at: number) => ({ k, name, t: 0, at });
    const { steps } = helperSteps([e(0, "t", 0), e(0, "first", 1), e(0, "inner", 2), e(1, "inner", 3), e(1, "first", 4), e(0, "second", 5), e(1, "second", 6), e(1, "t", 7)], { tested: ["t"], trace: Array.from({ length: 8 }, () => ({ event: "x" })) });
    expect(steps.map((s) => s.name)).toEqual(["first", "second"]);
    expect(steps[0]!.at).toBeLessThan(steps[1]!.at);
  });
});

describe("a still picture is lit as the run left it", () => {
  it("marks only the threads and lamps the beats reach", async () => {
    const { lightMachine } = await import("../../renderer/authors/machine-script");
    const svg = '<path class="m-thread" data-route="a-&gt;b"/><path class="m-thread" data-route="a-&gt;c"/><circle class="m-lamp" data-lamp="b"/><circle class="m-lamp" data-lamp="c"/>';
    const out = lightMachine(svg, [{ routes: ["a->b"], lamps: ["b"] }]);
    expect(out).toContain('data-route="a-&gt;b" data-ran=""');
    expect(out).toContain('data-route="a-&gt;c"/>');
    expect(out).toContain('data-lamp="b" data-on=""');
    expect(out).toContain('data-lamp="c"/>');
  });
});

describe("a leader can be followed", () => {
  const base = { owners: [], routes: [], reds: [], housings: [] };
  const rect = { x0: 0, x1: 1, y0: 0, y1: 1 };
  it("the audit catches two leaders that cross", async () => {
    const { auditMachine } = await import("../../renderer/machine/audit");
    const labels = [
      { part: "a", text: "one", rect, leader: [[0, 0], [100, 100]] as [[number, number], [number, number]] },
      { part: "b", text: "two", rect: { ...rect, x0: 500, x1: 501 }, leader: [[0, 100], [100, 0]] as [[number, number], [number, number]] },
    ];
    expect(auditMachine({ ...base, labels } as never).join(" ")).toMatch(/leaders of "one" and "two" cross/);
  });
  it("no drawing of the realistic files has a crossing leader", () => {
    const src = `function a(x) { return b(x) + c(x); }\nfunction b(x) { if (x) throw new Error("n"); return 1; }\nfunction c(x) { return b(x) + 1; }\nexport function f(x) { return a(x) + c(x); }\n`;
    const d = drawAt(machinePartsOfFile(src, "js", test("f"), fileOutline(src, "js")), { seed: "s" }, 1);
    expect(d.problems.filter((p) => /leader/.test(p))).toEqual([]);
  });
});
