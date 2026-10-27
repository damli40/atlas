// Day-7 review minors that live outside the screens: M1 (the repeat check treats a provably identical
// run as the same experiment), M2 (part of a key echoed back is removed too), M5 (every usage line names
// its provider; costs unchanged), M8 (live.ts names no private config path). Failed on the code before
// this commit (tests/evidence/D07-review/minors-tests-on-old-code.txt).

import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { alreadyRan, experimentKey } from "../../src/experiment-name";
import { validateAdversaryOutput } from "../../server/meta/roles/adversary";
import { TS_GATE_CONTEXT } from "../../server/app";
import { createMetaClient, providerFor } from "../../server/meta/client";
import { redactSecret } from "../../server/meta/redact-secret";
import { scrubModelText } from "../../server/meta/roles/fixer";
import { scrubText } from "../../server/proofs/refusals";
import { SPARK_OPEN_MODEL } from "../../src/claimants";

const answer = (experiment: unknown) => JSON.stringify({ experiment, why: "w" });

describe("M1: failTimes 0 makes the failure kind irrelevant, so those runs are the same experiment", () => {
  it("retry-scenario failTimes 0: error vs never_settles is a repeat (the review's P3)", () => {
    const v = validateAdversaryOutput(answer({ shape: "retry-scenario", failTimes: 0, failure: "never_settles" }), TS_GATE_CONTEXT, [{ shape: "retry-scenario", failTimes: 0, failure: "error" }]);
    expect(v.ok).toBe(false);
  });
  it("only where provable: failTimes 1 still tells error from never_settles", () => {
    expect(experimentKey({ shape: "retry-scenario", failTimes: 1, failure: "never_settles" })).not.toBe(experimentKey({ shape: "retry-scenario", failTimes: 1, failure: "error" }));
  });
  it("attempts and delayMs go into the code under test, which may use them any way it likes: never merged (P6 stays a new experiment)", () => {
    const v = validateAdversaryOutput(answer({ shape: "retry-scenario", failTimes: 1, failure: "error", attempts: 6 }), TS_GATE_CONTEXT, [{ shape: "retry-scenario", failTimes: 1, failure: "error", attempts: 5 }]);
    expect(v.ok).toBe(true);
    expect(alreadyRan({ shape: "retry-scenario", failTimes: 0, failure: "error", attempts: 3 }, [{ shape: "retry-scenario", failTimes: 0, failure: "error", attempts: 4 }])).toBe(false);
  });
});

describe("M2: any 12+ character piece of a secret is removed, not only the whole key", () => {
  const key = "bt-fake-test-key-0123456789abcdef"; // secret-scan: allow (an obviously fake key)
  it("redactSecret: prefix, middle and suffix pieces of 12+ characters", () => {
    const t = redactSecret(`a ${key.slice(0, 12)}... b ${key.slice(5, 20)} c ${key.slice(-14)} d ${key}`, key);
    for (let i = 0; i + 12 <= key.length; i++) expect(t).not.toContain(key.slice(i, i + 12));
    expect(t).toContain("[redacted]");
    expect(redactSecret("nothing here", key)).toBe("nothing here");
  });
  it("the Baseten client: a 401 body that echoes part of the key (the review's P5)", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: `Invalid API key ${key.slice(0, 12)}...${key.slice(-6)}` } }), { status: 401 })) as unknown as typeof fetch;
    const c = createMetaClient({ basetenApiKey: key, apiKey: "sk-meta", fetchImpl, usagePath: join(mkdtempSync(join(tmpdir(), "m2-")), "u.jsonl") });
    const r = await c.chat({ role: "claimant", model: SPARK_OPEN_MODEL, messages: [{ role: "user", content: "x" }], json: true });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).not.toContain(key.slice(0, 12));
  });
  it("Muse Code's text and refusal records too", () => {
    expect(scrubModelText(`see ${key.slice(3, 18)}`, key)).not.toContain(key.slice(3, 18));
    expect(scrubText(`x ${key.slice(2, 16)} y`, { BASETEN_API_KEY: key })).not.toContain(key.slice(2, 16));
  });
});

describe("M5: every usage line names its provider; the dollars are unchanged", () => {
  const lines = readFileSync(join(__dirname, "..", "evidence", "usage", "usage.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { model: string; provider?: string; usd: number });
  it("each line's provider is the one its model goes to", () => {
    for (const l of lines) expect(l.provider).toBe(providerFor(l.model));
  });
  // The migration touched the first 72 lines; their dollars must stay as they were. Later live calls append
  // lines (D22 added 8), so the file's total length is not pinned: that made the test fail on every new call.
  it("the first 72 lines (the ones the migration touched): $5.82752 in all, as before", () => {
    expect(lines.length).toBeGreaterThanOrEqual(72);
    expect(Math.round(lines.slice(0, 72).reduce((a, l) => a + l.usd, 0) * 1e6) / 1e6).toBe(5.82752);
  });
});

describe("M8: D07-01's live script names no private config path", () => {
  it("no ~/.config path and no `gh auth token` in its comments", () => {
    const src = readFileSync(join(__dirname, "..", "evidence", "D07-01", "live.ts"), "utf8");
    expect(src).not.toMatch(/~\/\.config|gh auth token/);
  });
});
