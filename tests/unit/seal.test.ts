import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, sealBet, sha256Hex, sha256HexBytes, verifySeal } from "../../src/seal";
import type { BetToSeal } from "../../src/seal";

const nodeSha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

describe("sha256Hex matches node:crypto", () => {
  const inputs = [
    "",
    "abc",
    "a".repeat(55), // padding edge: 55 + 1 + 8 = 64
    "a".repeat(56), // padding spills into a second block
    "a".repeat(64),
    "a".repeat(1000),
    "héllo wörld",
    "日本語のテキスト",
    "emoji 🎲🧮 and \u0000 nul",
    '{"answer":{"kind":"integer","value":5}}',
  ];
  for (const s of inputs) {
    it(`agrees on ${JSON.stringify(s.length > 40 ? s.slice(0, 20) + "…(" + s.length + ")" : s)}`, () => {
      expect(sha256Hex(s)).toBe(nodeSha(s));
    });
  }
  it("agrees on the empty string's known hash", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("agrees on random byte arrays of many lengths", () => {
    for (let len = 0; len < 200; len += 7) {
      const bytes = new Uint8Array(len);
      globalThis.crypto.getRandomValues(bytes);
      expect(sha256HexBytes(bytes)).toBe(nodeSha(bytes));
    }
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level, no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });
  it("key order does not change the output", () => {
    const a = { who: "human", answer: { kind: "number", value: 2200, tolerancePct: 10, unit: "USD" } };
    const b = { answer: { unit: "USD", tolerancePct: 10, value: 2200, kind: "number" }, who: "human" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
  it("keeps array order", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
  it("rejects undefined, NaN, Infinity, bigint, Date, cycles and holes", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson({ a: 1n })).toThrow();
    expect(() => canonicalJson({ a: new Date(0) })).toThrow();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => canonicalJson(cyc)).toThrow();
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 3])).toThrow();
  });
  it("allows the same object twice when it is not a cycle", () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});

describe("sealBet / verifySeal", () => {
  const input: BetToSeal = {
    experimentId: "exp1",
    who: "model:muse-spark-1.3",
    question: "How many times will the function call the RPC before it gives up?",
    measures: "calls",
    answer: { kind: "integer", value: 5 },
    rationale: "attempts defaults to 5",
  };

  it("adds a 16-byte hex nonce, an ISO time and a 64-hex hash, and verifies", () => {
    const b = sealBet(input, new Date("2026-10-27T10:00:00Z"));
    expect(b.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(b.sealedAt).toBe("2026-10-27T10:00:00.000Z");
    expect(b.sealedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.id).toHaveLength(10);
    expect(verifySeal(b)).toBe(true);
  });

  it("two seals of the same bet differ (fresh nonce)", () => {
    const t = new Date("2026-10-27T10:00:00Z");
    expect(sealBet(input, t).sealedHash).not.toBe(sealBet(input, t).sealedHash);
  });

  it("the hash covers who, experimentId, question, measures, answer, nonce, sealedAt, and the rationale when present", () => {
    const b = sealBet(input);
    const payload = {
      who: b.who, experimentId: b.experimentId, question: b.question, measures: b.measures,
      answer: b.answer, nonce: b.nonce, sealedAt: b.sealedAt, rationale: b.rationale,
    };
    expect(b.sealedHash).toBe(nodeSha(canonicalJson(payload)));
  });

  it("a bet with no rationale hashes exactly the original seven fields", () => {
    const { rationale: _r, ...noRationale } = input;
    const b = sealBet(noRationale);
    const payload = {
      who: b.who, experimentId: b.experimentId, question: b.question, measures: b.measures,
      answer: b.answer, nonce: b.nonce, sealedAt: b.sealedAt,
    };
    expect(b.sealedHash).toBe(nodeSha(canonicalJson(payload)));
  });

  it("verifySeal detects a changed answer", () => {
    const b = sealBet(input);
    expect(verifySeal({ ...b, answer: { kind: "integer", value: 6 } })).toBe(false);
  });

  it("verifySeal detects changes to every other sealed field", () => {
    const b = sealBet(input);
    expect(verifySeal({ ...b, who: "human" })).toBe(false);
    expect(verifySeal({ ...b, experimentId: "exp2" })).toBe(false);
    expect(verifySeal({ ...b, question: b.question + "?" })).toBe(false);
    expect(verifySeal({ ...b, measures: "totalWaitMs" })).toBe(false);
    expect(verifySeal({ ...b, nonce: "f".repeat(32) })).toBe(false);
    expect(verifySeal({ ...b, sealedAt: "2026-10-28T00:00:00.000Z" })).toBe(false);
  });

  it("the rationale IS sealed: rewriting, removing or adding it after sealing breaks the seal", () => {
    // Review finding S9: reasoning written after the run must not sit next to a "sealed" bet.
    const b = sealBet(input);
    expect(verifySeal({ ...b, rationale: "different" })).toBe(false);
    const { rationale: _r, ...withoutRationale } = b;
    expect(verifySeal(withoutRationale)).toBe(false);
    const { rationale: _r2, ...noRationale } = input;
    const plain = sealBet(noRationale);
    expect(verifySeal({ ...plain, rationale: "added later" })).toBe(false);
  });

  it("the id is not sealed (changing it keeps the seal valid)", () => {
    const b = sealBet(input);
    expect(verifySeal({ ...b, id: "other" })).toBe(true);
  });

  it("verifySeal returns false (does not throw) on a malformed bet", () => {
    const b = sealBet(input);
    expect(verifySeal({ ...b, answer: { kind: "number", value: Number.NaN, tolerancePct: 10, unit: "USD" } })).toBe(false);
    expect(verifySeal({ ...b, sealedHash: "nothex" })).toBe(false);
  });
});
