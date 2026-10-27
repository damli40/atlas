// E2: the plain-code side of pasted Python (no sandbox, no Python needed except for one list check): the pasted
// target, the top-level functions a person can pick, every import form, and the early "needs package X" refusal.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { exportedFunctionsFor, makePastedTarget, staticRefusalFor } from "../../src/pasted-code.ts";
import { isPyStdlib, pyTopLevelFunctions, scanPySource, staticRefusalPy } from "../../src/pasted-python.ts";
import { PY_STDLIB_MODULES } from "../../runners/py/py-words.ts";
import { findPython } from "../../runners/executor/sandbox-exec-python.ts";

describe("a pasted Python target", () => {
  it("is named by its fingerprint and carries language py", () => {
    const t = makePastedTarget("def f():\n    return 1\n", "py");
    expect(t.language).toBe("py");
    expect(t.ref).toBe(`pasted:${t.codeSha256.slice(0, 12)}`);
  });
});

describe("top-level functions, read by plain code", () => {
  const src = `"""A module docstring that says def fake(): and import numpy."""
import asyncio  # def commented_out():

@decorator(name="x")
def first(a, b=")", *args, **kw):
    def nested():
        pass
    return f"{a!r:>{b}} def not_me():"

class Cart:
    def method(self):
        pass

async def second(
    x,
    y,
):
    s = '''
def inside_string():
'''
    return s

if True:
    def conditional():
        pass

def \\
    third():
    pass
x = 1; y = 2
`;
  it("lists def and async def at column 0, with lines, and nothing else", () => {
    expect(pyTopLevelFunctions(src)).toEqual([
      { name: "first", line: 5, declaredAs: "function" },
      { name: "second", line: 14, declaredAs: "function" },
      { name: "third", line: 27, declaredAs: "function" }, // the line of the `def` keyword
    ]);
    expect(exportedFunctionsFor(src, "py").map((e) => e.name)).toEqual(["first", "second", "third"]);
    expect(exportedFunctionsFor("export function a() {}", "js").map((e) => e.name)).toEqual(["a"]);
  });

  it("f-strings with nested quotes and braces do not confuse it", () => {
    // Python 3.12+ (PEP 701) lets an f-string expression reuse the same quote.
    const s = 'def a():\n    return f"{ {"k": "v"}["k"] } {x:{w}} {{literal}} def c():"\n\ndef b():\n    pass\n';
    expect(pyTopLevelFunctions(s).map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("the gate accepts a top-level function and refuses a method or a missing name", () => {
    const names = pyTopLevelFunctions(src).map((e) => e.name);
    expect(gate({ shape: "call-function", exportName: "second", args: [] }, { exportNames: names }).allowed).toBe(true);
    const g = gate({ shape: "call-function", exportName: "method", args: [] }, { exportNames: names });
    expect(g.allowed).toBe(false);
  });
});

describe("imports, read by plain code", () => {
  it("finds every form, with the module as written", () => {
    const s = `import os, json as j
import xml.etree.ElementTree
from collections import abc
from . import sibling
from ..pkg import thing
if x:
    import numpy
y = 1; import pandas
m = __import__("requests")
n = importlib.import_module(name)
s = "import fake"  # import also_fake
`;
    expect(scanPySource(s).imports.map((i) => [i.module, i.line, i.form])).toEqual([
      ["os", 1, "import"],
      ["json", 1, "import"],
      ["xml.etree.ElementTree", 2, "import"],
      ["collections", 3, "from ... import"],
      ["a module next to this file (a relative import)", 4, "from ... import"],
      ["a module next to this file (a relative import)", 5, "from ... import"],
      ["numpy", 7, "import"],
      ["pandas", 8, "import"],
      ["requests", 9, "__import__()"],
      ["a module named at run time", 10, "import_module()"],
    ]);
  });

  it("the standard library is allowed; anything else is refused before running, with the first one named", () => {
    expect(staticRefusalPy("import json, asyncio\nfrom collections.abc import Mapping\n")).toBeNull();
    expect(staticRefusalPy("import json\nimport numpy as np\n")).toBe("the code needs numpy; Atlas runs one pasted file on its own, with no packages or other modules");
    expect(staticRefusalPy("from .helpers import x\n")).toMatch(/a module next to this file \(a relative import\)/);
    expect(staticRefusalPy("m = __import__(name)\n")).toMatch(/a module named at run time/);
    expect(staticRefusalFor("import numpy\n", "py")).toMatch(/needs numpy/);
    expect(staticRefusalFor("import x from 'lodash';", "js")).toMatch(/needs lodash/);
    expect(isPyStdlib("os.path")).toBe(true);
    expect(isPyStdlib("osx")).toBe(false);
  });

  it("text it cannot read is left to Python (which reports the SyntaxError in its own words)", () => {
    expect(scanPySource("def f(:\n").problem).toMatch(/bracket/);
    expect(staticRefusalPy("def f(:\n")).toBeNull();
    expect(scanPySource("s = 'open\n").problem).toMatch(/never closed/);
  });

  it.skipIf(!findPython())("the standard-library list is exactly the interpreter's own (sys.stdlib_module_names)", () => {
    const py = findPython()!;
    const out = execFileSync(py.interpreter, ["-I", "-S", "-c", "import sys, json; print(json.dumps(sorted(sys.stdlib_module_names)))"], { env: {}, encoding: "utf8" });
    if (py.version.startsWith("3.14.")) expect([...PY_STDLIB_MODULES].sort()).toEqual(JSON.parse(out));
    else for (const m of ["json", "asyncio", "collections", "typing"]) expect(PY_STDLIB_MODULES).toContain(m);
  });
});
