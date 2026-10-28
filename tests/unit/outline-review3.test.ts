// X1 review round 3: regression tests from the reviewer's inputs (scratchpad x1r3/label.ts, footer.ts, shadow.ts).
import { describe, expect, it } from "vitest";
import { buildCodeMap } from "../../src/outline/codemap";
import { sha256Text, utf8Length } from "../../src/outline/section";
import { COULD_NOT_CHECK, FOUND_NO_LINK, verifyOutline } from "../../src/outline/verify";
import type { CodeMap, JoinKind, OutlineFile, OutlineLanguage, VerifiedJoin, WonderOutline } from "../../src/outline/types";
import { createModelBudget } from "../../server/meta/budget";
import { runOutliner } from "../../server/meta/roles/outliner";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { createHourlyLimit } from "../../server/replay-limits";
import { FILES, GOOD } from "../tools/outline-fixtures";

const lang = (p: string): OutlineLanguage => (p.endsWith(".py") ? "py" : /\.(?:tsx?|mts|cts)$/.test(p) ? "ts" : "js");
const file = (path: string, text: string): OutlineFile => ({ path, text, language: lang(path), sha256: sha256Text(text), bytes: utf8Length(text) });
const count = (t: string) => t.split("\n").length - (t.endsWith("\n") ? 1 : 0);
/** The first lines of a range, enough of them to hold the 12 letters or digits a quote needs. */
const quoteFrom = (t: string, from = 1) => {
  const lines = t.split("\n").slice(from - 1);
  let q = "";
  for (const l of lines) {
    q = q ? `${q}\n${l}` : l;
    if ((q.match(/[\p{L}\p{N}_]/gu) ?? []).length >= 12) break;
  }
  return q;
};
const firstLine = (t: string) => quoteFrom(t);

/** Whole-file parts A and B, one Wonder join A→B; the join as plain code judged it. */
function judge(files: OutlineFile[], a: string, b: string, kind: JoinKind = "calls", skipped: string[] = []): VerifiedJoin {
  const fa = files.find((f) => f.path === a)!;
  const fb = files.find((f) => f.path === b)!;
  const o: WonderOutline = {
    parts: [
      { id: "A", name: "A", purpose: "p", files: [{ path: a, lineStart: 1, lineEnd: count(fa.text), quotedSnippet: firstLine(fa.text) }], patterns: [] },
      { id: "B", name: "B", purpose: "p", files: [{ path: b, lineStart: 1, lineEnd: count(fb.text), quotedSnippet: firstLine(fb.text) }], patterns: [] },
    ],
    joins: [{ from: "A", to: "B", kind, evidence: { path: a, line: 1, quotedSnippet: firstLine(fa.text) } }],
  };
  const v = verifyOutline(files, buildCodeMap(files, [], skipped), o, "m");
  expect(v.counts.confirmedParts, "both parts confirmed").toBe(2);
  return v.joins[0]!;
}
/** The honest outcomes: confirmed, or "could not check it". Never "found no import or call". */
const honest = (j: VerifiedJoin) => {
  expect(j.noLinkFound, j.reason).toBeUndefined();
  if (j.status !== "confirmed") expect(j.reason!.startsWith(COULD_NOT_CHECK), j.reason).toBe(true);
};

const DBPY = file("db.py", "def run_job(x):\n    return x * 2\n");
const DBTS = file("db.ts", "export function saveUser(x: number) {\n  return x\n}\n");

