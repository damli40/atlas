// X1 live run: one real outline job on a public GitHub folder, end to end, with the real Muse Wonder.
//
//   npx tsx tests/tools/outline-live.ts <owner/repo> <subfolder> [ref] <out.json>
//   OUTLINE_CLONE=<dir of a `git clone` of that repo> npx tsx tests/tools/outline-live.ts ...   (review round 1)
//
// With OUTLINE_CLONE set, the files are read from that local clone at the ref (git ls-tree + git cat-file), with the
// same skip rules, limits and blob ids as server/outline/intake.ts, so no GitHub API call (and no token) is needed.
//
// Reads the folder at one pinned commit (server/outline/intake.ts), builds the code map (plain code), asks
// muse-wonder-1.0 once (one repair at most, behind the code guard and a $3 budget), verifies the outline (plain
// code), seals the outline section and checks the outline-only .atlas.json with verifyOutlineFile.
// Writes a SUMMARY (counts, part and join statuses with reasons, file paths and hashes, usage), never the code.
// The key is read by server/meta/client.ts at run time and never printed.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { OutlineSection } from "../../src/outline/types";
import { createModelBudget } from "../../server/meta/budget";
import { createMetaClient } from "../../server/meta/client";
import { runOutliner } from "../../server/meta/roles/outliner";
import { intakeGithub, parseRepoRequest, skipReason, type Codebase, type RepoRequest } from "../../server/outline/intake";
import { isConfigFile, languageOf } from "../../src/outline/codemap";
import { MAX_OUTLINE_FILE_BYTES, MAX_OUTLINE_FILES, MAX_OUTLINE_TOTAL_BYTES, gitBlobOf, sha256Text } from "../../src/outline/section";
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
// OUTLINE_FROM_SECTION=<saved section>: re-judge a saved run with today's plain code, no model call, no network.
const saved = process.env.OUTLINE_FROM_SECTION ? (JSON.parse(readFileSync(process.env.OUTLINE_FROM_SECTION, "utf8")) as OutlineSection) : null;
const req = parseRepoRequest({ repo, subfolder, ...(ref ? { ref } : {}) });
/** The same reading as intakeGithub, from a local clone at one commit (no network). */
function intakeClone(dir: string, r: RepoRequest): Codebase {
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const commit = git("rev-parse", `${r.ref ?? "HEAD"}^{commit}`).trim();
  const prefix = r.subfolder ? `${r.subfolder}/` : "";
  const rows = git("ls-tree", "-r", "-l", commit, "--", r.subfolder || ".").split("\n").filter(Boolean);
  const files: Codebase["files"] = [];
  const configFiles: Codebase["configFiles"] = [];
  const skipped: Codebase["skipped"] = [];
  for (const row of rows) {
    const [meta, path] = row.split("\t") as [string, string];
    const [mode, type, sha, size] = meta.split(/\s+/);
    const rel = path.slice(prefix.length);
    if (type === "commit") { skipped.push({ path: rel, reason: "a git submodule (another repository)" }); continue; }
    if (mode === "120000") { skipped.push({ path: rel, reason: "a symbolic link" }); continue; }
    const read = () => git("cat-file", "blob", sha!);
    if (isConfigFile(rel) && configFiles.length < 5 && Number(size) <= 20 * 1024) { const text = read(); configFiles.push({ path: rel, sha256: sha256Text(text), bytes: Number(size), text }); continue; }
    const why = skipReason(rel);
    if (why) { skipped.push({ path: rel, reason: why }); continue; }
    if (Number(size) > MAX_OUTLINE_FILE_BYTES) { skipped.push({ path: rel, reason: `${size} bytes; Atlas reads files up to 100 KB` }); continue; }
    const text = read();
    if (gitBlobOf(text) !== sha) throw new Error(`${rel} is not the blob the tree lists`);
    files.push({ path: rel, language: languageOf(rel)!, sha256: sha256Text(text), bytes: Number(size), text, gitBlob: sha! });
  }
  if (files.length > MAX_OUTLINE_FILES || files.reduce((n, f) => n + f.bytes, 0) > MAX_OUTLINE_TOTAL_BYTES) throw new Error("over the 50-file / 300 KB limit");
  return { source: { kind: "github", repo: `${r.owner}/${r.repo}`, ...(r.ref ? { requestedRef: r.ref } : {}), commit, subfolder: r.subfolder }, files, configFiles, skipped };
}

const codebase: Codebase = saved
  ? { source: saved.source, files: saved.files, configFiles: saved.configFiles ?? [], skipped: saved.skipped }
  : process.env.OUTLINE_CLONE
    ? intakeClone(process.env.OUTLINE_CLONE, req)
    : await intakeGithub(req);
