// Review finding S10: the pre-commit secret scan. Fake values are built by joining pieces so this
// file itself never holds a whole secret shape.
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs tool with no type declarations
import { GENERIC_PATTERNS, scanText } from "../tools/secret-scan.mjs";

const fake = (...parts: string[]) => parts.join("");

describe("secret scan", () => {
  it("finds each generic secret shape", () => {
    const samples = [
      fake("sk", "-", "a".repeat(32)),
      fake("Bearer ", "b".repeat(30)),
      fake("https://x.base-mainnet.quik", "node.pro/", "c".repeat(20), "/"),
      fake("https://base-mainnet.g.alchemy", ".com/v2/", "d".repeat(20)),
      fake("https://mainnet.infura", ".io/v3/", "e".repeat(32)),
    ];
    for (const s of samples) expect(scanText(s, []).length, s.slice(0, 12)).toBe(1);
    expect(GENERIC_PATTERNS).toHaveLength(5);
  });

  it("finds a real value it was given, and names it without printing it", () => {
    const value = fake("value", "-that-is-secret-", "123");
    const hits = scanText(`config = ${value}`, [{ what: "the real Meta API key", value }]);
    expect(hits).toEqual(["the real Meta API key"]);
  });

  it("an allow comment skips generic shapes but never a real value", () => {
    const value = fake("value", "-that-is-secret-", "123");
    const line = `${fake("sk", "-", "a".repeat(32))} ${value} // secret-scan: allow`;
    expect(scanText(line, [{ what: "the real Meta API key", value }])).toEqual(["the real Meta API key"]);
  });

  it("ordinary code passes", () => {
    expect(scanText('headers: { authorization: `Bearer ${key}` }', [])).toEqual([]);
  });
});
