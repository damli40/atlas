// The final review's blockers and majors. Each of these passed before it was found by hand: now a test holds it. The page itself: tests/evidence/R5/truth.mjs and coldtest.mjs.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../server/app";
import { endOfRun, machinePartsOfFile, publicParts } from "../../renderer/authors/machine";
import { fileOutline } from "../../src/file-outline";
import { entriesFromRound, functionKey } from "../../src/track-record";
import { lastRoundOf, lastRoundWords } from "../../src/remember";
import { defaultFunction } from "../../web/screens/Studio";
import { machineScript } from "../../renderer/authors/machine-script";
import { sealBet } from "../../src/seal";

const test_ = (exportName: string) => ({ shape: "call-function", exportName, args: [] }) as never;
const end = (src: string, language: "js" | "py", thrown: { name: string; message: string }, ran: string[]) => {
  const parts = machinePartsOfFile(src, language, test_(ran[0]!), fileOutline(src, language));
  return endOfRun({ outcome: "threw", thrown, parts, tested: ran[0]!, ran: new Set(ran), called: () => false });
};

describe("B2: a throw that exists is not the throw that ended the run", () => {
  it("the same text in a class method places nothing", () => {
    expect(end(`class V {\n  check() {\n    throw new Error("invalid");\n  }\n}\nexport function f(x) {\n  if (x === null) throw new Error("invalid");\n  return new V().check();\n}\n`, "js", { name: "Error", message: "invalid" }, ["f"])).toBeNull();
  });
  it("the same text in a nested closure places nothing", () => {
    expect(end(`function h(flag) {\n  if (flag) throw new Error("bad");\n  return 1;\n}\nexport function f() {\n  h(false);\n  const g = () => { throw new Error("bad"); };\n  g();\n}\n`, "js", { name: "Error", message: "bad" }, ["f", "h"])).toBeNull();
  });
  it("the same text built elsewhere and thrown later places nothing", () => {
    expect(end(`function h() {\n  throw new Error("x");\n}\nfunction mk() {\n  return new Error("x");\n}\nexport function f() {\n  try { h(); } catch (e) {}\n  throw mk();\n}\n`, "js", { name: "Error", message: "x" }, ["f", "h", "mk"])).toBeNull();
  });
  it("a template's opening words place nothing", () => {
    expect(end("export function f(s) {\n  if (s === 1) throw new SyntaxError(`Unexpected ${s}`);\n  return JSON.parse('<');\n}\n", "js", { name: "SyntaxError", message: "Unexpected token <" }, ["f"])).toBeNull();
  });
  it("Python: the same text in a nested function places nothing", () => {
    expect(end(`def h(flag):\n    if flag:\n        raise ValueError("bad")\n    return 1\n\ndef f():\n    h(False)\n    def g():\n        raise ValueError("bad")\n    g()\n`, "py", { name: "ValueError", message: "bad" }, ["f", "h"])).toBeNull();
  });
  it("Python: a raise on one line after an if still counts", () => {
    expect(end(`def h(flag):\n    if flag: raise ValueError("bad")\n    return 1\n\ndef f():\n    h(False)\n    raise ValueError("bad")\n`, "py", { name: "ValueError", message: "bad" }, ["f", "h"])).toBeNull();
  });
  it("the one exact site in the file, in a function that ran, is placed", () => {
    expect(end(`export function f() {\n  throw new Error("mine");\n}\n`, "js", { name: "Error", message: "mine" }, ["f"])).toEqual({ part: "f", on: "chute", line: 2 });
  });
  it("the one site, in a function not known to have run, is not", () => {
    expect(end(`function h() {\n  throw new Error("mine");\n}\nexport function f() {\n  return h();\n}\n`, "js", { name: "Error", message: "mine" }, ["f"])).toBeNull();
  });
  it("a throw plain code can't read could be anything: it places nothing", () => {
    expect(end(`export function f(e) {\n  if (e) throw e;\n  throw new Error("mine");\n}\n`, "js", { name: "Error", message: "mine" }, ["f"])).toBeNull();
  });
});

