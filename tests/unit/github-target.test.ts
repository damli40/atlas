// D03-04: the GitHub target (server/targets/github.ts) and the Moonwell copies in contracts/lib/moonwell/.
//
// Three blocks:
// 1. Mocked fetch (runs everywhere): path order, fingerprint stability, removed/binary files,
//    not merged, rate limit, incomplete list, the token never appears in an error.
// 2. Committed copies (runs everywhere): each file in contracts/lib/moonwell/ still has the SHA-256
//    pinned below, which is the SHA of the bytes fetched at the merge commit.
// 3. Real fetch of PR #578 (needs the internet): skipped when ATLAS_OFFLINE=1 or GitHub does not
//    answer a quick reachability check; skipped (not failed) when GitHub rate-limits this IP.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codeSha256Of,
  countLines,
  fetchGithubPr,
  GithubTargetError,
  MOONWELL_PR_578,
} from "../../server/targets/github";

const ROOT = join(import.meta.dirname, "..", "..");
const COPY_DIR = join(ROOT, "contracts", "lib", "moonwell");

/** SHA-256 of each file's bytes at moonwell-contracts-v2@9a6738e1… (fetched Oct 27, 2026). */
const PINNED_COPIES: Record<string, string> = {
  "chains/8453.json": "b3121869f10e149692fd37cfd47be5faf73936d2957a329a2a7a4cc54c09dc06",
  "proposals/ChainlinkOracleConfigs.sol": "1051200988ea46e5731052d7cc3387dcb7541bfbba01ebea6e2eabf4563ad383",
  "proposals/mips/mip-x43/mip-x43.sol": "fa2a8c6333521534acf51d8b2e89dc034514bd1b291b2233097ff3e0e4fc2bd6",
  "proposals/mips/mip-x43/x43.md": "8d37734a593877af61614b6a9360c2206fceac651faf2d6839c51ac0c09696c9",
  LICENSE: "e7965e78ddd9d3372a7c2e2845bd494cfc5d2e337a23fd72bf511542608679f4",
};
/** codeSha256 of all 6 changed files of PR #578 at the merge commit (see the rule in github.ts). */
const PINNED_PR578_CODE_SHA = "6c431aaec1a5631719cb0c90128b0b2b0f294bafb3634c775cb93fee0670f7c7";

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

