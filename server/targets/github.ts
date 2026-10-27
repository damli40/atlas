// GitHub target: fetch the files a merged pull request changed, exactly as they are at the PR's
// merge commit, and fingerprint them.
//
// What it does, in order:
// 1. Reads the PR from the public GitHub API (api.github.com). If the PR is not merged it stops
//    with a plain reason: there is no merge commit to pin the files to.
// 2. Lists the PR's changed files (paged, 100 per page) and checks the list is complete against
//    the PR's own `changed_files` count.
// 3. Downloads each file's raw bytes AT THE MERGE COMMIT from raw.githubusercontent.com.
//    A file the PR removed has no bytes at that commit: it is skipped and listed with a note.
//    A binary file (a NUL byte, or bytes that are not valid UTF-8) keeps its bytes in the
//    fingerprint but gets no text and no line count.
// 4. Computes codeSha256 over the files in path order (exact rule below).
//
// Token: optional. `opts.token` or the GITHUB_TOKEN environment variable, sent only to
// api.github.com as an Authorization header. It is never logged and never put in an error.
// Without it, GitHub allows 60 API requests per hour per IP; one fetch uses 2 or more.
//
// Errors are thrown as GithubTargetError with a `kind` and a plain-language message.

import { createHash } from "node:crypto";
import type { Target } from "../../src/types";

/**
 * The fingerprint rule (codeSha256), exactly:
 *   files = every changed file that was fetched (removed files are excluded),
 *           sorted by path in JavaScript's default string order (UTF-16 code units;
 *           identical to byte order for ASCII paths)
 *   input = for each file in that order:  UTF-8(path) + "\n" + <raw file bytes> + "\n"
 *   codeSha256 = lowercase hex SHA-256(input)
 * Nothing else goes in: no status, no separators between files beyond the two "\n" above.
 */
export function codeSha256Of(files: ReadonlyArray<{ path: string; bytes: Uint8Array }>): string {
  const h = createHash("sha256");
  const nl = new Uint8Array([0x0a]);
  for (const f of sortByPath(files)) {
    h.update(new TextEncoder().encode(f.path));
    h.update(nl);
    h.update(f.bytes);
    h.update(nl);
  }
  return h.digest("hex");
}