describe("B3: a function that returns a function", () => {
  it("doesn't get its inner function's parts", () => {
    const b = fileOutline(`export const f = (a) => (b) => {\n  for (const v of [a]) if (v) throw new Error("late");\n  return b;\n};\n`, "ts").bodies!.f!;
    expect(b.throws).toEqual([]);
    expect(b.loops).toEqual([]);
  });
  it("an ordinary expression body is still read", () => {
    expect(fileOutline(`export const f = (a) => [a].map((v) => v);\n`, "ts").bodies!.f!.throws).toEqual([]);
  });
});

describe("B1: a public link", () => {
  const SRC = `function check() {\n  throw new Error("internal host db-prod-7.acme.local refused");\n}\nexport function f(a) {\n  if (a === 99) check();\n  return a + 1;\n}\n`;
  it("holds no words from a throw, on disk or from the route, and the owner's card gets no more", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const app = createApp({ keptProofsDir: dir });
    const session = "ssownerownerowner1";
    const headers = { "content-type": "application/json", "x-atlas-session": session };
    const post = async (path: string, body?: unknown) => (await app.request(path, { method: "POST", headers, body: JSON.stringify(body ?? {}) })).json() as Promise<Record<string, never>>;
    const p = await post("/paste", { code: SRC, language: "js" });
    const target = { ref: (p.target as { ref: string }).ref, codeSha256: (p.target as { codeSha256: string }).codeSha256 };
    const e = await post("/experiments", { target, params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }, quiz: true });
    const id = (e.experiment as { id: string }).id;
    await post("/bets", { experimentId: id, who: "human", bets: (e.questions as { measures: string }[]).map((q) => ({ measures: q.measures, answer: { kind: "declined", reason: "can't tell" } })) });
    const runId = ((await post("/runs", { experimentId: id })).run as { id: string }).id;
    const own = await (await app.request(`/proofs/${runId}/machine`, { headers: { "x-atlas-session": session } })).text();
    expect(own).not.toMatch(/db-prod/);
    expect(await post(`/proofs/${runId}/keep`)).toMatchObject({ kept: true });
    const onDisk = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("");
    expect(onDisk).not.toMatch(/db-prod/);
    const reader = createApp({ keptProofsDir: dir });
    const route = await (await reader.request(`/proofs/${runId}/machine`)).text();
    expect(route).toContain('"parts"');
    expect(route).not.toMatch(/db-prod/);
    expect(JSON.parse(route).parts.housings.map((h: { name: string }) => h.name)).toContain("check");
  });
  it("a link kept before this rule is cut on the way out", () => {
    const parts = machinePartsOfFile(SRC, "js", test_("f"), fileOutline(SRC, "js"));
    expect(JSON.stringify(parts)).toMatch(/db-prod/);
    expect(JSON.stringify(publicParts(parts))).not.toMatch(/db-prod/);
  });
});

describe("M2: no certain fact, no motion", () => {
  const src = `export async function f(x, flag) {\n  await x();\n  if (flag) await new Promise((r) => setTimeout(r, 100));\n  return 1;\n}\n`;
  const o = fileOutline(src, "ts");
  const parts = machinePartsOfFile(src, "ts", test_("f"), o);
  const spec = { steps: [{ device: "clock", nodes: ["c"] }], nodes: [{ id: "c", sweep: 0.3 }] } as never;
  it("a fake's scripted delay moves no dial", () => {
    expect(machineScript(spec, parts, o, "f", new Map(), false)[0]!.dial).toBeUndefined();
  });
  it("with nothing else to move the clock, the one wait does", () => {
    expect(machineScript(spec, parts, o, "f", new Map(), true)[0]!.dial?.part).toBe("f");
  });
});

describe("M3 and M4: the record", () => {
  const SHA_A = "a".repeat(64);
  const SHA_B = "b".repeat(64);
  const round = (id: string, sha: string) => {
    const bet = sealBet({ experimentId: "e", who: "human", question: "how it ends", measures: "outcome", answer: { kind: "enum", value: "threw", options: ["returned", "threw"] } });
    return entriesFromRound([bet], [{ betId: bet.id, runId: id, outcome: "not_matched", observed: "returned" } as never], { id, finishedAt: "2026-11-02T00:00:01.000Z", result: { measured: { outcome: "returned" } } } as never, test_("f"), sha);
  };
  it("another file's f is not this f", () => {
    const entries = round("r1", SHA_A);
    expect(entries.length).toBe(1);
    expect(lastRoundOf(entries, functionKey("f", SHA_A))!.sameFunction).toBe(true);
    const other = lastRoundOf(entries, functionKey("f", SHA_B))!;
    expect(other.sameFunction).toBe(false);
    expect(lastRoundWords(other, "f")).toMatch(/^Last time: /);
  });
  it("the same code and test mark the same round, whichever session runs them", () => {
    expect(round("r1", SHA_A)[0]!.round).toBe(round("r2", SHA_A)[0]!.round);
    expect(round("r1", SHA_A)[0]!.round).not.toBe(round("r2", SHA_B)[0]!.round);
  });
});

