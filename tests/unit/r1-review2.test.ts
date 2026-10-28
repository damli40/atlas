// R1 review round 2 (D42 / D43): machine reads outside the round-1 list (B1), address-based values (B2), [] as a locale
// (B3), the pins line above the bet questions (M1), Python's __file__ (M2), the same sandbox environment on both
// executors, and the "None" / hash-seed wording that never claims a complete check.

import { beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import { R1_SINCE } from "../../src/conditions.ts";
import { CONDITION_WORDS } from "../../src/paste-words.ts";
import { pastedBetHead, pinsLineOf, pinsSentence } from "../../src/paste-context.ts";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner.ts";
import { pyRunEnv, runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner.ts";
import { findPython, pythonEnv, pythonRefusal } from "../../runners/executor/sandbox-exec-python.ts";
import type { Experiment, ExperimentShape, Run } from "../../src/types.ts";

const HAVE_PYTHON = pythonRefusal() === null && findPython() !== null;
type Call = Extract<ExperimentShape, { shape: "call-function" }>;
function experiment(source: string, language: "js" | "py", exportName: string): Experiment {
  const target = makePastedTarget(source, language);
  const params: Call = { shape: "call-function", exportName, args: [] };
  const g = gate(params, { exportNames: exportedFunctionsFor(source, language).map((e) => e.name).concat(exportName) });
  if (!g.allowed) throw new Error(g.reason);
  return { id: `r2-${exportName}`, target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}
let js: Run;
let py: Run | null = null;
beforeAll(async () => {
  js = (await runCallControl()).run;
  if (HAVE_PYTHON) py = (await runPyCallControl()).run;
}, 60_000);
const run = (src: string, lang: "js" | "py", name = "f") => (lang === "py" ? runPyCallExperiment(experiment(src, "py", name), py!) : runCallExperiment(experiment(src, "js", name), js));
const kinds = (r: Run) => (r.conditions ?? []).map((c) => c.kind);
const hostSays = (r: Run) => r.conditions?.find((c) => c.kind === "host")?.says ?? "";

describe("B1, JavaScript: reads of Atlas's sandbox are noted, however they are made", () => {
  it("the environment holds exactly Atlas's pins, in one order (no __CF_USER_TEXT_ENCODING), and reading it is noted", async () => {
    const r = await run("export const f = () => Object.keys(process.env);", "js");
    expect(r.result.measured.returnedJson).toBe('["LC_ALL","TZ"]');
    expect(kinds(r)).toContain("host");
    expect(hostSays(r)).toContain("process.env");
  });
  it("a config read with a default (process.env.PORT ?? 3000) is measured with the host condition", async () => {
    const r = await run('export const f = () => ({ port: Number(process.env.PORT ?? 3000), debug: process.env.DEBUG === "1" });', "js");
    expect(r.result.measured.returnedJson).toBe('{"debug":false,"port":3000}');
    expect(kinds(r)).toEqual(["host"]);
  });
  it("process.env.TZ is the time-zone-or-locale condition", async () => {
    const r = await run("export const f = () => process.env.TZ;", "js");
    expect(r.result.measured.returnedJson).toBe('"UTC"');
    expect(kinds(r)).toEqual(["time-zone-or-locale"]);
  });
  it("import.meta (in the file's text) and process.getActiveResourcesInfo() are noted", async () => {
    expect(hostSays(await run("export const f = () => typeof import.meta.url;", "js"))).toContain("import.meta");
    expect(hostSays(await run("export const f = () => process.getActiveResourcesInfo().length >= 0;", "js"))).toContain("getActiveResourcesInfo");
  });
  it("console.log (Node reads its own env inside) adds no condition", async () => {
    expect(kinds(await run("export function f(){ console.log('hi'); return 1; }", "js"))).toEqual([]);
  });
});

describe("B3: [] or undefined as a locale means the default locale", () => {
  it("toLocaleString([]), Intl.NumberFormat([]), toLocaleString([], { timeZone }) carry the locale condition", async () => {
    const r = await run('export const f = () => [(1234567.5).toLocaleString([]), new Intl.NumberFormat([], { style: "currency", currency: "EUR" }).format(9.5), new Date(0).toLocaleString([], { timeZone: "UTC" })];', "js");
    expect(kinds(r)).toEqual(["time-zone-or-locale"]);
  });
  it("a named locale (a string, or a list of strings) carries none", async () => {
    const r = await run('export const f = () => [(1234567.5).toLocaleString("de-DE"), new Intl.NumberFormat(["en-GB"]).format(1), new Date(0).toLocaleString(["en-GB"], { timeZone: "UTC" })];', "js");
    expect(kinds(r)).toEqual([]);
  });
});

describe.skipIf(!HAVE_PYTHON)("B1 / M2, Python: machine reads through any name, the environment and __file__", () => {
  for (const [what, src, named] of [
    ["import sys as s", "import sys as s\n\ndef f():\n    return s.platform\n", "sys.platform"],
    ["from sys import platform", "from sys import platform\n\ndef f():\n    return platform\n", "sys.platform"],
    ["getattr(sys, 'platform')", "import sys\n\ndef f():\n    return getattr(sys, 'platform')\n", "sys.platform"],
    ["sys.version (the runtime's version)", "import sys\n\ndef f():\n    return sys.version_info[0]\n", "sys.version_info"],
    ["from os import environ, getenv", "from os import environ, getenv\n\ndef f():\n    return [sorted(environ), getenv('PORT', '8000')]\n", "os.environ"],
    ["threading.get_ident()", "import threading\n\ndef f():\n    return threading.get_ident() > 0\n", "threading.get_ident"],
    ["__file__", "from pathlib import Path\n\ndef f():\n    return str(Path(__file__).parent / 'data.json')\n", "__file__"],
  ] as const) {
    it(`${what} is noted as host, naming ${named}`, async () => {
      const r = await run(src, "py");
      expect(r.result.measured.outcome, JSON.stringify(r.result.notMeasured)).toBe("returned");
      expect(hostSays(r)).toContain(named);
    });
  }
  it("the environment is exactly Atlas's pins on every executor, and the locale is C in every category", async () => {
    const r = await run("import os, locale\n\ndef f():\n    return [sorted(os.environ), locale.setlocale(locale.LC_CTYPE), locale.setlocale(locale.LC_NUMERIC)]\n", "py");
    expect(r.result.measured.returnedJson).toBe('[["LC_ALL","PYTHONCOERCECLOCALE","PYTHONHASHSEED","TZ"],"C","C"]');
    expect(pyRunEnv("20260101")).toEqual({ LC_ALL: "C", PYTHONCOERCECLOCALE: "0", PYTHONHASHSEED: "20260101", TZ: "UTC" });
    expect(() => pythonEnv({ LC_ALL: "C.UTF-8" })).toThrow(/empty environment/);
  });
  it("__file__ is the stand-in /atlas/target.py, the same on both runs and executors", async () => {
    const r = await run("def f():\n    return __file__\n", "py");
    expect(r.result.measured.returnedJson).toBe('"/atlas/target.py"');
  });
  it("print of text still works (UTF-8 mode in the C locale)", async () => {
    const r = await run("def f():\n    print('héllo ✓')\n    return 1\n", "py");
    expect(r.result.measured.returnedJson).toBe("1");
  });
});

describe.skipIf(!HAVE_PYTHON)("B2: values hashed or ordered by memory address are noted every time", () => {
  for (const [what, src] of [
    ["hash(object()) % 7", "def f():\n    return hash(object()) % 7\n"],
    ["id()", "def f():\n    return id(object()) > 0\n"],
    ["set() of plain objects", "class A:\n    pass\n\ndef f():\n    return len(set(A() for _ in range(3)))\n"],
    ["frozenset() of plain objects", "class A:\n    pass\n\ndef f():\n    return len(frozenset([A(), A()]))\n"],
  ] as const) {
    it(`${what}: memory-address condition, whatever the double run sees`, async () => {
      const r = await run(src, "py");
      expect(kinds(r)).toContain("memory-address");
      expect(r.conditions?.find((c) => c.kind === "memory-address")?.says).toMatch(/catches most values that come from them, not all/);
    });
  }
  it("a set of text or numbers is not an address order; set still behaves as the real type", async () => {
    const src = "class MySet(set):\n    pass\n\ndef f():\n    s = set(['a', 'b'])\n    return [isinstance(s, set), isinstance(MySet(), set), sorted(set.union({1}, {2})), type(s).__name__, len(frozenset((1, 2))), str(set[int])]\n";
    const r = await run(src, "py");
    expect(r.result.measured.returnedJson).toBe('[true,true,[1,2],"set",2,"set[int]"]');
    expect(kinds(r)).not.toContain("memory-address");
  });
});

describe("words and the pins line (M1, B1, B2, m3)", () => {
  it("the page's pins line is the same bytes as the line inside the bettor text", () => {
    const exp = experiment("export const f = () => 1;", "js", "f");
    const head = pastedBetHead({ experiment: exp, questions: [] } as unknown as Parameters<typeof pastedBetHead>[0]);
    const line = pinsLineOf(head, "js");
    expect(head.split("\n")).toContain(line);
    expect(line).toBe(pinsSentence("js"));
    expect(pinsLineOf(undefined, "py")).toBe(pinsSentence("py"));
  });
  it("'None' and hash-seed never claim a complete check", () => {
    expect(CONDITION_WORDS.none).toBe("None of the conditions Atlas checks for (clock, randomness, time zone, locale, the machine details it watches); the second run matched.");
    expect(CONDITION_WORDS.hashSeed("1")).not.toMatch(/catches an order|second run catches/);
  });
  it("R1_SINCE is the day of the first R1 commit", () => {
    expect(R1_SINCE).toBe("2026-10-28T00:00:00.000Z");
  });
});
