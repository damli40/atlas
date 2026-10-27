// X1: repo intake (GitHub mocked), the Outliner role (Muse Wonder mocked), the contributor guard, and the
// explorer routes with per-session ownership and limits. No network, no paid call.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { codeModelRefusal, runOutliner } from "../../server/meta/roles/outliner";
import { gitBlobSha1, intakeGithub, intakeUpload, OutlineIntakeError, parseRepoRequest, type Codebase } from "../../server/outline/intake";
import { verifyOutlineFile } from "../../src/outline/section";
import type { OutlineAtlasFile, VerifiedOutline } from "../../src/outline/types";
import type { PartDetails } from "../../src/outline/details";
import { FILES, GOOD, MAP } from "../tools/outline-fixtures";

process.env.ATLAS_USAGE_PATH = join(mkdtempSync(join(tmpdir(), "atlas-x1s-")), "usage.jsonl");
const USAGE = { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, usd: 0.0208 };
const answer = (content: string): ChatResult => ({ ok: true, content, finishReason: "stop", usage: USAGE });

// ---------- intake ----------

describe("intake: uploads", () => {
  it("reads source files, skips the rest with reasons, refuses bad paths and duplicates", () => {
    const c = intakeUpload([
      { path: "src/a.ts", text: "export const a = 1;\n" },
      { path: "README.md", text: "# hi" },
      { path: "types.d.ts", text: "export {}" },
      { path: "node_modules/x/index.js", text: "" },
      { path: "lib/app.min.js", text: "x" },
      { path: "../../etc/passwd", text: "root" },
      { path: "evil\u202Etxt.ts", text: "x" },
      { path: "bin.py", text: "a\u0000b" },
    ]);
    expect(c.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(c.skipped.map((s) => [s.path, s.reason.split(" ").slice(0, 3).join(" ")])).toEqual([
      ["../../etc/passwd", "not read: the"],
      ["README.md", "not a source"],
      ["bin.py", "binary content (a"],
      ["evil\\u202etxt.ts", "not read: the"],
      ["lib/app.min.js", "minified code"],
      ["node_modules/x/index.js", "in node_modules/ (dependencies"],
      ["types.d.ts", "a type declaration"],
    ]);
    expect(() => intakeUpload([{ path: "a.ts", text: "1" }, { path: "a.ts", text: "2" }])).toThrow(/two files/);
  });

  it("limits: more than 50 source files or 300 KB is refused as a whole; one file over 100 KB is skipped", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.js`, text: "x;\n" }));
    expect(() => intakeUpload(many)).toThrow(/51 source files; Atlas reads at most 50/);
    const big = Array.from({ length: 4 }, (_, i) => ({ path: `b${i}.py`, text: "#".repeat(90 * 1024) }));
    expect(() => intakeUpload(big)).toThrow(/KB of source files; Atlas reads at most 300 KB/);
    const c = intakeUpload([{ path: "huge.ts", text: "x".repeat(101 * 1024) }, { path: "ok.ts", text: "x" }]);
    expect(c.skipped[0]).toMatchObject({ path: "huge.ts", reason: expect.stringMatching(/up to 100 KB/) });
    expect(() => intakeUpload([{ path: "README.md", text: "" }])).toThrow(/no JavaScript, TypeScript or Python files/);
  });
});

describe("intake: GitHub (mocked)", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const COMMIT = "a".repeat(40);
  const blobs: Record<string, string> = { "pkg/a.ts": "export const a = 1;\n", "pkg/b.py": "def b():\n    pass\n", "pkg/notes.md": "# notes", "other/c.js": "x" };
  const tree = Object.entries(blobs).map(([path, text]) => ({ path, mode: "100644", type: "blob", sha: gitBlobSha1(enc(text)), size: enc(text).length }));
  tree.push({ path: "pkg", mode: "040000", type: "tree", sha: "t", size: 0 }, { path: "pkg/link.ts", mode: "120000", type: "blob", sha: "s", size: 3 }, { path: "pkg/sub", mode: "160000", type: "commit", sha: "c", size: 0 });
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u + (new Headers(init?.headers).has("authorization") ? " (auth)" : ""));
    if (u.includes("/commits/")) return new Response(COMMIT, { status: 200 });
    if (u.includes("/git/trees/")) return new Response(JSON.stringify({ truncated: false, tree }), { status: 200 });
    const m = new RegExp(`raw.githubusercontent.com/o/r/${COMMIT}/(.+)$`).exec(u);
    if (m && blobs[decodeURIComponent(m[1]!)] !== undefined) return new Response(blobs[decodeURIComponent(m[1]!)]!, { status: 200 });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  it("pins one commit, reads only the subfolder's source files, checks each blob, lists the skipped", async () => {
    const c = await intakeGithub({ owner: "o", repo: "r", subfolder: "pkg" }, { fetchImpl, token: "tok-secret" });
    expect(c.source).toEqual({ kind: "github", repo: "o/r", commit: COMMIT, subfolder: "pkg" });
    expect(c.files.map((f) => [f.path, f.language])).toEqual([
      ["a.ts", "ts"],
      ["b.py", "py"],
    ]);
    expect(c.skipped.map((s) => s.path)).toEqual(["link.ts", "notes.md", "sub"]);
    // The token goes to api.github.com only.
    expect(calls.filter((u) => u.includes("raw.githubusercontent") && u.endsWith("(auth)"))).toEqual([]);
    expect(calls.filter((u) => u.includes("api.github.com")).every((u) => u.endsWith("(auth)"))).toBe(true);
  });

  it("a download that does not match its listed blob is refused; a missing folder is not_found", async () => {
    const tampered = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("raw.githubusercontent.com") && String(url).endsWith("a.ts")) return new Response("export const a = 2;\n", { status: 200 });
      return fetchImpl(url, init);
    }) as typeof fetch;
    await expect(intakeGithub({ owner: "o", repo: "r", subfolder: "pkg" }, { fetchImpl: tampered })).rejects.toMatchObject({ kind: "integrity" });
    await expect(intakeGithub({ owner: "o", repo: "r", subfolder: "nope" }, { fetchImpl })).rejects.toMatchObject({ kind: "not_found" });
  });

  it("reads owner/repo, URLs with /tree/<ref>/<folder>, and refuses odd input", () => {
    expect(parseRepoRequest({ repo: "https://github.com/damli40/atlas/tree/main/src/outline" })).toEqual({ owner: "damli40", repo: "atlas", ref: "main", subfolder: "src/outline" });
    expect(parseRepoRequest({ repo: "pallets/itsdangerous.git", subfolder: "/src/itsdangerous/" })).toEqual({ owner: "pallets", repo: "itsdangerous", subfolder: "src/itsdangerous" });
    for (const bad of ["../x", "https://evil.com/a/b", "a b/c", "./."]) expect(() => parseRepoRequest({ repo: bad }), bad).toThrow(OutlineIntakeError);
    expect(() => parseRepoRequest({ repo: "a/b", subfolder: "../../etc" })).toThrow(/not a plain path/);
    expect(() => parseRepoRequest({ repo: "a/b", ref: "main;rm -rf" })).toThrow(/ref/);
  });
});

// ---------- the role ----------

describe("Outliner role (Muse Wonder mocked)", () => {
  const input = { files: FILES, codeMap: MAP, label: "uploaded files", codeSha256: "0".repeat(64) };

  it("a valid answer: one call, usage returned; the prompt carries the numbered files and the code map", async () => {
    const seen: ChatArgs[] = [];
    const r = await runOutliner(input, { chat: async (a) => (seen.push(a), answer(JSON.stringify(GOOD))) });
    expect(r).toMatchObject({ ok: true, model: "muse-wonder-1.0", outline: GOOD, usage: USAGE });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.json).toBe(true);
    expect(seen[0]!.messages[1]!.content).toContain("=== src/api.ts (lines 1–6)");
    expect(seen[0]!.messages[1]!.content).toContain("calls src/api.ts line 4 -> src/client.ts fetchUser (fetchUser)");
  });

  it("an invalid answer gets exactly one repair call; a second invalid answer is reported, never a third call", async () => {
    let n = 0;
    const r = await runOutliner(input, { chat: async () => (n++, answer('{"parts": "nope"}')) });
    expect(n).toBe(2);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/after one repair try/) });
    expect(r.attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(r.usage!.usd).toBeCloseTo(USAGE.usd * 2);
    let m = 0;
    const fixed = await runOutliner(input, { chat: async (a) => (m++, answer(a.messages.length > 2 ? JSON.stringify(GOOD) : "not json")) });
    expect(fixed.ok).toBe(true);
    expect(m).toBe(2);
  });

  it("a depth-bomb or huge answer is refused without throwing", async () => {
    const r = await runOutliner(input, { chat: async () => answer("[".repeat(100_000) + "]".repeat(100_000)) });
    expect(r.ok).toBe(false);
  });

  it("code never reaches a contributor model, even with ATLAS_ALLOW_CONTRIBUTOR=1: nothing is sent", async () => {
    const before = process.env.ATLAS_ALLOW_CONTRIBUTOR;
    process.env.ATLAS_ALLOW_CONTRIBUTOR = "1";
    try {
      for (const model of ["muse-wonder-1.0-contributor", "muse-spark-1.3:Contributor", "contributor/x", "some-unknown-model"]) {
        let sent = 0;
        const r = await runOutliner({ ...input, model }, { chat: async () => (sent++, answer(JSON.stringify(GOOD))) });
        expect(sent, model).toBe(0);
        expect(r.ok, model).toBe(false);
        expect(codeModelRefusal(model), model).not.toBeNull();
      }
      expect(codeModelRefusal("muse-wonder-1.0")).toBeNull();
    } finally {
      if (before === undefined) delete process.env.ATLAS_ALLOW_CONTRIBUTOR;
      else process.env.ATLAS_ALLOW_CONTRIBUTOR = before;
    }
  });
});

// ---------- the routes ----------

const UPLOAD = FILES.map((f) => ({ path: f.path, text: f.text }));

function setup(over: { chat?: (a: ChatArgs) => Promise<ChatResult>; readGithub?: () => Promise<Codebase>; outlinesPerHour?: string } = {}) {
  let calls = 0;
  const chat = over.chat ?? (async () => (calls++, answer(JSON.stringify(GOOD))));
  if (over.outlinesPerHour) process.env.ATLAS_OUTLINES_PER_IP_PER_HOUR = over.outlinesPerHour;
  const app = createApp({ agentLog: createAgentLog(), outline: { outliner: { chat }, ...(over.readGithub ? { readGithub: over.readGithub } : {}) }, investigator: { chat: async () => ({ ok: false, reason: "unused" }), budget: createModelBudget() } });
  delete process.env.ATLAS_OUTLINES_PER_IP_PER_HOUR;
  const req = (session: string) => ({
    post: (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": session }, body: JSON.stringify(body) }),
    get: (path: string) => app.request(path, { headers: { "x-atlas-session": session } }),
  });
  return { req, calls: () => calls };
}

async function waitDone(get: (p: string) => Response | Promise<Response>, id: string) {
  for (let i = 0; i < 200; i++) {
    const s = (await (await get(`/outline/jobs/${id}`)).json()) as { status: string };
    if (s.status === "done" || s.status === "failed") return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job did not finish");
}

describe("outline routes", () => {
  it("upload → job → verified outline, part details from the code, an outline file that verifies", async () => {
    const { req, calls } = setup();
    const a = req("x1-a");
    const start = await a.post("/outline/jobs", { files: UPLOAD });
    expect(start.status).toBe(202);
    const { jobId } = (await start.json()) as { jobId: string };
    expect(await waitDone(a.get, jobId)).toMatchObject({ status: "done", files: 4, counts: { confirmedParts: 3, codeOnlyJoins: 1 } });
    expect(calls()).toBe(1);

    const o = (await (await a.get(`/outline/jobs/${jobId}/outline`)).json()) as { verified: VerifiedOutline; files: Record<string, unknown>[]; usage: unknown; labels: Record<string, string> };
    expect(o.verified.notInAnyPart).toEqual(["src/log.ts"]);
    expect(o.files[0]).not.toHaveProperty("text"); // the outline view does not echo the code
    expect(o.usage).toEqual(USAGE);
    expect(o.labels.joins).toMatch(/Wonder says; the code doesn't show it/);

    const part = (await (await a.get(`/outline/jobs/${jobId}/parts/retry`)).json()) as PartDetails;
    expect(part.definitions.map((d) => [d.name, d.params, d.returns, d.readFrom])).toEqual([["retry", ["fn: () => Promise<T>", "attempts = 3"], "Promise<T>", "the code"]]);
    expect(part.spans[0]!.lines![0]).toEqual({ n: 1, text: "export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {" });
    expect(part.edgesIn.map((e) => e.id)).toContain("calls:src/client.ts->src/retry.ts:retry");
    expect((await a.get(`/outline/jobs/${jobId}/parts/nope`)).status).toBe(404);

    const file = (await (await a.get(`/outline/jobs/${jobId}/atlas`)).json()) as OutlineAtlasFile;
    expect(verifyOutlineFile(file)).toMatchObject({ ok: true });
  });

  it("another session cannot see, open or download a job (404); a missing session header is refused", async () => {
    const { req } = setup();
    const a = req("x1-owner");
    const { jobId } = (await (await a.post("/outline/jobs", { files: UPLOAD })).json()) as { jobId: string };
    await waitDone(a.get, jobId);
    const b = req("x1-other");
    for (const p of ["", "/outline", "/parts/api", "/atlas"]) expect((await b.get(`/outline/jobs/${jobId}${p}`)).status, p).toBe(404);
    expect((await (await import("../../server/app")).createApp().request("/outline/jobs", { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("limits: per address an hour (429), one running job per session (409), bad uploads answered at once", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { req } = setup({ outlinesPerHour: "1", chat: async () => (await held, answer(JSON.stringify(GOOD))) });
    const a = req("x1-lim");
    const r1 = (await (await a.post("/outline/jobs", { files: UPLOAD })).json()) as { jobId: string };
    expect((await a.post("/outline/jobs", { files: UPLOAD })).status).toBe(409); // still running (Wonder has not answered)
    release();
    await waitDone(a.get, r1.jobId);
    const r2 = await req("x1-lim2").post("/outline/jobs", { files: UPLOAD });
    expect(r2.status).toBe(429);
    expect(((await r2.json()) as { error: string }).error).toMatch(/one client address may ask for 1 outlines an hour/);
    const many = Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.js`, text: "x" }));
    expect((await req("x1-lim3").post("/outline/jobs", { files: many })).status).toBe(413);
    expect((await req("x1-lim3").post("/outline/jobs", { repo: "../../etc/passwd" })).status).toBe(400);
  });

  it("Wonder giving nothing usable: the job is done with the code map and the failure, no verified outline", async () => {
    const { req } = setup({ chat: async () => answer("no") });
    const a = req("x1-fail");
    const { jobId } = (await (await a.post("/outline/jobs", { files: UPLOAD })).json()) as { jobId: string };
    expect(await waitDone(a.get, jobId)).toMatchObject({ status: "done", counts: null, wonderFailure: expect.stringMatching(/after one repair try/) });
    const file = (await (await a.get(`/outline/jobs/${jobId}/atlas`)).json()) as OutlineAtlasFile;
    expect(file.outline.verified).toBeNull();
    expect(verifyOutlineFile(file)).toMatchObject({ ok: true });
  });

  it("a GitHub job (reader stubbed): source recorded; an intake error fails the job with its reason", async () => {
    const codebase: Codebase = { ...intakeUpload(UPLOAD), source: { kind: "github", repo: "o/r", commit: "b".repeat(40), subfolder: "src" } };
    const { req } = setup({ readGithub: async () => codebase });
    const a = req("x1-gh");
    const { jobId } = (await (await a.post("/outline/jobs", { repo: "o/r", subfolder: "src" })).json()) as { jobId: string };
    expect(await waitDone(a.get, jobId)).toMatchObject({ status: "done" });
    expect(((await (await a.get(`/outline/jobs/${jobId}/outline`)).json()) as { source: unknown }).source).toEqual(codebase.source);

    const bad = setup({ readGithub: async () => Promise.reject(new OutlineIntakeError("too_many", "o/r has 80 source files; Atlas reads at most 50. Choose a subfolder.")) });
    const b = bad.req("x1-gh2");
    const j = (await (await b.post("/outline/jobs", { repo: "o/r" })).json()) as { jobId: string };
    expect(await waitDone(b.get, j.jobId)).toMatchObject({ status: "failed", error: expect.stringMatching(/Choose a subfolder/) });
    expect((await b.get(`/outline/jobs/${j.jobId}/outline`)).status).toBe(409);
  });
});
