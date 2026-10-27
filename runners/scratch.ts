// A scratch copy: the only place a proposed change is ever applied.
//
// Plain words: Atlas never edits the code it checks. To try a change, it writes the target's files
// into a fresh temp folder (a "scratch copy"), runs `git apply --check` there (does the diff fit
// these exact bytes?), then `git apply`, and reads the changed files back. Both use --recount: git
// infers each hunk's line counts from its lines instead of trusting the header (models miscount them). The folder is deleted
// afterwards. The repository's own files are never touched.

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

export interface Scratch {
  dir: string;
  /** Remove the folder. Safe to call twice. */
  dispose(): void;
}

function inside(dir: string, rel: string): string {
  const n = normalize(rel);
  if (isAbsolute(n) || n === ".." || n.startsWith(`..${sep}`)) throw new Error(`path "${rel}" leaves the scratch copy`);
  return join(dir, n);
}

/** Write `files` (relative path → text) into a new temp folder that is its own git repository. */
export async function makeScratch(files: Record<string, string>, prefix = "atlas-change-"): Promise<Scratch> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [rel, text] of Object.entries(files)) {
    const full = inside(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  // Its own repository, so `git apply` resolves paths against this folder and never a parent one.
  await git(dir, ["init", "-q"]);
  let gone = false;
  return {
    dir,
    dispose() {
      if (gone) return;
      gone = true;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function git(cwd: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      args,
      { cwd, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", HOME: cwd } },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** `git apply --check`: does the diff apply to the scratch copy's exact bytes? Never changes a file. */
export async function applyCheck(scratch: Scratch, diff: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await git(scratch.dir, ["apply", "--check", "--recount", "--unidiff-zero", "--whitespace=nowarn", "-"], diff);
  if (r.code === 0) return { ok: true };
  const why = r.stderr.trim().split("\n").slice(0, 3).join(" | ").replaceAll(scratch.dir, "<scratch>");
  return { ok: false, reason: `git apply --check refused the diff: ${why || `exit ${r.code}`}` };
}

/** Apply the diff in the scratch copy (after applyCheck passed). */
export async function applyDiff(scratch: Scratch, diff: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const check = await applyCheck(scratch, diff);
  if (!check.ok) return check;
  const r = await git(scratch.dir, ["apply", "--recount", "--unidiff-zero", "--whitespace=nowarn", "-"], diff);
  if (r.code === 0) return { ok: true };
  return { ok: false, reason: `git apply failed: ${r.stderr.trim().split("\n")[0]?.replaceAll(scratch.dir, "<scratch>") ?? `exit ${r.code}`}` };
}

export function readScratch(scratch: Scratch, rel: string): string {
  return readFileSync(inside(scratch.dir, rel), "utf8");
}

/**
 * Apply `diff` to a scratch copy of `files` and return every file's text afterwards.
 * The scratch folder is removed before this returns.
 */
export async function applyInScratch(files: Record<string, string>, diff: string): Promise<{ ok: true; files: Record<string, string> } | { ok: false; reason: string }> {
  const s = await makeScratch(files);
  try {
    const r = await applyDiff(s, diff);
    if (!r.ok) return r;
    const out: Record<string, string> = {};
    for (const rel of Object.keys(files)) out[rel] = readScratch(s, rel);
    return { ok: true, files: out };
  } finally {
    s.dispose();
  }
}
