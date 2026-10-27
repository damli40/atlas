// D02-03: the model go/no-go table, written by plain code.
//
// Run: pnpm exec tsx tests/tools/go-no-go.ts
// Writes tests/evidence/D02-03/go-no-go.md and go-no-go.json (the raw rows).
//
// One row per model, each decided by a plain rule (no judgment):
// 1. muse-wonder-1.0: ONE real, small investigator-style call. GO when the answer parses as JSON and
//    matches the investigator schema ({findings: 1–3 items with file, lineStart, lineEnd, kind,
//    claim, quotedSnippet}). Otherwise NO-GO with the reason.
// 2. muse-spark-1.3: no new call. Cites D02-02b (5 live Claimant calls): GO when at least 4 of 5
//    answers were schema-valid.
// 3. Spark Open on Baseten (meta-models/muse-spark-open-1026): needs a Baseten key in
//    BASETEN_API_KEY or ~/.config/baseten/env. No key → "pending" (never faked). With a key → ONE
//    real call to the OpenAI-style endpoint (path UNVERIFIED) with the same small request; GO only
//    when a schema-valid answer comes back.
//
// Every real call goes through server/meta/client.ts, which appends its usage line to
// tests/evidence/usage/usage.jsonl. Nothing here prints, logs or stores a key or a request header.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chat, createMetaClient, type ChatArgs, type ChatResult } from "../../server/meta/client.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(REPO, "tests", "evidence", "D02-03");
const SPARK_RUNS = join(REPO, "tests", "evidence", "D02-02b", "claimant-5-runs.jsonl");

export const BASETEN_BASE_URL = "https://inference.baseten.co/v1"; // UNVERIFIED path
export const BASETEN_MODEL = "meta-models/muse-spark-open-1026";
const SYSTEM_PREAMBLE =
  "You propose. You never decide. Plain code will run the code and judge. Say 'unknown' instead of guessing. Return only JSON matching the schema.";

/** A short input on purpose: the check is "does a schema-valid answer come back", not quality. */
const SMALL_CODE = [
  "=== retry.ts (lines 1-8)",
  "1| export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {",
  "2|   let last: unknown;",
  "3|   for (let i = 0; i < attempts; i++) {",
  "4|     try { return await fn(); }",
  "5|     catch (e) { last = e; }",
  "6|   }",
  "7|   throw last;",
  "8| }",
].join("\n");

const INVESTIGATOR_TASK =
  "Find up to 3 places where a reader's expectation of what this code does is most likely wrong. These are behaviours, not bugs. " +
  "For each: file, lineStart, lineEnd, kind (retry/price/other), a one-sentence claim written as 'People expect X; the code does Y', " +
  "and quotedSnippet copied exactly from those lines. Return only this JSON object: " +
  '{"findings": [{"file": "...", "lineStart": 1, "lineEnd": 1, "kind": "retry", "claim": "...", "quotedSnippet": "..."}]}';