describe("R3-B1: 'Atlas found no import or call' only when plain code covered every way A could reach B", () => {
  it("L1 star-import chain", () => honest(judge([file("app.py", "from pkg import *\n\ndef main_entry():\n    return run_job(1)\n"), file("pkg/__init__.py", "from .db import *\n"), file("pkg/db.py", "def run_job(x):\n    return x * 2\n")], "app.py", "pkg/db.py")));
  it("L2 import_module imported by name", () => honest(judge([file("app.py", "from importlib import import_module\n\ndef main_entry():\n    mod = import_module('db')\n    return mod.run_job(1)\n"), DBPY], "app.py", "db.py")));
  it("L3 `import pkg.sub` then pkg.run_job(): now a real edge to pkg/__init__.py", () => {
    const j = judge([file("app.py", "import pkg.sub\n\ndef main_entry():\n    return pkg.run_job(1)\n"), file("pkg/__init__.py", "def run_job(x):\n    return x * 2\n"), file("pkg/sub.py", "def other_function():\n    return 0\n")], "app.py", "pkg/__init__.py");
    expect(j.status).toBe("confirmed");
  });
  it("L4 namespace import of a barrel, then destructuring", () => honest(judge([file("app.ts", "import * as api from './index'\nconst { saveUser } = api\nexport function go() {\n  return saveUser(1)\n}\n"), file("index.ts", "export * from './db'\n"), DBTS], "app.ts", "db.ts")));
  it("L5 require('./index').saveUser", () =>
    honest(judge([file("app.js", "const saveUser = require('./index').saveUser\nfunction go() {\n  return saveUser(1)\n}\nmodule.exports = { go }\n"), file("index.js", "const db = require('./db')\nmodule.exports = { saveUser: db.saveUser }\n"), file("db.js", "function saveUser(x) {\n  return x\n}\nmodule.exports = { saveUser }\n")], "app.js", "db.js")));
  it("L6a/b/c one-line compound and semicolon imports are read", () => {
    expect(judge([file("app.py", "import sys\nif sys.version_info >= (3, 8): from db import run_job\n\ndef main_entry():\n    return run_job(1)\n"), DBPY], "app.py", "db.py").status).toBe("confirmed");
    expect(judge([file("app.py", "DEBUG = False; import db\n\ndef main_entry():\n    return db.run_job(1)\n"), DBPY], "app.py", "db.py").status).toBe("confirmed");
    honest(judge([file("app.py", "try: from db import run_job\nexcept ImportError: run_job = None\n\ndef main_entry():\n    return run_job(1)\n"), DBPY], "app.py", "db.py"));
  });
  it("L7 a skipped local file is 'Atlas did not read it', never an outside package", () => {
    const files = [file("app.py", "from big import run_job\n\ndef main_entry():\n    return run_job(1)\n"), DBPY];
    honest(judge(files, "app.py", "db.py", "calls", ["big.py"]));
    expect(buildCodeMap(files, [], ["big.py"]).files[0]!.imports[0]!.target).toMatchObject({ kind: "unresolved", reason: expect.stringMatching(/did not read/) });
    honest(judge(files, "app.py", "db.py")); // even without the skipped list: "big" is not the standard library
  });
  it("L8 a barrel re-exporting from a skipped file", () => honest(judge([file("app.ts", "import { saveUser } from './index'\nexport function go() {\n  return saveUser(1)\n}\n"), file("index.ts", "export * from './huge'\n"), DBTS], "app.ts", "db.ts")));
  it("L9 a parse error in a barrel A goes through", () => honest(judge([file("app.py", "from pkg import run_job\n\ndef main_entry():\n    return run_job(1)\n"), file("pkg/__init__.py", "NOTE = 'unclosed\nfrom .db import run_job\n"), file("pkg/db.py", "def run_job(x):\n    return x * 2\n")], "app.py", "pkg/db.py")));
  it("L10 createRequire", () => honest(judge([file("app.ts", "import { createRequire } from 'node:module'\nconst req = createRequire(import.meta.url)\nexport function go() {\n  return req('./db').saveUser(1)\n}\n"), DBTS], "app.ts", "db.ts")));
  it("L11 a data join checks both directions", () => honest(judge([file("a.ts", "export class Store {\n  put(x: number) { return x }\n}\n"), file("b.ts", "import type { Store } from './a'\nexport function use(s: Store) {\n  return s.put(1)\n}\n")], "a.ts", "b.ts", "data")));
  it("L12 a path alias from a config Atlas did not read", () => honest(judge([file("src/app.ts", "import { saveUser } from '@app/db'\nexport function go() {\n  return saveUser(1)\n}\n"), file("src/db.ts", "export function saveUser(x: number) {\n  return x\n}\n")], "src/app.ts", "src/db.ts")));
  it("S1 a script's sibling queue.py beats the standard library (CPython order); built-ins still win", () => {
    const files = [file("scripts/worker.py", "from queue import Queue\n\ndef go():\n    return Queue()\n"), file("scripts/queue.py", "class Queue:\n    pass\n")];
    expect(judge(files, "scripts/worker.py", "scripts/queue.py").status).toBe("confirmed");
    const sys = buildCodeMap([file("scripts/run.py", "import sys\n"), file("scripts/sys.py", "x = 1\n")]);
    expect(sys.files.find((f) => f.path === "scripts/run.py")!.imports[0]!.target).toEqual({ kind: "external", name: "sys" });
    const pkg = buildCodeMap([file("pkg/__init__.py", ""), file("pkg/worker.py", "from queue import Queue\n"), file("pkg/queue.py", "class Queue:\n    pass\n")]);
    expect(pkg.files.find((f) => f.path === "pkg/worker.py")!.imports[0]!.target).toEqual({ kind: "external", name: "queue" });
  });
  it("the positive label still appears when plain code really covered everything", () => {
    const v = verifyOutline(FILES, buildCodeMap(FILES), { ...GOOD, joins: [{ from: "retry", to: "api", kind: "calls", evidence: { path: "src/retry.ts", line: 1, quotedSnippet: "x" } }] }, "m");
    expect(v.joins[0]).toMatchObject({ noLinkFound: true, reason: `${FOUND_NO_LINK}: no file of retry imports a file of api` });
  });
});

