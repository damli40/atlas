import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import oracle from "../oracle/retry-oracle.json";

// The original file is private and is not in this repo. Point ATLAS_FIXTURE_SOURCE at it to run the
// two checks against it; without it they are skipped, not failed.
const ORIGINAL = process.env.ATLAS_FIXTURE_SOURCE ?? "";
const ORIGINAL_SHA256 = "bf2d018c092deba95fb40fc6c4a934e2b2992b58bcde2b83d08590d197059fb6";
// SHA-256 of the verbatim block itself (the 56 lines between the BEGIN and END markers, joined with
// "\n", no trailing newline). Pinned here so every clone, CI included, checks that the block is
// unchanged without needing the original. It equals the hash of lines 31-86 of the original.
const VERBATIM_BLOCK_SHA256 = "9b433eb07e821b5e3f9592035d19fc85524badf49158b28fc877cb3e3988ec1d";
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
  it("the verbatim block has its pinned SHA-256 (runs everywhere, no private file needed)", () => {
    const sha = createHash("sha256").update(verbatimBlock().join("\n")).digest("hex");
    expect(sha).toBe(VERBATIM_BLOCK_SHA256);
  });

  it.skipIf(!ORIGINAL || !existsSync(ORIGINAL))("lines 31-86 of the original hash to the pinned block SHA-256", () => {
    const original = readFileSync(ORIGINAL, "utf8").split("\n").slice(30, 86).join("\n");
    expect(createHash("sha256").update(original).digest("hex")).toBe(VERBATIM_BLOCK_SHA256);
  });

  it.skipIf(!ORIGINAL || !existsSync(ORIGINAL))("original file still has the pinned SHA-256", () => {
    const sha = createHash("sha256").update(readFileSync(ORIGINAL)).digest("hex");
    expect(sha).toBe(ORIGINAL_SHA256);
  });

  it.skipIf(!ORIGINAL || !existsSync(ORIGINAL))("fixture block equals lines 31–86 of the original", () => {
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