describe("M4: through the server", () => {
  it("the same code and test after a reload don't count again; changed code does", async () => {
    const app = createApp({});
    const browser = "browser-aaaaaaaaaaaaaaaa";
    const play = async (session: string, code: string) => {
      const headers = { "content-type": "application/json", "x-atlas-session": session, "x-atlas-browser": browser };
      const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers, body: JSON.stringify(body) })).json() as Promise<Record<string, never>>;
      const p = await post("/paste", { code, language: "js" });
      const target = { ref: (p.target as { ref: string }).ref, codeSha256: (p.target as { codeSha256: string }).codeSha256 };
      const e = await post("/experiments", { target, params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }, quiz: true });
      const id = (e.experiment as { id: string }).id;
      const qs = e.questions as { measures: string; quiz: { id: string }[] }[];
      await post("/bets", { experimentId: id, who: "human", bets: qs.map((q) => ({ measures: q.measures, answer: { kind: "quiz", choice: q.quiz[0]!.id } })) });
      await post("/runs", { experimentId: id });
      return ((await (await app.request("/track-record", { headers })).json()) as { record: { counted: number } }).record.counted;
    };
    const A = "export function f(a) {\n  return a;\n}\n";
    const first = await play("sessionfirstfirst001", A);
    expect(first).toBeGreaterThan(0);
    expect(await play("sessionsecondsecond02", A)).toBe(first);
    expect(await play("sessionthirdthird0003", `${A}// changed\n`)).toBeGreaterThan(first);
  }, 60_000);
});

describe("M6: a wrapped function", () => {
  it("can be bet on", () => {
    const o = fileOutline(`import { memo } from "react";\nexport const f = memo((x) => {\n  if (!x) throw new Error("x");\n  return x;\n});\n`, "ts");
    expect(o.parts.find((p) => p.name === "f")).toMatchObject({ kind: "function", exported: true });
    expect(o.bodies!.f!.returns).toEqual([4]);
    expect(defaultFunction(o, [{ name: "f" }] as never)).toBe("f");
  });
  it("a call with no function written in it stays a value", () => {
    expect(fileOutline(`const g = () => 1;\nexport const f = memo(g);\n`, "ts").parts.find((p) => p.name === "f")).toBeUndefined();
  });
});

