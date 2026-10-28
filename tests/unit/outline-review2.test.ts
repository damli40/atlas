// X1 review round 2: one or more tests per finding, from the reviewer's inputs (scratchpad x1r2/b1.ts, b1g.ts,
// b2.ts, b2b.ts, star.ts, vwork.ts, tamper.ts) and from the live runs' false code-only joins.
import { describe, expect, it } from "vitest";
import { buildCodeMap, MAX_MAP_WORK, TOO_COMPLEX_TO_MAP } from "../../src/outline/codemap";
import { makeOutlineSection, outlineSectionProblems, sha256Text, utf8Length, verifyOutlineFile } from "../../src/outline/section";
import { COULD_NOT_CHECK, FOUND_NO_LINK, checkOutlineValue, verifyOutline } from "../../src/outline/verify";
import type { CodeMap, OutlineFile, OutlineLanguage, WonderOutline } from "../../src/outline/types";
import { childProcessOffLoop, OffLoopError } from "../../server/outline/offloop";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { FILES, GOOD } from "../tools/outline-fixtures";

const lang = (p: string): OutlineLanguage => (p.endsWith(".py") ? "py" : /\.(?:tsx?|mts|cts)$/.test(p) ? "ts" : "js");
const file = (path: string, text: string): OutlineFile => ({ path, text, language: lang(path), sha256: sha256Text(text), bytes: utf8Length(text) });
const part = (id: string, path: string, lineStart: number, lineEnd: number, quotedSnippet: string) => ({ id, name: id, purpose: "p", files: [{ path, lineStart, lineEnd, quotedSnippet }], patterns: [] });
const ids = (m: CodeMap) => m.edges.map((e) => e.id);
const verify = (files: OutlineFile[], o: WonderOutline) => verifyOutline(files, buildCodeMap(files), o, "muse-wonder-1.0");

// ---------- R2-B1 ----------

