// D18 = A: Muse Spark (the Claimant, both modes) sees only the finding's CODE LINES: the file, the
// line range and the numbered lines around it. Never the Investigator's claim sentence, never any
// other model's rationale. chat() is mocked: no network, no key.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createBetStore } from "../../server/bets";
import { createAgentLog } from "../../server/log/agentlog";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { buildClaimantMessages } from "../../server/meta/roles/claimant";
import { buildBetOnlyMessages } from "../../server/meta/roles/claimant-bets";
import { FIXTURE_FILE } from "../../server/meta/roles/fixture-finding";
import { questionsFor } from "../../src/gate";
import type { Experiment, Finding } from "../../src/types";
import { TS_GATE_CONTEXT } from "../../server/app";

const FILE_TEXT = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
// Marker text that cannot appear in the code or the prompt template by accident.
const CLAIM = "Okapi-claim: People expect one quick retry; the code keeps going.";
const WONDER_FINDING = { file: FIXTURE_FILE, lineStart: 55, lineEnd: 56, kind: "retry", claim: CLAIM, quotedSnippet: "for (let i = 1; i <= attempts; i++) {\n    try { return await fn(); }" };
const usage = { promptTokens: 100, completionTokens: 10, usd: 0.001 };

function mockChat(replies: string[]) {
  const calls: ChatArgs[] = [];
  const chat = async (args: ChatArgs): Promise<ChatResult> => {
    calls.push(JSON.parse(JSON.stringify(args)));
    const r = replies[calls.length - 1];
    if (r === undefined) throw new Error("chat called more times than expected");
    return { ok: true, content: r, finishReason: "stop", usage };
  };
  return { chat, calls };
}

const SPARK_BETS = JSON.stringify({
  bets: [
    { measures: "calls", answer: { kind: "integer", value: 5 }, rationale: "Spark-own-reason" },
    { measures: "totalWaitMs", answer: { kind: "integer", value: 12000 }, rationale: "Spark-own-reason" },
    { measures: "outcome", answer: { kind: "enum", value: "throws", options: ["returns", "throws", "pending"] }, rationale: "Spark-own-reason" },
  ],
});

describe("D18: the Claimant never sees the Investigator's claim", () => {
  it("a session with a Wonder finding: Spark's bet-only prompt holds the file, the lines and the code, not the claim", async () => {
    const wonder = mockChat([JSON.stringify({ findings: [WONDER_FINDING] })]);
    const spark = mockChat([SPARK_BETS]);
    const app = createApp({ betStore: createBetStore(), agentLog: createAgentLog(), investigator: { chat: wonder.chat }, modelBets: { chat: spark.chat } });
    const h = { "content-type": "application/json", "x-atlas-session": "d18" };
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) });
    const t = (await (await post("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).json()) as { ref: string; codeSha256: string };
    const inv = (await (await post("/investigate", { target: t })).json()) as { ok: boolean; findings: Finding[] };
    expect(inv.ok).toBe(true);
    expect(inv.findings[0]!.claim).toBe(CLAIM); // the claim exists (model panel), so its absence below is real

    expect((await post("/experiments", { id: "e1", target: t, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } })).status).toBe(200);
    await post("/experiments/e1/model-bets", {});
    expect(spark.calls).toHaveLength(1);
    const prompt = spark.calls[0]!.messages.map((m) => m.content).join("\n");
    // What Spark does see: where the finding is, and the numbered code lines.
    expect(prompt).toContain(`file: ${FIXTURE_FILE}, lines 55-56`);
    expect(prompt).toMatch(/55\| +for \(let i = 1; i <= attempts; i\+\+\) \{/);
    // What it never sees: Wonder's sentence, any part of it, or a "claim:" line.
    expect(prompt).not.toContain(CLAIM);
    expect(prompt).not.toContain("Okapi-claim");
    expect(prompt).not.toContain("People expect");
    expect(prompt).not.toMatch(/^claim:/m);
  });

  it("both prompt builders, given a finding with a claim, leave the claim out", () => {
    const finding: Finding = { id: "f1", ...WONDER_FINDING, kind: "retry", verified: true, proposedBy: { role: "investigator", model: "muse-wonder-1.0" } };
    const target = { kind: "ts-fixture" as const, ref: FIXTURE_FILE, codeSha256: "a".repeat(64) };
    const full = buildClaimantMessages({ target, finding, fileText: FILE_TEXT, gateContext: TS_GATE_CONTEXT }).map((m) => m.content).join("\n");
    const params = { shape: "retry-scenario" as const, failTimes: 5, failure: "error" as const };
    const experiment: Experiment = { id: "e1", target, runner: "ts", params, proposedBy: { role: "human" }, gate: { allowed: true } };
    const betOnly = buildBetOnlyMessages({ experiment, questions: questionsFor(params, TS_GATE_CONTEXT), finding, fileText: FILE_TEXT, gateContext: TS_GATE_CONTEXT })
      .map((m) => m.content)
      .join("\n");
    for (const p of [full, betOnly]) {
      expect(p).toContain("lines 55-56");
      expect(p).not.toContain("Okapi-claim");
      expect(p).not.toMatch(/^claim:/m);
    }
  });
});
