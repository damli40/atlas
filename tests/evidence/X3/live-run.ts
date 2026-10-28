// X3 LIVE: the one paid check of this batch (cap $0.30). Real Muse Wonder and Muse Spark 1.3 through the real routes,
// in-process; the sandbox, gate, judge, seals, proof files, track store and labels are real.
// 1. Paste a small retry function with no overall deadline. Labels: "no overall timeout" should be "found in this code".
// 2. Round 1 with the script's own test (fetchIt fails once, then answers). The "person" is this script: its bets are
//    fixed below, chosen before any model answered (outcome threw, 500 ms, 1 call), so its record has misses.
// 3. Ask Muse Wonder for tests: its prompt carries the weak-spot summary (types and counts only).
// 4. Round 2 on Wonder's test whose stand-in never answers, if it proposed one; otherwise the script's own such test
//    (said in the output). Labels again: the label should flip to "reproduced", linked to round 2's proof card.
// Keys are read at run time from ~/.config (never printed). Usage lines go to tests/evidence/X3/live/usage.jsonl.
//
// Run: X3_LIVE=1 pnpm exec tsx tests/evidence/X3/live-run.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import { createMetaClient, type ChatArgs } from "../../../server/meta/client";
import { memoryTrackStore } from "../../../server/track-store";

if (process.env.X3_LIVE !== "1") {
  console.error("refusing to spend money: set X3_LIVE=1");
  process.exit(1);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "live");
mkdirSync(OUT, { recursive: true });
const usagePath = join(OUT, "usage.jsonl");
const CODE = `// Retry a call until it works or the tries run out.
export async function withRetry(call: () => Promise<unknown>, tries: number = 3) {
  let lastError: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await call();
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastError;
}
`;
const client = createMetaClient({ usagePath, timeoutMs: 180_000 });
const wonderPrompts: string[] = [];
const chat = async (a: ChatArgs) => {
  if (a.role === "investigator") wonderPrompts.push(a.messages.map((m) => m.content).join("\n"));
  return client.chat(a);
};
const budget = createModelBudget({ spendCeilingUsd: 0.3 });
const app = createApp({ modelBets: { chat, budget, sparkOpen: { available: false, reason: "Spark only in this check" }, deadlineMs: 180_000 }, paste: { proposer: { chat, budget } }, trackStore: memoryTrackStore() });

let session: string | null = null;
const BROWSER = "bX3LiveCheck0000000001";
const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const headers: Record<string, string> = { "content-type": "application/json", "x-atlas-browser": BROWSER };
  if (session) headers["x-atlas-session"] = session;
  const res = await app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  session ??= res.headers.get("x-atlas-session");
  return { status: res.status, json: await res.json() };
};
const say = (...a: unknown[]) => console.log(...a);
const ntOf = (labels: any) => labels.json.labels.find((l: any) => l.failure === "no-overall-timeout");

const paste = await call("POST", "/paste", { code: CODE });
const target = paste.json.target;
const fn = "withRetry";
const labels0 = await call("POST", "/paste/labels", { target, exportName: fn });
say("labels before any run:", ntOf(labels0)?.label, JSON.stringify(ntOf(labels0)?.lines));

async function round(params: unknown | null, proposalId: string | null, bets: unknown[]) {
  const e = await call("POST", "/experiments", { target, ...(proposalId ? { proposalId } : { params }) });
  if (e.status !== 200) throw new Error(`experiment: ${e.status} ${JSON.stringify(e.json).slice(0, 300)}`);
  const id = e.json.experiment.id;
  const answerable = new Set(e.json.questions.map((q: any) => q.measures));
  const b = await call("POST", "/bets", { experimentId: id, who: "human", bets: (bets as any[]).filter((x) => answerable.has(x.measures)) });
  if (b.status !== 200) throw new Error(`bets: ${b.status} ${JSON.stringify(b.json)}`);
  await call("POST", `/experiments/${id}/model-bets`, {});
  const r = await call("POST", "/runs", { experimentId: id });
  if (r.status !== 200) throw new Error(`run: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  say(`round ${id}: run ${r.json.run.id}`, JSON.stringify(r.json.run.result.measured));
  for (const v of r.json.verdicts) {
    const bet = r.json.bets.find((x: any) => x.id === v.betId);
    say(`  ${bet.who} ${bet.measures}: ${JSON.stringify(bet.answer)} → ${v.outcome}`);
  }
  return r.json;
}
const stand = (calls: unknown[]) => ({ kind: "stand-in", name: "call", async: true, calls, then: "repeat_last" });
const r1 = await round({ shape: "call-function", exportName: fn, args: [stand([{ do: "throw", errorName: "Error", message: "flaky" }, { do: "return", value: "ok" }]), { kind: "json", value: 3 }] }, null, [
  { measures: "outcome", answer: { kind: "enum", value: "threw" } },
  { measures: "virtualMs", answer: { kind: "number", value: 500 } },
  { measures: "calls:call", answer: { kind: "integer", value: 1 } },
]);
say("record after round 1:", JSON.stringify(r1.track.after.lines));

const props = await call("POST", "/paste/proposals", { target, exportName: fn });
say("Wonder told:", props.json.aimedAt);
const prompt = wonderPrompts[0] ?? "";
say("Wonder prompt carries the summary:", prompt.includes("THIS PERSON'S EARLIER ROUNDS"), "| holds round 1's test values:", /flaky/.test(prompt));
for (const p of props.json.proposals) say(`  proposal ${p.id}: ${p.gate.allowed ? `allowed: ${p.says}` : `refused: ${p.gate.reason}`}`);
const never = props.json.proposals.find((p: any) => p.gate.allowed && JSON.stringify(p.params).includes("never_settle"));
say(never ? `round 2 uses Wonder's test ${never.id} (a stand-in that never answers)` : "Wonder proposed no allowed never-answers test: round 2 uses the script's own");
const r2 = await round(never ? null : { shape: "call-function", exportName: fn, args: [stand([{ do: "never_settle" }]), { kind: "json", value: 3 }] }, never?.id ?? null, [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }]);
const labels2 = await call("POST", "/paste/labels", { target, exportName: fn });
const nt2 = ntOf(labels2);
say("labels after round 2:", nt2?.label, nt2?.runId, nt2?.why);
const proof = await call("GET", `/proofs/${r2.run.id}`);
say("proof card for that run:", proof.status);
say(`spent: $${budget.spentUsd().toFixed(4)}`);
writeFileSync(join(OUT, "live-run.json"), JSON.stringify({ code: CODE, labelsBefore: labels0.json, round1: { measured: r1.run.result.measured, track: r1.track }, proposals: props.json, wonderPromptHasSummary: prompt.includes("THIS PERSON'S EARLIER ROUNDS"), round2: { usedWonder: !!never, measured: r2.run.result.measured, runId: r2.run.id, proof: r2.proof }, labelsAfter: labels2.json, proofStatus: proof.status, spentUsd: budget.spentUsd() }, null, 2) + "\n");
