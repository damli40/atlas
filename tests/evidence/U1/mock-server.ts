// U1 screenshots and the $0 click-through: the real Atlas server (real paste reader and file outline, gate, quiz
// builder, sandbox, judge, seals, proof file; real outline jobs for the explorer) with every MODEL call mocked, so a run
// costs $0. Each mocked model sentence says it is a mock.
// - Muse Wonder (test proposals for the U1 example's fetchWithRetry): one allowed test, one the gate refuses.
// - Muse Spark / Muse Spark Open (quiz bets): fixed letters, so the marks show matched and didn't match.
// - Muse Wonder (outline): the X2 saved answer for server/meta at 058ab2a.
//
// Run: PORT=<port> pnpm exec tsx tests/evidence/U1/mock-server.ts   then   ATLAS_API_PORT=<port> pnpm exec vite --port <port2> --strictPort
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";
import { intakeClone } from "../../tools/intake-clone";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const MOCK = "(mocked for the U1 screenshots: no model was called)";
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const WONDER_OUTLINE = readFileSync(join(ROOT, "tests/fixtures/outline/wonder-server-meta-058ab2a.json"), "utf8");
export const U1_TEST = {
  shape: "call-function",
  exportName: "fetchWithRetry",
  args: [
    {
      kind: "stand-in",
      name: "fetchIt",
      async: true,
      calls: [
        { do: "throw", errorName: "TimeoutError", message: "slow source" },
        { do: "throw", errorName: "TimeoutError", message: "slow source" },
        { do: "return", value: { price: 42 }, afterMs: 300 },
      ],
      then: "repeat_last",
    },
    { kind: "json", value: 3 },
    { kind: "json", value: 100 },
  ],
};
const PROPOSALS = {
  claim: `People expect three tries with short waits; the waits double, so the whole call takes longer than they think. ${MOCK}`,
  experiments: [U1_TEST, { shape: "call-function", exportName: "fetchWithRetry", args: [{ kind: "stand-in", name: "fetchIt", async: false, calls: [{ do: "never_settle" }], then: "repeat_last" }] }],
};
/** Spark picks (a) everywhere; Spark Open picks (b) everywhere. */
export const mockChat = async (a: ChatArgs): Promise<ChatResult> => {
  const all = a.messages.map((m) => m.content).join("\n");
  if (a.role === "outliner") return { ok: true, finishReason: "stop", usage, content: WONDER_OUTLINE };
  if (a.role === "investigator") return { ok: true, finishReason: "stop", usage, content: JSON.stringify(PROPOSALS) };
  const qs = [...all.matchAll(/measures "([^"]+)"/g)].map((m) => m[1]!);
  const letter = /open/i.test(a.model ?? "") ? "b" : "a";
  return { ok: true, finishReason: "stop", usage, content: JSON.stringify({ bets: qs.map((m) => ({ measures: m, answer: { kind: "quiz", choice: letter }, rationale: MOCK })) }) };
};

if (process.argv[1]?.endsWith("mock-server.ts")) {
  const budget = createModelBudget({ spendCeilingUsd: 5 });
  const app = createApp({
    modelBets: { chat: mockChat, budget, sparkOpen: { available: true } },
    paste: { proposer: { chat: mockChat } },
    outline: { outliner: { chat: mockChat }, readGithub: async (r) => intakeClone(ROOT, r) },
  });
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8798) }, (i) => console.log(`U1 mock-model server on ${i.port}: every model call is mocked ($0)`));
}
