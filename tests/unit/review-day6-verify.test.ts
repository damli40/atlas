// Day-6 review S1 (verify re-checks the change replay as strictly as the original), S2 ("Re-run it" re-runs
// BOTH runs), M6 (a failed replay is not cached forever) and M8 (proposedBy.model is a model id).
// Muse Code is mocked; the TS sandbox is real. Fails on the code before this commit
// (tests/evidence/D06-review/verify-tests-on-old-code.txt).

import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import type { MuseExec } from "../../server/meta/roles/fixer";
import type { ChangeAnswer } from "../../server/changes";
import { judge } from "../../src/judge";
import { verifyAtlasFile } from "../../src/atlasfile";
import type { AtlasFile, Run, Target } from "../../src/types";
import { tsRunner } from "../../runners/ts/control";
import { replayWords } from "../../web/screens/proofcard-model";
import type { ReplayAnswer } from "../../web/api";

const REF = "tests/fixtures/with-rpc-retry.ts";
const code = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const DIFF = `--- a/${REF}\n+++ b/${REF}\n@@ -51,1 +51,1 @@\n-  const delayMs = opts.delayMs ?? RPC_RETRY_DELAY_MS;\n+  const delayMs = opts.delayMs ?? 2000;\n`;
const S3 = { shape: "retry-scenario", failTimes: "always", failure: "error" };
void code;

function setup(tsReplay?: Parameters<typeof createApp>[0] extends infer O ? (O extends { tsReplay?: infer R } ? R : never) : never) {
  process.env.ATLAS_USAGE_PATH = join(mkdtempSync(join(tmpdir(), "atlas-d6v-")), "usage.jsonl");
  const museExec: MuseExec = async () => ({ ok: true, text: DIFF, model: "muse-spark-1.3", models: ["muse-spark-1.3"], usage: { promptTokens: 1, completionTokens: 1, usd: 0 } });
  const app = createApp({ agentLog: createAgentLog(), fixer: { museExec, chat: async () => ({ ok: false as const, reason: "not used" }) }, ...(tsReplay ? { tsReplay } : {}) });
  const headers = { "content-type": "application/json", "x-atlas-session": "d6-verify" };
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const get = (path: string) => app.request(path, { headers });
  return { post, get };
}

async function round(post: (p: string, b: unknown) => Response | Promise<Response>) {
  const target = (await (await post("/targets", { kind: "ts-fixture", ref: REF })).json()) as Target;
  await post("/experiments", { id: "s3", target: { ref: target.ref, codeSha256: target.codeSha256 }, params: S3 });
  await post("/bets", { experimentId: "s3", who: "human", bets: [{ measures: "totalWaitMs", answer: { kind: "integer", value: 8000 } }] });
  return ((await (await post("/runs", { experimentId: "s3" })).json()) as { run: Run }).run;
}

async function fileWithChange() {
  const { post, get } = setup();
  const run = await round(post);
  const a = (await (await post("/changes", { runId: run.id })).json()) as ChangeAnswer;
  expect(a.ok, a.ok ? "" : a.reason).toBe(true);
  const file = (await (await get(`/proofs/${run.id}`)).json()) as AtlasFile;
  expect(verifyAtlasFile(file)).toMatchObject({ ok: true });
  return { file, run, get };
}

const problems = (file: AtlasFile, edit: (x: AtlasFile) => void) => {
  const copy = JSON.parse(JSON.stringify(file)) as AtlasFile;
  edit(copy);
  // Re-judge the replay so the verdict check alone cannot be what catches the edit.
  if (copy.replay) copy.replay.verdicts = copy.bets.map((b) => judge(b, copy.replay!.run));
  const v = verifyAtlasFile(copy);
  return v.ok ? "" : v.problems.join(" | ");
};

