// D07-04 screenshots: the real Atlas server (real gate, real TypeScript sandbox, real Base fork, real judge,
// real seals, real proof cards) with every MODEL call mocked, so a click-through costs $0.
//
// What is mocked, and what each mock answers (every model sentence on screen says it is a mock):
// - Muse Spark's sealed bets (claimant): withRpcRetry → calls 6, total wait 15000 ms, throws; Moonwell →
//   declined. No Meta call.
// - Muse Code's change (fixer, `muse exec`): the diff Muse Code proposed live in D06-01/D20 (cbETHETH_ORACLE →
//   cbETH_ORACLE), and for withRpcRetry a one-line delay change. Reported model id muse-spark-1.3.
// - The Investigator and the Adversary are off ("not asked").
// Nothing is written to proofs/ (files are kept in memory).
//
// Run (BASE_RPC_URL set in the environment for the Moonwell fork):
//   pnpm exec tsx tests/evidence/D07-04/mock-server.ts     then  pnpm exec vite --strictPort
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import { createProofStore } from "../../../server/evm-round";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";
import type { MuseExec } from "../../../server/meta/roles/fixer";

const MOCK = "(mocked for the D07-04 screenshots: no model was called)";
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const text = (a: ChatArgs) => a.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

const chat = async (a: ChatArgs): Promise<ChatResult> => {
  const prompt = text(a);
  if (/priceUsd1e18/.test(prompt)) {
    return { ok: true, finishReason: "stop", usage, content: JSON.stringify({ bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "declined", reason: `unknown: ${MOCK}` }, rationale: MOCK }] }) };
  }
  return {
    ok: true,
    finishReason: "stop",
    usage,
    content: JSON.stringify({
      bets: [
        { measures: "calls", answer: { kind: "integer", value: 6 }, rationale: MOCK },
        { measures: "totalWaitMs", answer: { kind: "integer", value: 15000 }, rationale: MOCK },
        { measures: "outcome", answer: { kind: "enum", value: "throws", options: ["returns", "throws", "pending"] }, rationale: MOCK },
      ],
    }),
  };
};

const MOONWELL_DIFF = `--- a/proposals/ChainlinkOracleConfigs.sol
+++ b/proposals/ChainlinkOracleConfigs.sol
@@ -39,7 +39,7 @@
         //     OracleConfig("CHAINLINK_ETH_USD", "WETH", "MOONWELL_WETH")
         // );
         _oracleConfigs[BASE_CHAIN_ID].push(
-            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")
+            OracleConfig("cbETH_ORACLE", "cbETH", "MOONWELL_cbETH")
         );
         // Composite oracles don't support latestRound(), deferred to follow-up
         // _oracleConfigs[BASE_CHAIN_ID].push(
`;

const museExec: MuseExec = async (req) => {
  const files = Object.keys(req.files);
  if (files.some((f) => f.endsWith("ChainlinkOracleConfigs.sol"))) return { ok: true, model: "muse-spark-1.3", text: "```diff\n" + MOONWELL_DIFF + "```\n" };
  const f = files.find((x) => x.endsWith("with-rpc-retry.ts"));
  if (!f) return { ok: false, reason: "no file this mock knows" };
  const lines = req.files[f]!.split("\n");
  const i = lines.findIndex((l) => /opts\.attempts \?\?/.test(l));
  if (i === -1) return { ok: false, reason: "the mock could not find the attempts line" };
  const n = i + 1;
  const diff = `--- a/${f}\n+++ b/${f}\n@@ -${n},1 +${n},1 @@\n-${lines[i]}\n+${lines[i]!.replace(/\?\? *[A-Za-z0-9_]+/, "?? 6")}\n`;
  return { ok: true, model: "muse-spark-1.3", text: "```diff\n" + diff + "```\n" };
};

const budget = createModelBudget({ spendCeilingUsd: 1 });
const app = createApp({
  proofs: createProofStore({ publish: false, dir: "/nonexistent-not-written" }),
  modelBets: { chat, budget, sparkOpen: { available: false, reason: "turned off for the D07-04 screenshots" } },
  fixer: { museExec, chat, budget },
});
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) }, (i) => console.log(`D07-04 mock-model server on ${i.port}: every model call is mocked ($0); runners, gate and judge are real`));
