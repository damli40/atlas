// D02-02: the Claimant role with a mocked chat(). No network, no key, nothing written to proofs/.

import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUESTION_TEXT, type GateContext } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { verifySeal } from "../../src/seal.ts";
import type { AgentEvent, Run, Target } from "../../src/types.ts";
import type { ChatArgs, ChatResult } from "../../server/meta/client.ts";
import { FIXTURE_FINDING_LABEL, FIXTURE_FILE, fixtureFinding, snippetMatches } from "../../server/meta/roles/fixture-finding.ts";
import { SYSTEM_PREAMBLE, runClaimant, validateClaimantOutput } from "../../server/meta/roles/claimant.ts";
import { writeRefusal, type RefusalRecord } from "../../server/proofs/refusals.ts";
import { TS_GATE_CONTEXT } from "../../server/app.ts";

const FILE_TEXT = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const TARGET: Target = { kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: "a".repeat(64) };
const finding = fixtureFinding(FILE_TEXT);
const usage = { promptTokens: 1000, completionTokens: 200, usd: 0.008 };

const GOOD = {
  experiment: { shape: "retry-scenario", failTimes: "always", failure: "error" },
  bets: [
    { measures: "calls", answer: { kind: "integer", value: 5 }, rationale: "Default attempts is 5." },
    { measures: "totalWaitMs", answer: { kind: "integer", value: 12000 }, rationale: "Four waits of 3000 ms." },
    { measures: "outcome", answer: { kind: "enum", value: "throws", options: ["returns", "throws", "pending"] }, rationale: "Rethrows the last error." },
  ],
};

function mockChat(replies: (string | ChatResult)[]) {
  const calls: ChatArgs[] = [];
  const chat = async (args: ChatArgs): Promise<ChatResult> => {
    calls.push(JSON.parse(JSON.stringify(args)));
    const r = replies[calls.length - 1];
    if (r === undefined) throw new Error("chat called more times than expected");
    return typeof r === "string" ? { ok: true, content: r, finishReason: "stop", usage } : r;
  };
  return { chat, calls };
}

function harness(replies: (string | ChatResult)[]) {
  const m = mockChat(replies);
  const events: AgentEvent[] = [];
  const refusals: RefusalRecord[] = [];
  const input = { target: TARGET, finding, fileText: FILE_TEXT, gateContext: TS_GATE_CONTEXT };
  const deps = { chat: m.chat, emit: (e: AgentEvent) => events.push(e), onRefusal: (r: RefusalRecord) => refusals.push(r) };
  return { ...m, events, refusals, run: () => runClaimant(input, deps) };
}

describe("the fixture finding", () => {
  it("is the retry loop (fixture lines 49–66 = original lines 69–86) and verifies against the file", () => {
    const lines = FILE_TEXT.split("\n");
    expect(lines[finding.lineStart - 1]).toContain("export async function withRpcRetry");
    expect(lines[finding.lineEnd - 1]).toBe("}");
    expect(lines[10]).toContain("Retry budget"); // fixture line 11 = original line 31
    expect(finding.verified).toBe(true);
  });
  it("is unverified when the quote is not in its lines", () => {
    expect(snippetMatches(FILE_TEXT, { lineStart: 11, lineEnd: 20, quotedSnippet: finding.quotedSnippet })).toBe(false);
    expect(snippetMatches(FILE_TEXT, { lineStart: 60, lineEnd: 999, quotedSnippet: "x" })).toBe(false);
  });
});

