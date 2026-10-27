// E1 review round 2: a hostile value must never crash Atlas, and question text must not hide characters.
// MAJOR-1: canonicalJson / sealBet on a deeply nested bet value ran out of stack (RangeError).
// MAJOR-2: verifyAtlasFile could throw on a hostile proof file instead of answering { ok: false }.
// MINOR-3: control, bidi and zero-width characters reached the question text a bettor reads.

import { describe, expect, it } from "vitest";
import { MAX_BET_JSON_DEPTH, MAX_JSON_DEPTH, canonicalJson, jsonBetValueProblem, jsonDepth, sealBet } from "../../src/seal.ts";
import { verifyAtlasFile } from "../../src/atlasfile.ts";
import { describeCall, questionsFor, visibleText } from "../../src/gate.ts";
import { checkAnswer } from "../../server/bets.ts";
import type { ExperimentShape, JsonValue } from "../../src/types.ts";

/** [[[...]]] nested `levels` deep, built without recursion. */
function nested(levels: number): JsonValue {
  let v: JsonValue = 1;
  for (let i = 0; i < levels; i++) v = [v];
  return v;
}

describe("MAJOR-1: deep JSON is refused with a plain error, never a stack overflow", () => {
  it("canonicalJson writes 100 levels and refuses 101 with a TypeError", () => {
    expect(canonicalJson(nested(MAX_JSON_DEPTH))).toBe("[".repeat(100) + "1" + "]".repeat(100));
    expect(() => canonicalJson(nested(MAX_JSON_DEPTH + 1))).toThrow(TypeError);
    expect(() => canonicalJson(nested(MAX_JSON_DEPTH + 1))).toThrow(/deeper than 100 levels/);
  });
  it("a value 100 000 levels deep: TypeError (not RangeError) from canonicalJson and from sealBet", () => {
    const deep = nested(100_000);
    expect(() => canonicalJson(deep)).toThrow(TypeError);
    expect(() => sealBet({ who: "human", experimentId: "e", question: "q", measures: "returnedJson", answer: { kind: "json", value: deep } })).toThrow(TypeError);
  });
  it("jsonDepth counts without recursion and stops past its limit", () => {
    expect(jsonDepth(1)).toBe(0);
    expect(jsonDepth([])).toBe(1);
    expect(jsonDepth({ a: [{}] })).toBe(3);
    expect(jsonDepth(nested(1_000_000), 100)).toBe(101);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(jsonDepth(cycle, 50)).toBe(51);
  });
  it("the bet is bounded where it is accepted (POST /bets checkAnswer): 98 levels sealed, 99 and 100 000 refused", () => {
    const q = { measures: "returnedJson", text: "q", kind: "json" as const, unit: "json" as const };
    const ok = checkAnswer(q, { kind: "json", value: nested(MAX_BET_JSON_DEPTH) });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(() => sealBet({ who: "human", experimentId: "e", question: "q", measures: "returnedJson", answer: ok.answer })).not.toThrow();
    for (const levels of [MAX_BET_JSON_DEPTH + 1, 100_000]) {
      const r = checkAnswer(q, { kind: "json", value: nested(levels) });
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.reason).toMatch(/nests deeper than 98 levels/);
    }
    expect(checkAnswer(q, { kind: "json", value: { a: Number.NaN } })).toMatchObject({ ok: false });
    expect(checkAnswer(q, { kind: "json", value: "x".repeat(3000) })).toMatchObject({ ok: false });
    expect(jsonBetValueProblem({ a: [1, "b", null] })).toBeNull();
  });
});

describe("MAJOR-2: verifyAtlasFile never throws", () => {
  it("a proof file with a bet value 100 000 levels deep answers { ok: false } with a reason", () => {
    const file = { version: 1, bets: [{ answer: { kind: "json", value: nested(100_000) } }] };
    const v = verifyAtlasFile(file);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems[0]).toMatch(/nests deeper than 200 levels/);
  });
  it("a value whose reading throws (a getter, a hostile Proxy) answers { ok: false }", () => {
    const getter = Object.defineProperty({}, "version", { get() { throw new Error("boom"); }, enumerable: true });
    const proxy = new Proxy({}, { ownKeys() { throw new Error("trap"); }, get() { throw new Error("trap"); } });
    for (const raw of [getter, proxy]) {
      let v: ReturnType<typeof verifyAtlasFile> | undefined;
      expect(() => (v = verifyAtlasFile(raw))).not.toThrow();
      expect(v!.ok).toBe(false);
    }
  });
  it("ordinary garbage still gets zod's plain problems", () => {
    expect(verifyAtlasFile(null).ok).toBe(false);
    expect(verifyAtlasFile({ version: 2 }).ok).toBe(false);
  });
});

describe("MINOR-3: question text shows hidden characters as visible escapes", () => {
  const params: Extract<ExperimentShape, { shape: "call-function" }> = {
    shape: "call-function",
    exportName: "f",
    args: [
      { kind: "json", value: "safe\u202Eevil\u200Bx\nnew line" },
      { kind: "stand-in", name: "g", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "E", message: "a\u2066b\u0085c\u0007d\uFEFF" }] },
    ],
  };
  // Built from code points so this file itself holds no hidden character.
  const ranges: [number, number][] = [[0x00, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
  const HIDDEN = new RegExp(`[${ranges.map(([a, b]) => `\\u${a.toString(16).padStart(4, "0")}-\\u${b.toString(16).padStart(4, "0")}`).join("")}]`);
  it("JSON values and messages: no raw control, bidi or zero-width character reaches any question", () => {
    const d = describeCall(params);
    expect(d).not.toMatch(HIDDEN);
    expect(d).toContain("\\u202e");
    expect(d).toContain("\\u200b");
    expect(d).toContain("\\u2066");
    expect(d).toContain("\\u0085");
    expect(d).toContain("\\u0007");
    expect(d).toContain("\\ufeff");
    for (const q of questionsFor(params)) expect(q.text).not.toMatch(HIDDEN);
  });
  it("export and stand-in names are escaped too (the gate already refuses such names; this is the second line)", () => {
    const odd = { ...params, exportName: "f\u202Eg", args: [{ kind: "stand-in" as const, name: "h\u2028i", async: false, then: "repeat_last" as const, calls: [{ do: "return" as const, value: 1 }] }] };
    for (const q of questionsFor(odd)) expect(q.text).not.toMatch(HIDDEN);
    expect(questionsFor(odd).at(-1)!.text).toContain("call h\\u2028i?");
  });
  it("visibleText leaves ordinary text, accents and emoji alone", () => {
    expect(visibleText("café → 42 ✓ 😀 \"q\"")).toBe("café → 42 ✓ 😀 \"q\"");
    expect(visibleText("a\nb\tc")).toBe("a\\u000ab\\u0009c");
  });
});
