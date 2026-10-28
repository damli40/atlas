// X1: reading a small codebase for the explorer, from a public GitHub repo or from files a person uploaded.
//
// Plain words:
// - Limits (D29): at most 50 source files (.js .jsx .mjs .cjs .ts .tsx .mts .cts .py), 300 KB in total, 100 KB per file. Every
//   other file is skipped and listed with the reason (not a source file, a declaration file, minified, a symbolic
//   link, a submodule, a dependency folder, over the per-file cap, not UTF-8 text, a path with odd characters).
//   More than 50 source files, or more than 300 KB, is refused as a whole with the reason ("choose a subfolder"):
//   half a codebase would give an outline that looks complete and is not.
// - GitHub: Atlas pins the request to one commit (the ref the person named, else the default branch), lists the
//   repo's files at that commit in one call, picks the files under the chosen subfolder, and downloads each from
//   raw.githubusercontent.com AT THAT COMMIT. Each download is checked against the git blob hash GitHub listed
//   (SHA-1 of "blob <size>\0<bytes>"), so a file cannot change between the listing and the download.
// - tsconfig.json / jsconfig.json (at most 5, 20 KB each) are kept beside the code, read for path aliases only.
// - Nothing is written to disk: the files live in the server's memory for the job and in the outline proof file
//   the person downloads. The code is never committed and never logged (log lines say counts and fingerprints).
// - Token: optional GITHUB_TOKEN, sent only to api.github.com, never logged (as server/targets/github.ts).

import { createHash } from "node:crypto";
import { visibleText } from "../../src/gate";
import { isConfigFile, languageOf } from "../../src/outline/codemap";
import { MAX_CONFIG_FILE_BYTES, MAX_CONFIG_FILES, MAX_OUTLINE_FILE_BYTES, MAX_OUTLINE_FILES, MAX_OUTLINE_TOTAL_BYTES, gitBlobOf, pathProblem, sha256Text, utf8Length } from "../../src/outline/section";
import type { ConfigFile, OutlineFile, OutlineSource, SkippedFile } from "../../src/outline/types";
import { decodeText } from "../targets/github";
import { plural } from "../../src/words";

export type IntakeErrorKind = "bad_input" | "not_found" | "rate_limited" | "too_many" | "too_large" | "empty" | "network" | "http" | "integrity";

export class OutlineIntakeError extends Error {
  readonly kind: IntakeErrorKind;
  constructor(kind: IntakeErrorKind, message: string) {
    super(message);
    this.name = "OutlineIntakeError";
    this.kind = kind;
  }
}

export interface Codebase {
  source: OutlineSource;
  files: OutlineFile[];
  /** tsconfig.json / jsconfig.json files, read for path aliases only (review M3). */
  configFiles: ConfigFile[];
  skipped: SkippedFile[];
}

/** Folders that hold other people's code or build output, not the codebase itself. */
const DEPENDENCY_DIRS = new Set(["node_modules", "dist", "build", "out", ".git", "vendor", "__pycache__", ".venv", "venv", "coverage", ".next", "site-packages"]);
/** At most this many skipped files are listed one by one; the rest are counted in one last line. */
export const MAX_SKIPPED_LISTED = 1000;

const ext = (p: string) => (/\.[A-Za-z0-9]{1,10}$/.exec(p)?.[0] ?? "(none)");

/** Why plain code does not read this path as a source file (null = it does). Size and bytes are checked separately. */
export function skipReason(path: string): string | null {
  const pp = pathProblem(path);
  if (pp) return `not read: ${pp}`;
  const dir = path.split("/").slice(0, -1).find((seg) => DEPENDENCY_DIRS.has(seg));
  if (dir) return `in ${dir}/ (dependencies or build output, not this code)`;
  if (/\.d\.(?:ts|mts|cts)$/.test(path)) return "a type declaration file (.d.ts): no code runs from it";
  if (/\.min\.(?:js|mjs|cjs)$/.test(path)) return "minified code";
  if (languageOf(path) === null) return `not a source file Atlas reads (${ext(path)})`;
  return null;
}

