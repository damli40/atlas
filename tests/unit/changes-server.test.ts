// D06-01 server side: POST /changes {runId} with a MOCKED Muse Code and the real TS sandbox.
// The same sealed bets are judged before and after; the replay keeps the seed; one change per run;
// no Fixer configured = "not asked". The diff below is test data, not a model's answer.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { CHANGE_CAPTION, type MuseExec } from "../../server/meta/roles/fixer";
import type { ChangeAnswer } from "../../server/changes";
import type { Target } from "../../src/types";

const REF = "tests/fixtures/with-rpc-retry.ts";
const code = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const S6 = { shape: "retry-scenario", failTimes: "always", failure: "never_settles" };

function diffOf(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-difftest-"));
  try {
    writeFileSync(join(dir, "a"), before);
    writeFileSync(join(dir, "b"), after);
    try {
      execFileSync("git", ["diff", "--no-index", "--no-color", "a", "b"], { cwd: dir, encoding: "utf8" });
      return "";
    } catch (e) {
      return String((e as { stdout?: string }).stdout).replaceAll("a/a", `a/${REF}`).replaceAll("b/b", `b/${REF}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const DIFF = diffOf(code, code.replace("    try { return await fn(); }", "    try { return await Promise.race([fn(), sleep(2000).then(() => { throw new Error(`${label}: no answer within 2000 ms`); })]); }"));

function setup(fixer?: { museExec: MuseExec }) {
  const agentLog = createAgentLog();
  const usagePath = join(mkdtempSync(join(tmpdir(), "atlas-changes-usage-")), "usage.jsonl");
  process.env.ATLAS_USAGE_PATH = usagePath;
  const app = createApp({ agentLog, ...(fixer ? { fixer: { museExec: fixer.museExec, chat: async () => ({ ok: false as const, reason: "not used" }) } } : {}) });
  const session = "changes-test";
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": session }, body: JSON.stringify(body) });
  return { app, post, agentLog, session };
}

async function round(post: (p: string, b: unknown) => Response | Promise<Response>) {
  const target = (await (await post("/targets", { kind: "ts-fixture", ref: REF })).json()) as Target;
  await post("/experiments", { id: "s6", target: { ref: target.ref, codeSha256: target.codeSha256 }, params: S6 });
  await post("/bets", { experimentId: "s6", who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }, { measures: "outcome", answer: { kind: "enum", value: "throws" } }] });
  const run = (await (await post("/runs", { experimentId: "s6" })).json()) as { run: { id: string; seed: string } };
  return run.run;
}

describe("POST /changes", () => {
  it("proposes, checks, replays with the same seed, and judges the SAME bets before and after", async () => {
    let calls = 0;
    const museExec: MuseExec = async () => (calls++, { ok: true, text: DIFF, model: "muse-spark-1.3", usage: { promptTokens: 10, completionTokens: 5, usd: 0.0001 } });
    const { app, post, agentLog, session } = setup({ museExec });
    const run = await round(post);
    const res = await post("/changes", { runId: run.id });
    expect(res.status).toBe(200);
    const a = (await res.json()) as ChangeAnswer;
    expect(a.ok, a.ok ? "" : a.reason).toBe(true);
    if (!a.ok) return;
    expect(a.caption).toBe(CHANGE_CAPTION);
    expect(a.diff).toBe(DIFF);
    expect(a.change.proposedBy).toEqual({ role: "fixer", model: "muse-spark-1.3" });
    expect(a.change.toward).toContain("The person bet on");
    expect(a.replay.seed).toBe(run.seed);
    expect(a.after.run.seed).toBe(a.before.run.seed);
    expect(a.before.verdicts.map((v) => v.betId)).toEqual(a.after.verdicts.map((v) => v.betId));
    const outcomeBet = a.bets.find((b) => b.measures === "outcome")!;
    expect(a.before.verdicts.find((v) => v.betId === outcomeBet.id)!.outcome).toBe("not_matched");
    expect(a.after.verdicts.find((v) => v.betId === outcomeBet.id)!.outcome).toBe("matched");
    const callsBet = a.bets.find((b) => b.measures === "calls")!;
    expect(a.after.verdicts.find((v) => v.betId === callsBet.id)!.outcome).toBe("matched");
    // The agent log: a fixer line with the model id and usage, the runner's replay line, the judge's line.
    const ev = agentLog.history(session).map((e) => e.event);
    const fixerLine = ev.find((e) => e.role === "fixer")!;
    expect(fixerLine.model).toBe("muse-spark-1.3");
    expect(fixerLine.action).toMatch(/^Muse Code \(muse exec, muse-spark-1.3\) proposes a change to tests\/fixtures\/with-rpc-retry.ts/);
    expect(ev.some((e) => e.role === "runner" && /same seed/.test(e.action))).toBe(true);
    // D06-01: the change and its replay are in the round's .atlas.json, and verify recomputes them.
    const { verifyAtlasFile } = await import("../../src/atlasfile");
    const file = (await (await app.request(`/proofs/${run.id}`)).json()) as import("../../src/types").AtlasFile;
    expect(file.change?.id).toBe(a.change.id);
    expect(file.replay?.run.id).toBe(a.replay.id);
    expect(verifyAtlasFile(file)).toMatchObject({ ok: true });
    const tamper = (f: (x: typeof file) => void) => {
      const copy = JSON.parse(JSON.stringify(file)) as typeof file;
      f(copy);
      const v = verifyAtlasFile(copy);
      return v.ok ? [] : v.problems;
    };
    expect(tamper((x) => (x.replay!.verdicts[0]!.outcome = "cant_check")).join(" ")).toMatch(/replay verdict on bet .* is not what src\/judge.ts gives/);
    expect(tamper((x) => (x.replay!.run.seed = "other")).join(" ")).toMatch(/the replay used seed other/);
    expect(tamper((x) => (x.change!.diff = x.change!.diff.replace("2000", "3000"))).join(" ")).toMatch(/the diff applied to the code gives/);
    expect(tamper((x) => (x.change!.toward = "- anything")).join(" ")).toMatch(/toward/);
    expect(tamper((x) => delete x.replay).join(" ")).toMatch(/must come together/);
    // Asking again gives the same answer, with no second model call.
    const again = (await (await post("/changes", { runId: run.id })).json()) as ChangeAnswer;
    expect(again.ok && again.change.id).toBe(a.change.id);
    expect(calls).toBe(1);
  });

  it("no Fixer on this server: 'not asked', nothing replays; unknown run: 404", async () => {
    const { post } = setup();
    const run = await round(post);
    const a = (await (await post("/changes", { runId: run.id })).json()) as ChangeAnswer;
    expect(a).toMatchObject({ ok: false, reason: "Muse Code: not asked (this server asks no Meta model for changes)" });
    expect((await post("/changes", { runId: "nope" })).status).toBe(404);
  });

  it("a refused change says 'Muse Code: no usable change (<reason>)' and nothing replays", async () => {
    const bad = DIFF.replaceAll(REF, "chains/8453.json");
    const { post } = setup({ museExec: async () => ({ ok: true, text: bad, model: "muse-spark-1.3", usage: { promptTokens: 1, completionTokens: 1, usd: 0 } }) });
    const run = await round(post);
    const a = (await (await post("/changes", { runId: run.id })).json()) as ChangeAnswer;
    expect(a.ok).toBe(false);
    // S5 (day-6): a path the model wrote that is not a file of this target is described, never quoted.
    expect(!a.ok && a.reason).toMatch(/^Muse Code: no usable change \(the diff touches a file outside this target/);
    expect(a).not.toHaveProperty("replay");
  });
});
