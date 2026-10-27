// X1 review round 1: one test (or more) per finding, each written from the reviewer's inputs
// (scratchpad x1r/ver.ts, py.ts, bomb.ts, cost.ts). Not re-run against the old code (most use functions this round added).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodeMap, codeMapTooLarge, MAX_CODEMAP_EDGES } from "../../src/outline/codemap";
import { anchoredProblem, matchesWholeLines, quoteProblem } from "../../src/outline/quote";
import { makeOutlineSection, outlineSectionProblems, sha256Text, utf8Length } from "../../src/outline/section";
import { TOO_LARGE_TO_VERIFY, parseWonderOutline, verifyOutline } from "../../src/outline/verify";
import { PYTHON_STDLIB, PYTHON_STDLIB_VERSION } from "../../src/outline/py-stdlib";
import type { CodeMap, OutlineFile, OutlineLanguage, WonderOutline } from "../../src/outline/types";
import { MAX_OUTLINE_PROMPT_TOKENS, renderCodeMap, runOutliner, worstCaseUsd } from "../../server/meta/roles/outliner";
import { createMetaClient, type ChatArgs, type ChatResult } from "../../server/meta/client";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { intakeUpload } from "../../server/outline/intake";
import { MAX_KEPT_JOBS_PER_SESSION } from "../../server/outline/routes";
import { FILES, GOOD } from "../tools/outline-fixtures";

const lang = (p: string): OutlineLanguage => (p.endsWith(".py") ? "py" : /\.(?:tsx?|mts|cts)$/.test(p) ? "ts" : "js");
const file = (path: string, text: string): OutlineFile => ({ path, text, language: lang(path), sha256: sha256Text(text), bytes: utf8Length(text) });
const ids = (m: CodeMap) => m.edges.map((e) => e.id);
const fileOf = (m: CodeMap, p: string) => m.files.find((f) => f.path === p)!;

// ---------- B1 ----------