describe("the line the run threw from", () => {
  const parts = (src: string, lang: "js" | "py", fn: string) => machinePartsOfFile(src, lang, test_(fn), fileOutline(src, lang));
  const thrown = { name: "Error", message: "HTTP 429" };
  const SRC = "function page(s) {\n  if (s) throw new Error(`HTTP ${s}`);\n  return 1;\n}\nexport function f(s) {\n  return page(s);\n}\n";
  it("rings a template's throw when that line is a throw on a part known to have run", () => {
    expect(endOfRun({ outcome: "threw", thrown, parts: parts(SRC, "js", "f"), tested: "f", ran: new Set(["f", "page"]), called: () => false, thrownAt: 2 })).toEqual({ part: "page", on: "chute", line: 2 });
  });
  it("nothing when the part isn't known to have run", () => {
    expect(endOfRun({ outcome: "threw", thrown, parts: parts(SRC, "js", "f"), tested: "f", ran: new Set(["f"]), called: () => false, thrownAt: 2 })).toBeNull();
  });
  it("nothing when the line isn't a throw", () => {
    expect(endOfRun({ outcome: "threw", thrown, parts: parts(SRC, "js", "f"), tested: "f", ran: new Set(["f", "page"]), called: () => false, thrownAt: 3 })).toBeNull();
  });
  it("the words can't overrule the line", () => {
    const one = `export function f() {\n  const e = new TypeError("not this");\n  throw new Error("mine");\n}\n`;
    expect(endOfRun({ outcome: "threw", thrown: { name: "Error", message: "mine" }, parts: parts(one, "js", "f"), tested: "f", ran: new Set(["f"]), called: () => false, thrownAt: 2 })).toBeNull();
  });
  const fakeTest = { shape: "call-function", exportName: "f", args: [{ kind: "stand-in", name: "x", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "Error", message: "flaky" }] }] } as never;
  const withFake = (src: string) => machinePartsOfFile(src, "js", fakeTest, fileOutline(src, "js"));
  const fake = (src: string) => endOfRun({ outcome: "threw", thrown: { name: "Error", message: "flaky" }, parts: withFake(src), tested: "f", test: fakeTest, ran: new Set(["f"]), called: () => true, thrownAt: null });
  it("a fake's error passed on by the one rethrow stays on the fake", () => {
    expect(fake(`export async function f(x) {\n  let last;\n  try { return await x(); } catch (e) { last = e; }\n  throw last;\n}\n`)).toEqual({ part: "stand-in x", on: "port" });
  });
  it("two rethrows: it can't be told which, so no ring", () => {
    expect(fake(`export async function f(x) {\n  let last;\n  try { return await x(); } catch (e) { last = e; if (e.code) throw e; }\n  throw last;\n}\n`)).toBeNull();
  });
  it("the third run reports it, by real runs: JS, TS and Python, and none from a library's frame", async () => {
    const { helperRun } = await import("../../server/helpers");
    const { PASTED_RUNNERS } = await import("../../runners/pasted-registry");
    const { executorFromEnv } = await import("../../runners/executor/select");
    const { createHash } = await import("node:crypto");
    const executor = executorFromEnv();
    const at = async (source: string, language: "js" | "ts" | "py") => {
      const params = { shape: "call-function", exportName: "f", args: [] };
      const exp = { id: "e", target: { kind: "pasted", ref: "p", language, source, codeSha256: createHash("sha256").update(source).digest("hex") }, runner: "ts", proposedBy: { role: "human" }, params, gate: { allowed: true } };
      const r = PASTED_RUNNERS[language]!;
      const run = await r.run(exp as never, (await r.control(executor)) as never, executor);
      const h = await helperRun(exp as never, run, { executor });
      return "steps" in h ? h.thrownAt ?? null : `none: ${h.none}`;
    };
    expect(await at(`// one\n// two\nfunction h() {\n  throw new Error("x");\n}\nexport function f() {\n  h();\n}\n`, "js")).toBe(4);
    expect(await at(`type T = {\n  a: number;\n};\nfunction h(): T {\n  throw new TypeError("x");\n}\nexport function f(): T {\n  return h();\n}\n`, "ts")).toBe(5);
    expect(await at(`# one\ndef h():\n    raise ValueError("x")\n\ndef f():\n    h()\n`, "py")).toBe(3);
    expect(await at(`export function f() {\n  return JSON.parse("<");\n}\n`, "js")).toBeNull();
    expect(await at(`export function f() {\n  return 1;\n}\n`, "js")).toBeNull();
  }, 60_000);
});

describe("merge gate N1: only a function written in a plain wrapper is callable", () => {
  const partOf = (src: string) => fileOutline(src, "ts").parts.find((p) => p.name === "f");
  it("a list method's result, a timer and a promise are not functions", () => {
    for (const src of [
      "const nums = [1, 2, 3];\nexport const f = nums.map((n) => n * 2);\n",
      "const nums = [1, 2, 3];\nexport const f = nums.reduce((a, n) => a + n, 0);\n",
      "const nums = [1, 2, 3];\nexport const f = nums.filter((n) => n > 1);\n",
      'export const f = setTimeout(() => { throw new Error("x"); }, 10);\n',
      "export const f = Promise.resolve().then(() => 1);\n",
    ]) {
      expect(partOf(src)?.kind, src).not.toBe("function");
      expect(defaultFunction(fileOutline(src, "ts"), [{ name: "f" }] as never), src).toBeNull();
    }
  });
  it("memo((x) => ...) is a function, and f does not call memo", () => {
    const o = fileOutline('import { memo } from "react";\nexport const f = memo((x) => {\n  return x;\n});\n', "ts");
    expect(o.parts.find((p) => p.name === "f")?.kind).toBe("function");
    expect(o.joins.map((j) => `${j.from}->${j.to}`)).not.toContain("f->memo");
  });
});