describe("R2-B1: an import line alone never links a part that does not use the name", () => {
  const UTIL = "import { saveUser } from './db'\n\nexport function formatDate(d: Date) {\n  return d.toISOString()\n}\n\nexport function persist(xs: number[]) {\n  for (const x of xs) saveUser(x)\n}\n";
  const DB = "export function saveUser(x: number) {\n  return x\n}\n";
  const files = [file("util.ts", UTIL), file("db.ts", DB)];
  const ev = { path: "util.ts", line: 1, quotedSnippet: "import { saveUser } from './db'" };

  it("the reviewer's B1a: fmt (lines 1–5, the import plus a pure function) → db is never imports/data-confirmed, never code-only", () => {
    const v = verify(files, {
      parts: [part("fmt", "util.ts", 1, 5, "import { saveUser } from './db'"), part("persist", "util.ts", 7, 9, "export function persist(xs: number[]) {"), part("db", "db.ts", 1, 3, "export function saveUser(x: number) {")],
      joins: [
        { from: "fmt", to: "db", kind: "imports", evidence: ev },
        { from: "fmt", to: "db", kind: "data", evidence: ev },
      ],
    });
    expect(v.joins.filter((j) => j.from === "fmt").map((j) => j.status)).toEqual(["model-only", "model-only"]);
    expect(v.joins.find((j) => j.id === "code:persist->db")).toMatchObject({ status: "code-only", kind: "calls" });
  });

  it("a part holding the whole importing file links through its import statement", () => {
    const v = verify(files, { parts: [part("util", "util.ts", 1, 9, "import { saveUser } from './db'"), part("db", "db.ts", 1, 3, "export function saveUser(x: number) {")], joins: [{ from: "util", to: "db", kind: "imports", evidence: ev }] });
    expect(v.joins[0]).toMatchObject({ status: "confirmed", wonderEvidence: { matches: true } });
  });

  it("the live itsdangerous case: a protocol part at the top of serializer.py gets no join from the imports above it", () => {
    const SER = [
      "from .encoding import want_bytes",
      "from .exc import BadPayload",
      "from .signer import Signer",
      "",
      "class _PDataSerializer:",
      "    def loads(self, payload):",
      "        pass",
      "",
      "class Serializer:",
      "    def load_payload(self, payload):",
      "        want_bytes(payload)",
      "        raise BadPayload('x')",
      "    def make_signer(self):",
      "        return Signer()",
      "",
    ].join("\n");
    const pyFiles = [
      file("pkg/__init__.py", ""),
      file("pkg/serializer.py", SER),
      file("pkg/encoding.py", "def want_bytes(s):\n    return s\n"),
      file("pkg/exc.py", "class BadPayload(Exception):\n    pass\n"),
      file("pkg/signer.py", "class Signer:\n    pass\n"),
    ];
    const v = verify(pyFiles, {
      parts: [
        part("serializer-protocol", "pkg/serializer.py", 1, 7, "from .encoding import want_bytes"),
        part("serializer-core", "pkg/serializer.py", 9, 14, "class Serializer:"),
        part("encoding-utils", "pkg/encoding.py", 1, 2, "def want_bytes(s):"),
        part("exceptions", "pkg/exc.py", 1, 2, "class BadPayload(Exception):"),
        part("signer-core", "pkg/signer.py", 1, 2, "class Signer:\n    pass"),
      ],
      joins: [],
    });
    const codeOnly = v.joins.filter((j) => j.status === "code-only").map((j) => j.id);
    expect(codeOnly.filter((id) => id.startsWith("code:serializer-protocol->"))).toEqual([]);
    expect(codeOnly).toEqual(expect.arrayContaining(["code:serializer-core->encoding-utils", "code:serializer-core->exceptions", "code:serializer-core->signer-core"]));
  });

  it("the live runners/evm case: apply-parse-plan (lines 1–N of apply.ts) gets no join from a constant imported for another part", () => {
    const APPLY = ["import { CHAINLINK_ORACLE } from './moonwell-base';", "import { tokenSymbol } from './reads';", "", "export function parsePlan(x: string) {", "  return x.trim();", "}", "", "export function onchain() {", "  return CHAINLINK_ORACLE;", "}", "", "export function resolve() {", "  return tokenSymbol('a');", "}", ""].join("\n");
    const tsFiles = [file("apply.ts", APPLY), file("moonwell-base.ts", "export const CHAINLINK_ORACLE = '0x1';\n"), file("reads.ts", "export function tokenSymbol(a: string) {\n  return a;\n}\n")];
    const v = verify(tsFiles, {
      parts: [
        part("apply-parse-plan", "apply.ts", 1, 6, "import { CHAINLINK_ORACLE } from './moonwell-base';"),
        part("apply-onchain", "apply.ts", 8, 10, "export function onchain() {"),
        part("apply-resolve", "apply.ts", 12, 14, "export function resolve() {"),
        part("constants", "moonwell-base.ts", 1, 1, "export const CHAINLINK_ORACLE = '0x1';"),
        part("reads", "reads.ts", 1, 3, "export function tokenSymbol(a: string) {"),
      ],
      joins: [],
    });
    const codeOnly = v.joins.filter((j) => j.status === "code-only").map((j) => j.id);
    expect(codeOnly.filter((id) => id.startsWith("code:apply-parse-plan->"))).toEqual([]);
    expect(codeOnly).toEqual(expect.arrayContaining(["code:apply-onchain->constants", "code:apply-resolve->reads"]));
  });
});

// ---------- R2-B2 ----------

const starFiles = (n: number, l: "ts" | "py") => {
  const out: OutlineFile[] = [];
  for (let i = 0; i < n; i++) {
    const others = [...Array(n).keys()].filter((j) => j !== i);
    out.push(file(l === "ts" ? `m${i}.ts` : `pkg/m${i}.py`, others.map((j) => (l === "ts" ? `export * from './m${j}'` : `from .m${j} import *`)).join("\n") + "\n"));
  }
  if (l === "py") out.push(file("pkg/__init__.py", ""));
  out.push(l === "ts" ? file("main.ts", "import { nope } from './m0'\nnope()\n") : file("pkg/main.py", "from .m0 import nope\nnope()\n"));
  return out;
};