describe("B1: a join counts only calls and imports made inside the part's lines, reaching inside the other part's lines", () => {
  const UTIL = ["export function formatDate(d: Date) {", "  return d.toISOString()", "}", "", "", "", "import { saveUser } from './db'", "export function persistAll(xs: number[]) {", "  for (const x of xs) saveUser(x)", "}"].join("\n") + "\n";
  const DB = "export function saveUser(x: number) {\n  return x\n}\nexport function dropAll() {\n  // destroys every table\n}\n";
  const files = [file("util.ts", UTIL), file("db.ts", DB)];
  const map = buildCodeMap(files);
  const base = (extra: WonderOutline["parts"] = [], joins: WonderOutline["joins"] = []): WonderOutline => ({
    parts: [
      { id: "fmt", name: "Date formatting", purpose: "Formats dates.", files: [{ path: "util.ts", lineStart: 1, lineEnd: 3, quotedSnippet: "export function formatDate(d: Date) {" }], patterns: [] },
      { id: "db", name: "Database", purpose: "Writes users.", files: [{ path: "db.ts", lineStart: 1, lineEnd: 3, quotedSnippet: "export function saveUser(x: number) {" }], patterns: [] },
      ...extra,
    ],
    joins,
  });

  it("the reviewer's case: fmt (lines 1–3, calls nothing) → db is NOT confirmed; no code-only join from fmt", () => {
    const v = verifyOutline(files, map, base([], [{ from: "fmt", to: "db", kind: "calls", evidence: { path: "util.ts", line: 1, quotedSnippet: "export function formatDate(d: Date) {" } }]), "muse-wonder-1.0");
    expect(v.joins[0]).toMatchObject({ status: "model-only", codeEdges: [], wonderEvidence: { matches: false } });
    expect(v.joins.filter((j) => j.from === "fmt")).toHaveLength(1);
  });

  it("the part that really calls (persistAll, lines 8–10) is confirmed; Wonder's evidence must be the call's line", () => {
    const persist = { id: "persist", name: "Persist", purpose: "Saves all.", files: [{ path: "util.ts", lineStart: 8, lineEnd: 10, quotedSnippet: "export function persistAll(xs: number[]) {" }], patterns: [] };
    const v = verifyOutline(files, map, base([persist], [
      { from: "persist", to: "db", kind: "calls", evidence: { path: "util.ts", line: 9, quotedSnippet: "for (const x of xs) saveUser(x)" } },
      { from: "persist", to: "db", kind: "calls", evidence: { path: "util.ts", line: 8, quotedSnippet: "export function persistAll(xs: number[]) {" } },
    ]), "muse-wonder-1.0");
    expect(v.joins[0]).toMatchObject({ status: "confirmed", codeEdges: ["calls:util.ts->db.ts:saveUser"], wonderEvidence: { matches: true } });
    expect(v.joins[1]).toMatchObject({ status: "confirmed", wonderEvidence: { matches: false }, reason: expect.stringMatching(/not the line of an import, call or use/) });
  });

  it("each import statement keeps its own names: two `from .timed import …` lines reach two different parts", () => {
    const f2 = [
      file("pkg/__init__.py", "from .timed import TimedSerializer as TimedSerializer\nfrom .timed import TimestampSigner as TimestampSigner\n"),
      file("pkg/timed.py", "class TimestampSigner:\n    pass\n\n\nclass TimedSerializer:\n    pass\n"),
    ];
    const m2 = buildCodeMap(f2);
    const o: WonderOutline = {
      parts: [
        { id: "api", name: "a", purpose: "p", files: [{ path: "pkg/__init__.py", lineStart: 1, lineEnd: 2, quotedSnippet: "from .timed import TimedSerializer as TimedSerializer" }], patterns: [] },
        { id: "signer", name: "s", purpose: "p", files: [{ path: "pkg/timed.py", lineStart: 1, lineEnd: 2, quotedSnippet: "class TimestampSigner:" }], patterns: [] },
      ],
      joins: [{ from: "api", to: "signer", kind: "imports", evidence: { path: "pkg/__init__.py", line: 2, quotedSnippet: "from .timed import TimestampSigner as TimestampSigner" } }],
    };
    expect(verifyOutline(f2, m2, o, "m").joins[0]).toMatchObject({ status: "confirmed", codeEdges: ["imports:pkg/__init__.py->pkg/timed.py:.timed@2"], wonderEvidence: { matches: true } });
  });

  it("the target must lie inside the other part: a call of saveUser does not join to a part holding only dropAll", () => {
    const drop = { id: "drop", name: "Drop", purpose: "Drops.", files: [{ path: "db.ts", lineStart: 4, lineEnd: 6, quotedSnippet: "export function dropAll() {" }], patterns: [] };
    const persist = { id: "persist", name: "Persist", purpose: "Saves all.", files: [{ path: "util.ts", lineStart: 8, lineEnd: 10, quotedSnippet: "export function persistAll(xs: number[]) {" }], patterns: [] };
    const v = verifyOutline(files, map, base([drop, persist], [{ from: "persist", to: "drop", kind: "calls", evidence: { path: "util.ts", line: 9, quotedSnippet: "for (const x of xs) saveUser(x)" } }]), "muse-wonder-1.0");
    expect(v.joins[0]!.status).toBe("model-only");
    // and plain code adds persist → db (found by plain code), never persist → drop
    expect(v.joins.filter((j) => j.status === "code-only").map((j) => j.id)).toEqual(["code:persist->db"]);
  });
});

// ---------- B2 ----------

