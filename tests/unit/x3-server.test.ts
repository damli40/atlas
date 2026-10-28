// X3 on the real server (every model mocked, $0; sandbox, gate, judge, seals and proof files real):
// - D27: a judged round goes into the person's track record (invite code, else this browser, else the session);
//   repeats are left out and counted; the record survives a restart (on-disk store) and never holds code.
// - D27: Muse Wonder's proposal prompt gets the person's weak spots (types and counts only); the bettors' text and
//   prompts are byte-identical with and without a track record (D19).
// - D28: labels for a pasted function and for an explorer part flip from "found in this code" to "reproduced" after a
//   sealed run shows the failure, and link to that run's proof card.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { runAs } from "../../server/access/context";
import { buildProposerMessages } from "../../server/meta/roles/proposer";
import { diskTrackStore, memoryTrackStore, TRACK_DIR_NAME, type TrackStore } from "../../server/track-store";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { allowedA, makeApp, RETRY_SRC } from "../tools/paste-fixtures";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-x3-server-"));
  dirs.push(d);
  return d;
};

type App = ReturnType<typeof createApp>;
/** A client that also sends this browser's id (x-atlas-browser), like the page does. */
function client(app: App, browser: string | null, session?: string, extra: Record<string, string> = {}) {
  let s: string | null = session ?? null;
  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const h: Record<string, string> = { "content-type": "application/json", ...extra };
    if (s) h["x-atlas-session"] = s;
    if (browser) h["x-atlas-browser"] = browser;
    const res = await app.request(path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    s ??= res.headers.get("x-atlas-session");
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return { post: (p: string, b: unknown) => call("POST", p, b), get: (p: string) => call("GET", p), session: () => s };
}
type Client = ReturnType<typeof client>;

const BROWSER = "bTestBrowserId0123456789";
const NEVER = { shape: "call-function", exportName: "retryWithBackoff", args: [{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "never_settle" }], then: "repeat_last" }, { kind: "json", value: 3 }, { kind: "json", value: 100 }] };

async function paste(c: Client, code = RETRY_SRC) {
  const r = await c.post("/paste", { code });
  expect(r.status).toBe(200);
  return { ref: r.json.target.ref as string, codeSha256: r.json.target.codeSha256 as string };
}
/** One round on allowedA: fetchIt throws once, then returns {ok:true} → returned, {"ok":true}, 100 ms, 2 calls. */
async function round(c: Client, target: { ref: string; codeSha256: string }, params: unknown = allowedA, bets = [
  { measures: "outcome", answer: { kind: "enum", value: "returned" } },
  { measures: "virtualMs", answer: { kind: "number", value: 500 } },
  { measures: "calls:fetchIt", answer: { kind: "integer", value: 2 } },
]) {
  const e = await c.post("/experiments", { target, params });
  expect(e.status).toBe(200);
  const b = await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets });
  expect(b.status).toBe(200);
  const r = await c.post("/runs", { experimentId: e.json.experiment.id });
  expect(r.status).toBe(200);
  return { exp: e.json, run: r.json };
}