describe("short check: wrappers are an allow-list", () => {
  const kind = (src: string) => fileOutline(src, "ts").parts.find((p) => p.name === "f")?.kind;
  it("an unknown call gives no part, whatever it is handed", () => {
    for (const src of [
      "function run(fn) { return fn(); }\nexport const f = run(() => 42);\n",
      "function reduce(xs, fn) { return xs.reduce(fn); }\nexport const f = reduce([1, 2], (a, b) => a + b);\n",
      "function sortBy(xs, fn) { return [...xs].sort(fn); }\nexport const f = sortBy([2, 1], (a, b) => a - b);\n",
      "function computed(fn) { return { get value() { return fn(); } }; }\nexport const f = computed(() => 1);\n",
      "function atom(fn) { return { read: fn }; }\nexport const f = atom(() => 1);\n",
      "import React from 'react';\nexport const f = React.useMemo(() => 1, []);\n",
    ]) expect(kind(src), src).not.toBe("function");
  });
  it("the known function wrappers are", () => {
    for (const [w, from] of [["memo", "react"], ["debounce", "lodash"], ["throttle", "lodash-es"], ["once", "lodash/once"], ["useCallback", "react"], ["forwardRef", "react"], ["React.memo", "react"], ["React.forwardRef", "react"]]) {
      const head = w.includes(".") ? `import React from "${from}";` : `import { ${w} } from "${from}";`;
      expect(kind(`${head}\nexport const f = ${w}((x) => {\n  return x;\n});\n`), w).toBe("function");
    }
    // Not bound in the file at all: the name as the libraries mean it.
    expect(kind("export const f = withAuth((x) => {\n  return x;\n});\n")).toBe("function");
    expect(kind('const debounce = require("lodash.debounce");\nexport const f = debounce((x) => x, 10);\n')).toBe("function");
  });
  it("the file's own memo, once or withX: no part, whatever it returns", () => {
    for (const src of [
      "const memo = (g) => g();\nexport const f = memo(() => 1);\n",
      "function once(g) { return g(); }\nexport const f = once(() => 1);\n",
      "const withX = (g) => g();\nexport const f = withX(() => 1);\n",
      'import { memo } from "./my-cache";\nexport const f = memo(() => 1);\n',
      "const React = { memo: (g) => g() };\nexport const f = React.memo(() => 1);\n",
    ]) expect(kind(src), src).not.toBe("function");
  });
});

describe("merge gate N2: no pasted code runs while Atlas reads the traceback", () => {
  it("a str subclass as the file name can't run its __eq__ in the window, and the window is shut after", async () => {
    const { readFileSync } = await import("node:fs");
    const { runProbedPyCall } = await import("../../runners/py/py-runner");
    const { createHash } = await import("node:crypto");
    const base = readFileSync(new URL("./fixtures-py6.py.txt", import.meta.url), "utf8");
    const src = `${base}\ndef b():\n    try:\n        a()\n    except ValueError:\n        pass\n    LOOT.append("after:" + str(after()))\n    raise RuntimeError(repr(LOOT)[:1500])\n`;
    const run = async (name: string) => {
      const exp = { id: "e", target: { kind: "pasted", ref: "p", language: "py", source: src, codeSha256: createHash("sha256").update(src).digest("hex") }, runner: "ts", proposedBy: { role: "human" }, params: { shape: "call-function", exportName: name, args: [] }, gate: { allowed: true } };
      return (await runProbedPyCall(exp as never, src)) as { reason?: string; result?: { measured: Record<string, unknown> } };
    };
    const a = await run("a");
    expect(a.result?.measured.thrownMessage).toBe("x");
    const b = await run("b");
    expect(JSON.stringify(b)).not.toMatch(/own_walk pinned|disarmed|keys=/);
    expect(b.reason ?? "").toMatch(/stack frame/);
  }, 60_000);
});

describe("merge gate minor: two throws on the line the run threw from", () => {
  it("place nothing", () => {
    const src = 'export function f(x) { if (x) throw new Error("a"); [1].forEach(() => { throw new Error("b"); }); }\n';
    const parts = machinePartsOfFile(src, "js", test_("f"), fileOutline(src, "js"));
    expect(endOfRun({ outcome: "threw", thrown: { name: "Error", message: "b" }, parts, tested: "f", ran: new Set(["f"]), called: () => false, thrownAt: 1 })).toBeNull();
  });
});