describe("B2: Python standard library and outside packages never reach a local file by name", () => {
  it(`stdlib names (CPython ${PYTHON_STDLIB_VERSION} list) stay outside even with myapp/logging.py and tools/json.py present`, () => {
    expect(PYTHON_STDLIB.has("logging") && PYTHON_STDLIB.has("json") && !PYTHON_STDLIB.has("requests")).toBe(true);
    const m = buildCodeMap([
      file("myapp/__init__.py", ""),
      file("myapp/logging.py", "def getLogger(n):\n    pass\n"),
      file("other/worker.py", "import logging\nimport json\nlog = logging.getLogger(__name__)\njson.dumps({})\n"),
      file("tools/json.py", "def dumps(x):\n    pass\n"),
    ]);
    expect(ids(m)).toEqual([]);
    expect(m.externals.map((e) => e.name)).toEqual(["json", "logging"]);
    expect(m.notes[0]).toMatch(/CPython 3\.14/);
  });

  it("a stub tests/requests.py is not `import requests` (the pip package)", () => {
    const m = buildCodeMap([file("tests/requests.py", "def get(u):\n    pass\n"), file("client.py", "import requests\nrequests.get('x')\n")]);
    expect(ids(m)).toEqual([]);
    expect(m.externals).toEqual([{ name: "requests", importedBy: ["client.py"] }]);
  });

  it("absolute imports resolve from the root, from a src/ layout, and from a script's own folder; never by path suffix", () => {
    const m = buildCodeMap([
      file("src/pkg/__init__.py", ""),
      file("src/pkg/core.py", "def run():\n    pass\n"),
      file("scripts/helper.py", "def h():\n    pass\n"),
      file("scripts/go.py", "import helper\nfrom pkg.core import run\nhelper.h()\nrun()\n"),
      file("deep/x/core.py", "def run():\n    pass\n"),
      file("main.py", "import core\n"),
    ]);
    expect(ids(m)).toContain("calls:scripts/go.py->scripts/helper.py:helper.h");
    expect(ids(m)).toContain("calls:scripts/go.py->src/pkg/core.py:run");
    expect(fileOf(m, "main.py").imports[0]!.target).toEqual({ kind: "external", name: "core" });
  });
});

// ---------- B3 ----------

describe("B3: quote checks take linear time; a too-large outline is 'can't check', never a hang", () => {
  it("the reviewer's worst case (8,000 lines, 2,000-character quote) answers in well under a second, both rules", () => {
    const lines = 8000;
    const text = "a\n".repeat(lines);
    const fileLines = text.split("\n");
    const quote = "a ".repeat(1000) + "b";
    const t = performance.now();
    expect(quoteProblem(fileLines, lines, 1, lines, quote)).toMatch(/not whole lines/);
    expect(anchoredProblem(fileLines, lines, 1, lines, quote)).toMatch(/not whole lines/);
    expect(matchesWholeLines("a ".repeat(3999) + "a", Array(8000).fill("a"))).toBe(true);
    expect(performance.now() - t).toBeLessThan(500);
  });

  it("matchesWholeLines gives the first version's answers", () => {
    const lines = ["  a = 1", "", "  return thing(a)", "}", "a = 1"];
    const cases: [string, boolean][] = [["a = 1", true], ["a = 1 return thing(a)", true], ["thing(a)", false], ["return thing(a) } a = 1", true], ["a = 1 return", false], ["} a = 1 x", false]];
    for (const [q, want] of cases) expect(matchesWholeLines(q, lines), q).toBe(want);
  });

  it("an outline whose checks would exceed the work budget is 'can't check: too large to verify' (same answer every time)", () => {
    const big = file("big.ts", "export const x = 1;\n" + "// filler line of a comment\n".repeat(3700));
    const files = [big];
    const map = buildCodeMap(files);
    const parts = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: "n", purpose: "p", files: Array.from({ length: 5 }, () => ({ path: "big.ts", lineStart: 1, lineEnd: 3701, quotedSnippet: "export const x = 1;" })), patterns: [] }));
    const outline: WonderOutline = { parts, joins: [] };
    expect(parseWonderOutline(JSON.stringify(outline)).ok).toBe(true);
    const v = verifyOutline(files, map, outline, "muse-wonder-1.0");
    expect(v.cantCheck).toBe(TOO_LARGE_TO_VERIFY);
    expect(v.counts.confirmedParts).toBe(0);
    expect(v.parts[0]!.reasons).toEqual([TOO_LARGE_TO_VERIFY]);
  });

  it("schema caps: more than 200 ranges, or more than 100,000 quoted characters, is refused", () => {
    const span = { path: "a.ts", lineStart: 1, lineEnd: 1, quotedSnippet: "x".repeat(400) };
    const many = { parts: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: "n", purpose: "p", files: Array(6).fill(span), patterns: [] })), joins: [] };
    expect(parseWonderOutline(JSON.stringify(many))).toMatchObject({ ok: false, error: expect.stringMatching(/240 line ranges/) });
    const longQuotes = { parts: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: "n", purpose: "p", files: Array(2).fill({ ...span, quotedSnippet: "x".repeat(1500) }), patterns: [] })), joins: [] };
    expect(parseWonderOutline(JSON.stringify(longQuotes))).toMatchObject({ ok: false, error: expect.stringMatching(/quotes 120000 characters/) });
  });
});