describe("R3-B2: export statements and footers link only a part that holds the whole file", () => {
  const twoParts = (path: string, text: string, kinds: JoinKind[]) => {
    const f = file(path, text);
    const lines = text.split("\n");
    const o: WonderOutline = {
      parts: [
        { id: "H", name: "H", purpose: "p", files: [{ path, lineStart: 1, lineEnd: 3, quotedSnippet: quoteFrom(text, 1) }], patterns: [] },
        { id: "U", name: "U", purpose: "p", files: [{ path, lineStart: 5, lineEnd: count(text), quotedSnippet: quoteFrom(text, 5) }], patterns: [] },
      ],
      joins: kinds.map((kind) => ({ from: "U", to: "H", kind, evidence: { path, line: count(text), quotedSnippet: lines[count(text) - 1]! } })),
    };
    return verifyOutline([f], buildCodeMap([f]), o, "m");
  };
  it("TS `export default helper`, CommonJS `module.exports = { … }` and `exports.x = …`", () => {
    for (const [path, text] of [
      ["mod.ts", "function helperFunction() {\n  return 1\n}\n\nexport function unrelatedThing() {\n  return 2\n}\n\nexport default helperFunction\n"],
      ["mod.js", "function saveUser() {\n  return 1\n}\n\nfunction other() {\n  return 2\n}\n\nmodule.exports = { save: saveUser, other }\n"],
      ["exp.js", "function saveUser() {\n  return 1\n}\n\nfunction other() {\n  return 2\n}\n\nexports.save = saveUser\n"],
    ] as const) {
      const v = twoParts(path, text, ["data", "imports", "calls"]);
      expect(v.counts.confirmedParts, path).toBe(2);
      expect(v.joins.map((j) => j.status), path).toEqual(["model-only", "model-only", "model-only"]);
    }
  });
  it("a part holding the whole file still links through its export line; Python's __main__ footer really runs code and links", () => {
    const m = buildCodeMap([file("mod.ts", "function helperFunction() {\n  return 1\n}\nexport default helperFunction\n")]);
    expect(m.edges.map((e) => [e.id, e.onExport])).toEqual([["uses:mod.ts->mod.ts:export helperFunction", true]]);
    const py = twoParts("mod.py", "def main_entry():\n    return 1\n\n\ndef other():\n    return 2\n\n\nif __name__ == '__main__':\n    main_entry()\n", ["calls"]);
    expect(py.joins[0]!.status).toBe("confirmed");
  });
});

