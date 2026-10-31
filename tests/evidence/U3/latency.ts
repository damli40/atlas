// U3 item 6: how long Muse Wonder takes to write the first tests, and whether less reasoning cuts it without hurting
// validity. REAL model calls (billed). One call per file per setting, spend stopped at U3_LATENCY_CAP dollars.
// "Valid" = allowed by plain code's gate and the network rule, the same check the page uses.
// Run: U3_EFFORTS=low,minimal U3_LATENCY_CAP=0.15 ATLAS_USAGE_PATH=<file> pnpm exec tsx tests/evidence/U3/latency.ts
import { readFileSync, writeFileSync } from "node:fs";
import { createMetaClient, type ChatArgs } from "../../../server/meta/client";
import { runProposer } from "../../../server/meta/roles/proposer";
import { exportedFunctionsFor } from "../../../src/pasted-code";

const client = createMetaClient({ timeoutMs: 300_000, ...(process.env.ATLAS_USAGE_PATH ? { usagePath: process.env.ATLAS_USAGE_PATH } : {}) });
const efforts = (process.env.U3_EFFORTS ?? "low,minimal").split(",") as NonNullable<ChatArgs["reasoningEffort"]>[];
const cap = Number(process.env.U3_LATENCY_CAP ?? 0.15);
const FILES = [
  { file: "orders.ts", language: "ts" as const, exportName: "fetchAllOrders" },
  { file: "plan_cache.py", language: "py" as const, exportName: "get_user_plan" },
];
const rows: unknown[] = [];
let spent = 0;
for (const effort of efforts)
  for (const f of FILES) {
    if (spent >= cap) continue;
    const source = readFileSync(new URL(`./inputs/${f.file}`, import.meta.url), "utf8");
    const t0 = Date.now();
    const r = await runProposer(
      { source, language: f.language, exportName: f.exportName, exportNames: exportedFunctionsFor(source, f.language).map((e) => e.name) },
      { chat: (a) => client.chat({ ...a, reasoningEffort: effort }) },
    );
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    spent += r.usage?.usd ?? 0;
    const allowed = r.proposals.filter((p) => p.gate.allowed);
    const row = { effort, file: f.file, seconds, ok: r.ok, proposed: r.proposals.length, allowed: allowed.length, twoCall: allowed.filter((p) => Array.isArray((p.params as { calls?: unknown }).calls)).length, refused: r.proposals.filter((p) => !p.gate.allowed).map((p) => (p.gate.allowed ? "" : p.gate.reason.slice(0, 120))), completionTokens: r.usage?.completionTokens ?? null, usd: r.usage?.usd ?? null };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
console.log(`spent $${spent.toFixed(4)}`);
writeFileSync(new URL("./live/latency.json", import.meta.url), `${JSON.stringify({ rows, spentUsd: spent }, null, 2)}\n`);
