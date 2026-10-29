// U1 live run: the real Atlas server with REAL models on the drawing-first screen: Muse Wonder (muse-wonder-1.0)
// proposes the tests, Muse Spark (muse-spark-1.3) and Muse Spark Open (via Baseten) answer the quiz. Everything else is
// real too: paste reader, file outline, gate, quiz builder, sandbox, judge, seals, proof file. Spend is capped at $1 on
// the shared budget; billed usage goes to ATLAS_USAGE_PATH. Keys are read by server/meta/client.ts and never printed.
//
// Run: PORT=<port> ATLAS_USAGE_PATH=<scratch usage.jsonl> pnpm exec tsx tests/evidence/U1/live-server.ts
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import { createMetaClient, loadBasetenKey } from "../../../server/meta/client";

const budget = createModelBudget({ spendCeilingUsd: 1, callsPerHour: 12 });
const real = createMetaClient({ timeoutMs: 300_000, ...(process.env.ATLAS_USAGE_PATH ? { usagePath: process.env.ATLAS_USAGE_PATH } : {}) });
const app = createApp({
  modelBets: { chat: real.chat, budget, sparkOpen: loadBasetenKey() ? { available: true } : { available: false, reason: "no Baseten access on this machine" } },
  paste: { proposer: { chat: real.chat, budget } },
});
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8813) }, (i) => console.log(`U1 live server on ${i.port}: real Muse Wonder, Muse Spark and Muse Spark Open; spend capped at $1`));