describe("X3 (D27) track record on the server", () => {
  it("a judged round goes into this browser's record: matched / didn't match by type, with n; the run answer has before and after", async () => {
    const { app } = makeApp();
    const c = client(app, BROWSER);
    const t = await paste(c);
    const { run } = await round(c, t);
    expect(run.run.result.measured).toMatchObject({ outcome: "returned", virtualMs: 100, "calls:fetchIt": 2 });
    expect(run.track.person).toBe("browser");
    expect(run.track.before.counted).toBe(0);
    expect(run.track.after.lines.map((l: any) => [l.type, l.n, l.matched, l.notMatched, l.cantCheck, l.over])).toEqual([
      ["outcome", 1, 1, 0, 0, 0],
      ["timing", 1, 0, 1, 0, 1],
      ["call counts", 1, 1, 0, 0, 0],
    ]);
    const got = await c.get("/track-record");
    expect(got.json).toMatchObject({ person: "browser", record: run.track.after });
    // The models' bets are not the person's record.
    expect(got.json.record.counted).toBe(3);
    // The record before this round, for the proof card.
    const before = await c.get(`/track-record?before=${run.run.id}`);
    expect(before.json.before.counted).toBe(0);
  });

  it("a repeat of a test already run is left out and counted as left out", async () => {
    const { app } = makeApp();
    const c = client(app, BROWSER);
    const t = await paste(c);
    await round(c, t);
    const again = await round(c, t);
    expect(again.exp.repeatOf).toBeDefined();
    expect(again.run.bets.filter((b: any) => b.who === "human").every((b: any) => b.repeat === true)).toBe(true);
    expect(again.run.track.after.counted).toBe(3);
    expect(again.run.track.after.excludedRepeats).toBe(3);
  });

  it("who the person is: the same browser across sessions; another browser starts empty; no browser id → the session; an invite code → the code", async () => {
    const { app } = makeApp();
    const a = client(app, BROWSER);
    await round(a, await paste(a));
    const sameBrowserNewSession = client(app, BROWSER);
    expect((await sameBrowserNewSession.get("/track-record")).json.record.counted).toBe(3);
    expect((await client(app, "bAnotherBrowser0123456789").get("/track-record")).json.record.counted).toBe(0);
    const noBrowser = client(app, null);
    await round(noBrowser, await paste(noBrowser));
    const r = await noBrowser.get("/track-record");
    expect(r.json).toMatchObject({ person: "session", record: { counted: 3 } });
    expect((await client(app, null).get("/track-record")).json.record.counted).toBe(0);
    // An invite code names the person whatever the browser says.
    const asInvite = <T>(fn: () => Promise<T>) => runAs({ kind: "invite", id: "inv_dev_1", label: "ada", role: "dev", route: "test" }, fn);
    const inv = client(app, BROWSER);
    const fromInvite = await asInvite(() => inv.get("/track-record"));
    expect(fromInvite.json).toMatchObject({ person: "invite", record: { counted: 0 } });
  });

  it("on disk: survives a restart (a new app on the same folder), and the folder holds no code, no session id and no browser id", async () => {
    const dir = tmp();
    const first = makeApp({ trackStore: diskTrackStore(dir) });
    const c = client(first.app, BROWSER);
    await round(c, await paste(c));
    const second = makeApp({ trackStore: diskTrackStore(dir) });
    const after = await client(second.app, BROWSER).get("/track-record");
    expect(after.json.record.counted).toBe(3);
    const folder = join(dir, TRACK_DIR_NAME);
    const text = readdirSync(folder).map((f) => f + readFileSync(join(folder, f), "utf8")).join("\n");
    expect(text).not.toContain("retryWithBackoff");
    expect(text).not.toContain("fetchIt");
    expect(text).not.toContain(BROWSER);
    expect(text).not.toContain(c.session()!);
  });
});

