// E3 LIVE: one whole paste round with the REAL Meta models, through the real routes, in-process.
// Muse Wonder (muse-wonder-1.0) proposes tests; Muse Spark 1.3 and Muse Spark Open (Baseten) bet ("both" mode);
// the sandbox, the gate, the judge, the seals and the proof file are real. Keys are read at run time from
// ~/.config (never printed). Every call's usage goes to tests/evidence/E3/live/usage.jsonl.
// Spend is capped by a model budget of $2.50 for this script (this batch's limit is $3).
//
// Run: E3_LIVE=1 pnpm exec tsx tests/evidence/E3/live-run.ts
// The "person" in this run is this script: it seals one bet (outcome: returned) before the run, fixed in the code
// below, chosen before any model answered. It is labelled as such in the README.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../server/app";
import { createModelBudget } from "../../../server/meta/budget";
import { createMetaClient, loadBasetenKey } from "../../../server/meta/client";
import { verifyAtlasFile } from "../../../src/atlasfile";
import type { AtlasFile, Bet, Run, Verdict } from "../../../src/types";

if (process.env.E3_LIVE !== "1") {
  console.error("refusing to spend money: set E3_LIVE=1");
  process.exit(1);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "live");
mkdirSync(OUT, { recursive: true });
const usagePath = join(OUT, "usage.jsonl");

const CODE = readFileSync(join(HERE, "../../../web/paste-example.ts"), "utf8").match(/`([\s\S]*)`;/)![1]!.replace(/\\`/g, "`");

const chat = createMetaClient({ usagePath, timeoutMs: 180_000 }).chat;
const budget = createModelBudget({ spendCeilingUsd: 2.5 });
const sparkOpen = loadBasetenKey() ? { available: true as const } : { available: false as const, reason: "no Baseten key on this machine" };
const app = createApp({ modelBets: { chat, budget, sparkOpen, deadlineMs: 180_000 }, paste: { proposer: { chat } } });

let session: string | null = null;
const call = async <T,>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: T }> => {
  const headers: Record<string, string> = { "content-type": "application/json", "x-atlas-claimant": "both" };
  if (session) headers["x-atlas-session"] = session;
  const res = await app.request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  session ??= res.headers.get("x-atlas-session");
  return { status: res.status, json: (await res.json()) as T };
};

const t0 = new Date().toISOString();
const paste = await call<{ target: { ref: string; codeSha256: string }; exports: { name: string }[]; language: unknown }>("POST", "/paste", { code: CODE });
console.log("paste:", paste.status, JSON.stringify(paste.json.language), paste.json.exports.map((e) => e.name));
const target = paste.json.target;

type Props = { ok: boolean; reason?: string; proposals: { id: string; params: unknown; gate: { allowed: boolean; reason?: string }; says?: string }[]; usage: unknown };
const props = await call<Props>("POST", "/paste/proposals", { target, exportName: "retryWithBackoff" });
console.log("proposals status:", props.status, JSON.stringify(props.json).slice(0, 400));
console.log("proposals:", props.json.ok, props.json.reason ?? "", props.json.proposals.map((p) => (p.gate.allowed ? `allowed: ${p.says}` : `refused: ${p.gate.reason}`)));
const first = props.json.proposals.find((p) => p.gate.allowed);
if (!first) {
  writeFileSync(join(OUT, "live-run.json"), JSON.stringify({ startedAt: t0, paste: paste.json, proposals: props.json, stoppedBecause: "no proposal was allowed" }, null, 2) + "\n");
  console.log("no allowed proposal; stopped. spent $", budget.spentUsd().toFixed(4));
  process.exit(0);
}

type ExpAns = { experiment: { id: string; proposedBy: unknown }; questions: { measures: string; text: string }[]; seenContext: string; models: unknown };
const exp = await call<ExpAns>("POST", "/experiments", { target, proposalId: first.id });
console.log("experiment:", exp.status, exp.json.experiment.id, exp.json.questions.map((q) => q.measures));
const id = exp.json.experiment.id;
const bets = await call<{ bets: unknown[] }>("POST", "/bets", { experimentId: id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
console.log("person's bet sealed:", bets.status);
const slots = await call<{ models: { display: string; status: string; reason?: string; sealed: unknown[] }[] }>("POST", `/experiments/${id}/model-bets`, {});
console.log("model slots:", slots.json.models.map((m) => `${m.display}: ${m.status}${m.reason ? ` (${m.reason})` : ""}, ${m.sealed.length} sealed`));
type RunAns = { run: Run; verdicts: Verdict[]; bets: Bet[]; proof: { ok: boolean; runId: string }; models: unknown };
const run = await call<RunAns>("POST", "/runs", { experimentId: id });
// E3 review B2: the claim opens only once every bet is frozen (the run started). The recorded live run (before this
// fix) read it right after the person's seal; that order is now refused with 409.
const claim = await call<{ claim?: string; error?: string }>("POST", "/paste/claim", { experimentId: id });
console.log("run:", run.status, JSON.stringify(run.json.run.result.measured), "control", run.json.run.controlPassed);
const verdicts = run.json.verdicts.map((v) => {
  const b = run.json.bets.find((x) => x.id === v.betId)!;
  return { who: b.who, measures: b.measures, answer: b.answer, outcome: v.outcome, observed: v.observed ?? null, ...(v.reason ? { reason: v.reason } : {}), rationale: b.rationale ?? null };
});
for (const v of verdicts) console.log(`  ${v.who} ${v.measures}: ${JSON.stringify(v.answer)} → ${v.outcome}`);
const proof = await call<AtlasFile>("GET", `/proofs/${run.json.run.id}`);
const verified = verifyAtlasFile(proof.json);
const replay = await call<{ measuredEqual: boolean; sameOutcomes: boolean; controlPassed: boolean }>("GET", `/replay/${run.json.run.id}`);
console.log("proof verifies:", verified.ok, "replay:", JSON.stringify(replay.json && { measuredEqual: replay.json.measuredEqual, sameOutcomes: replay.json.sameOutcomes }));

const lines = readFileSync(usagePath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { ts: string; role: string; model: string; promptTokens: number; completionTokens: number; reasoningTokens: number | null; usd: number; priceVerified: boolean });
const mine = lines.filter((l) => l.ts >= t0);
const total = mine.reduce((n, l) => n + l.usd, 0);
writeFileSync(
  join(OUT, "live-run.json"),
  JSON.stringify(
    {
      startedAt: t0,
      finishedAt: new Date().toISOString(),
      code: CODE,
      paste: paste.json,
      proposals: props.json,
      used: first.id,
      experiment: exp.json.experiment,
      questions: exp.json.questions,
      seenContext: exp.json.seenContext,
      claimAfterSeal: claim.json,
      modelSlots: slots.json.models,
      run: run.json.run,
      verdicts,
      proofVerifies: verified.ok,
      replay: replay.json,
      usage: mine,
      totalUsd: total,
      budgetSpentUsd: budget.spentUsd(),
    },
    null,
    2,
  ) + "\n",
);
console.log(`calls: ${mine.length}; total $${total.toFixed(4)} (${mine.map((l) => `${l.model} ${l.role} ${l.promptTokens}+${l.completionTokens} $${l.usd.toFixed(4)}${l.priceVerified ? "" : " (price unverified, upper bound)"}`).join("; ")})`);
process.exit(0);
