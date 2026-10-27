// X1: the plain-code code map on small JS/TS/Python codebases. No model, nothing is run.
import { describe, expect, it } from "vitest";
import { buildCodeMap, bracketDepth, MAX_BRACKET_DEPTH, resolveJs } from "../../src/outline/codemap";
import type { CodeMap, OutlineLanguage } from "../../src/outline/types";

const f = (path: string, text: string, language?: OutlineLanguage) => ({ path, text, language: language ?? (path.endsWith(".py") ? "py" : /\.tsx?$/.test(path) ? "ts" : "js") as OutlineLanguage });
const edgeIds = (m: CodeMap) => m.edges.map((e) => e.id);
const fileOf = (m: CodeMap, p: string) => m.files.find((x) => x.path === p)!;
const sym = (m: CodeMap, p: string, name: string) => fileOf(m, p).symbols.find((s) => s.name === name);

const JS = [
  f("a.ts", `import { save as persist } from "./db";\nimport * as q from "./queue/index.js";\nimport Def from "./def";\nimport type { T } from "./types";\nimport React from "react";\nimport { join } from "node:path";\nexport async function run(x: number): Promise<void> {\n  await persist(x);\n  q.push(x);\n  new Def();\n  const m = await import("./lazy");\n  const n = await import(name);\n}\nexport default run;\n`),
  f("db.ts", `export function save(n: number): number {\n  return n;\n}\nfunction hidden() {}\n`),
  f("queue/index.ts", `export { push } from "./impl";\nexport * from "./more";\nexport * as extra from "./more";\n`),
  f("queue/impl.ts", `import { run } from "../a";\nexport const push = (n: number) => {\n  run(n);\n};\n`),
  f("queue/more.ts", `export class Queue {\n  add(x: number) { return x; }\n}\n`),
  f("def.js", `class D {\n  m() { return 1; }\n}\nmodule.exports = D;\n`),
  f("types.ts", `export interface T { a: number }\n`),
  f("cjs.cjs", `const { save } = require("./db");\nconst q = require("./queue/index");\nexports.go = function () { return save(1) + q.push(2); };\nfunction late() { return require("./def"); }\n`),
  f("ui.tsx", `import { Panel } from "./panel";\nexport function App() {\n  return <Panel title="x" />;\n}\n`),
  f("panel.tsx", `export const Panel = (p: { title: string }) => <div>{p.title}</div>;\n`),
];

