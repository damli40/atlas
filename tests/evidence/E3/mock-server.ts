// E3 screenshots and the browser click-through: the real Atlas server (real gate, real sandbox, real judge, real
// seals, real proof cards) with every MODEL call mocked, so a click-through costs $0. Each mocked model sentence
// says it is a mock.
// - Muse Wonder (proposals): three tests for retryWithBackoff, the second one refused by the gate on purpose.
// - Muse Spark (bets): returned, {"ok":true}, 100 ms, 2 calls. Muse Spark Open: off on this server.
// Nothing is written to proofs/ (pasted rounds are always kept in memory only).
//
// Run: PORT=8797 pnpm exec tsx tests/evidence/E3/mock-server.ts   then   ATLAS_API_PORT=8797 pnpm exec vite --port 5183 --strictPort
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";

const MOCK = "(mocked for the E3 screenshots: no model was called)";
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const fetchIt = (calls: unknown[]) => ({ kind: "stand-in", name: "fetchIt", async: true, calls, then: "repeat_last" });
const WONDER = {
  claim: `People expect it to give up right after the last failed try; the code waits once more before it throws. ${MOCK}`,
  experiments: [
    { shape: "call-function", exportName: "retryWithBackoff", args: [fetchIt([{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: { ok: true } }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }] },
    { shape: "call-function", exportName: "retryWithBackoff", args: [{ kind: "stand-in", name: "fetchIt", async: false, calls: [{ do: "never_settle" }], then: "repeat_last" }] },
    { shape: "call-function", exportName: "retryWithBackoff", args: [fetchIt([{ do: "throw", errorName: "TimeoutError", message: "slow" }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }] },
  ],
};
const SPARK = {
  bets: [
    { measures: "outcome", answer: { kind: "enum", value: "returned", options: ["returned", "threw", "never_settled", "still_running_at_watch_limit"] }, rationale: MOCK },
    { measures: "returnedJson", answer: { kind: "json", value: { ok: true } }, rationale: MOCK },
    { measures: "virtualMs", answer: { kind: "number", value: 100, tolerancePct: 10, unit: "ms" }, rationale: MOCK },
    { measures: "calls:fetchIt", answer: { kind: "integer", value: 2 }, rationale: MOCK },
  ],
};
const chat = async (a: ChatArgs): Promise<ChatResult> => {
  const text = a.messages.map((m) => m.content).join("\n");
  if (a.role === "investigator") return { ok: true, finishReason: "stop", usage, content: JSON.stringify(WONDER) };
  // Bets on any other pasted test: decline every question honestly (the mock knows only the example's first test).
  if (!text.includes("fetchIt (async) throws TimeoutError (\"slow\") on call 1, then returns")) {
    const qs = [...text.matchAll(/measures "([^"]+)"/g)].map((m) => m[1]!);
    return { ok: true, finishReason: "stop", usage, content: JSON.stringify({ bets: qs.map((m) => ({ measures: m, answer: { kind: "declined", reason: `unknown: ${MOCK}` }, rationale: MOCK })) }) };
  }
  return { ok: true, finishReason: "stop", usage, content: JSON.stringify(SPARK) };
};

const budget = createModelBudget({ spendCeilingUsd: 1 });
const app = createApp({
  modelBets: { chat, budget, sparkOpen: { available: false, reason: "turned off for the E3 screenshots" } },
  paste: { proposer: { chat } },
});
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8797) }, (i) => console.log(`E3 mock-model server on ${i.port}: every model call is mocked ($0); runners, gate and judge are real`));