/** Caps the skipped list: MAX_SKIPPED_LISTED entries, then one line counting the rest. Sorted by path. */
function capSkipped(skipped: SkippedFile[]): SkippedFile[] {
  const sorted = [...skipped].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (sorted.length <= MAX_SKIPPED_LISTED) return sorted;
  return [...sorted.slice(0, MAX_SKIPPED_LISTED), { path: "…", reason: `and ${sorted.length - MAX_SKIPPED_LISTED} more files, not listed one by one` }];
}

function checkTotals(files: { path: string; bytes: number }[], where: string): void {
  if (files.length === 0) throw new OutlineIntakeError("empty", `${where} has no JavaScript, TypeScript or Python files Atlas reads (.js .mjs .cjs .ts .tsx .py)`);
  if (files.length > MAX_OUTLINE_FILES) {
    throw new OutlineIntakeError("too_many", `${where} has ${files.length} source files; Atlas reads at most ${MAX_OUTLINE_FILES}. Choose a subfolder.`);
  }
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (total > MAX_OUTLINE_TOTAL_BYTES) {
    throw new OutlineIntakeError("too_large", `${where} has ${Math.ceil(total / 1024)} KB of source files; Atlas reads at most ${MAX_OUTLINE_TOTAL_BYTES / 1024} KB. Choose a subfolder.`);
  }
}

// ---------- uploads ----------

/** At most this many entries are accepted in one upload (source or not). */
export const MAX_UPLOAD_ENTRIES = 200;

/** A codebase from uploaded or pasted files ({path, text} each). Throws OutlineIntakeError with a plain reason. */
export function intakeUpload(entries: ReadonlyArray<{ path: string; text: string }>): Codebase {
  if (entries.length > MAX_UPLOAD_ENTRIES) throw new OutlineIntakeError("too_many", `${plural(entries.length, "file")} ${entries.length === 1 ? "was" : "were"} sent; Atlas takes at most ${MAX_UPLOAD_ENTRIES} in one upload (of which at most ${MAX_OUTLINE_FILES} source files)`);
  const seen = new Set<string>();
  const files: OutlineFile[] = [];
  const configFiles: ConfigFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const e of entries) {
    if (!pathProblem(e.path) && isConfigFile(e.path) && !seen.has(e.path)) {
      seen.add(e.path);
      const bytes = utf8Length(e.text);
      if (configFiles.length >= MAX_CONFIG_FILES || bytes > MAX_CONFIG_FILE_BYTES) skipped.push({ path: e.path, reason: `a config file over Atlas's limit (${MAX_CONFIG_FILES} files, ${MAX_CONFIG_FILE_BYTES / 1024} KB each)` });
      else configFiles.push({ path: e.path, sha256: sha256Text(e.text), bytes, text: e.text });
      continue;
    }
    if (seen.has(e.path)) throw new OutlineIntakeError("bad_input", `two files have the path ${JSON.stringify(visibleText(e.path))}`);
    seen.add(e.path);
    const why = skipReason(e.path);
    const shown = pathProblem(e.path) ? visibleText(e.path).slice(0, 200) : e.path;
    if (why) {
      skipped.push({ path: shown, reason: why });
      continue;
    }
    if (e.text.includes("\u0000")) {
      skipped.push({ path: e.path, reason: "binary content (a NUL byte), not text" });
      continue;
    }
    const bytes = utf8Length(e.text);
    if (bytes > MAX_OUTLINE_FILE_BYTES) {
      skipped.push({ path: e.path, reason: `${bytes} bytes; Atlas reads files up to ${MAX_OUTLINE_FILE_BYTES / 1024} KB` });
      continue;
    }
    files.push({ path: e.path, language: languageOf(e.path)!, sha256: sha256Text(e.text), bytes, text: e.text });
  }
  checkTotals(files, "the upload");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { source: { kind: "upload" }, files, configFiles, skipped: capSkipped(skipped) };
}

// ---------- GitHub ----------