// ---------- a tiny fake GitHub ----------
type FakeFile = { filename: string; status: string; body?: Uint8Array<ArrayBuffer> | string };
function fakeGithub(opts: {
  merged?: boolean;
  commit?: string;
  files: FakeFile[];
  changedFiles?: number;
  status?: { api?: number; raw?: number; headers?: Record<string, string> };
}) {
  const commit = opts.commit ?? "c0ffee";
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    const isApi = url.startsWith("https://api.github.com/");
    const forced = isApi ? opts.status?.api : opts.status?.raw;
    if (forced) return new Response("{}", { status: forced, headers: opts.status?.headers });
    if (isApi && /\/pulls\/\d+$/.test(url)) {
      return Response.json({
        merged: opts.merged ?? true,
        merge_commit_sha: (opts.merged ?? true) ? commit : null,
        merged_at: (opts.merged ?? true) ? "2026-02-10T18:58:44Z" : null,
        changed_files: opts.changedFiles ?? opts.files.length,
        title: "test PR",
      });
    }
    if (isApi && url.includes("/files?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      const slice = opts.files.slice((page - 1) * 100, page * 100);
      return Response.json(slice.map(({ filename, status }) => ({ filename, status })));
    }
    const prefix = `https://raw.githubusercontent.com/o/r/${commit}/`;
    if (url.startsWith(prefix)) {
      const path = url.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
      const f = opts.files.find((x) => x.filename === path);
      if (!f || f.status === "removed") return new Response("404", { status: 404 });
      return new Response(f.body ?? "");
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { impl, calls };
}
const base = { owner: "o", repo: "r", number: 1 };

describe("GitHub target with a mocked fetch", () => {
  const files: FakeFile[] = [
    { filename: "z/last.sol", status: "modified", body: "contract Z {}\n" },
    { filename: "a/first.md", status: "added", body: "# A\nline 2\n" },
    { filename: "m/mid.json", status: "modified", body: "{}" },
  ];

  it("sorts by path and hashes path + \\n + bytes + \\n in that order", async () => {
    const { impl } = fakeGithub({ files });
    const r = await fetchGithubPr({ ...base, fetchImpl: impl, token: "" });
    expect(r.files.map((f) => f.path)).toEqual(["a/first.md", "m/mid.json", "z/last.sol"]);
    const expected = sha("a/first.md\n# A\nline 2\n\nm/mid.json\n{}\nz/last.sol\ncontract Z {}\n\n");
    expect(r.target).toEqual({ kind: "github-pr", ref: "o/r#1", commit: "c0ffee", codeSha256: expected });
    expect(r.files.map((f) => f.lines)).toEqual([2, 1, 1]);
    expect(r.files[0].sha256).toBe(sha("# A\nline 2\n"));
  });

  it("gives the same fingerprint whatever order GitHub lists the files in", async () => {
    const a = await fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files }).impl, token: "" });
    const b = await fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files: [...files].reverse() }).impl, token: "" });
    expect(a.target.codeSha256).toBe(b.target.codeSha256);
    // and it changes when one byte changes
    const changed = files.map((f) => (f.filename === "m/mid.json" ? { ...f, body: "{ }" } : f));
    const c = await fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files: changed }).impl, token: "" });
    expect(c.target.codeSha256).not.toBe(a.target.codeSha256);
  });

  it("the path is part of the fingerprint (moving bytes between files changes it)", () => {
    const x = codeSha256Of([{ path: "a", bytes: new TextEncoder().encode("1") }, { path: "b", bytes: new Uint8Array() }]);
    const y = codeSha256Of([{ path: "a", bytes: new Uint8Array() }, { path: "b", bytes: new TextEncoder().encode("1") }]);
    expect(x).not.toBe(y);
  });

  it("skips a removed file with a note and leaves it out of the fingerprint", async () => {
    const withRemoved = [...files, { filename: "gone.sol", status: "removed" }];
    const r = await fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files: withRemoved }).impl, token: "" });
    const plain = await fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files }).impl, token: "" });
    expect(r.skipped).toEqual([{ path: "gone.sol", status: "removed", note: expect.stringContaining("removed") }]);
    expect(r.files.map((f) => f.path)).not.toContain("gone.sol");
    expect(r.target.codeSha256).toBe(plain.target.codeSha256);
    expect(r.changedFiles).toBe(4);
  });

  it("keeps a binary file's bytes in the fingerprint but gives it no text or line count", async () => {
    const bin = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const r = await fetchGithubPr({
      ...base,
      fetchImpl: fakeGithub({ files: [{ filename: "logo.png", status: "added", body: bin }] }).impl,
      token: "",
    });
    expect(r.files[0]).toMatchObject({ path: "logo.png", binary: true, sizeBytes: 6, sha256: sha(bin) });
    expect(r.files[0].content).toBeUndefined();
    expect(r.files[0].lines).toBeUndefined();
    expect(r.target.codeSha256).toBe(sha(Buffer.concat([Buffer.from("logo.png\n"), bin, Buffer.from("\n")])));
  });

  it("refuses a PR that is not merged, in plain words", async () => {
    const p = fetchGithubPr({ ...base, fetchImpl: fakeGithub({ merged: false, files }).impl, token: "" });
    await expect(p).rejects.toMatchObject({ kind: "not_merged", message: expect.stringContaining("not merged") });
  });

  it("refuses when the merge commit is not the expected one", async () => {
    const p = fetchGithubPr({ ...base, expectCommit: "abc", fetchImpl: fakeGithub({ files }).impl, token: "" });
    await expect(p).rejects.toMatchObject({ kind: "commit_mismatch" });
  });

  it("reports a rate limit plainly (403 with no requests left, and 429), with the reset time", async () => {
    const reset = "1800000000";
    const p403 = fetchGithubPr({
      ...base,
      fetchImpl: fakeGithub({ files, status: { api: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } } }).impl,
      token: "",
    });
    await expect(p403).rejects.toMatchObject({ kind: "rate_limited", message: expect.stringContaining("2027-01-15T08:00:00.000Z") });
    const p429 = fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files, status: { raw: 429 } }).impl, token: "" });
    await expect(p429).rejects.toMatchObject({ kind: "rate_limited", message: expect.stringContaining("raw.githubusercontent.com") });
  });

  it("a plain 403 (not a rate limit) is an http error, not a rate limit", async () => {
    const p = fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files, status: { api: 403 } }).impl, token: "" });
    await expect(p).rejects.toMatchObject({ kind: "http" });
  });

  it("refuses a partial list (GitHub listed fewer files than the PR changed)", async () => {
    const p = fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files, changedFiles: 4 }).impl, token: "" });
    await expect(p).rejects.toMatchObject({ kind: "incomplete_list" });
  });

  it("pages through more than 100 files", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ filename: `f${String(i).padStart(3, "0")}`, status: "added", body: `${i}\n` }));
    const r = await fetchGithubPr({ ...base, fetchImpl: fakeGithub({ files: many }).impl, token: "" });
    expect(r.files).toHaveLength(150);
  });

  it("sends the token only to api.github.com and never puts it in an error", async () => {
    const token = "ghp_FAKEFAKEFAKEFAKEFAKE0123456789"; // secret-scan: allow
    const ok = fakeGithub({ files });
    await fetchGithubPr({ ...base, fetchImpl: ok.impl, token });
    for (const c of ok.calls) {
      if (c.url.startsWith("https://api.github.com/")) expect(c.headers.Authorization).toBe(`Bearer ${token}`);
      else expect(c.headers.Authorization).toBeUndefined();
    }
    const failing = fakeGithub({ files, status: { api: 500 } });
    const err = await fetchGithubPr({ ...base, fetchImpl: failing.impl, token }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubTargetError);
    expect(String((err as Error).message)).not.toContain(token);
    expect(JSON.stringify(err)).not.toContain(token);
  });

  it("a network failure becomes a plain 'could not reach' error", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(fetchGithubPr({ ...base, fetchImpl: impl, token: "" })).rejects.toMatchObject({
      kind: "network",
      message: expect.stringContaining("Could not reach api.github.com"),
    });
  });

  it("counts lines the way an editor numbers them", () => {
    expect([countLines(""), countLines("a"), countLines("a\n"), countLines("a\nb"), countLines("a\n\n")]).toEqual([0, 1, 1, 2, 2]);
  });
});

