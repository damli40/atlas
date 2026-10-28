// X3 browser click-through: the real Atlas server (real paste flow, gate, sandbox, judge, seals, proof files, outline
// intake, code map and checks, track-record store, label routes) with every MODEL call mocked, so a run costs $0.
// Each mocked model sentence says it is a mock.
// - Muse Wonder (outline): one part, "Retry helper", over the whole uploaded retry.ts, tagged retry and rpc-call.
// - Muse Wonder (test proposals): test 1 fetchIt fails once then answers; test 2 fetchIt never answers.
// - Muse Spark (bets): returned, 100 ms, 2 calls; declines the returned value.
// The track record is kept on disk in X3_TRACK_DIR (a scratch folder), like the hosted server keeps it.
//
// Run: PORT=<port> X3_TRACK_DIR=<scratch> pnpm exec tsx tests/evidence/X3/mock-server.ts
//      then ATLAS_API_PORT=<port> pnpm exec vite --port <port2> --strictPort
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";
import { diskTrackStore, memoryTrackStore } from "../../../server/track-store";
import { PASTE_EXAMPLE } from "../../../web/paste-example";
import { CALL_OUTCOME_OPTIONS } from "../../../src/units";

const MOCK = "(mocked for the X3 click-through: no model was called)";
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const lines = PASTE_EXAMPLE.split("\n").length - 1;
const OUTLINE = JSON.stringify({
  parts: [{ id: "retry", name: "Retry helper", purpose: `Retries a flaky call with a growing wait. ${MOCK}`, files: [{ path: "retry.ts", lineStart: 1, lineEnd: lines, quotedSnippet: PASTE_EXAMPLE.split("\n")[0] }], patterns: ["retry", "rpc-call"] }],
  joins: [],
});
const stand = (calls: unknown[]) => ({ kind: "stand-in", name: "fetchIt", async: true, calls, then: "repeat_last" });
const PROPOSALS = JSON.stringify({
  claim: `People expect a call that never answers to be given up on; the code waits for it forever. ${MOCK}`,
  experiments: [
    { shape: "call-function", exportName: "retryWithBackoff", args: [stand([{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: { ok: true } }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }] },
    { shape: "call-function", exportName: "retryWithBackoff", args: [stand([{ do: "never_settle" }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }] },
  ],
});

export const mockChat = async (a: ChatArgs): Promise<ChatResult> => {
  if (a.role === "outliner") return { ok: true, finishReason: "stop", usage, content: OUTLINE };
  if (a.role === "investigator") return { ok: true, finishReason: "stop", usage, content: PROPOSALS };
  const all = a.messages.map((m) => m.content).join("\n");
  const qs = [...all.matchAll(/measures "([^"]+)"/g)].map((m) => m[1]!);
  const bet = (m: string) =>
    m === "outcome"
      ? { measures: m, answer: { kind: "enum", value: "returned", options: [...CALL_OUTCOME_OPTIONS] }, rationale: MOCK }
      : m === "virtualMs"
        ? { measures: m, answer: { kind: "number", value: 100, tolerancePct: 10, unit: "ms" }, rationale: MOCK }
        : m.startsWith("calls:")
          ? { measures: m, answer: { kind: "integer", value: 2 }, rationale: MOCK }
          : { measures: m, answer: { kind: "declined", reason: `unknown: ${MOCK}` }, rationale: MOCK };
  return { ok: true, finishReason: "stop", usage, content: JSON.stringify({ bets: qs.map(bet) }) };
};

if (process.argv[1]?.endsWith("mock-server.ts")) {
  const budget = createModelBudget({ spendCeilingUsd: 5 });
  const dir = process.env.X3_TRACK_DIR;
  const app = createApp({
    modelBets: { chat: mockChat, budget, sparkOpen: { available: false, reason: "turned off for the X3 click-through" } },
    paste: { proposer: { chat: mockChat } },
    outline: { outliner: { chat: mockChat } },
    trackStore: dir ? diskTrackStore(dir) : memoryTrackStore(),
  });
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8799) }, (i) => console.log(`X3 mock-model server on ${i.port}: every model call is mocked ($0); runners, gate, judge, seals, track store and labels are real`));
}
