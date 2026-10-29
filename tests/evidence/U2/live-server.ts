// U2 cold walkthrough, live: the real Atlas server with REAL models: Muse Wonder (muse-wonder-1.0) writes the tests,
// Muse Spark (muse-spark-1.3) and Muse Spark Open (via Baseten) answer the quiz. Spend is capped at $0.50 on the shared
// budget; billed usage goes to ATLAS_USAGE_PATH. Keys are read by server/meta/client.ts and never printed.
// Run: PORT=<port> ATLAS_USAGE_PATH=<scratch usage.jsonl> ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000 pnpm exec tsx tests/evidence/U2/live-server.ts
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import { createMetaClient, loadBasetenKey } from "../../../server/meta/client";

// U2_SPEND_CAP lowers the cap for a second server process (the cap is per process; the batch total must stay under $0.50).
const budget = createModelBudget({ spendCeilingUsd: Math.min(0.5, Number(process.env.U2_SPEND_CAP ?? 0.5)), callsPerHour: 40 });
const real = createMetaClient({ timeoutMs: 300_000, ...(process.env.ATLAS_USAGE_PATH ? { usagePath: process.env.ATLAS_USAGE_PATH } : {}) });
const app = createApp({
  modelBets: { chat: real.chat, budget, sparkOpen: loadBasetenKey() ? { available: true } : { available: false, reason: "no Baseten access on this machine" } },
  paste: { proposer: { chat: real.chat, budget } },
});
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 18861) }, (i) => console.log(`U2 live server on ${i.port}: real Muse Wonder, Muse Spark and Muse Spark Open; spend capped at $0.50`));