describe("committed Moonwell copies (contracts/lib/moonwell/)", () => {
  it.each(Object.entries(PINNED_COPIES))("%s still has the SHA-256 of the merge-commit bytes", (path, want) => {
    expect(sha(readFileSync(join(COPY_DIR, path)))).toBe(want);
  });

  it("keeps the BSD-3-Clause notice and the NOTICE.md", () => {
    const lic = readFileSync(join(COPY_DIR, "LICENSE"), "utf8");
    expect(lic).toContain("Copyright 2023 Lunar Enterprise Ventures, Ltd.");
    expect(lic).toContain("Redistributions of source code must retain the above copyright notice");
    const notice = readFileSync(join(COPY_DIR, "NOTICE.md"), "utf8");
    expect(notice).toContain("moonwell-fi/moonwell-contracts-v2");
    expect(notice).toContain(MOONWELL_PR_578.commit);
    expect(notice).toContain("BSD-3-Clause");
    expect(notice).toContain("GPL-3.0-or-later");
  });
});

// ---------- the real fetch ----------
async function githubReachable(): Promise<boolean> {
  if (process.env.ATLAS_OFFLINE === "1") return false;
  try {
    const r = await fetch("https://api.github.com/zen", { signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch {
    return false;
  }
}
const ONLINE = await githubReachable();

describe.skipIf(!ONLINE)("real fetch of moonwell-fi/moonwell-contracts-v2#578 (network)", () => {
  it("returns the 6 changed files at the merge commit, and the copies match byte for byte", async (ctx) => {
    let r;
    try {
      r = await fetchGithubPr({ ...MOONWELL_PR_578, expectCommit: MOONWELL_PR_578.commit });
    } catch (e) {
      if (e instanceof GithubTargetError && e.kind === "rate_limited") return ctx.skip(e.message);
      throw e;
    }
    expect(r.target.kind).toBe("github-pr");
    expect(r.target.ref).toBe("moonwell-fi/moonwell-contracts-v2#578");
    expect(r.target.commit).toBe(MOONWELL_PR_578.commit);
    expect(r.changedFiles).toBe(6);
    expect(r.files).toHaveLength(6);
    expect(r.skipped).toEqual([]);
    expect(r.files.map((f) => f.path)).toContain("proposals/mips/mip-x43/x43.md");
    for (const f of r.files) {
      expect(f.binary).toBe(false);
      if (PINNED_COPIES[f.path]) {
        expect(f.sha256).toBe(PINNED_COPIES[f.path]);
        expect(f.sha256).toBe(sha(readFileSync(join(COPY_DIR, f.path))));
      }
    }
    expect(r.target.codeSha256).toBe(PINNED_PR578_CODE_SHA);
  }, 60_000);
});