// ---------- M1 ----------

describe("M1: the code map, the prompt and the worst-case cost are bounded before any paid call", { timeout: 120_000 }, () => {
  it("24,000 calls of one name are one edge with a count, not 24,000 edges", () => {
    const calls = "from b import f\n" + "f()\n".repeat(24000);
    const m = buildCodeMap([file("a.py", calls), file("b.py", "def f():\n    pass\n")]);
    const call = m.edges.find((e) => e.kind === "calls")!;
    expect(m.edges).toHaveLength(2);
    expect(call).toMatchObject({ id: "calls:a.py->b.py:f", count: 24000, line: 2 });
    expect(call.lines).toHaveLength(24000); // review round 2 (minor 3): every line is kept
    expect(codeMapTooLarge(m)).toBeNull();
  });

  it("a code map over the edge cap is refused with a reason; the rendered map is cut; a huge prompt is never sent", async () => {
    const many = Array.from({ length: MAX_CODEMAP_EDGES + 5 }, (_, i) => `from m${i} import f${i}\nf${i}()\n`).join("");
    const mods = Array.from({ length: 10 }, (_, i) => file(`m${i}.py`, `def f${i}():\n    pass\n`));
    const fake: CodeMap = { ...buildCodeMap([file("a.py", many), ...mods]) };
    fake.edges = Array.from({ length: MAX_CODEMAP_EDGES + 1 }, (_, i) => ({ ...fake.edges[0]!, id: `x${i}` }));
    expect(codeMapTooLarge(fake)).toMatch(/at most 3000/);
    expect(renderCodeMap(fake).length).toBeLessThan(90_000);
    expect(renderCodeMap(fake)).toMatch(/more code-map lines not shown/);
    let sent = 0;
    const huge = Array.from({ length: 3 }, (_, i) => file(`h${i}.py`, "x = 1\n".repeat(17_000)));
    const r = await runOutliner({ files: huge, codeMap: buildCodeMap(huge), label: "t", codeSha256: "0".repeat(64) }, { chat: async () => (sent++, { ok: false, reason: "x" }) });
    expect(sent).toBe(0);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/not asked \(the prompt would be about \d+ tokens; Atlas sends at most 100000/) });
    expect(worstCaseUsd(MAX_OUTLINE_PROMPT_TOKENS)).toBeLessThan(2);
  });

  it("Wonder's spend is logged under its own role, 'outliner'", async () => {
    const usagePath = join(mkdtempSync(join(tmpdir(), "atlas-x1r-")), "usage.jsonl");
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(GOOD) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 })) as typeof fetch;
    const client = createMetaClient({ apiKey: "test-key-not-real", fetchImpl, usagePath });
    const r = await runOutliner({ files: FILES, codeMap: buildCodeMap(FILES), label: "t", codeSha256: "0".repeat(64) }, { chat: client.chat });
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(usagePath, "utf8").trim()).role).toBe("outliner");
  });

  it("jobs: each session keeps a fair share; a flood from one session never evicts another's job", async () => {
    let n = 0;
    const app = createApp({ agentLog: createAgentLog(), outline: { outliner: { chat: async () => (n++, { ok: true, content: JSON.stringify(GOOD), finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 } } as ChatResult) } }, investigator: { chat: async () => ({ ok: false, reason: "unused" }) } });
    process.env.ATLAS_OUTLINES_PER_IP_PER_HOUR = "100";
    const post = (s: string) => app.request("/outline/jobs", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": s }, body: JSON.stringify({ files: FILES.map((f) => ({ path: f.path, text: f.text })) }) });
    const get = (s: string, id: string) => app.request(`/outline/jobs/${id}`, { headers: { "x-atlas-session": s } });
    const settle = async (s: string, id: string) => {
      for (let i = 0; i < 1500; i++) {
        const st = ((await (await get(s, id)).json()) as { status?: string }).status;
        if (st === "done" || st === "failed") return st;
        await new Promise((r) => setTimeout(r, 10));
      }
      return "timeout";
    };
    const victim = ((await (await post("victim")).json()) as { jobId: string }).jobId;
    expect(await settle("victim", victim)).toBe("done");
    const flood: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = ((await (await post(`flood-${i % 1}`)).json()) as { jobId?: string }).jobId;
      if (id) {
        flood.push(id);
        await settle("flood-0", id);
      }
    }
    expect((await get("victim", victim)).status).toBe(200);
    const kept = (await Promise.all(flood.map(async (id) => (await get("flood-0", id)).status))).filter((s) => s === 200);
    expect(kept.length).toBeLessThanOrEqual(MAX_KEPT_JOBS_PER_SESSION);
    delete process.env.ATLAS_OUTLINES_PER_IP_PER_HOUR;
  });
});

