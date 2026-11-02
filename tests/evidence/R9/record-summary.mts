// R9: records the built-in example's file summary ONCE, with one real Muse Wonder call, through the same role and checker as any file
// (server/meta/roles/summarizer.ts, src/file-summary.ts). The usage line is appended to tests/evidence/usage/usage.jsonl by the real client.
// Keys are read by the client and never printed.
//   pnpm exec tsx tests/evidence/R9/record-summary.mts <out.json>
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createMetaClient } from "../../../server/meta/client";
import { buildSummarizerMessages, runSummarizer } from "../../../server/meta/roles/summarizer";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";
import { fileOutline } from "../../../src/file-outline";
import { U1_EXAMPLE } from "../../../web/u1-example";

const out = process.argv[2];
if (!out) throw new Error("usage: record-summary.mts <out.json>");
const parts = fileOutline(U1_EXAMPLE, "ts").parts;
const box: { raw: { content: string | null; usd: number | null; promptTokens: number | null; completionTokens: number | null } | null } = { raw: null };
const real = createMetaClient().chat;
const chat = async (a: ChatArgs): Promise<ChatResult> => {
  const r = await real(a);
  box.raw = { content: r.ok ? r.content : null, usd: r.usage?.usd ?? null, promptTokens: r.usage?.promptTokens ?? null, completionTokens: r.usage?.completionTokens ?? null };
  return r;
};
const r = await runSummarizer({ source: U1_EXAMPLE, language: "ts", parts }, { chat });
const promptSha256 = createHash("sha256").update(JSON.stringify(buildSummarizerMessages({ source: U1_EXAMPLE, language: "ts", parts }))).digest("hex");
writeFileSync(out, JSON.stringify({ recordedAt: new Date().toISOString(), promptSha256, raw: box.raw, checked: r }, null, 2));
console.log(r.ok ? `summary kept (${Object.keys(r.summary.parts).length} part lines, ${r.refused} refused), $${box.raw?.usd ?? "?"}` : `no summary: ${r.reason}, $${box.raw?.usd ?? "?"}`);