export const investigatorSchema = z
  .object({
    findings: z
      .array(
        z
          .object({
            file: z.string().min(1),
            lineStart: z.number().int().min(1),
            lineEnd: z.number().int().min(1),
            kind: z.enum(["retry", "price", "other"]),
            claim: z.string().min(1),
            quotedSnippet: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

const messages = [
  { role: "system" as const, content: SYSTEM_PREAMBLE },
  { role: "user" as const, content: `${SMALL_CODE}\n\n${INVESTIGATOR_TASK}` },
];

export interface Row {
  model: string;
  where: string;
  check: string;
  result: "GO" | "NO-GO" | "pending";
  detail: string;
  usd: number | null;
}

/** Plain rule: valid JSON + investigator schema. */
export function schemaVerdict(res: ChatResult): { valid: boolean; detail: string } {
  if (!res.ok) return { valid: false, detail: `call failed: ${res.reason}` };
  let json: unknown;
  try {
    json = JSON.parse(res.content);
  } catch {
    return { valid: false, detail: `answer is not valid JSON (finish_reason ${res.finishReason})` };
  }
  const p = investigatorSchema.safeParse(json);
  if (!p.success) return { valid: false, detail: `JSON does not match the investigator schema: ${p.error.issues[0]?.message ?? "invalid"}` };
  return { valid: true, detail: `schema-valid JSON, ${p.data.findings.length} finding(s), finish_reason ${res.finishReason}` };
}

/** Reads the Baseten key without printing it. Undefined when absent. */
export function loadBasetenKey(): string | undefined {
  if (process.env.BASETEN_API_KEY?.trim()) return process.env.BASETEN_API_KEY.trim();
  const file = join(homedir(), ".config", "baseten", "env");
  if (!existsSync(file)) return undefined;
  const m = readFileSync(file, "utf8").match(/^\s*(?:export\s+)?BASETEN_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
  return m?.[1];
}

/** Spark's D02-02b rate, read from the evidence file. */
export function sparkRate(path = SPARK_RUNS): { valid: number; total: number } {
  const rows = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { ok: boolean });
  return { valid: rows.filter((r) => r.ok).length, total: rows.length };
}

async function wonderRow(): Promise<Row> {
  const args: ChatArgs = { role: "investigator", model: "muse-wonder-1.0", messages, json: true };
  const res = await chat(args);
  const v = schemaVerdict(res);
  return {
    model: "muse-wonder-1.0",
    where: "api.meta.ai",
    check: "1 live investigator-style call, 8-line input; GO if schema-valid JSON",
    result: v.valid ? "GO" : "NO-GO",
    detail: v.detail,
    usd: res.usage?.usd ?? null,
  };
}

function sparkRow(): Row {
  const { valid, total } = sparkRate();
  return {
    model: "muse-spark-1.3",
    where: "api.meta.ai",
    check: "cites D02-02b (5 live Claimant calls); GO if at least 4/5 schema-valid",
    result: valid >= 4 ? "GO" : "NO-GO",
    detail: `${valid}/${total} schema-valid (tests/evidence/D02-02b/claimant-5-runs.jsonl); no new call`,
    usd: null,
  };
}

async function basetenRow(): Promise<Row> {
  const base = { model: BASETEN_MODEL, where: "Baseten (endpoint path UNVERIFIED)", check: "1 live call if a key exists; GO only if schema-valid" };
  const key = loadBasetenKey();
  if (!key) {
    return { ...base, result: "pending", detail: "pending: no Baseten key on this machine (credits not yet claimed); open-weights mode shows \"not available\"", usd: null };
  }
  const client = createMetaClient({ apiKey: key, baseUrl: BASETEN_BASE_URL });
  const res = await client.chat({ role: "investigator", model: BASETEN_MODEL, messages, json: true });
  const v = schemaVerdict(res);
  return { ...base, result: v.valid ? "GO" : "NO-GO", detail: v.detail, usd: res.usage?.usd ?? null };
}

const FALLBACK_CHAIN = [
  "Wonder fails → Spark investigates.",
  "Spark fails → Wonder claims.",
  "Both fail → D0 option B shape: human bets only, still live runs.",
  "Spark Open not available → the open-weights mode switch shows \"not available\"; never faked.",
];

function render(rows: Row[], at: string): string {
  const money = (u: number | null) => (u === null ? "—" : `$${u.toFixed(6)}`);
  return [
    "# D02-03: model go/no-go",
    "",
    `Written by \`tests/tools/go-no-go.ts\` (plain code) at ${at}. Each row is decided by the rule in its "Check" column.`,
    "",
    "| Model | Where | Check | Result | Detail | Cost |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| \`${r.model}\` | ${r.where} | ${r.check} | **${r.result}** | ${r.detail} | ${money(r.usd)} |`),
    "",
    "Costs are upper bounds where the price is unverified (Spark, Baseten); every real call's usage line is in `tests/evidence/usage/usage.jsonl`.",
    "",
    "## Fallback chain (from the build plan, D02-03)",
    "",
    ...FALLBACK_CHAIN.map((l) => `- ${l}`),
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [await wonderRow(), sparkRow(), await basetenRow()];
  const at = new Date().toISOString();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "go-no-go.md"), render(rows, at));
  writeFileSync(join(OUT_DIR, "go-no-go.json"), JSON.stringify({ at, rows, fallbackChain: FALLBACK_CHAIN }, null, 2) + "\n");
  for (const r of rows) console.log(`${r.model}: ${r.result} (${r.detail})`);
}