// ---------- M2, M3 ----------

describe("M2/M3: .jsx .mts .cts are read; tsconfig paths resolve; aliases are never called packages", () => {
  it("reads .jsx, .mts and .cts and resolves ./a.mjs to a.mts", () => {
    const c = intakeUpload([
      { path: "App.tsx", text: 'import Other from "./Other";\nexport const App = () => <Other />;\n' },
      { path: "Other.jsx", text: "export default function Other() { return <div/>; }\n" },
      { path: "d.ts", text: 'import { a } from "./a.mjs";\nimport { b } from "./b.cjs";\nexport const d = a() + b();\n' },
      { path: "a.mts", text: "export const a = () => 1;\n" },
      { path: "b.cts", text: "export const b = () => 2;\n" },
    ]);
    expect(c.files.map((f) => f.path)).toEqual(["App.tsx", "Other.jsx", "a.mts", "b.cts", "d.ts"]);
    const m = buildCodeMap(c.files);
    expect(ids(m)).toEqual(expect.arrayContaining(["calls:App.tsx->Other.jsx:<Other>", "calls:d.ts->a.mts:a", "calls:d.ts->b.cts:b"]));
  });

  it("tsconfig `paths` and `baseUrl` resolve to files; a bare src/x without a config is 'may be a path alias'", () => {
    const files = [file("src/app/x.ts", "export function run() {}\n"), file("src/lib/q.ts", "export default 1;\n"), file("src/main.ts", "import { run } from '@app/x';\nimport q from 'src/lib/q';\nrun();\n")];
    const tsconfig = { path: "tsconfig.json", text: '{\n  // comments are allowed\n  "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/app/*"], }, },\n}\n' };
    const m = buildCodeMap(files, [tsconfig]);
    const imps = fileOf(m, "src/main.ts").imports;
    expect(imps.map((i) => i.target)).toEqual([{ kind: "file", path: "src/app/x.ts" }, { kind: "file", path: "src/lib/q.ts" }]);
    expect(m.notes).toContain("path aliases read from tsconfig.json (1 pattern, a base folder)");
    const bare = buildCodeMap(files);
    const t = fileOf(bare, "src/main.ts").imports.map((i) => i.target);
    expect(t[1]).toMatchObject({ kind: "unresolved", reason: expect.stringMatching(/may be a path alias/) });
    expect(bare.externals.map((e) => e.name)).toEqual(["@app/x"]); // without the tsconfig, a scoped name cannot be told from a package
  });

  it("an uploaded tsconfig.json is kept as a config file, and the section re-checks it", () => {
    const c = intakeUpload([{ path: "tsconfig.json", text: '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}' }, { path: "src/a.ts", text: 'import { b } from "@/b";\nb();\n' }, { path: "src/b.ts", text: "export function b() {}\n" }]);
    expect(c.configFiles.map((x) => x.path)).toEqual(["tsconfig.json"]);
    const s = makeOutlineSection({ source: c.source, files: c.files, configFiles: c.configFiles, skipped: c.skipped, wonder: { model: "muse-wonder-1.0", outline: null, attempts: [], failure: "not asked (test)" } });
    expect(ids(s.codeMap)).toContain("calls:src/a.ts->src/b.ts:b");
    const t = JSON.parse(JSON.stringify(s));
    t.configFiles[0].text = '{"compilerOptions":{}}';
    expect(outlineSectionProblems(t).join(" ")).toMatch(/config file tsconfig.json/);
  });
});