export function sortByPath<T extends { path: string }>(files: ReadonlyArray<T>): T[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Lines as an editor numbers them: a final "\n" does not start a new line. 0 for an empty file. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

export type GithubTargetErrorKind =
  | "not_merged"
  | "rate_limited"
  | "not_found"
  | "commit_mismatch"
  | "incomplete_list"
  | "too_large"
  | "http"
  | "network";

export class GithubTargetError extends Error {
  readonly kind: GithubTargetErrorKind;
  constructor(kind: GithubTargetErrorKind, message: string) {
    super(message);
    this.name = "GithubTargetError";
    this.kind = kind;
  }
}

export interface GithubPrFile {
  path: string;
  /** GitHub's status for the file in this PR: added, modified, renamed, copied, changed. */
  status: string;
  sha256: string;
  sizeBytes: number;
  binary: boolean;
  /** UTF-8 text; absent for binary files. */
  content?: string;
  /** Absent for binary files. */
  lines?: number;
}

export interface GithubPrSkipped {
  path: string;
  status: string;
  note: string;
}

export interface GithubPrTarget {
  target: Target;
  /** Sorted by path: the same order the fingerprint uses. */
  files: GithubPrFile[];
  /** Files the PR changed that have no bytes at the merge commit (removed), with a note. */
  skipped: GithubPrSkipped[];
  /** The PR's own changed-file count from the API. */
  changedFiles: number;
  title: string;
  mergedAt: string;
}

export interface FetchPrOptions {
  owner: string;
  repo: string;
  number: number;
  /** If set, the PR's merge commit must equal this, or the fetch fails (commit_mismatch). */
  expectCommit?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  /** Per-request time limit. Default 20 s. */
  timeoutMs?: number;
  /** Per-file size limit. Default 5 MB. */
  maxFileBytes?: number;
}

/** The PR Atlas's Moonwell story is about. */
export const MOONWELL_PR_578 = {
  owner: "moonwell-fi",
  repo: "moonwell-contracts-v2",
  number: 578,
  commit: "9a6738e189fa903bffa0abf10b9dd7ed2fe73a18",
} as const;

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const MAX_PAGES = 30; // GitHub lists at most 3000 files per PR

export async function fetchGithubPr(opts: FetchPrOptions): Promise<GithubPrTarget> {
  const doFetch = opts.fetchImpl ?? fetch;
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? undefined;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;
  const ref = `${opts.owner}/${opts.repo}#${opts.number}`;

  const get = async (url: string, api: boolean): Promise<Response> => {
    const headers: Record<string, string> = { "User-Agent": "atlas-github-target" };
    if (api) {
      headers.Accept = "application/vnd.github+json";
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const why = e instanceof Error && e.name === "TimeoutError" ? `no answer in ${timeoutMs} ms` : "the request failed";
      throw new GithubTargetError("network", `Could not reach ${new URL(url).host}: ${why}. Check the internet connection.`);
    }
    if (res.ok) return res;
    throw await httpError(res, url, ref);
  };

  // 1. The PR.
  const prRes = await get(`${API}/repos/${opts.owner}/${opts.repo}/pulls/${opts.number}`, true);
  const pr = (await prRes.json()) as {
    merged?: boolean;
    merge_commit_sha?: string | null;
    changed_files?: number;
    title?: string;
    merged_at?: string | null;
  };
  if (!pr.merged || !pr.merge_commit_sha || !pr.merged_at) {
    throw new GithubTargetError(
      "not_merged",
      `Pull request ${ref} is not merged, so it has no merge commit to read the files at. Atlas only reads merged pull requests.`,
    );
  }
  const commit = pr.merge_commit_sha;
  if (opts.expectCommit && commit !== opts.expectCommit) {
    throw new GithubTargetError(
      "commit_mismatch",
      `Pull request ${ref} merged at ${commit}, not the expected ${opts.expectCommit}.`,
    );
  }
  const changedFiles = pr.changed_files ?? 0;

  // 2. The changed-file list.
  const listed: Array<{ filename: string; status: string }> = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await get(
      `${API}/repos/${opts.owner}/${opts.repo}/pulls/${opts.number}/files?per_page=100&page=${page}`,
      true,
    );
    const batch = (await res.json()) as Array<{ filename: string; status: string }>;
    listed.push(...batch);
    if (batch.length < 100) break;
  }
  if (listed.length !== changedFiles) {
    throw new GithubTargetError(
      "incomplete_list",
      `GitHub listed ${listed.length} files for ${ref} but the pull request says it changed ${changedFiles}. Refusing a partial fingerprint.`,
    );
  }

  // 3. The bytes at the merge commit, in path order.
  const files: GithubPrFile[] = [];
  const skipped: GithubPrSkipped[] = [];
  const hashed: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const f of sortByPath(listed.map((x) => ({ path: x.filename, status: x.status })))) {
    if (f.status === "removed") {
      skipped.push({ path: f.path, status: f.status, note: "removed by this pull request: no bytes at the merge commit" });
      continue;
    }
    const url = `${RAW}/${opts.owner}/${opts.repo}/${commit}/${f.path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await get(url, false);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxFileBytes) {
      throw new GithubTargetError("too_large", `${f.path} is ${bytes.length} bytes, over the ${maxFileBytes}-byte limit.`);
    }
    hashed.push({ path: f.path, bytes });
    const text = decodeText(bytes);
    files.push({
      path: f.path,
      status: f.status,
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.length,
      binary: text === null,
      ...(text === null ? {} : { content: text, lines: countLines(text) }),
    });
  }

  return {
    target: { kind: "github-pr", ref, commit, codeSha256: codeSha256Of(hashed) },
    files,
    skipped,
    changedFiles,
    title: pr.title ?? "",
    mergedAt: pr.merged_at,
  };
}

/** UTF-8 text, or null when the bytes look binary (a NUL byte, or not valid UTF-8). */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function httpError(res: Response, url: string, ref: string): Promise<GithubTargetError> {
  const host = new URL(url).host;
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (res.status === 429 || (res.status === 403 && remaining === "0")) {
    const when = reset && /^\d+$/.test(reset) ? ` It resets at ${new Date(Number(reset) * 1000).toISOString()}.` : "";
    return new GithubTargetError(
      "rate_limited",
      `GitHub's rate limit was reached (${host}, HTTP ${res.status}). Without a token GitHub allows 60 requests an hour.${when} Set GITHUB_TOKEN or wait.`,
    );
  }
  if (res.status === 404) {
    return new GithubTargetError("not_found", `GitHub has no ${host === "api.github.com" ? `pull request ${ref}` : "such file at that commit"} (HTTP 404).`);
  }
  return new GithubTargetError("http", `GitHub answered HTTP ${res.status} for a request to ${host}.`);
}
