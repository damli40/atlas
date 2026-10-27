// Live acceptance for D01-07: one trivial JSON request to muse-spark-1.3.
// Run: pnpm exec tsx tests/evidence/D01-07/live-call.ts
// Writes live-call.json (model, finish reason, usage only) next to this file.
import { writeFileSync } from "node:fs";
import { chat } from "../../../server/meta/client";

const r = await chat({
  role: "claimant",
  model: "muse-spark-1.3",
  json: true,
  messages: [
    { role: "system", content: "Return only JSON." },
    { role: "user", content: 'Return exactly {"ok": true}.' },
  ],
});
const out = r.ok
  ? { model: "muse-spark-1.3", finish_reason: r.finishReason, usage: r.usage }
  : { model: "muse-spark-1.3", error: r.reason, usage: r.usage ?? null };
writeFileSync(new URL("./live-call.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
