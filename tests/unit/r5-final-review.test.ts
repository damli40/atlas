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
    const o = fileOutline(`const memo = (fn) => fn;\nexport const f = memo((x) => {\n  if (!x) throw new Error("x");\n  return x;\n});\n`, "ts");
    expect(o.parts.find((p) => p.name === "f")).toMatchObject({ kind: "function", exported: true });
    expect(o.bodies!.f!.returns).toEqual([4]);
    expect(defaultFunction(o, [{ name: "f" }] as never)).toBe("f");
  });
  it("a call with no function written in it stays a value", () => {
    expect(fileOutline(`const g = () => 1;\nexport const f = memo(g);\n`, "ts").parts.find((p) => p.name === "f")).toBeUndefined();
  });
});
