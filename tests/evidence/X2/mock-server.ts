// X2 screenshots and the $0 browser click-through: the real Atlas server (real outline job: intake rules, code map
// in its own process, plain-code verification; real paste flow, gate, sandbox, judge and seals) with every MODEL call
// mocked, so a run costs $0. Each mocked model sentence says it is a mock.
// - Muse Wonder (outline): answers with the outline Wonder really gave for server/meta at 058ab2a
//   (tests/fixtures/outline/wonder-server-meta-058ab2a.json), so plain code checks a real answer.
// - The GitHub reader reads this repository's own git history at the asked commit (no network, same rules).
// - Muse Wonder (test proposals for redactSecret): two tests, the second refused by the gate on purpose.
// - Muse Spark (bets): answers the first proposed test; declines every other question.
//
// Run: PORT=8798 pnpm exec tsx tests/evidence/X2/mock-server.ts   then   ATLAS_API_PORT=8798 pnpm exec vite --port 5184 --strictPort
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";
import { intakeClone } from "../../tools/intake-clone";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const MOCK = "(mocked for the X2 screenshots: no model was called)";
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const WONDER_OUTLINE = readFileSync(join(ROOT, "tests/fixtures/outline/wonder-server-meta-058ab2a.json"), "utf8");
const text = (v: unknown) => ({ kind: "json", value: v });
export const SECRET = "bt-abc123def456ghi789";
const PROPOSALS = {
  claim: `People expect only the whole key to be removed; the code also removes any 12-character piece of it. ${MOCK}`,
  experiments: [
    { shape: "call-function", exportName: "redactSecret", args: [text(`Invalid API key ${SECRET.slice(0, 15)}... refused`), text(SECRET)] },
    { shape: "call-function", exportName: "redactSecret", args: [{ kind: "stand-in", name: "never", async: false, calls: [{ do: "never_settle" }], then: "repeat_last" }] },
  ],
};

export const mockChat = async (a: ChatArgs): Promise<ChatResult> => {
  const all = a.messages.map((m) => m.content).join("\n");
  if (a.role === "outliner") return { ok: true, finishReason: "stop", usage, content: WONDER_OUTLINE };
  if (a.role === "investigator") return { ok: true, finishReason: "stop", usage, content: JSON.stringify(PROPOSALS) };
  const qs = [...all.matchAll(/measures "([^"]+)"/g)].map((m) => m[1]!);
  const known = all.includes(SECRET.slice(0, 15));
  return {
    ok: true,
    finishReason: "stop",
    usage,
    content: JSON.stringify({
      bets: qs.map((m) =>
        known && m === "outcome"
          ? { measures: m, answer: { kind: "enum", value: "returned", options: ["returned", "threw", "never_settled", "still_running_at_watch_limit"] }, rationale: MOCK }
          : known && m === "returnedJson"
            ? { measures: m, answer: { kind: "json", value: "Invalid API key [redacted]... refused" }, rationale: MOCK }
            : { measures: m, answer: { kind: "declined", reason: `unknown: ${MOCK}` }, rationale: MOCK },
      ),
    }),
  };
};

if (process.argv[1]?.endsWith("mock-server.ts")) {
  const budget = createModelBudget({ spendCeilingUsd: 5 });
  const app = createApp({
    modelBets: { chat: mockChat, budget, sparkOpen: { available: false, reason: "turned off for the X2 screenshots" } },
    paste: { proposer: { chat: mockChat } },
    outline: { outliner: { chat: mockChat }, readGithub: async (r) => intakeClone(ROOT, r) },
  });
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8798) }, (i) => console.log(`X2 mock-model server on ${i.port}: every model call is mocked ($0); intake, code map, checks, runners, gate and judge are real`));
}