describe("Claimant: valid path", () => {
  it("one call, gate allows, one sealed bet per plain-code question, model id on every bet", async () => {
    const h = harness([JSON.stringify(GOOD)]);
    const r = await h.run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.model).toBe("muse-spark-1.3");
    expect(h.calls[0]!.json).toBe(true);
    expect(r.experiment.gate).toEqual({ allowed: true });
    expect(r.experiment.params).toEqual(GOOD.experiment);
    expect(r.experiment.proposedBy).toEqual({ role: "claimant", model: "muse-spark-1.3" });
    expect(r.bets.map((b) => [b.measures, b.question])).toEqual([
      ["calls", QUESTION_TEXT.calls],
      ["totalWaitMs", QUESTION_TEXT.totalWaitMs],
      ["outcome", QUESTION_TEXT.outcome],
    ]);
    for (const b of r.bets) {
      expect(b.who).toBe("model:muse-spark-1.3");
      expect(b.experimentId).toBe(r.experiment.id);
      expect(verifySeal(b)).toBe(true);
      expect(b.rationale).toBeTruthy();
    }
    expect(r.rejected).toEqual([]);
    expect(h.refusals).toEqual([]);
    expect(h.events.map((e) => `${e.role}: ${e.action}`)).toEqual([
      "claimant: proposes retry-scenario",
      "gate: allowed",
      "seal: seals 3 bets from muse-spark-1.3",
    ]);
    expect(h.events[0]!.usage).toEqual(usage);
  });

  it("the prompt: preamble, label, finding lines ±20 with numbers, allow-list, questions; never a hash or nonce", async () => {
    const h = harness([JSON.stringify(GOOD)]);
    await h.run();
    const [sys, user] = h.calls[0]!.messages;
    expect(sys!.content).toBe(SYSTEM_PREAMBLE);
    expect(user!.content).toContain(FIXTURE_FINDING_LABEL);
    expect(user!.content).toContain("lines 49-66");
    expect(user!.content).toContain("29| ");
    expect(user!.content).toContain("67| ");
    expect(user!.content).not.toMatch(/^28\| /m);
    expect(user!.content).toContain('shape "retry-scenario"');
    expect(user!.content).not.toContain("concurrency-sweep");
    expect(user!.content).toContain(QUESTION_TEXT.outcome);
    expect(user!.content).not.toMatch(/sealedHash|nonce/);
  });

  it("a declined bet is kept, sealed, reported as a refusal, and judged can't check", async () => {
    const declined = { ...GOOD, bets: [...GOOD.bets.slice(0, 2), { measures: "outcome", answer: { kind: "declined", reason: "unknown: depends on fn" }, rationale: "Not sure." }] };
    const h = harness([JSON.stringify(declined)]);
    const r = await h.run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(h.refusals).toHaveLength(1);
    expect(h.refusals[0]).toMatchObject({ kind: "declined_bet", model: "muse-spark-1.3", measures: "outcome", reason: "unknown: depends on fn" });
    const run = { id: "r1", experimentId: r.experiment.id, controlPassed: true, result: { measured: { outcome: "throws" }, notMeasured: {} } } as unknown as Run;
    expect(judge(r.bets[2]!, run)).toMatchObject({ outcome: "cant_check", reason: "the bettor declined" });
  });
});

describe("Claimant: repair loop", () => {
  it("garbage → exactly one repair (error appended) → ok:false, and the log says 'no usable answer'", async () => {
    const h = harness(["this is not json", "{\"still\": \"garbage\"}"]);
    const r = await h.run();
    expect(r.ok).toBe(false);
    expect(h.calls).toHaveLength(2);
    const repair = h.calls[1]!.messages;
    expect(repair).toHaveLength(4);
    expect(repair[2]).toEqual({ role: "assistant", content: "this is not json" });
    expect(repair[3]!.content).toBe("Your previous answer failed: the answer is not valid JSON. Return only the JSON.");
    if (r.ok) return;
    expect(r.reason).toMatch(/does not match the schema/);
    expect(r.attempts).toHaveLength(2);
    expect(r.usage?.usd).toBeCloseTo(0.016);
    const last = h.events.at(-1)!;
    expect(last.role).toBe("claimant");
    expect(last.model).toBe("muse-spark-1.3");
    expect(last.action).toMatch(/^no usable answer \(/);
  });

  it("out-of-bounds experiment → gate rejection kept and reported → repair with the gate's reason → ok", async () => {
    const bad = { ...GOOD, experiment: { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 1000 } };
    const h = harness([JSON.stringify(bad), JSON.stringify(GOOD)]);
    const r = await h.run();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.messages[3]!.content).toBe(
      "Your previous answer failed: gate: rejected (attempts 1000 is outside the allowed range (1 to 10)). Return only the JSON.",
    );
    expect(r.ok).toBe(true);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.gate).toEqual({ allowed: false, reason: "attempts 1000 is outside the allowed range (1 to 10)" });
    expect(r.rejected[0]!.params).toEqual(bad.experiment);
    expect(h.refusals).toHaveLength(1);
    expect(h.refusals[0]).toMatchObject({ kind: "gate_rejection", model: "muse-spark-1.3", experiment: bad.experiment });
    expect(h.events.map((e) => e.action)).toContain("rejected (attempts 1000 is outside the allowed range (1 to 10))");
  });

  it("two gate rejections → ok:false, both kept", async () => {
    const bad = { ...GOOD, experiment: { shape: "fetch-url", url: "https://example.com" } };
    const h = harness([JSON.stringify(bad), JSON.stringify(bad)]);
    const r = await h.run();
    expect(r.ok).toBe(false);
    expect(r.rejected).toHaveLength(2);
    expect(h.refusals.map((x) => x.kind)).toEqual(["gate_rejection", "gate_rejection"]);
  });

  it("a failed model call (HTTP error) → ok:false at once, no repair", async () => {
    const h = harness([{ ok: false, reason: "HTTP 500: boom" }]);
    const r = await h.run();
    expect(h.calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, reason: "the model call failed: HTTP 500: boom" });
  });

  it("an unverified finding → ok:false without calling the model", async () => {
    const m = mockChat([]);
    const r = await runClaimant({ target: TARGET, finding: { ...finding, verified: false }, fileText: FILE_TEXT, gateContext: TS_GATE_CONTEXT }, { chat: m.chat });
    expect(r.ok).toBe(false);
    expect(m.calls).toHaveLength(0);
  });
});