describe("R3-M1: every Python rebinding form shadows (never a confirmed call)", () => {
  const H = "def helper_function():\n    return 1\n\n\n";
  const cases: [string, string][] = [
    ["tuple unpacking", "def use():\n    first, helper_function = make_pair()\n    return helper_function()\n"],
    ["async for", "async def use(gen):\n    async for helper_function in gen:\n        helper_function()\n"],
    ["walrus", "def use():\n    if (helper_function := pick()):\n        helper_function()\n"],
    ["with … as (a, b)", "def use(cm):\n    with cm as (first, helper_function):\n        helper_function()\n"],
    ["starred target", "def use(xs):\n    *rest, helper_function = xs\n    helper_function()\n"],
    ["class-body attribute", "class Use:\n    helper_function = staticmethod(len)\n    value = helper_function('ab')\n"],
    ["@x.setter", "class Use:\n    @property\n    def helper_function(self):\n        return 1\n\n    @helper_function.setter\n    def helper_function(self, v):\n        pass\n"],
    ["match / case capture", "def use(v):\n    match v:\n        case helper_function:\n            helper_function()\n"],
  ];
  for (const [name, body] of cases) {
    it(name, () => {
      const text = H + body;
      const f = file("mod.py", text);
      const m = buildCodeMap([f]);
      expect(m.edges.filter((e) => e.kind === "calls"), name).toEqual([]);
      const o: WonderOutline = {
        parts: [
          { id: "H", name: "H", purpose: "p", files: [{ path: "mod.py", lineStart: 1, lineEnd: 2, quotedSnippet: "def helper_function():" }], patterns: [] },
          { id: "U", name: "U", purpose: "p", files: [{ path: "mod.py", lineStart: 5, lineEnd: count(text), quotedSnippet: quoteFrom(text, 5) }], patterns: [] },
        ],
        joins: [{ from: "U", to: "H", kind: "calls", evidence: { path: "mod.py", line: 5, quotedSnippet: body.split("\n")[0]! } }],
      };
      expect(verifyOutline([f], m, o, "m").joins[0]!.status, name).toBe("model-only");
    });
  }
  it("control: `global` really uses the module function", () => {
    const m = buildCodeMap([file("mod.py", H + "def use():\n    global helper_function\n    helper_function = wrap(helper_function)\n    helper_function()\n")]);
    expect(m.edges.some((e) => e.kind === "calls")).toBe(true);
  });
});

describe("round-3 minors", () => {
  it("1: with an @overload stub and a real definition, a call goes to the real (last) one", () => {
    const m = buildCodeMap([file("mod.py", "from typing import overload\n\n@overload\ndef parse_value(x: int) -> int: ...\n\n@overload\ndef parse_value(x: str) -> str: ...\n\ndef parse_value(x):\n    return x\n\ndef caller():\n    return parse_value(1)\n")]);
    expect(m.edges.find((e) => e.kind === "calls")!.toSymbol).toBe("mod.py#parse_value@9");
  });

  it("2: `X.map()` on an imported constant is a use of X, not a call into X's code", () => {
    const m: CodeMap = buildCodeMap([file("c.ts", "export const USD = ['a', 'b'];\nexport function f() { return 1 }\n"), file("u.ts", "import { USD, f } from './c';\nexport const n = USD.map((x) => x);\nexport const g = f();\n")]);
    expect(m.edges.filter((e) => e.from === "u.ts" && e.kind !== "imports").map((e) => [e.kind, e.what])).toEqual([
      ["calls", "f"],
      ["uses", "USD.map"],
    ]);
  });

  it("3: allowances are checked before either is counted; the model round is taken only when Wonder is really asked", async () => {
    const a = createHourlyLimit(1, "x");
    expect(a.check("ip")).toEqual({ ok: true });
    expect(a.check("ip")).toEqual({ ok: true });
    a.take("ip");
    expect(a.check("ip").ok).toBe(false);
    let taken = 0;
    const huge = Array.from({ length: 3 }, (_, i) => file(`h${i}.py`, "x = 1\n".repeat(17_000)));
    await runOutliner({ files: huge, codeMap: buildCodeMap(huge), label: "t", codeSha256: "0".repeat(64) }, { chat: async () => ({ ok: false, reason: "x" }), beforeFirstCall: () => (taken++, { ok: true }) });
    expect(taken).toBe(0); // refused by the prompt gate: no model round spent
  });

  it("4: outline calls reserve their worst case, so calls running at once cannot pass the ceiling", async () => {
    const budget = createModelBudget({ spendCeilingUsd: 3 });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const chat = budget.wrap(async () => (await held, { ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.5 } } as ChatResult), { reserveWorstCase: true });
    const args: ChatArgs = { role: "outliner", model: "muse-wonder-1.0", messages: [{ role: "user", content: "x".repeat(100_000) }], maxTokens: 24_000 };
    const first = chat(args);
    const second = await chat(args); // the first holds about $1.6 of the $3 ceiling; the second's worst case does not fit
    expect(second).toMatchObject({ ok: false, reason: expect.stringMatching(/held for calls in flight/) });
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(budget.spentUsd()).toBeCloseTo(0.5);
  });
});