describe("R2-B2: star re-export chains cost files × links, never the number of paths", () => {
  it("the reviewer's N=14 (TS and Python) and N=40 build in well under a second each", () => {
    for (const [n, l] of [[14, "ts"], [14, "py"], [40, "ts"]] as const) {
      const t = performance.now();
      const m = buildCodeMap(starFiles(n, l));
      expect(m.cantMap, `${n} ${l}`).toBeUndefined();
      expect(performance.now() - t, `${n} ${l}`).toBeLessThan(1000);
    }
  });

  it("the outline-only proof file of the reviewer's 3 KB input checks fast", () => {
    const files = starFiles(12, "ts");
    const s = makeOutlineSection({ source: { kind: "upload" }, files, skipped: [], wonder: { model: "muse-wonder-1.0", outline: null, attempts: [], failure: "not asked (test)" } });
    const t = performance.now();
    expect(verifyOutlineFile({ version: 1, kind: "outline", outline: s, createdAt: "2026-10-28T00:00:00.000Z" })).toMatchObject({ ok: true });
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it("past the counted work budget the map is given up the same way every time: 'can't check: too complex to map'", () => {
    // 50 files that all star-export each other, and many distinct names looked up through them.
    const n = 49;
    const files = starFiles(n, "ts").filter((f) => f.path !== "main.ts");
    const names = Array.from({ length: Math.ceil((2 * MAX_MAP_WORK) / (n * n)) }, (_, i) => `n${i}`);
    files.push(file("main.ts", `import { ${names.join(", ")} } from './m0'\n${names.map((x) => `${x}()`).join("\n")}\n`));
    const t = performance.now();
    const m = buildCodeMap(files);
    expect(m.cantMap).toBe(TOO_COMPLEX_TO_MAP);
    expect(m.edges).toEqual([]);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(JSON.stringify(buildCodeMap(files))).toBe(JSON.stringify(m));
    const v = verifyOutline(files, m, { parts: [part("a", "m0.ts", 1, n - 1, "export * from './m1'"), part("b", "m1.ts", 1, n - 1, "export * from './m0'")], joins: [{ from: "a", to: "b", kind: "calls", evidence: { path: "m0.ts", line: 1, quotedSnippet: "x" } }] }, "m");
    expect(v.joins[0]!.reason).toMatch(/too complex to map/);
  });

  it("the code map runs off the event loop, in a child process with a wall-clock limit", async () => {
    const off = childProcessOffLoop(30_000);
    const m = await off.map(FILES, []);
    expect(m).toEqual(JSON.parse(JSON.stringify(buildCodeMap(FILES))));
    await expect(childProcessOffLoop(1).map(FILES, [])).rejects.toBeInstanceOf(OffLoopError);
  }, 60_000);

  it("while one job's code map is still running, the server answers other requests", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const app = createApp({
      agentLog: createAgentLog(),
      outline: { offLoop: { map: async (f, c) => (await held, buildCodeMap(f, c)), section: async (i) => makeOutlineSection(i) } },
    });
    const start = await app.request("/outline/jobs", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "busy" }, body: JSON.stringify({ files: FILES.map((f) => ({ path: f.path, text: f.text })) }) });
    expect(start.status).toBe(202);
    expect((await app.request("/health")).status).toBe(200);
    const { jobId } = (await start.json()) as { jobId: string };
    expect(((await (await app.request(`/outline/jobs/${jobId}`, { headers: { "x-atlas-session": "busy" } })).json()) as { status: string }).status).toBe("mapping");
    release();
  });
});

// ---------- R2-M1 ----------

