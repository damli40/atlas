// U2 click-through at $0: the real Atlas server (paste reader, outline, gate, quiz, sandbox, judge, seals, proof file)
// with every MODEL call mocked. Each mocked sentence says it is a mock.
// - Muse Wonder (tests for the walkthrough's two files): for fetchWithRetry, a degenerate test (retries -1, no fake), a
//   test without the network fake (plain code refuses it), and one whose fake fails twice then answers; for run_all, a
//   rate-0.5 test (the hang) and an ordinary one.
// - Muse Spark / Muse Spark Open: fixed letters (a / b).
// Run: PORT=<port> pnpm exec tsx tests/evidence/U2/mock-server.ts   then   ATLAS_API_PORT=<port> pnpm exec vite --port <port2> --strictPort
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";

const MOCK = "(mocked for the U2 click-through: no model was called)";
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const url = { kind: "json", value: "https://api.example.com/data" };
const FETCH = {
  claim: `People expect fetchWithRetry to give up right after its last failed try; the code sleeps a full backoff after the final attempt too. ${MOCK}`,
  experiments: [
    { shape: "call-function", exportName: "fetchWithRetry", args: [url, { kind: "json", value: {} }, { kind: "json", value: -1 }], network: { replaces: "fetch", calls: [{ do: "respond", status: 200, body: { ok: true } }], then: "repeat_last" } },
    { shape: "call-function", exportName: "fetchWithRetry", args: [url, { kind: "json", value: {} }, { kind: "json", value: 2 }] },
    {
      shape: "call-function",
      exportName: "fetchWithRetry",
      args: [url, { kind: "json", value: {} }, { kind: "json", value: 3 }],
      network: { replaces: "fetch", calls: [{ do: "respond", status: 503, body: { error: "busy" } }, { do: "never_answer" }, { do: "respond", status: 200, body: { items: [1, 2, 3] } }], then: "repeat_last" },
    },
  ],
};
const PY = {
  claim: `People expect run_all to accept any positive rate and just run slower; with a rate below 1 the limiter never reaches one token and waits forever. ${MOCK}`,
  experiments: [
    { shape: "call-function", exportName: "run_all", args: [{ kind: "json", value: [1, 2, 3] }, { kind: "json", value: 2 }] },
    { shape: "call-function", exportName: "run_all", args: [{ kind: "json", value: [1, 2, 3] }, { kind: "json", value: 0.5 }], watchLimitMs: 10000 },
  ],
};
export const mockChat = async (a: ChatArgs): Promise<ChatResult> => {
  const all = a.messages.map((m) => m.content).join("\n");
  if (a.role === "investigator") return { ok: true, finishReason: "stop", usage, content: JSON.stringify(/run_all/.test(all) ? PY : FETCH) };
  const qs = [...all.matchAll(/measures "([^"]+)"/g)].map((m) => m[1]!);
  const letter = /open/i.test(a.model ?? "") ? "b" : "a";
  return { ok: true, finishReason: "stop", usage, content: JSON.stringify({ bets: qs.map((m) => ({ measures: m, answer: { kind: "quiz", choice: letter }, rationale: MOCK })) }) };
};

const budget = createModelBudget({ spendCeilingUsd: 5 });
const app = createApp({ modelBets: { chat: mockChat, budget, sparkOpen: { available: true } }, paste: { proposer: { chat: mockChat } } });
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 18851) }, (i) => console.log(`U2 mock-model server on ${i.port}: every model call is mocked ($0)`));
