import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import oracle from "../oracle/retry-oracle.json";

// The original file lives only on Dami's machine. Without it these checks are skipped, not failed.
const ORIGINAL = "/Users/Admin/Desktop/oft-audit-product/backend/src/executor/chain-reads.ts";
const ORIGINAL_SHA256 = "bf2d018c092deba95fb40fc6c4a934e2b2992b58bcde2b83d08590d197059fb6";
const FIXTURE = new URL("../fixtures/with-rpc-retry.ts", import.meta.url);
const BEGIN = "// ---- BEGIN VERBATIM (chain-reads.ts lines 31–86) ----";
const END = "// ---- END VERBATIM ----";

function verbatimBlock(): string[] {
  const lines = readFileSync(FIXTURE, "utf8").split("\n");
  const start = lines.indexOf(BEGIN);
  const end = lines.indexOf(END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start + 1, end);
}

describe("withRpcRetry fixture", () => {
  it.skipIf(!existsSync(ORIGINAL))("original file still has the pinned SHA-256", () => {
    const sha = createHash("sha256").update(readFileSync(ORIGINAL)).digest("hex");
    expect(sha).toBe(ORIGINAL_SHA256);
  });

  it.skipIf(!existsSync(ORIGINAL))("fixture block equals lines 31–86 of the original", () => {
    const original = readFileSync(ORIGINAL, "utf8").split("\n").slice(30, 86);
    expect(verbatimBlock()).toEqual(original);
  });

  it("fixture block is 56 lines and exports withRpcRetry", () => {
    const block = verbatimBlock();
    expect(block).toHaveLength(56);
    expect(block.join("\n")).toContain("export async function withRpcRetry<T>(");
  });
});

describe("retry oracle table", () => {
  it("has S1–S6, H1, H2 in order", () => {
    expect(oracle.cases.map((c) => c.id)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "H1", "H2"]);
  });

  it("each case is internally consistent", () => {
    for (const c of oracle.cases) {
      const e = c.expected;
      expect(e.waitsMs.length, c.id).toBe(e.logCount);
      expect(e.logAttempts.length, c.id).toBe(e.logCount);
      expect(e.waitsMs.reduce((a, b) => a + b, 0), c.id).toBe(e.totalWaitMs);
    }
  });
});