describe("R2-M1: Cls.method() reaches the method's own lines when the code map knows the method", () => {
  it("JS static call and Python Cls.method()", () => {
    const js = [file("store.ts", "export class Store {\n  static putThing(x: number) {\n    return x;\n  }\n  getThing() {\n    return 1;\n  }\n}\n"), file("app.ts", "import { Store } from './store';\nexport function go() {\n  return Store.putThing(1);\n}\n")];
    const ev = { path: "app.ts", line: 3, quotedSnippet: "return Store.putThing(1);" };
    const o: WonderOutline = {
      parts: [part("go", "app.ts", 2, 4, "export function go() {"), part("put", "store.ts", 2, 4, "static putThing(x: number) {"), part("get", "store.ts", 5, 7, "getThing() {\n    return 1;")],
      joins: [
        { from: "go", to: "put", kind: "calls", evidence: ev },
        { from: "go", to: "get", kind: "calls", evidence: ev },
      ],
    };
    const v = verify(js, o);
    expect(v.joins[0]).toMatchObject({ status: "confirmed", wonderEvidence: { matches: true } });
    expect(v.joins[1]!.status).toBe("model-only");
    const py = [file("store.py", "class Store:\n    def put(self):\n        pass\n\n    def get(self):\n        pass\n"), file("app.py", "from store import Store\n\ndef go():\n    Store.put(None)\n")];
    const m = buildCodeMap(py);
    expect(m.edges.find((e) => e.kind === "calls")!.toSymbol).toBe("store.py#Store.put");
  });
});

// ---------- R2-M2 ----------