describe("validateClaimantOutput: meaning checks", () => {
  const ts = TS_GATE_CONTEXT;
  const withBets = (bets: unknown[]) => JSON.stringify({ ...GOOD, bets });
  const [calls, wait, outcome] = GOOD.bets;
  const err = (content: string, ctx: GateContext = ts) => {
    const v = validateClaimantOutput(content, ctx);
    if (v.ok) throw new Error("expected a failure");
    return v.error;
  };

  it.each([
    ["missing a question", withBets([calls, wait]), /no bet on "outcome"/],
    ["two bets on one field", withBets([calls, calls, wait, outcome]), /two bets on "calls"/],
    ["a bet on a field no question asks", withBets([calls, wait, outcome, { measures: "settleTime", answer: { kind: "integer", value: 1 }, rationale: "x" }]), /answer no question/],
    ["integer kind on the outcome question", withBets([calls, wait, { ...outcome, answer: { kind: "integer", value: 1 } }]), /must be kind "enum"/],
    ["enum kind on calls", withBets([{ ...calls, answer: { kind: "enum", value: "5", options: ["5"] } }, wait, outcome]), /must be kind "integer"/],
    ["fraction for calls", withBets([{ ...calls, answer: { kind: "integer", value: 4.5 } }, wait, outcome]), /whole number/],
    ["negative wait", withBets([calls, { ...wait, answer: { kind: "integer", value: -1 } }, outcome]), /whole number of 0 or more/],
    ["outcome not an option", withBets([calls, wait, { ...outcome, answer: { kind: "enum", value: "hangs", options: ["returns", "throws", "pending"] } }]), /must be one of/],
    ["outcome options changed", withBets([calls, wait, { ...outcome, answer: { kind: "enum", value: "throws", options: ["throws"] } }]), /must have options/],
    ["number kind with seconds", withBets([calls, { ...wait, answer: { kind: "number", value: 12, tolerancePct: 0, unit: "s" } }, outcome]), /must be kind "integer"/],
    ["extra top-level key", JSON.stringify({ ...GOOD, notes: "hi" }), /does not match the schema/],
    ["no rationale", withBets([{ measures: "calls", answer: { kind: "integer", value: 5 } }, wait, outcome]), /does not match the schema/],
  ])("%s", (_n, content, why) => {
    expect(err(content)).toMatch(why);
  });

  it("price bets: unit must be USD and tolerance the question's 10%", () => {
    const evm: GateContext = { shapes: ["apply-proposal-then-read"], touchedMarkets: ["cbETH"] };
    const mk = (answer: unknown) => JSON.stringify({ experiment: { shape: "apply-proposal-then-read", markets: ["cbETH"] }, bets: [{ measures: "priceUsd1e18:cbETH", answer, rationale: "r" }] });
    expect(validateClaimantOutput(mk({ kind: "number", value: 2200, tolerancePct: 10, unit: "USD" }), evm).ok).toBe(true);
    expect(err(mk({ kind: "number", value: 1.12, tolerancePct: 10, unit: "ETH" }), evm)).toMatch(/must have unit "USD"/);
    expect(err(mk({ kind: "number", value: 2200, tolerancePct: 99, unit: "USD" }), evm)).toMatch(/tolerancePct 10/);
  });
});

describe("refusal writer", () => {
  it("writes <date>-<id>.json with only the listed fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-refusals-"));
    const rec = { kind: "gate_rejection", id: "abc123", time: "2026-10-27T05:00:00.000Z", role: "claimant", model: "muse-spark-1.3", experiment: { shape: "x" }, reason: "unknown shape", secret: "nope" } as unknown as RefusalRecord;
    const path = writeRefusal(rec, dir);
    expect(readdirSync(dir)).toEqual(["2026-10-27-abc123.json"]);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(saved).sort()).toEqual(["experiment", "id", "kind", "model", "reason", "role", "time"]);
  });
});
