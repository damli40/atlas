// D03-04 evidence: fetch PR #578 at its merge commit with server/targets/github.ts, compare each
// file to the committed copy in contracts/lib/moonwell/, and write the result as JSON.
// Usage: pnpm exec tsx tests/tools/github-target-check.ts <out.json>
// Needs the internet. GITHUB_TOKEN is optional and never written.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchGithubPr, MOONWELL_PR_578 } from "../../server/targets/github";

const out = process.argv[2];
if (!out) throw new Error("usage: github-target-check.ts <out.json>");
const COPY_DIR = join(import.meta.dirname, "..", "..", "contracts", "lib", "moonwell");

const r = await fetchGithubPr({ ...MOONWELL_PR_578, expectCommit: MOONWELL_PR_578.commit });
const files = r.files.map((f) => {
  const copy = join(COPY_DIR, f.path);
  const copySha = existsSync(copy) ? createHash("sha256").update(readFileSync(copy)).digest("hex") : null;
  return {
    path: f.path,
    status: f.status,
    lines: f.lines ?? null,
    sizeBytes: f.sizeBytes,
    binary: f.binary,
    fetchedSha256: f.sha256,
    committedCopySha256: copySha,
    copy: copySha === null ? "not copied" : copySha === f.sha256 ? "matched" : "didn't match",
  };
});
const report = {
  fetchedAt: new Date().toISOString(),
  target: r.target,
  title: r.title,
  mergedAt: r.mergedAt,
  changedFiles: r.changedFiles,
  fingerprintRule: 'for each fetched file sorted by path: UTF-8(path) + "\\n" + bytes + "\\n"; SHA-256 of the whole',
  files,
  skipped: r.skipped,
};
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
for (const f of files) console.log(`${f.copy.padEnd(13)} ${String(f.lines).padStart(5)} lines  ${f.fetchedSha256}  ${f.path}`);
console.log(`codeSha256 ${r.target.codeSha256}  commit ${r.target.commit}  files ${files.length}/${r.changedFiles}`);