describe("R2-M2: honest labels; calls inside one file and base classes are real edges", () => {
  const SIGNER = "class HMACAlgorithm:\n    pass\n\n\nclass Signer:\n    def __init__(self):\n        self.algorithm = HMACAlgorithm()\n";
  const TIMED = "from .signer import Signer\n\n\nclass TimestampSigner(Signer):\n    pass\n\n\nclass TimedSerializer:\n    default_signer = TimestampSigner\n";
  const files = [file("pkg/__init__.py", ""), file("pkg/signer.py", SIGNER), file("pkg/timed.py", TIMED)];
  const o: WonderOutline = {
    parts: [
      part("algorithms", "pkg/signer.py", 1, 2, "class HMACAlgorithm:\n    pass"),
      part("signer-core", "pkg/signer.py", 5, 7, "class Signer:\n    def __init__(self):"),
      part("timestamp-signer", "pkg/timed.py", 4, 5, "class TimestampSigner(Signer):"),
      part("timed-serializer", "pkg/timed.py", 8, 9, "class TimedSerializer:"),
    ],
    joins: [
      { from: "signer-core", to: "algorithms", kind: "calls", evidence: { path: "pkg/signer.py", line: 7, quotedSnippet: "self.algorithm = HMACAlgorithm()" } },
      { from: "timestamp-signer", to: "signer-core", kind: "imports", evidence: { path: "pkg/timed.py", line: 4, quotedSnippet: "class TimestampSigner(Signer):" } },
      { from: "timed-serializer", to: "timestamp-signer", kind: "data", evidence: { path: "pkg/timed.py", line: 9, quotedSnippet: "default_signer = TimestampSigner" } },
    ],
  };

  it("the itsdangerous Wonder-only joins (same-file call, base class, class reference) are now confirmed", () => {
    const v = verify(files, o);
    expect(v.joins.map((j) => [j.id, j.status, j.wonderEvidence?.matches])).toEqual([
      ["wonder:0", "confirmed", true],
      ["wonder:1", "confirmed", true],
      ["wonder:2", "confirmed", true],
    ]);
    const m = buildCodeMap(files);
    expect(ids(m)).toEqual(expect.arrayContaining(["calls:pkg/signer.py->pkg/signer.py:HMACAlgorithm", "uses:pkg/timed.py->pkg/signer.py:extends Signer", "uses:pkg/timed.py->pkg/timed.py:TimestampSigner"]));
    const js = buildCodeMap([file("a.ts", "export class Base {}\nexport class Child extends Base {}\n")]);
    expect(ids(js)).toEqual(["uses:a.ts->a.ts:extends Base"]);
  });

  it("a Wonder-only join never says 'the code doesn't show it'; 'found no import or call' only when plain code positively looked", () => {
    const v = verify(FILES, { ...GOOD, joins: [{ from: "retry", to: "api", kind: "calls", evidence: { path: "src/retry.ts", line: 5, quotedSnippet: "return await fn();" } }, { from: "api", to: "client", kind: "data", evidence: GOOD.joins[0]!.evidence }, { from: "client", to: "api", kind: "calls", evidence: GOOD.joins[0]!.evidence }] });
    expect(v.joins[0]!.reason).toBe(`${FOUND_NO_LINK}: no file of retry imports a file of api`);
    expect(v.joins[2]!.reason!.startsWith(`${FOUND_NO_LINK}`)).toBe(true);
    for (const j of v.joins) expect(j.reason ?? "").not.toMatch(/doesn't show/);
    const sameFile = verify(files, { ...o, joins: [{ from: "algorithms", to: "signer-core", kind: "calls", evidence: o.joins[0]!.evidence }] });
    expect(sameFile.joins[0]!.reason!.startsWith(COULD_NOT_CHECK)).toBe(true);
  });
});

// ---------- R2-M3 ----------

describe("R2-M3: names resolve in their real scope; when unsure, nothing is confirmed", () => {
  const DB = file("db.py", "def save_record(x):\n    pass\n");
  const calls = (m: CodeMap, from: string) => m.edges.filter((e) => e.kind === "calls" && e.from === from && e.to === "db.py");

  it("a Python import inside one function applies only to that function", () => {
    const m = buildCodeMap([DB, file("app.py", "def save_record(x):\n    pass\n\ndef use_remote_db():\n    from db import save_record\n    save_record(1)\n\ndef use_local_only():\n    save_record(2)\n")]);
    expect(calls(m, "app.py").flatMap((e) => e.lines)).toEqual([6]);
  });

  it("lambda parameters, comprehension variables and a module-level redefinition hide the import", () => {
    const m = buildCodeMap([DB, file("app.py", "from db import save_record\n\nf = lambda save_record: save_record(2)\ng = [save_record(1) for save_record in []]\n")]);
    expect(calls(m, "app.py")).toEqual([]);
    const r = buildCodeMap([DB, file("app.py", "from db import save_record\n\ndef save_record(x):\n    pass\n\ndef run():\n    save_record(1)\n")]);
    expect(calls(r, "app.py")).toEqual([]);
  });

  it("Python type annotations are types, not uses (as TypeScript types are skipped)", () => {
    const m = buildCodeMap([file("t.py", "class Proto:\n    pass\n"), file("u.py", "from t import Proto\n\nx: Proto = None\n\ndef f(a: Proto, b: int = 1) -> Proto:\n    return Proto()\n")]);
    expect(m.edges.filter((e) => e.kind !== "imports").map((e) => [e.kind, e.lines])).toEqual([["calls", [6]]]);
  });

  it("JS: a top-level for-of or block variable hides the import (TypeScript's binder decides)", () => {
    const m = buildCodeMap([file("db.ts", "export function saveUser(x: number) {}\n"), file("app.ts", "import { saveUser } from './db';\nfor (const saveUser of [() => 1]) saveUser();\n{ const saveUser = () => 2; saveUser(); }\nsaveUser(3);\n")]);
    expect(m.edges.filter((e) => e.kind === "calls").flatMap((e) => e.lines)).toEqual([4]);
  });
});

// ---------- R2-M4 ----------

describe("R2-M4: the work budget counts real comparisons", () => {
  it("the reviewer's 7-second input (233 KB, 1,515 edges, 40 parts × 5 ranges, 200 data joins) finishes under a second", () => {
    const NAMES = 100;
    const files: OutlineFile[] = [file("lib.py", "# a library of many small functions\n" + [...Array(NAMES).keys()].map((i) => `def f${i}():\n    return ${i}\n`).join(""))];
    const names = [...Array(NAMES).keys()].map((i) => `f${i}`);
    for (let c = 0; c < 15; c++) files.push(file(`c${c}.py`, [`from lib import ${names.join(", ")}`, `def run${c}():`, ...[...Array(25).keys()].map(() => "    " + names.map((n) => `${n}()`).join(";"))].join("\n") + "\n"));
    const map = buildCodeMap(files);
    const paths = files.map((f) => f.path);
    const count = (p: string) => files.find((f) => f.path === p)!.text.split("\n").length - 1;
    const first = (p: string) => files.find((f) => f.path === p)!.text.split("\n")[0]!;
    const parts = [...Array(40).keys()].map((i) => ({ id: `p${i}`, name: "x", purpose: "y", patterns: [], files: [0, 1, 2, 3, 4].map((k) => ({ path: paths[(i * 5 + k) % paths.length]!, lineStart: 1, lineEnd: count(paths[(i * 5 + k) % paths.length]!), quotedSnippet: first(paths[(i * 5 + k) % paths.length]!) })) }));
    const joins = [...Array(200).keys()].map((i) => ({ from: `p${i % 40}`, to: `p${(i * 7 + 1) % 40}`, kind: "data" as const, evidence: { path: "c0.py", line: 3, quotedSnippet: "x" } }));
    const o = checkOutlineValue({ parts, joins });
    expect(o.ok).toBe(true);
    const t = performance.now();
    const v = verifyOutline(files, map, (o as { outline: WonderOutline }).outline, "m");
    expect(performance.now() - t).toBeLessThan(1000);
    expect(v.cantCheck === undefined || /too large/.test(v.cantCheck)).toBe(true);
  });
});

// ---------- minors ----------

describe("round-2 minors", () => {
  it("1: relative imports Python itself refuses are unresolved, with the reason", () => {
    const m = buildCodeMap([file("helper.py", "def h():\n    pass\n"), file("pkg/__init__.py", ""), file("pkg/a.py", "from .. import helper\n"), file("scripts/run.py", "from .helper import go\n"), file("scripts/helper.py", "def go():\n    pass\n")]);
    for (const p of ["pkg/a.py", "scripts/run.py"]) expect(m.files.find((f) => f.path === p)!.imports[0]!.target).toMatchObject({ kind: "unresolved", reason: expect.stringMatching(/Python refuses/) });
    expect(ids(m).filter((x) => x.startsWith("imports"))).toEqual([]);
  });

  it("2: a namespace package is not an outside package; its submodule still resolves", () => {
    const m = buildCodeMap([file("ns/sub/mod.py", "def f():\n    pass\n"), file("tool.py", "from ns.sub import mod\nmod.f()\n")]);
    expect(m.externals).toEqual([]);
    expect(ids(m)).toContain("calls:tool.py->ns/sub/mod.py:mod.f");
  });

  it("4: removing a GitHub section's blob ids, or editing the reasoning-token total, fails verify", () => {
    const files = FILES.map((f) => ({ ...f, gitBlob: undefined as string | undefined }));
    const s = makeOutlineSection({
      source: { kind: "github", repo: "o/r", commit: "a".repeat(40), subfolder: "" },
      files: FILES.map((f) => ({ ...f, gitBlob: require("node:crypto").createHash("sha1").update(`blob ${Buffer.byteLength(f.text)}\u0000`).update(f.text).digest("hex") as string })),
      skipped: [],
      wonder: { model: "m", outline: GOOD, attempts: [{ attempt: 1, usage: { promptTokens: 1, completionTokens: 1, reasoningTokens: 1, usd: 0 } }] },
    });
    void files;
    const noBlob = JSON.parse(JSON.stringify(s));
    for (const f of noBlob.files) delete f.gitBlob;
    expect(outlineSectionProblems(noBlob).join(" ")).toMatch(/must record each file's git blob id/);
    const tokens = JSON.parse(JSON.stringify(s));
    tokens.usage.reasoningTokens = 999;
    expect(outlineSectionProblems(tokens).join(" ")).toMatch(/usage total/);
  });

  it("5: a tsconfig that only `extends` another one is followed; one with no options says so (not 'not JSON')", () => {
    const files = [file("src/app/x.ts", "export function run() {}\n"), file("src/main.ts", "import { run } from '@app/x';\nrun();\n")];
    const m = buildCodeMap(files, [
      { path: "tsconfig.json", text: '{ "extends": "./tsconfig.base.json" }' },
      { path: "tsconfig.base.json", text: '{ "compilerOptions": { "paths": { "@app/*": ["src/app/*"] } } }' },
    ]);
    expect(ids(m)).toContain("calls:src/main.ts->src/app/x.ts:run");
    expect(m.notes).toContain("path aliases read from tsconfig.json (1 pattern; extends tsconfig.base.json)");
    const empty = buildCodeMap(files, [{ path: "tsconfig.json", text: '{ "files": [] }' }]);
    expect(empty.notes).toContain("tsconfig.json sets no baseUrl or paths, so it gives no path aliases");
  });
});
