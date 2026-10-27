import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createMetaClient, DEFAULT_USAGE_PATH } from "./meta/client";
import { createModelBudget, DEFAULT_CALLS_PER_HOUR, DEFAULT_EXPERIMENTS_PER_SESSION, DEFAULT_SPEND_CEILING_USD, envNumber, readUsageTotal } from "./meta/budget";
import { fileRefusalWriter } from "./proofs/refusals";

const port = Number(process.env.PORT ?? 8787);

// D02-06: the running server asks Muse Spark for its bets on every experiment a person creates.
// ATLAS_MODEL_BETS=off turns that off (no Meta calls, the slot says "not asked").
const modelBetsOn = process.env.ATLAS_MODEL_BETS !== "off";

// S5: limits on model calls. The spend so far is read from the usage log once, at startup.
const usagePath = process.env.ATLAS_USAGE_PATH ?? DEFAULT_USAGE_PATH;
const spentAtStart = readUsageTotal(usagePath);
const budget = createModelBudget({
  callsPerHour: envNumber(process.env.ATLAS_MODEL_CALLS_PER_HOUR, DEFAULT_CALLS_PER_HOUR),
  experimentsPerSession: envNumber(process.env.ATLAS_MODEL_EXPERIMENTS_PER_SESSION, DEFAULT_EXPERIMENTS_PER_SESSION),
  spendCeilingUsd: envNumber(process.env.ATLAS_SPEND_CEILING_USD, DEFAULT_SPEND_CEILING_USD),
  spentAtStartUsd: spentAtStart.usd,
});

// Bets get a shorter deadline than the client's default, so a model that never answers cannot hold
// a person's run for minutes (the run waits for the model's bets before it starts).
const BET_TIMEOUT_MS = 45_000;
const chat = createMetaClient({ timeoutMs: BET_TIMEOUT_MS }).chat;

// S7: the live server writes a public refusal record for every gate refusal and can't-check verdict.
const app = createApp({
  ...(modelBetsOn ? { modelBets: { chat, budget } } : {}),
  refusals: fileRefusalWriter(undefined, (e) => console.error(`could not write a refusal record: ${e instanceof Error ? e.message : String(e)}`)),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Atlas server listening on http://localhost:${info.port} (model bets ${modelBetsOn ? "on" : "off"})`);
  if (modelBetsOn) {
    console.log(`model budget: $${budget.spentUsd().toFixed(2)} already spent (usage log, ${spentAtStart.lines} lines${spentAtStart.skipped ? `, ${spentAtStart.skipped} unreadable` : ""})`);
  }
});