describe("X3 (D27) Wonder aims at weak spots; the bettors' text does not change (D19)", () => {
  it("Muse Wonder's prompt gets the types and counts where this person's bets didn't match, never the earlier code; a person with no record gets the prompt as before", async () => {
    const { app, m } = makeApp();
    const c = client(app, BROWSER);
    await round(c, await paste(c));
    const OTHER = "export function addOne(x: number) {\n  return x + 1; // zebraToken\n}\n";
    const t2 = await paste(c, OTHER);
    const k = m.calls.length;
    const p = await c.post("/paste/proposals", { target: t2, exportName: "addOne" });
    expect(p.status).toBe(200);
    // The first Wonder call of this request (the mock's answer is for other code, so a repair call follows it).
    const wonder = m.calls.slice(k).find((x) => x.role === "investigator")!;
    const prompt = wonder.messages.map((x) => x.content).join("\n");
    expect(prompt).toContain("THIS PERSON'S EARLIER ROUNDS");
    expect(prompt).toContain("timing (1 of 1 didn't match; guessed lower than the run 0, higher 1)");
    expect(prompt).not.toContain("retryWithBackoff");
    expect(prompt).not.toContain("fetchIt");
    expect(p.json.aimedAt).toMatch(/^In this person's earlier rounds/);
    // Nobody else's record: a fresh browser gets exactly the pre-X3 prompt.
    const fresh = client(app, "bFreshBrowser0123456789");
    const t3 = await paste(fresh, OTHER);
    const k3 = m.calls.length;
    await fresh.post("/paste/proposals", { target: t3, exportName: "addOne" });
    const plain = m.calls.slice(k3).find((x) => x.role === "investigator")!;
    expect(plain.messages).toEqual(buildProposerMessages({ source: OTHER, language: "ts", exportName: "addOne", exportLine: 1, exportNames: ["addOne"] }));
  });

  it("the bet screen's text and every betting model's prompt are byte-identical with and without a track record", async () => {
    const withRecord: TrackStore = memoryTrackStore();
    // A long record for this browser, with plenty that didn't match.
    withRecord.add({ kind: "browser", id: BROWSER }, Array.from({ length: 12 }, (_, i) => ({ runId: `r${i}`, betId: `b${i}`, sealedHash: "c".repeat(64), type: i % 2 ? ("timing" as const) : ("call counts" as const), outcome: "not_matched" as const, repeat: false, side: "under" as const, at: "2026-10-28T10:00:00.000Z" })));
    const run = async (store: TrackStore) => {
      const { app, m } = makeApp({ trackStore: store });
      const c = client(app, BROWSER, undefined, { "x-atlas-claimant": "both" });
      const t = await paste(c);
      const e = await c.post("/experiments", { target: t, params: allowedA });
      await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
      const bettors = m.calls.filter((x) => x.role === "claimant");
      return { seen: e.json.seenContext as string, prompts: bettors.map((x) => JSON.stringify(x.messages)) };
    };
    const a = await run(withRecord);
    const b = await run(memoryTrackStore());
    expect(a.prompts.length).toBe(2); // Muse Spark and Muse Spark Open
    expect(a.seen).toBe(b.seen);
    expect(a.prompts).toEqual(b.prompts);
    for (const p of a.prompts) expect(p).not.toMatch(/track record|didn't match|earlier rounds/);
  });
});

describe("X3 (D28) labels on the server", () => {
  it("a pasted retry with no deadline: 'found in this code' with its lines → a sealed never-answers run → 'reproduced', linked to its proof card", async () => {
    const { app } = makeApp();
    const c = client(app, BROWSER);
    const t = await paste(c);
    const before = await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" });
    expect(before.status).toBe(200);
    const nt = before.json.labels.find((l: any) => l.failure === "no-overall-timeout");
    expect(nt).toMatchObject({ label: "found in this code", lines: [{ lineStart: 4, lineEnd: 11 }] });
    expect(before.json.read).toBe("pasted lines 2–13");
    const { run } = await round(c, t, NEVER, [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }]);
    expect(["never_settled", "still_running_at_watch_limit"]).toContain(run.run.result.measured.outcome);
    expect(run.proof.ok).toBe(true);
    const after = await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" });
    const nt2 = after.json.labels.find((l: any) => l.failure === "no-overall-timeout");
    expect(nt2).toMatchObject({ label: "reproduced", runId: run.run.id });
    expect((await c.get(`/proofs/${run.run.id}`)).status).toBe(200);
    // Another session cannot read this paste's labels.
    expect((await client(app, BROWSER).post("/paste/labels", { target: t, exportName: "retryWithBackoff" })).status).toBe(404);
  });

  it("a run that comes back can't check makes the label 'inconclusive'", async () => {
    const { app } = makeApp();
    const c = client(app, BROWSER);
    const code = RETRY_SRC.replace("// a small retry", 'import axios from "axios";\n// a small retry');
    const t = await paste(c, code);
    const { run } = await round(c, t, NEVER, [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }]);
    expect(run.run.result.notMeasured.wholeRun).toMatch(/axios/);
    const l = (await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" })).json.labels.find((x: any) => x.failure === "no-overall-timeout");
    expect(l).toMatchObject({ label: "inconclusive", runId: run.run.id });
  });

  it("an explorer part: Wonder's tag lists the kind, plain code decides; after a round on the part's function the label is 'reproduced'", async () => {
    const n = RETRY_SRC.split("\n").length - 1;
    const outline = JSON.stringify({
      parts: [{ id: "retry", name: "Retry helper", purpose: "Retries a call.", files: [{ path: "retry.ts", lineStart: 1, lineEnd: n, quotedSnippet: RETRY_SRC.split("\n")[0] }], patterns: ["retry", "queue"] }],
      joins: [],
    });
    const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
    const outliner = async (_a: ChatArgs): Promise<ChatResult> => ({ ok: true, finishReason: "stop", usage, content: outline });
    const { app } = makeApp({ outline: { outliner: { chat: outliner } } });
    const c = client(app, BROWSER);
    const job = await c.post("/outline/jobs", { files: [{ path: "retry.ts", text: RETRY_SRC }] });
    expect(job.status).toBe(202);
    for (let i = 0; i < 200; i++) {
      const j = await c.get(`/outline/jobs/${job.json.jobId}`);
      if (j.json.status === "done" || j.json.status === "failed") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const first = await c.get(`/outline/jobs/${job.json.jobId}/labels`);
    expect(first.status).toBe(200);
    const part = first.json.parts.retry;
    expect(part.labels.find((l: any) => l.failure === "no-overall-timeout")).toMatchObject({ label: "found in this code", kindBy: { wonder: { tag: "retry" } } });
    // Wonder tagged "queue"; plain code saw no queue marker, so it is only a common pattern.
    expect(part.labels.find((l: any) => l.failure === "duplicate-delivery")).toMatchObject({ label: "common pattern", kindBy: { wonder: { tag: "queue" } } });
    // "Bet on this part": the file goes to the paste flow unchanged; a never-answers round reproduces it.
    const t = await paste(c);
    const { run } = await round(c, t, NEVER, [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }]);
    const again = await c.get(`/outline/jobs/${job.json.jobId}/labels`);
    expect(again.json.parts.retry.labels.find((l: any) => l.failure === "no-overall-timeout")).toMatchObject({ label: "reproduced", runId: run.run.id });
    // Another session: 404.
    expect((await client(app, BROWSER).get(`/outline/jobs/${job.json.jobId}/labels`)).status).toBe(404);
  });
});

describe("X3 review round 1 on the server", () => {
  it("M2: while a round on this code has the person's bets still to seal, both label routes answer 409; after the seal, 200", async () => {
    const n = RETRY_SRC.split("\n").length - 1;
    const outline = JSON.stringify({ parts: [{ id: "retry", name: "Retry helper", purpose: "Retries.", files: [{ path: "retry.ts", lineStart: 1, lineEnd: n, quotedSnippet: RETRY_SRC.split("\n")[0] }], patterns: ["retry"] }], joins: [] });
    const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
    const { app } = makeApp({ outline: { outliner: { chat: async () => ({ ok: true, finishReason: "stop", usage, content: outline }) } } });
    const c = client(app, BROWSER);
    const job = await c.post("/outline/jobs", { files: [{ path: "retry.ts", text: RETRY_SRC }] });
    for (let i = 0; i < 200; i++) {
      const j = await c.get(`/outline/jobs/${job.json.jobId}`);
      if (j.json.status === "done" || j.json.status === "failed") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const t = await paste(c);
    expect((await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" })).status).toBe(200);
    const e = await c.post("/experiments", { target: t, params: NEVER });
    const held = await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" });
    expect(held.status).toBe(409);
    expect(held.json.error).toMatch(/once your bets on the open round are sealed/);
    expect((await c.get(`/outline/jobs/${job.json.jobId}/labels`)).status).toBe(409);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }] });
    expect((await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" })).status).toBe(200);
    expect((await c.get(`/outline/jobs/${job.json.jobId}/labels`)).status).toBe(200);
  });

  it("M3: label requests are limited per client an hour; the scan is cached (the same answer, fast)", async () => {
    const env0 = process.env.ATLAS_LABELS_PER_IP_PER_HOUR;
    process.env.ATLAS_LABELS_PER_IP_PER_HOUR = "3";
    try {
      const { app } = makeApp();
      const c = client(app, BROWSER);
      const t = await paste(c);
      const first = await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" });
      const second = await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" });
      expect(second.json).toEqual(first.json);
      await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" });
      const over = await c.post("/paste/labels", { target: t, exportName: "retryWithBackoff" });
      expect(over.status).toBe(429);
      expect(over.json.error).toMatch(/labels not read/);
    } finally {
      if (env0 === undefined) delete process.env.ATLAS_LABELS_PER_IP_PER_HOUR;
      else process.env.ATLAS_LABELS_PER_IP_PER_HOUR = env0;
    }
  });

  it("M3: the reviewer's 61 KB paste: POST /paste/labels answers in under 50 ms", async () => {
    const { app } = makeApp();
    const c = client(app, BROWSER);
    const N = 998;
    const code = "export function g() {\n" + ("for(;;){" + " ".repeat(22) + "\n").repeat(N) + ("}" + " ".repeat(28) + "\n").repeat(N) + "}\n";
    const t = await paste(c, code);
    const t0 = performance.now();
    const r = await c.post("/paste/labels", { target: t, exportName: "g" });
    expect(r.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("B4 through the real sandbox: a batch loop where send fails 25 times is never 'retry storm: reproduced'", async () => {
    const { app } = makeApp();
    const c = client(app, BROWSER);
    const code = "export async function notifyAll(send: (id: number) => Promise<void>, ids: number[]) {\n  const failed: number[] = [];\n  for (const id of ids) {\n    try {\n      await send(id);\n    } catch (e) {\n      failed.push(id);\n    }\n  }\n  return failed.length;\n}\n";
    const t = await paste(c, code);
    const ids = Array.from({ length: 25 }, (_, i) => i);
    const { run } = await round(c, t, { shape: "call-function", exportName: "notifyAll", args: [{ kind: "stand-in", name: "send", async: true, calls: [{ do: "throw", errorName: "Error", message: "down" }], then: "repeat_last" }, { kind: "json", value: ids }] }, [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }]);
    expect(run.run.result.measured["calls:send"]).toBe(25);
    const l = await c.post("/paste/labels", { target: t, exportName: "notifyAll" });
    expect(l.json.labels.filter((x: any) => x.label !== "common pattern")).toEqual([]);
  });
});