// ---------- M4 ----------

describe("M4: ranges sit on whole definitions, the quote starts the range, long ranges are whole files", () => {
  const DB = "export function saveUser(x: number) {\n  return x\n}\nexport function dropAll() {\n  // destroys every table\n}\n";
  const files = [file("db.ts", DB)];
  const map = buildCodeMap(files);
  const part = (lineStart: number, lineEnd: number, quotedSnippet: string) => ({ parts: [{ id: "p", name: "n", purpose: "p", files: [{ path: "db.ts", lineStart, lineEnd, quotedSnippet }], patterns: [] }], joins: [] });
  const v = (o: WonderOutline) => verifyOutline(files, map, o, "muse-wonder-1.0").parts[0]!;

  it("the reviewer's 'wipe' part (quote from the middle) is unconfirmed; 'wipe2' is confirmed only as 'whole file'", () => {
    expect(v(part(1, 6, "  return x + nothing at all"))).toMatchObject({ status: "unconfirmed" });
    expect(v(part(1, 6, "export function saveUser(x: number) {"))).toMatchObject({ status: "confirmed", spans: [{ wholeFile: true }] });
    expect(v(part(4, 6, "export function dropAll() {"))).toMatchObject({ status: "confirmed", spans: [{ ok: true }] });
    expect(v(part(4, 6, "export function dropAll() {")).spans[0]!.wholeFile).toBeUndefined();
  });

  it("a range that starts or ends inside a definition is unconfirmed", () => {
    expect(v(part(2, 3, "  return x\n}  // pad")).reasons[0]).toMatch(/line 2 is not the start of a definition/);
    expect(v(part(1, 2, "export function saveUser(x: number) {")).reasons[0]).toMatch(/line 2 is not the end of a definition/);
  });

  it("a range over 400 lines must be the whole file", () => {
    const long = file("long.ts", "export function a() {\n" + "  x();\n".repeat(450) + "}\nexport function b() {}\n");
    const r = verifyOutline([long], buildCodeMap([long]), { parts: [{ id: "p", name: "n", purpose: "p", files: [{ path: "long.ts", lineStart: 1, lineEnd: 452, quotedSnippet: "export function a() {" }], patterns: [] }], joins: [] }, "m");
    expect(r.parts[0]!.reasons[0]).toMatch(/over 400 lines must be the whole file/);
  });

  it("the shared fixture's correct outline still confirms (Wonder can follow the rule)", () => {
    expect(verifyOutline(FILES, buildCodeMap(FILES), GOOD, "m").counts.confirmedParts).toBe(3);
  });
});

// ---------- minors ----------

