// B1 review (B-2, M-5): what each benchmark pre-registered, and content hashes that survive a rebase.
//
// Plain words: a commit SHA changes when history is rebased; the files' contents do not. So each result records
// (1) a hash of the registration's CONTENTS (every registered file's path and SHA-256), and (2) the SHA-256 of every
// file that produced it (the classifier, the bench runner, the corpus loader, and every file under runners/ plus the
// src/ files the runner uses). tests/unit/bench-order.test.ts recomputes both from git and compares.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const sha256Of = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

export interface BenchRegistration {
  name: string;
  /** Registered paths (files or folders), committed alone before any result. */
  prereg: string[];
  /** The one expectations / corpus file the runner may read. */
  corpus: string;
  results: string;
  /** Bench-owned scoring code: a change after the first result must be logged in bench/TOOLING-CHANGES.md. */
  scoring: string[];
}

export const REGISTRATIONS: BenchRegistration[] = [
  {
    name: "truth",
    prereg: ["bench/truth/PASS-RULE.md", "bench/truth/expected.json", "bench/truth/cases"],
    corpus: "bench/truth/expected.json",
    results: "bench/truth/results",
    scoring: ["bench/truth/classify.ts", "bench/truth/run.ts", "bench/lib"],
  },
  {
    name: "truth-2",
    prereg: ["bench/truth-2/PASS-RULE.md", "bench/truth-2/expected.json", "bench/truth-2/cases"],
    corpus: "bench/truth-2/expected.json",
    results: "bench/truth-2/results",
    scoring: ["bench/truth/classify.ts", "bench/truth/run.ts", "bench/lib"],
  },
  {
    name: "models",
    prereg: ["bench/models/PASS-RULE.md", "bench/models/corpus.json", "bench/models/cases", "bench/models/bet-context.ts"],
    corpus: "bench/models/corpus.json",
    results: "bench/models/results",
    scoring: ["bench/models/run.ts", "bench/models/validate.ts", "bench/lib"],
  },
];

export const TOOLING_LOG = "bench/TOOLING-CHANGES.md";

/** The src/ and bench/ files a bench T run depends on, besides every file under runners/. */
export const TOOLING_EXTRA = [
  "bench/truth/classify.ts",
  "bench/truth/run.ts",
  "bench/lib/corpus.ts",
  "bench/lib/registration.ts",
  "src/gate.ts",
  "src/seal.ts",
  "src/pasted-code.ts",
  "src/pasted-python.ts",
  "src/types.ts",
];

export const inPaths = (path: string, paths: readonly string[]) => paths.some((p) => path === p || path.startsWith(`${p}/`));

/** sha256 over "path\0sha256(content)\n" lines, sorted by path. */
export function contentHash(files: readonly { path: string; sha256: string }[]): string {
  return sha256Of([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => `${f.path}\0${f.sha256}\n`).join(""));
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** Tracked files under `paths`, read from the working tree. */
export function workingFiles(root: string, paths: readonly string[]): { path: string; sha256: string }[] {
  const list = git(root, "ls-files", "-z", "--", ...paths).split("\0").filter(Boolean);
  return list.map((p) => ({ path: p, sha256: sha256Of(readFileSync(join(root, p))) }));
}

/** Files under `paths` in a commit's tree. */
export function committedFiles(root: string, commit: string, paths: readonly string[]): { path: string; sha256: string }[] {
  const list = git(root, "ls-tree", "-r", "-z", "--name-only", commit, "--", ...paths).split("\0").filter(Boolean);
  return list.map((p) => ({ path: p, sha256: sha256Of(execFileSync("git", ["show", `${commit}:${p}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })) }));
}

/** The tooling a bench T run records: every tracked file under runners/, plus TOOLING_EXTRA. */
export function toolingHashes(root: string): Record<string, string> {
  return Object.fromEntries(workingFiles(root, ["runners", ...TOOLING_EXTRA]).map((f) => [f.path, f.sha256]));
}