export interface RepoRequest {
  owner: string;
  repo: string;
  /** Branch, tag or commit; absent = the default branch. */
  ref?: string;
  /** "" = the whole repo. */
  subfolder: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9._/-]{1,200}$/;

/**
 * Reads what the person typed: "owner/repo", "https://github.com/owner/repo", "…/tree/<ref>/<folder>" (the first
 * segment after /tree/ is taken as the ref; a branch whose name has a "/" must be given as `ref` instead), plus
 * optional explicit ref and subfolder, which win over the URL's.
 */
export function parseRepoRequest(input: { repo: string; ref?: string; subfolder?: string }): RepoRequest {
  const raw = input.repo.trim();
  let owner: string | undefined;
  let repo: string | undefined;
  let urlRef: string | undefined;
  let urlFolder = "";
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+)((?:\/[^\s]*)?))?\/?$/.exec(raw);
  if (m) {
    owner = m[1];
    repo = m[2];
    urlRef = m[3];
    urlFolder = (m[4] ?? "").replace(/^\/+|\/+$/g, "");
  }
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo) || owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new OutlineIntakeError("bad_input", "the repo must look like owner/repo or https://github.com/owner/repo");
  }
  const ref = input.ref?.trim() || urlRef;
  if (ref !== undefined && (!REF.test(ref) || ref.split("/").some((s) => s === "" || s === "." || s === ".."))) throw new OutlineIntakeError("bad_input", "the ref must be a branch, tag or commit name (letters, digits, . _ - /)");
  const subfolder = (input.subfolder ?? urlFolder).trim().replace(/^\/+|\/+$/g, "");
  if (subfolder !== "" && pathProblem(subfolder)) throw new OutlineIntakeError("bad_input", `the subfolder is not a plain path: ${pathProblem(subfolder)}`);
  return { owner, repo, ...(ref ? { ref } : {}), subfolder };
}

export interface GithubIntakeOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  /** Per-request time limit. Default 20 s. */
  timeoutMs?: number;
}

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

/** Git's blob id: SHA-1 of "blob <size>\0" + bytes. */
export const gitBlobSha1 = (bytes: Uint8Array) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