describe("JS/TS code map (TypeScript compiler parser)", () => {
  const m = buildCodeMap(JS);

  it("lists exports, top-level functions and classes with line spans and signatures", () => {
    expect(sym(m, "db.ts", "save")).toMatchObject({ id: "db.ts#save", kind: "function", exported: true, lineStart: 1, lineEnd: 3, params: ["n: number"], returns: "number" });
    expect(sym(m, "db.ts", "hidden")).toMatchObject({ exported: false });
    expect(sym(m, "a.ts", "run")).toMatchObject({ exported: true, isDefault: true, lineStart: 7, lineEnd: 13, returns: "Promise<void>" });
    expect(sym(m, "queue/more.ts", "Queue")).toMatchObject({ kind: "class", exported: true, lineStart: 1, lineEnd: 3 });
    expect(fileOf(m, "queue/more.ts").symbols.find((s) => s.parent === "Queue")).toMatchObject({ id: "queue/more.ts#Queue.add", name: "add", lineStart: 2 });
  });

  it("default exports: `export default name` and CommonJS `module.exports = D`", () => {
    expect(sym(m, "def.js", "D")).toMatchObject({ exported: true, isDefault: true });
    expect(sym(m, "cjs.cjs", "go")).toMatchObject({ kind: "function", exported: true });
  });

  it("resolves imports: relative, .js written for .ts, index files, packages by name", () => {
    const imps = fileOf(m, "a.ts").imports;
    expect(imps.find((i) => i.specifier === "./db")!.target).toEqual({ kind: "file", path: "db.ts" });
    expect(imps.find((i) => i.specifier === "./queue/index.js")!.target).toEqual({ kind: "file", path: "queue/index.ts" });
    expect(imps.find((i) => i.specifier === "./def")!.target).toEqual({ kind: "file", path: "def.js" });
    expect(imps.find((i) => i.specifier === "./types")!.kind).toBe("type-only");
    expect(imps.find((i) => i.specifier === "react")!.target).toEqual({ kind: "external", name: "react" });
    expect(m.externals).toEqual([
      { name: "node:path", importedBy: ["a.ts"] },
      { name: "react", importedBy: ["a.ts"] },
    ]);
  });

  it("dynamic imports and computed names are listed as unresolved, never followed", () => {
    const dyn = fileOf(m, "a.ts").imports.filter((i) => i.kind === "dynamic");
    expect(dyn).toHaveLength(2);
    for (const d of dyn) expect(d.target.kind).toBe("unresolved");
    expect(dyn.find((d) => d.specifier === "<computed>")!.target).toMatchObject({ reason: expect.stringContaining("computed") });
    expect(edgeIds(m).some((id) => id.includes("lazy"))).toBe(false);
  });

  it("aliasing: `save as persist` → a call of persist is a call of db.ts#save", () => {
    expect(m.edges.find((e) => e.id === "calls:a.ts->db.ts:persist")).toMatchObject({ toSymbol: "db.ts#save" });
  });

  it("re-exports: q.push() through queue/index.ts reaches the file that defines push", () => {
    expect(m.edges.find((e) => e.id === "calls:a.ts->queue/impl.ts:q.push")).toMatchObject({ toSymbol: "queue/impl.ts#push" });
    expect(edgeIds(m)).toContain("imports:queue/index.ts->queue/impl.ts:./impl");
    expect(edgeIds(m)).toContain("imports:queue/index.ts->queue/more.ts:./more");
    expect(fileOf(m, "queue/index.ts").imports.map((i) => i.kind)).toEqual(["re-export", "re-export", "re-export"]);
  });

  it("new Class() and <Component /> count as calls", () => {
    expect(edgeIds(m)).toContain("calls:a.ts->def.js:new Def");
    expect(edgeIds(m)).toContain("calls:ui.tsx->panel.tsx:<Panel>");
  });

  it("CommonJS require (destructured, whole module, nested) is read", () => {
    const imps = fileOf(m, "cjs.cjs").imports;
    expect(imps.map((i) => [i.line, i.specifier, i.kind])).toEqual([
      [1, "./db", "require"],
      [2, "./queue/index", "require"],
      [4, "./def", "require"],
    ]);
    expect(edgeIds(m)).toContain("calls:cjs.cjs->db.ts:save");
    expect(edgeIds(m)).toContain("calls:cjs.cjs->queue/impl.ts:q.push");
  });

  it("circular imports (a.ts ↔ queue/impl.ts) terminate and give one edge each way", () => {
    expect(edgeIds(m)).toContain("calls:queue/impl.ts->a.ts:run");
    expect(edgeIds(m)).toContain("imports:a.ts->queue/index.ts:./queue/index.js");
    expect(edgeIds(m)).toContain("imports:queue/impl.ts->a.ts:../a");
  });

  it("a self-referencing re-export cycle does not loop", () => {
    const loop = buildCodeMap([f("x.ts", `export * from "./y";\nexport { a } from "./y";\n`), f("y.ts", `export * from "./x";\nexport { a } from "./x";\n`), f("z.ts", `import { a } from "./x";\na();\n`)]);
    expect(edgeIds(loop)).toContain("calls:z.ts->x.ts:a");
  });

  it("is deterministic: the same files in any order give the same map, byte for byte", () => {
    const again = buildCodeMap([...JS].reverse());
    expect(JSON.stringify(again)).toBe(JSON.stringify(m));
    expect(m.files.map((x) => x.path)).toEqual([...m.files.map((x) => x.path)].sort());
    expect(edgeIds(m)).toEqual([...edgeIds(m)].sort());
  });

  it("a path climbing out of the codebase or an alias is unresolved", () => {
    expect(resolveJs("a.ts", { specifier: "../../etc/passwd", kind: "static" }, new Set(["a.ts"]))).toMatchObject({ kind: "unresolved" });
    expect(resolveJs("a.ts", { specifier: "@/lib/x", kind: "static" }, new Set(["a.ts"]))).toMatchObject({ kind: "unresolved" });
    expect(resolveJs("a.ts", { specifier: "@scope/pkg/sub", kind: "static" }, new Set(["a.ts"]))).toEqual({ kind: "external", name: "@scope/pkg" });
  });

  it("a file with syntax errors still maps, with a parse note", () => {
    const bad = buildCodeMap([f("bad.ts", `export function ok() {}\nexport const = ;\n`)]);
    expect(fileOf(bad, "bad.ts").parseNotes[0]).toMatch(/syntax problem/);
    expect(sym(bad, "bad.ts", "ok")).toBeDefined();
  });

  it("a bracket bomb is not parsed (deterministic note), and nothing throws", () => {
    const bomb = "(".repeat(MAX_BRACKET_DEPTH + 5);
    expect(bracketDepth(bomb)).toBeGreaterThan(MAX_BRACKET_DEPTH);
    const bm = buildCodeMap([f("bomb.js", `export const x = ${bomb};`), f("bomb.py", `x = ${"[".repeat(5000)}`)]);
    expect(fileOf(bm, "bomb.js").parseNotes[0]).toMatch(/nest deeper/);
    expect(fileOf(bm, "bomb.py").parseNotes[0]).toMatch(/nest deeper/);
  });
});

