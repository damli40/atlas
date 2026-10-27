import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { chat } from "./meta/client";

const port = Number(process.env.PORT ?? 8787);

// D02-06: the running server asks Muse Spark for its bets on every experiment a person creates.
// ATLAS_MODEL_BETS=off turns that off (no Meta calls, the slot says "not asked").
const modelBetsOn = process.env.ATLAS_MODEL_BETS !== "off";
const app = createApp(modelBetsOn ? { modelBets: { chat } } : {});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Atlas server listening on http://localhost:${info.port} (model bets ${modelBetsOn ? "on" : "off"})`);
});