describe("S1: a tampered change replay does not verify", () => {
  it("measured edited (and verdicts recomputed to agree) → caught by the trace", async () => {
    const { file } = await fileWithChange();
    expect(problems(file, (x) => (x.replay!.run.result.measured.totalWaitMs = 1))).toMatch(/measured totalWaitMs is 1, but its trace adds up to 8000/);
  });
  it("trace events deleted except replay_checks → caught", async () => {
    const { file } = await fileWithChange();
    expect(problems(file, (x) => (x.replay!.run.trace = x.replay!.run.trace.filter((t) => t.event === "replay_checks")))).toMatch(/replay .*: (measured|its trace)/);
  });
  it("harnessCheck.passed false while controlPassed stays true → caught", async () => {
    const { file } = await fileWithChange();
    const edit = (x: AtlasFile) => {
      const ev = x.replay!.run.trace.find((t) => t.event === "replay_checks")!;
      (ev.data!.harnessCheck as { passed: boolean }).passed = false;
    };
    expect(problems(file, edit)).toMatch(/harness check says passed = false, but its controlPassed is true/);
  });
  it("finishedAt earlier than startedAt → caught", async () => {
    const { file } = await fileWithChange();
    expect(problems(file, (x) => (x.replay!.run.finishedAt = "2000-01-01T00:00:00.000Z"))).toMatch(/finished before it started/);
  });
  it("the change caption missing → caught", async () => {
    const { file } = await fileWithChange();
    expect(problems(file, (x) => (x.captions = x.captions.filter((c) => c !== "changed toward what you expected, then re-run")))).toMatch(/does not carry the caption/);
  });
  it("M8: a sentence in proposedBy.model → refused", async () => {
    const { file } = await fileWithChange();
    expect(problems(file, (x) => (x.change!.proposedBy.model = "the person who fixed the bug"))).toMatch(/proposedBy\.model/);
  });
});

describe("S2: 'Re-run it' on a card with a change re-runs BOTH runs", () => {
  it("both re-run with the same seed: 'same result ✓' only because both match", async () => {
    const { run, get } = await fileWithChange();
    const r = (await (await get(`/replay/${run.id}`)).json()) as ReplayAnswer;
    expect(r.changeReplay).toBeDefined();
    expect(r.changeReplay && !("error" in r.changeReplay) && r.changeReplay.measuredEqual).toBe(true);
    expect(replayWords(r).text).toBe("replayed both runs (before and after the change): same result ✓");
  });
  it("when the change replay comes out differently, the card says which one differed", async () => {
    let n = 0;
    const tsReplay = async (r: Run, ch: Parameters<ReturnType<typeof tsRunner>["replayWithChange"]>[1], ctx: Parameters<ReturnType<typeof tsRunner>["replayWithChange"]>[2]) => {
      const out = await tsRunner().replayWithChange(r, ch, ctx);
      if (n++ > 0) out.result.measured.totalWaitMs = 7; // the second time (the re-run), something else
      return out;
    };
    const { post, get } = setup(tsReplay);
    const run = await round(post);
    expect(((await (await post("/changes", { runId: run.id })).json()) as ChangeAnswer).ok).toBe(true);
    const r = (await (await get(`/replay/${run.id}`)).json()) as ReplayAnswer;
    const w = replayWords(r);
    expect(w.same).toBe(false);
    expect(w.text).toBe("replayed both runs: before the change, same result; after the change, differs: measured.totalWaitMs");
  });
  it("words: a change replay that could not run is said, never 'same result'", () => {
    expect(replayWords({ measuredEqual: true, resultDiff: [], sameOutcomes: true, controlPassed: true, changeReplay: { error: "x" } }).same).toBe(false);
  });
});

describe("M6: a replay that could not finish is not cached", () => {
  it("asking again after a failed replay tries again", async () => {
    let n = 0;
    const tsReplay = async (r: Run, ch: Parameters<ReturnType<typeof tsRunner>["replayWithChange"]>[1], ctx: Parameters<ReturnType<typeof tsRunner>["replayWithChange"]>[2]) => {
      if (n++ === 0) throw new Error("the sandbox was busy");
      return tsRunner().replayWithChange(r, ch, ctx);
    };
    const { post } = setup(tsReplay);
    const run = await round(post);
    const first = (await (await post("/changes", { runId: run.id })).json()) as ChangeAnswer;
    expect(first.ok).toBe(false);
    const second = (await (await post("/changes", { runId: run.id })).json()) as ChangeAnswer;
    expect(second.ok).toBe(true);
  });
});
