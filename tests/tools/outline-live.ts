// X1 live run: one real outline job on a public GitHub folder, end to end, with the real Muse Wonder.
//
//   npx tsx tests/tools/outline-live.ts <owner/repo> <subfolder> [ref] <out.json>
//
// Reads the folder at one pinned commit (server/outline/intake.ts), builds the code map (plain code), asks
// muse-wonder-1.0 once (one repair at most, behind the code guard and a $3 budget), verifies the outline (plain
// code), seals the outline section and checks the outline-only .atlas.json with verifyOutlineFile.
// Writes a SUMMARY (counts, part and join statuses with reasons, file paths and hashes, usage), never the code.
// The key is read by server/meta/client.ts at run time and never printed.

import { writeFileSync } from "node:fs";
import { createModelBudget } from "../../server/meta/budget";
import { createMetaClient } from "../../server/meta/client";
import { runOutliner } from "../../server/meta/roles/outliner";
import { intakeGithub, parseRepoRequest } from "../../server/outline/intake";
import { buildCodeMap } from "../../src/outline/codemap";
import { codebaseSha256, makeOutlineSection, verifyOutlineFile } from "../../src/outline/section";

const [repo, subfolder, a3, a4] = process.argv.slice(2);
const out = a4 ?? a3;
const ref = a4 ? a3 : undefined;
if (!repo || subfolder === undefined || !out) {
  console.error("usage: outline-live.ts <owner/repo> <subfolder> [ref] <out.json>");
  process.exit(2);
}

const t0 = Date.now();
const req = parseRepoRequest({ repo, subfolder, ...(ref ? { ref } : {}) });
const codebase = await intakeGithub(req);
const codeMap = buildCodeMap(codebase.files);
const files = [...codebase.files].sort((a, b) => (a.path < b.path ? -1 : 1));
const codeSha256 = codebaseSha256(files);
const label = `${req.owner}/${req.repo}@${codebase.source.kind === "github" ? codebase.source.commit.slice(0, 12) : ""}${req.subfolder ? ` (${req.subfolder})` : ""}`;
console.log(`read ${files.length} files (${files.reduce((n, f) => n + f.bytes, 0)} bytes), skipped ${codebase.skipped.length}; code map: ${codeMap.edges.length} edges, ${codeMap.externals.length} outside packages`);

const budget = createModelBudget({ spendCeilingUsd: 3, callsPerHour: 4 });
const chat = budget.wrap(createMetaClient({ timeoutMs: 300_000 }).chat);
const r = await runOutliner({ files, codeMap, label, codeSha256 }, { chat });
const section = makeOutlineSection({
  source: codebase.source,
  files,
  skipped: codebase.skipped,
  codeMap,
  wonder: r.ok ? { model: r.model, outline: r.outline, attempts: r.attempts } : { model: r.model, outline: null, attempts: r.attempts, failure: r.reason },
});
const check = verifyOutlineFile({ version: 1, kind: "outline", outline: section, createdAt: new Date().toISOString() });
const v = section.verified;
const summary = {
  ranAt: new Date().toISOString(),
  seconds: Math.round((Date.now() - t0) / 1000),
  source: section.source,
  codeSha256: section.codeSha256,
  files: section.files.map((f) => ({ path: f.path, language: f.language, bytes: f.bytes, sha256: f.sha256 })),
  skipped: section.skipped,
  codeMap: { files: codeMap.files.length, edges: codeMap.edges.length, callEdges: codeMap.edges.filter((e) => e.kind === "calls").length, externals: codeMap.externals.map((e) => e.name), unresolved: codeMap.files.flatMap((f) => f.imports.filter((i) => i.target.kind === "unresolved").map((i) => `${f.path}:${i.line} ${i.specifier}`)), parseNotes: codeMap.files.filter((f) => f.parseNotes.length).map((f) => ({ path: f.path, notes: f.parseNotes })) },
  wonder: { model: section.wonder.model, attempts: section.wonder.attempts, ...(section.wonder.failure ? { failure: section.wonder.failure } : {}) },
  counts: v?.counts ?? null,
  parts: v?.parts.map((p) => ({ id: p.id, status: p.status, name: p.name.text, purposeByModel: p.purpose.text, files: p.files, reasons: p.reasons, patterns: p.patterns })) ?? [],
  joins: v?.joins.map((j) => ({ id: j.id, from: j.from, to: j.to, kind: j.kind, status: j.status, codeEdges: j.codeEdges.length, ...(j.reason ? { reason: j.reason } : {}), ...(j.wonderEvidence ? { wonderEvidenceMatches: j.wonderEvidence.matches } : {}) })) ?? [],
  notInAnyPart: v?.notInAnyPart ?? [],
  usage: section.usage,
  verifyOutlineFile: check.ok ? "ok" : check.problems,
};
writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ counts: summary.counts, usage: summary.usage, attempts: summary.wonder.attempts.length, verify: summary.verifyOutlineFile, notInAnyPart: summary.notInAnyPart.length }, null, 1));