describe("minors", () => {
  it("1: a parameter or local that shadows an import is not a call of it (JS and Python)", () => {
    const m = buildCodeMap([
      file("db.ts", "export function save() {}\n"),
      file("h.ts", "import { save } from './db';\nexport function handler(save: () => void) { save(); }\nexport function other() { const save = 1; return save; }\nexport function real() { save(); }\n"),
      file("db.py", "def save():\n    pass\n"),
      file("h.py", "from db import save\ndef handler(save):\n    save()\ndef real():\n    save()\n"),
    ]);
    expect(m.edges.find((e) => e.id === "calls:h.ts->db.ts:save")!.lines).toEqual([4]);
    expect(m.edges.find((e) => e.id === "calls:h.py->db.py:save")!.lines).toEqual([5]);
  });

  it("3: a type-only import never confirms a 'data' join; an 'imports' join it confirms is labelled type-only", () => {
    const files = [file("types.ts", "export interface User { id: string }\nexport function mk(): User { return { id: '' }; }\n"), file("api.ts", "import type { User } from './types';\nexport function show(u: User) { return u.id; }\n")];
    const map = buildCodeMap(files);
    const o: WonderOutline = {
      parts: [
        { id: "types", name: "t", purpose: "p", files: [{ path: "types.ts", lineStart: 1, lineEnd: 2, quotedSnippet: "export interface User { id: string }" }], patterns: [] },
        { id: "api", name: "a", purpose: "p", files: [{ path: "api.ts", lineStart: 1, lineEnd: 2, quotedSnippet: "import type { User } from './types';" }], patterns: [] },
      ],
      joins: [
        { from: "api", to: "types", kind: "data", evidence: { path: "api.ts", line: 1, quotedSnippet: "import type { User } from './types';" } },
        { from: "api", to: "types", kind: "imports", evidence: { path: "api.ts", line: 1, quotedSnippet: "import type { User } from './types';" } },
      ],
    };
    const v = verifyOutline(files, map, o, "m");
    expect(v.joins[0]!.status).toBe("model-only");
    expect(v.joins[1]).toMatchObject({ status: "confirmed", typeOnly: true });
  });

  it("4: two `export *` giving the same name: no symbol is picked, and the edge says why; a barrel's private import is not followed", () => {
    const m = buildCodeMap([
      file("one.ts", "export function x() {}\n"),
      file("two.ts", "export function x() {}\n"),
      file("index.ts", "export * from './one';\nexport * from './two';\nimport { x as y } from './one';\n"),
      file("use.ts", "import { x, y } from './index';\nx();\ny();\n"),
    ]);
    const e = m.edges.find((x) => x.id === "calls:use.ts->index.ts:x")!;
    expect(e.toSymbol).toBeUndefined();
    expect(e.note).toMatch(/exported by 2 files through "export \*" \(one\.ts, two\.ts\)/);
    expect(m.edges.find((x) => x.id === "calls:use.ts->index.ts:y")!.toSymbol).toBeUndefined();
  });

  it("5: hidden characters never reach a field raw: import strings, Python names, join part ids, span paths", () => {
    const m = buildCodeMap([file("a.ts", "import x from './b\u202Ec';\nx();\n"), file("p.py", "def f\u202Eg():\n    pass\n")]);
    expect(JSON.stringify(m)).not.toMatch(/[\u202E]/);
    const bad = { ...GOOD, joins: [{ ...GOOD.joins[0]!, from: "api\u202E" }] };
    expect(parseWonderOutline(JSON.stringify(bad)).ok).toBe(false);
    const o = JSON.parse(JSON.stringify(GOOD)) as WonderOutline;
    o.parts[0]!.files[0]!.path = "src/\u202Eapi.ts";
    expect(JSON.stringify(verifyOutline(FILES, buildCodeMap(FILES), o, "m"))).not.toMatch(/[\u202E]/);
  });

  it("6: GitHub files carry their git blob id, and the section re-checks it", () => {
    const f = { ...file("a.ts", "export const a = 1;\n"), gitBlob: "0".repeat(40) };
    expect(() => makeOutlineSection({ source: { kind: "github", repo: "o/r", commit: "a".repeat(40), subfolder: "" }, files: [f], skipped: [], wonder: { model: "m", outline: null, attempts: [], failure: "x" } })).toThrow(/git blob/);
  });
});
