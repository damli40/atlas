// R3 journey item 2: "Test this claim" compares tests by what they do, whatever order their keys came in.
import { describe, expect, it } from "vitest";
import { canonicalTest } from "../../web/screens/Studio";

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