const codeMap = buildCodeMap(codebase.files, codebase.configFiles, codebase.skipped.map((x) => x.path));
const files = [...codebase.files].sort((a, b) => (a.path < b.path ? -1 : 1));
const codeSha256 = codebaseSha256(files);
const label = `${req.owner}/${req.repo}@${codebase.source.kind === "github" ? codebase.source.commit.slice(0, 12) : ""}${req.subfolder ? ` (${req.subfolder})` : ""}`;
console.log(`read ${files.length} files (${files.reduce((n, f) => n + f.bytes, 0)} bytes), skipped ${codebase.skipped.length}; code map: ${codeMap.edges.length} edges, ${codeMap.externals.length} outside packages`);

const budget = createModelBudget({ spendCeilingUsd: 3, callsPerHour: 4 });
const chat = budget.wrap(createMetaClient({ timeoutMs: 300_000 }).chat);
const r = saved
  ? saved.wonder.outline
    ? ({ ok: true, model: saved.wonder.model, outline: saved.wonder.outline, attempts: saved.wonder.attempts } as const)
    : ({ ok: false, model: saved.wonder.model, reason: saved.wonder.failure ?? "", attempts: saved.wonder.attempts } as const)
  : await runOutliner({ files, codeMap, label, codeSha256 }, { chat });
const section = makeOutlineSection({
  source: codebase.source,
  files,
  configFiles: codebase.configFiles,
  skipped: codebase.skipped,
  codeMap,
  wonder: r.ok ? { model: r.model, outline: r.outline, attempts: r.attempts } : { model: r.model, outline: null, attempts: r.attempts, failure: r.reason },
});
const check = verifyOutlineFile({ version: 1, kind: "outline", outline: section, createdAt: new Date().toISOString() });
const v = section.verified;
const summary = {
  ranAt: new Date().toISOString(),
  ...(saved ? { rejudgedFrom: "a saved section of the live run: same files and Wonder answer, today's plain code, no model call" } : {}),
  seconds: Math.round((Date.now() - t0) / 1000),
  source: section.source,
  codeSha256: section.codeSha256,
  files: section.files.map((f) => ({ path: f.path, language: f.language, bytes: f.bytes, sha256: f.sha256 })),
  skipped: section.skipped,
  codeMap: { files: codeMap.files.length, edges: codeMap.edges.length, callEdges: codeMap.edges.filter((e) => e.kind === "calls").length, externals: codeMap.externals.map((e) => e.name), unresolved: codeMap.files.flatMap((f) => f.imports.filter((i) => i.target.kind === "unresolved").map((i) => `${f.path}:${i.line} ${i.specifier}`)), parseNotes: codeMap.files.filter((f) => f.parseNotes.length).map((f) => ({ path: f.path, notes: f.parseNotes })) },
  wonder: { model: section.wonder.model, attempts: section.wonder.attempts, ...(section.wonder.failure ? { failure: section.wonder.failure } : {}) },
  counts: v?.counts ?? null,
  parts: v?.parts.map((p) => ({ id: p.id, status: p.status, name: p.name.text, purposeByModel: p.purpose.text, files: p.files, ranges: p.spans.map((s) => `${s.path}:${s.lineStart}-${s.lineEnd}${s.wholeFile ? " (whole file)" : ""}${s.ok ? "" : " (not confirmed)"}`), reasons: p.reasons, patterns: p.patterns })) ?? [],
  splitFiles: v ? [...new Set(v.parts.flatMap((p) => p.spans.filter((s) => !s.wholeFile).map((s) => s.path)))].sort() : [],
  joins: v?.joins.map((j) => ({ id: j.id, from: j.from, to: j.to, kind: j.kind, status: j.status, codeEdges: j.codeEdges.length, ...(j.typeOnly ? { typeOnly: true } : {}), ...(j.reason ? { reason: j.reason } : {}), ...(j.wonderEvidence ? { wonderEvidenceMatches: j.wonderEvidence.matches } : {}) })) ?? [],
  notInAnyPart: v?.notInAnyPart ?? [],
  usage: section.usage,
  verifyOutlineFile: check.ok ? "ok" : check.problems,
};
writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
// The full section (it holds the code) only where the caller says, e.g. a scratch folder outside the repo.
if (process.env.OUTLINE_SAVE_SECTION) writeFileSync(process.env.OUTLINE_SAVE_SECTION, JSON.stringify(section) + "\n");
console.log(JSON.stringify({ counts: summary.counts, usage: summary.usage, attempts: summary.wonder.attempts.length, verify: summary.verifyOutlineFile, notInAnyPart: summary.notInAnyPart.length }, null, 1));
