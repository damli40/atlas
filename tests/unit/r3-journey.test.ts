// R3 journey item 2: "Test this claim" compares tests by what they do, whatever order their keys came in.
import { describe, expect, it } from "vitest";
import { canonicalTest, codeFingerprint } from "../../web/screens/Studio";

describe("canonicalTest", () => {
  it("the same test with its keys in another order is the same test", () => {
    const a = { shape: "call-function", exportName: "f", args: [{ kind: "json", value: { b: 1, a: 2 } }] };
    const b = { args: [{ value: { a: 2, b: 1 }, kind: "json" }], exportName: "f", shape: "call-function" };
    expect(canonicalTest(a)).toBe(canonicalTest(b));
  });
  it("a different argument, or arguments in another order, is a different test", () => {
    const f = (args: unknown[]) => ({ exportName: "f", args });
    expect(canonicalTest(f([1, 2]))).not.toBe(canonicalTest(f([2, 1])));
    expect(canonicalTest(f([1]))).not.toBe(canonicalTest(f([1, 2])));
  });
});

describe("M3: the label's fingerprint", () => {
  it("spaces and comments do not make new code; a string or a token does", () => {
    const f = (s: string) => codeFingerprint(s, "js");
    const base = 'export function a() { return "x y"; }\n';
    expect(f('// note\nexport function a() {\n  /* c */ return "x y";\n}')).toBe(f(base));
    expect(f('export function a() { return "x  y"; }')).not.toBe(f(base));
    expect(f('export function a() { return "// not a comment"; }')).toContain("// not a comment");
    expect(f("export function b() { return 1; }")).not.toBe(f("export function a() { return 1; }"));
  });
  it("Python keeps its indentation, because there it is the code", () => {
    const f = (s: string) => codeFingerprint(s, "py");
    expect(f("def a():\n    return 1  # note\n")).toBe(f("# top\ndef a():\n    return 1\n"));
    expect(f("if x:\n    y()\nz()\n")).not.toBe(f("if x:\n    y()\n    z()\n"));
  });
});
