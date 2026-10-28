// X2: reads a folder of a local git clone at one commit, with the same skip rules, limits and blob checks as
// server/outline/intake.ts (copied from tests/tools/outline-live.ts intakeClone). The $0 browser runs and the server
// round-trip test use it as the outline job's GitHub reader, so they need no network.
import { execFileSync } from "node:child_process";
import { skipReason, type Codebase, type RepoRequest } from "../../server/outline/intake";
import { isConfigFile, languageOf } from "../../src/outline/codemap";
import { MAX_OUTLINE_FILE_BYTES, MAX_OUTLINE_FILES, MAX_OUTLINE_TOTAL_BYTES, gitBlobOf, sha256Text } from "../../src/outline/section";

export function intakeClone(dir: string, r: RepoRequest): Codebase {
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
