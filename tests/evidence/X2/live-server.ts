// X2 live end-to-end: the real Atlas server with the REAL Muse Wonder for the outline (one paid call, reserved on the
// shared budget) and the bet half mocked (Wonder's test proposals and Muse Spark's bets: tests/evidence/X2/mock-server.ts
// mockChat), as the task allows "mocked or real models" for the bet. Everything else is real: GitHub intake pinned to
// the commit, code map in its own process, plain-code checks, paste route, gate, sandbox, judge, seals.
// Billed usage goes to ATLAS_USAGE_PATH (the key is read by server/meta/client.ts and never printed).
//
// Run: PORT=<port> ATLAS_USAGE_PATH=<scratch usage.jsonl> pnpm exec tsx tests/evidence/X2/live-server.ts
import { serve } from "@hono/node-server";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import { createMetaClient } from "../../../server/meta/client";
import { mockChat } from "./mock-server";

const budget = createModelBudget({ spendCeilingUsd: 2.5, callsPerHour: 4 });
const real = createMetaClient({ timeoutMs: 300_000, ...(process.env.ATLAS_USAGE_PATH ? { usagePath: process.env.ATLAS_USAGE_PATH } : {}) });
const app = createApp({
  modelBets: { chat: mockChat, budget, sparkOpen: { available: false, reason: "turned off for the X2 live run (bets mocked)" } },
  paste: { proposer: { chat: mockChat } },
  outline: { outliner: { chat: real.chat, budget } },
});
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8812) }, (i) => console.log(`X2 live server on ${i.port}: the outline asks the real muse-wonder-1.0; test proposals and bets are mocked ($0)`));