const PY = [
  f("main.py", `import pkg\nfrom pkg import handle\nimport pkg.util as pu\nimport requests\nimport os.path\n\nhandle(1)\npkg.handle(2)\npu.helper(3)\nimportlib.import_module("pkg.core")\n`),
  f("pkg/__init__.py", `from .core import handle\n__all__ = ["handle"]\n`),
  f(
    "pkg/core.py",
    `import os\nfrom . import util\nfrom .util import helper as h\nfrom ..outside import nope\n\n@decor(\n    arg=1,\n)\nasync def handle(req, *, retries: int = 3) -> dict:\n    """doc with 'quotes' and f"{x}" """\n    x = util.helper(req)\n    if x:\n        return h(x)\n\n    # a comment at column 0 inside the function\n    return {}\n\nclass Worker(Base):\n    limit = 3\n\n    def run(self, job):\n        def inner():\n            pass\n        return h(job)\n\n    async def stop(self) -> None:\n        pass\n\n\ndef _private():\n    pass\n`,
  ),
  f("pkg/util.py", `def helper(x):\n    s = f"{x['a']} {'}'} {x["b"]}"\n    t = '''multi\nline'''\n    return s + \\\n        t\n\nVALUE: int = 3\n`),
  f("pkg/sub/__init__.py", ``),
  f("pkg/sub/deep.py", `from ...pkg import core\nfrom .. import util\nfrom . import missing\n`),
];

