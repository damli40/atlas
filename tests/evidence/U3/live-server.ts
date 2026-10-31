// U3 cold walkthrough, live: the real Atlas server with REAL models. Spend is capped by U3_SPEND_CAP (dollars); billed
// usage goes to ATLAS_USAGE_PATH. Keys are read by server/meta/client.ts and never printed.
// Run: PORT=<port> U3_SPEND_CAP=0.3 ATLAS_USAGE_PATH=<file> ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000 pnpm exec tsx tests/evidence/U3/live-server.ts
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import { createMetaClient, loadBasetenKey } from "../../../server/meta/client";

const budget = createModelBudget({ spendCeilingUsd: Number(process.env.U3_SPEND_CAP ?? 0.3), callsPerHour: 40 });
const real = createMetaClient({ timeoutMs: 300_000, ...(process.env.ATLAS_USAGE_PATH ? { usagePath: process.env.ATLAS_USAGE_PATH } : {}) });
const app = createApp({
  modelBets: { chat: real.chat, budget, sparkOpen: loadBasetenKey() ? { available: true } : { available: false, reason: "no Baseten access on this machine" } },
  paste: { proposer: { chat: real.chat, budget } },
});
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 18961) }, (i) => console.log(`U3 live server on ${i.port}: real models, spend capped`));
