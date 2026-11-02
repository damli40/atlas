// R7 (D69): records the built-in example's round ONCE, with real Meta model calls, so the first screen can show it with no
// network call that can fail and no cost. It drives the real server in-process exactly as the page does: paste the example,
// ask for its natural names (kept, no call), ask Muse Wonder for tests (one real call), make the round on Wonder's first
// allowed test with one question (src/quiz.ts oneQuestion), and let Muse Spark and Muse Spark Open bet (real calls).
// Nobody answers anything here: these answers are sealed from the bettors' text before any person has answered.
// Every call's usage is appended to tests/evidence/usage/usage.jsonl by the real client. Keys are read by the client and
// never printed.
//   pnpm exec tsx tests/evidence/R7/record-example.mts <out.json>
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createApp } from "../../../server/app";
import { createMetaClient, loadBasetenKey } from "../../../server/meta/client";
import { createModelBudget } from "../../../server/meta/budget";
import { BET_TIMEOUT_MS } from "../../../server/wiring";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";
import { U1_EXAMPLE } from "../../../web/u1-example";

const out = process.argv[2];
if (!out) throw new Error("usage: record-example.mts <out.json>");
const calls: { role: string; model: string; promptSha256: string; content: string | null; usd: number | null }[] = [];
const recording = (chat: (a: ChatArgs) => Promise<ChatResult>) => async (a: ChatArgs): Promise<ChatResult> => {
  const r = await chat(a);
  calls.push({ role: a.role, model: a.model ?? "", promptSha256: createHash("sha256").update(JSON.stringify(a.messages)).digest("hex"), content: r.ok ? r.content : null, usd: r.usage?.usd ?? null });
  return r;
};
const budget = createModelBudget({ spendCeilingUsd: 1, callsPerHour: 50 });
const sparkOpen = loadBasetenKey() ? { available: true as const } : { available: false as const, reason: "no Baseten access on this machine" };
const app = createApp({
  modelBets: { chat: recording(createMetaClient({ timeoutMs: BET_TIMEOUT_MS }).chat), budget, sparkOpen },
  paste: { proposer: { chat: recording(createMetaClient().chat), budget } },
});
const headers = { "content-type": "application/json", "x-atlas-session": "ss_r7_record_example", "x-atlas-claimant": "both" };
const post = async (path: string, body: unknown) => {
  const r = await app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const j = (await r.json()) as Record<string, unknown>;
  if (r.status >= 400) throw new Error(`${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const pasted = (await post("/paste", { code: U1_EXAMPLE, language: "ts" })) as { target: { ref: string; codeSha256: string } };
const target = { ref: pasted.target.ref, codeSha256: pasted.target.codeSha256 };
await post("/paste/names", { target });
const props = (await post("/paste/proposals", { target, exportName: "fetchWithRetry" })) as { proposals: { id: string; gate: { allowed: boolean }; params: unknown }[] };
const first = props.proposals.find((p) => p.gate.allowed);
if (!first) throw new Error("Muse Wonder gave no allowed test");
const exp = (await post("/experiments", { target, proposalId: first.id, quiz: true, one: true })) as { experiment: { id: string; params: unknown }; questions: { measures: string }[]; seenContext: string };
const slots = (await post(`/experiments/${exp.experiment.id}/model-bets`, {})) as { models?: { model: string; status: string; reason?: string }[] };
writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), test: exp.experiment.params, questions: exp.questions.map((q) => q.measures), seenSha256: createHash("sha256").update(exp.seenContext).digest("hex"), slots: slots.models?.map((s) => ({ model: s.model, status: s.status, reason: s.reason })), calls }, null, 2));
console.log(`recorded ${calls.length} calls, $${calls.reduce((n, c) => n + (c.usd ?? 0), 0).toFixed(4)}; slots: ${slots.models?.map((s) => `${s.model} ${s.status}`).join(", ")}`);
