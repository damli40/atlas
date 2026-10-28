// E3: shared fixtures for the paste-flow server tests (mocked models; no network, no key, $0).

import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { CALL_OUTCOME_OPTIONS } from "../../src/units";

export const RETRY_SRC = `// a small retry with backoff, as an AI might write it
export async function retryWithBackoff(fetchIt: () => Promise<unknown>, attempts: number = 3, baseMs: number = 100) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchIt();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

export const VERSION = "1";
`;

export const CLAIM = "People expect it to give up right after the last failed try; the code waits once more before it throws (zebra-claim-7731).";
const usage = { promptTokens: 2100, completionTokens: 400, usd: 0.0164 };

export const allowedA = {
  shape: "call-function",
  exportName: "retryWithBackoff",
  args: [
    { kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: { ok: true } }], then: "repeat_last" },
    { kind: "json", value: 3 },
    { kind: "json", value: 100 },
  ],
};
export const refusedB = {
  shape: "call-function",
  exportName: "retryWithBackoff",
  args: [{ kind: "stand-in", name: "fetchIt", async: false, calls: [{ do: "never_settle" }], then: "repeat_last" }],
};
export const allowedC = {
  shape: "call-function",
  exportName: "retryWithBackoff",
  args: [
    { kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "throw", errorName: "TimeoutError", message: "slow" }], then: "repeat_last" },
    { kind: "json", value: 3 },
    { kind: "json", value: 100 },
  ],
};
export const WONDER_ANSWER = JSON.stringify({ claim: CLAIM, experiments: [allowedA, refusedB, allowedC] });

export const SPARK_ANSWER = JSON.stringify({
  bets: [
    { measures: "outcome", answer: { kind: "enum", value: "returned", options: [...CALL_OUTCOME_OPTIONS] }, rationale: "mock" },
    { measures: "returnedJson", answer: { kind: "json", value: { ok: true } }, rationale: "mock" },
    { measures: "virtualMs", answer: { kind: "number", value: 100, tolerancePct: 10, unit: "ms" }, rationale: "mock" },
    { measures: "calls:fetchIt", answer: { kind: "integer", value: 2 }, rationale: "mock" },
  ],
});

/** One mocked chat for every role: Wonder (role investigator) proposes; Spark and Spark Open (role claimant) bet. */
export function mockModels() {
  const calls: ChatArgs[] = [];
  const chat = async (a: ChatArgs): Promise<ChatResult> => {
    calls.push(JSON.parse(JSON.stringify(a)));
    return { ok: true, finishReason: "stop", usage, content: a.role === "investigator" ? WONDER_ANSWER : SPARK_ANSWER };
  };
  return { chat, calls };
}

export function makeApp(over: Parameters<typeof createApp>[0] = {}) {
  const m = mockModels();
  const agentLog = createAgentLog();
  const budget = createModelBudget({ spendCeilingUsd: 5 });
  const app = createApp({
    agentLog,
    modelBets: { chat: m.chat, budget, sparkOpen: { available: true } },
    paste: { proposer: { chat: m.chat } },
    ...over,
  });
  return { app, m, agentLog };
}

export function client(app: ReturnType<typeof createApp>, session?: string) {
  let s: string | null = session ?? null;
  const call = async (method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { "content-type": "application/json", ...headers };
    if (s) h["x-atlas-session"] = s;
    const res = await app.request(path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    s ??= res.headers.get("x-atlas-session");
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return { post: (p: string, b: unknown, h?: Record<string, string>) => call("POST", p, b, h), get: (p: string) => call("GET", p), session: () => s };
}