export async function intakeGithub(req: RepoRequest, opts: GithubIntakeOptions = {}): Promise<Codebase> {
  const doFetch = opts.fetchImpl ?? fetch;
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? undefined;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const name = `${req.owner}/${req.repo}`;

  const get = async (url: string, accept?: string): Promise<Response> => {
    const api = url.startsWith(API);
    const headers: Record<string, string> = { "User-Agent": "atlas-outline" };
    if (api) {
      headers.Accept = accept ?? "application/vnd.github+json";
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const why = e instanceof Error && e.name === "TimeoutError" ? `no answer in ${timeoutMs} ms` : "the request failed";
      throw new OutlineIntakeError("network", `Could not reach ${new URL(url).host}: ${why}.`);
    }
    if (res.ok) return res;
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429 || (res.status === 403 && remaining === "0")) {
      throw new OutlineIntakeError("rate_limited", "GitHub's rate limit was reached (60 requests an hour without a token). Try again later.");
    }
    if (res.status === 404 || res.status === 422) throw new OutlineIntakeError("not_found", api ? `GitHub has no public repo ${name}${req.ref ? ` with ref ${req.ref}` : ""} (HTTP ${res.status}).` : "GitHub has no such file at that commit (HTTP 404).");
    throw new OutlineIntakeError("http", `GitHub answered HTTP ${res.status} for a request to ${new URL(url).host}.`);
  };

  // 1. Pin one commit.
  const commitRes = await get(`${API}/repos/${req.owner}/${req.repo}/commits/${encodeURIComponent(req.ref ?? "HEAD")}`, "application/vnd.github.sha");
  const commit = (await commitRes.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new OutlineIntakeError("http", "GitHub did not answer with a commit id");

  // 2. Every file at that commit, in one listing.
  const treeRes = await get(`${API}/repos/${req.owner}/${req.repo}/git/trees/${commit}?recursive=1`);
  const tree = (await treeRes.json()) as { truncated?: boolean; tree?: { path: string; mode: string; type: string; sha: string; size?: number }[] };
  if (tree.truncated) throw new OutlineIntakeError("too_many", `${name} is too large for GitHub to list in one answer; Atlas reads small repos (up to ${MAX_OUTLINE_FILES} source files)`);
  const prefix = req.subfolder === "" ? "" : `${req.subfolder}/`;
  const entries = (tree.tree ?? []).filter((e) => e.path.startsWith(prefix) && e.type !== "tree");
  if (req.subfolder !== "" && !(tree.tree ?? []).some((e) => e.path === req.subfolder && e.type === "tree")) {
    throw new OutlineIntakeError("not_found", `${name} has no folder ${req.subfolder} at commit ${commit.slice(0, 12)}`);
  }

  const skipped: SkippedFile[] = [];
  const picked: { rel: string; full: string; sha: string; size: number }[] = [];
  const configs: { rel: string; full: string; sha: string; size: number }[] = [];
  for (const e of entries) {
    const rel = e.path.slice(prefix.length);
    const shown = pathProblem(rel) ? visibleText(rel).slice(0, 200) : rel;
    if (e.type === "commit") skipped.push({ path: shown, reason: "a git submodule (another repository)" });
    else if (e.mode === "120000") skipped.push({ path: shown, reason: "a symbolic link" });
    else if (!pathProblem(rel) && isConfigFile(rel) && configs.length < MAX_CONFIG_FILES && (e.size ?? 0) <= MAX_CONFIG_FILE_BYTES) configs.push({ rel, full: e.path, sha: e.sha, size: e.size ?? 0 });
    else {
      const why = skipReason(rel);
      if (why) skipped.push({ path: shown, reason: why });
      else if ((e.size ?? 0) > MAX_OUTLINE_FILE_BYTES) skipped.push({ path: rel, reason: `${e.size} bytes; Atlas reads files up to ${MAX_OUTLINE_FILE_BYTES / 1024} KB` });
      else picked.push({ rel, full: e.path, sha: e.sha, size: e.size ?? 0 });
    }
  }
  const where = req.subfolder === "" ? name : `${name}/${req.subfolder}`;
  checkTotals(picked.map((p) => ({ path: p.rel, bytes: p.size })), where);

  // 3. The bytes, at that commit, each checked against its git blob id.
  const files: OutlineFile[] = [];
  for (const p of picked.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    const res = await get(`${RAW}/${req.owner}/${req.repo}/${commit}/${p.full.split("/").map(encodeURIComponent).join("/")}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== p.size || gitBlobSha1(bytes) !== p.sha) throw new OutlineIntakeError("integrity", `${p.rel} did not match the blob GitHub listed at commit ${commit.slice(0, 12)}; nothing was read`);
    const text = decodeText(bytes);
    if (text === null) {
      skipped.push({ path: p.rel, reason: "not UTF-8 text" });
      continue;
    }
    files.push({ path: p.rel, language: languageOf(p.rel)!, sha256: sha256Text(text), bytes: bytes.length, text, gitBlob: gitBlobOf(text) });
  }
  const configFiles: ConfigFile[] = [];
  for (const p of configs.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    const res = await get(`${RAW}/${req.owner}/${req.repo}/${commit}/${p.full.split("/").map(encodeURIComponent).join("/")}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = bytes.length === p.size && gitBlobSha1(bytes) === p.sha ? decodeText(bytes) : null;
    if (text === null) skipped.push({ path: p.rel, reason: "a config file that did not match its listed blob or is not UTF-8 text" });
    else configFiles.push({ path: p.rel, sha256: sha256Text(text), bytes: bytes.length, text });
  }
  checkTotals(files, where);
  return {
    source: { kind: "github", repo: name, ...(req.ref ? { requestedRef: req.ref } : {}), commit, subfolder: req.subfolder },
    files,
    configFiles,
    skipped: capSkipped(skipped),
  };
}