describe("Python code map (pure-TS scanner)", () => {
  const m = buildCodeMap(PY);

  it("top-level defs (decorated, async), classes and their methods, with line spans and signatures", () => {
    expect(sym(m, "pkg/core.py", "handle")).toMatchObject({ kind: "function", lineStart: 6, lineEnd: 16, params: ["req", "*", "retries: int = 3"], returns: "dict", signature: "async def handle(req, *, retries: int = 3) -> dict" });
    expect(sym(m, "pkg/core.py", "Worker")).toMatchObject({ kind: "class", lineStart: 18, lineEnd: 27, signature: "class Worker(Base)" });
    expect(fileOf(m, "pkg/core.py").symbols.filter((s) => s.parent === "Worker").map((s) => [s.name, s.lineStart, s.lineEnd])).toEqual([
      ["run", 21, 24],
      ["stop", 26, 27],
    ]);
    expect(sym(m, "pkg/core.py", "inner")).toBeUndefined();
    expect(sym(m, "pkg/core.py", "_private")).toMatchObject({ exported: false });
    expect(sym(m, "pkg/util.py", "helper")).toMatchObject({ lineStart: 1, lineEnd: 6 });
    expect(sym(m, "pkg/util.py", "VALUE")).toMatchObject({ kind: "variable", lineStart: 8 });
    expect(fileOf(m, "pkg/util.py").parseNotes).toEqual([]);
  });

  it("__all__ decides what a module exports", () => {
    expect(sym(m, "pkg/__init__.py", "__all__")).toMatchObject({ exported: false });
  });

  it("relative imports: `.`, `.util`, `..` from a subpackage, `...` climbing out", () => {
    const core = fileOf(m, "pkg/core.py").imports;
    expect(core.find((i) => i.specifier === ".")!.target).toEqual({ kind: "file", path: "pkg/util.py" });
    expect(core.find((i) => i.specifier === ".util")!.target).toEqual({ kind: "file", path: "pkg/util.py" });
    expect(core.find((i) => i.specifier === "..outside")!.target).toMatchObject({ kind: "unresolved" });
    const deep = fileOf(m, "pkg/sub/deep.py").imports;
    expect(deep.find((i) => i.specifier === "..")!.target).toEqual({ kind: "file", path: "pkg/util.py" });
    expect(deep.find((i) => i.specifier === "...pkg")!.target).toEqual({ kind: "file", path: "pkg/core.py" });
    expect(deep.find((i) => i.specifier === ".")!.target).toEqual({ kind: "file", path: "pkg/sub/__init__.py" });
  });

  it("absolute imports resolve inside the codebase; others are outside packages by top-level name", () => {
    const main = fileOf(m, "main.py").imports;
    expect(main.find((i) => i.specifier === "pkg.util")!.target).toEqual({ kind: "file", path: "pkg/util.py" });
    expect(m.externals.map((e) => e.name)).toEqual(["os", "requests"]);
  });

  it("calls through `from pkg import handle`, `pkg.handle` and an aliased module reach the defining file", () => {
    expect(m.edges.find((e) => e.id === "calls:main.py->pkg/core.py:handle")).toMatchObject({ toSymbol: "pkg/core.py#handle" });
    expect(m.edges.find((e) => e.id === "calls:main.py->pkg/core.py:pkg.handle")).toMatchObject({ toSymbol: "pkg/core.py#handle" });
    expect(m.edges.find((e) => e.id === "calls:main.py->pkg/util.py:pu.helper")).toMatchObject({ toSymbol: "pkg/util.py#helper" });
    expect(edgeIds(m)).toContain("calls:pkg/core.py->pkg/util.py:util.helper");
    expect(edgeIds(m)).toContain("calls:pkg/core.py->pkg/util.py:h");
  });

  it("importlib.import_module is a dynamic import, listed unresolved", () => {
    const dyn = fileOf(m, "main.py").imports.find((i) => i.kind === "dynamic")!;
    expect(dyn).toMatchObject({ line: 10, specifier: "pkg.core", target: { kind: "unresolved" } });
  });

  it("circular Python imports terminate", () => {
    const c = buildCodeMap([f("a.py", "from b import g\ndef f():\n    return g()\n"), f("b.py", "from a import f\ndef g():\n    return f()\n")]);
    expect(edgeIds(c)).toEqual(["calls:a.py->b.py:g", "calls:b.py->a.py:f", "imports:a.py->b.py:b", "imports:b.py->a.py:a"]);
  });

  it("an unclosed string is noted and what came before it is kept", () => {
    const c = buildCodeMap([f("u.py", "def ok():\n    pass\n\nx = 'never closed\n")]);
    expect(fileOf(c, "u.py").parseNotes[0]).toMatch(/unclosed string/);
    expect(sym(c, "u.py", "ok")).toBeDefined();
  });
});
