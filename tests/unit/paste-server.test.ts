// E3: the paste flow on the server, end to end, with every model call mocked (no network, no key, $0).
// The sandbox, the gate, the judge, the seals and the proof file are real.

import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import { SEEN_CONTEXT_HEADING } from "../../server/meta/roles/claimant-bets";
import { pastedCodeModelRefusal } from "../../server/meta/pasted-guard";
import { verifyAtlasFile } from "../../src/atlasfile";
import type { AtlasFile, Bet, Run, Verdict } from "../../src/types";
import { PASTED_RUNNERS } from "../../runners/pasted-registry";

import { CLAIM, RETRY_SRC, allowedA, client, makeApp, mockModels, refusedB } from "../tools/paste-fixtures";

const env0 = process.env.ATLAS_ALLOW_CONTRIBUTOR;
afterEach(() => {
  if (env0 === undefined) delete process.env.ATLAS_ALLOW_CONTRIBUTOR;
  else process.env.ATLAS_ALLOW_CONTRIBUTOR = env0;
});

describe("POST /paste", () => {
  it("reads the language, the exports and the fingerprint; keeps the code in the session; logs no code", async () => {
    const { app, agentLog } = makeApp();
    const c = client(app);
    const r = await c.post("/paste", { code: RETRY_SRC });
    expect(r.status).toBe(200);
    expect(r.json.language.chosen).toBe("ts");
    expect(r.json.language.chosenBy).toBe("plain code");
    expect(r.json.language.why).toMatch(/type annotation/);
    expect(r.json.runnable).toBe(true);
    expect(r.json.exports.map((e: { name: string }) => e.name)).toEqual(["retryWithBackoff", "VERSION"]);
    expect(r.json.target.ref).toMatch(/^pasted:[0-9a-f]{12}$/);
    expect(r.json.target.source).toBeUndefined();
    expect(r.json.cantCheck).toBeNull();
    const lines = agentLog.history(c.session()!).map((e) => e.event.action);
    expect(lines.some((l) => /pastes one TypeScript file \(15 lines, sha256 [0-9a-f]{12}…, 2 exports\)/.test(l))).toBe(true);
    for (const l of lines) expect(l).not.toContain("fetchIt");
  });

  it("the person's language choice wins; a language with no runner shows as coming and nothing is kept", async () => {
    const { js, ts } = PASTED_RUNNERS;
    const { app } = makeApp({ paste: { runners: { js: js!, ts: ts! } } });
    const c = client(app);
    const jsr = await c.post("/paste", { code: RETRY_SRC, language: "js" });
    expect(jsr.json.language).toMatchObject({ chosen: "js", guessed: "ts", chosenBy: "person" });
    const py = await c.post("/paste", { code: "def add(a, b):\n    return a + b\n" });
    expect(py.status).toBe(200);
    expect(py.json.language.chosen).toBe("py");
    expect(py.json.runnable).toBe(false);
    expect(py.json.reason).toMatch(/Python runs are coming/);
    const langs = await c.get("/paste/languages");
    expect(langs.json.languages).toEqual([
      { language: "js", name: "JavaScript", runnable: true },
      { language: "ts", name: "TypeScript", runnable: true },
      { language: "py", name: "Python", runnable: false },
    ]);
    const exp = await c.post("/experiments", { target: { ref: py.json.target.ref, codeSha256: py.json.target.codeSha256 }, params: { shape: "call-function", exportName: "add", args: [] } });
    expect(exp.status).toBe(400);
  });

  it("Python runs now (E2's runner): a round end to end, a package refused early, a stdlib module the sandbox does not load refused with its plain reason", async () => {
    const { app } = makeApp();
    const c = client(app);
    expect((await c.get("/paste/languages")).json.languages.find((l: { language: string }) => l.language === "py")).toEqual({ language: "py", name: "Python", runnable: true });
    const py = await c.post("/paste", { code: "def add(a, b):\n    return a + b\n" });
    expect(py.json).toMatchObject({ runnable: true, cantCheck: null });
    expect(py.json.exports.map((e: { name: string }) => e.name)).toEqual(["add"]);
    const t = { ref: py.json.target.ref, codeSha256: py.json.target.codeSha256 };
    const e = await c.post("/experiments", { target: t, params: { shape: "call-function", exportName: "add", args: [{ kind: "json", value: 1 }, { kind: "json", value: 2 }] } });
    expect(e.json.seenContext).toMatch(/^Code: one pasted Python file/);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "returnedJson", answer: { kind: "json", value: 3 } }] });
    const run = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(run.json.run.controlPassed).toBe(true);
    expect(run.json.run.result.measured).toMatchObject({ outcome: "returned", returnedJson: "3" });
    expect(run.json.verdicts[0].outcome).toBe("matched");
    const pkg = await c.post("/paste", { code: "import numpy\n\ndef get(u):\n    return numpy.zeros(u)\n" });
    expect(pkg.json.cantCheck).toMatch(/numpy/);
    // U2 (D53): requests is a network library a test can fake, so the paste itself is runnable; a test without the
    // fake is refused before running, with the network reason.
    const net = await c.post("/paste", { code: "import requests\n\ndef get(u):\n    return requests.get(u).text\n" });
    expect(net.json.cantCheck).toBeNull();
    const ne = await c.post("/experiments", { target: { ref: net.json.target.ref, codeSha256: net.json.target.codeSha256 }, params: { shape: "call-function", exportName: "get", args: [{ kind: "json", value: "http://x" }] } });
    await c.post("/bets", { experimentId: ne.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
    const nr = await c.post("/runs", { experimentId: ne.json.experiment.id });
    expect(nr.json.run.result.notMeasured.wholeRun).toMatch(/calls requests \(line 1\) and this test has no fake for it/);
    const lib = await c.post("/paste", { code: "import sqlite3\n\ndef f():\n    return 1\n" });
    expect(lib.json.runnable).toBe(true);
    const le = await c.post("/experiments", { target: { ref: lib.json.target.ref, codeSha256: lib.json.target.codeSha256 }, params: { shape: "call-function", exportName: "f", args: [] } });
    await c.post("/bets", { experimentId: le.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
    const lr = await c.post("/runs", { experimentId: le.json.experiment.id });
    expect(lr.json.run.result.notMeasured.wholeRun).toMatch(/standard-library module sqlite3, which Atlas does not load into its Python sandbox/);
    expect(JSON.stringify(lr.json)).not.toMatch(/coming/);
    expect(lr.json.verdicts[0].outcome).toBe("cant_check");
  }, 120_000);

  it("a Python runner plugs in by language with no other change", async () => {
    const py = { ...PASTED_RUNNERS.js!, read: () => ({ exports: [{ name: "add", line: 1, declaredAs: "function" as const }], refusal: null }) };
    const { app } = makeApp({ paste: { runners: { ...PASTED_RUNNERS, py } } });
    const r = await client(app).post("/paste", { code: "def add(a, b):\n    return a + b\n" });
    expect(r.json.runnable).toBe(true);
    expect(r.json.exports.map((e: { name: string }) => e.name)).toEqual(["add"]);
  });

  it("refuses more than 64 KB, an empty paste and a body that is not JSON, each with a plain reason", async () => {
    const { app } = makeApp();
    const c = client(app);
    const big = await c.post("/paste", { code: `export const x = "${"a".repeat(64 * 1024)}";` });
    expect(big.status).toBe(413);
    expect(big.json.error).toMatch(/at most 65536 bytes \(64 KB\)/);
    expect((await c.post("/paste", { code: "   " })).status).toBe(400);
    expect((await c.post("/paste", { code: "x", extra: 1 })).status).toBe(400);
  });

  it("counts pastes per client address (sessions are free to make)", async () => {
    const before = process.env.ATLAS_PASTES_PER_IP_PER_HOUR;
    process.env.ATLAS_PASTES_PER_IP_PER_HOUR = "2";
    try {
      const { app } = makeApp();
      expect((await client(app).post("/paste", { code: RETRY_SRC })).status).toBe(200);
      expect((await client(app).post("/paste", { code: RETRY_SRC })).status).toBe(200);
      const third = await client(app).post("/paste", { code: RETRY_SRC });
      expect(third.status).toBe(429);
      expect(third.json.error).toMatch(/one client address may ask for 2 pastes an hour/);
    } finally {
      if (before === undefined) delete process.env.ATLAS_PASTES_PER_IP_PER_HOUR;
      else process.env.ATLAS_PASTES_PER_IP_PER_HOUR = before;
    }
  });

  it("says early when the whole run will be can't check (an import)", async () => {
    const { app } = makeApp();
    const r = await client(app).post("/paste", { code: 'import axios from "axios";\nexport async function get(u: string) { return (await axios.get(u)).data; }\n' });
    expect(r.json.cantCheck).toMatch(/the code needs axios; Atlas runs one pasted file on its own, with no packages/);
  });

  it("a pasted target belongs to its session: another session cannot use it", async () => {
    const { app } = makeApp();
    const a = client(app);
    const r = await a.post("/paste", { code: RETRY_SRC });
    const b = client(app);
    const exp = await b.post("/experiments", { target: { ref: r.json.target.ref, codeSha256: r.json.target.codeSha256 }, params: allowedA });
    expect(exp.status).toBe(400);
    expect(exp.json.error).toMatch(/unknown target/);
  });
});

describe("Muse Wonder's proposals", () => {
  it("allowed and refused proposals are both shown; the refused one can never run; the claim is held back", async () => {
    const { app, m } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const r = await c.post("/paste/proposals", { target, exportName: "retryWithBackoff" });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.display).toBe("Muse Wonder 1.0 (muse-wonder-1.0)");
    expect(m.calls[0]!.model).toBe("muse-wonder-1.0");
    expect(m.calls[0]!.role).toBe("investigator");
    expect(r.json.proposals).toHaveLength(3);
    const [a, b, cc] = r.json.proposals;
    expect(a.gate).toEqual({ allowed: true });
    expect(a.says).toMatch(/^Atlas calls retryWithBackoff\(fetchIt, 3, 100\)\. fetchIt \(async\) throws TimeoutError/);
    expect(b.gate.allowed).toBe(false);
    expect(b.gate.reason).toMatch(/never_settle needs an async stand-in/);
    expect(b.says).toBeUndefined();
    expect(cc.gate).toEqual({ allowed: true });
    expect(JSON.stringify(r.json)).not.toContain("zebra-claim-7731");

    const refused = await c.post("/experiments", { target, proposalId: b.id });
    expect(refused.status).toBe(422);
    expect(refused.json.error).toMatch(/the gate refused proposal/);

    const used = await c.post("/experiments", { target, proposalId: a.id });
    expect(used.status).toBe(200);
    expect(used.json.experiment.proposedBy).toEqual({ role: "investigator", model: "muse-wonder-1.0" });
    expect(used.json.experiment.target.source).toBeUndefined();
    const id = used.json.experiment.id;
    const early = await c.post("/paste/claim", { experimentId: id });
    expect(early.status).toBe(409);
    expect(JSON.stringify(early.json)).not.toContain("zebra-claim-7731");
    await c.post("/bets", { experimentId: id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }] });
    // E3 review B2: sealing is not enough; the claim waits until every bet is frozen (the run started).
    expect((await c.post("/paste/claim", { experimentId: id })).status).toBe(409);
    await c.post("/runs", { experimentId: id });
    const late = await c.post("/paste/claim", { experimentId: id });
    expect(late.status).toBe(200);
    expect(late.json.claim).toBe(CLAIM);
  });

  it("asks no model when the server has no proposer, and caps proposals per session", async () => {
    const { app } = makeApp({ paste: {} });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const r = await c.post("/paste/proposals", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, exportName: "retryWithBackoff" });
    expect(r.json).toMatchObject({ ok: false, reason: "not asked (this server asks no Meta model for tests)" });

    const two = makeApp();
    const c2 = client(two.app);
    const p2 = await c2.post("/paste", { code: RETRY_SRC });
    const t2 = { ref: p2.json.target.ref, codeSha256: p2.json.target.codeSha256 };
    // U2: the cap is 6 per session (was 3), so "Bet on another test" and "Test this claim" both stay usable.
    for (let i = 0; i < 6; i++) expect((await c2.post("/paste/proposals", { target: t2, exportName: "retryWithBackoff" })).json.ok).toBe(true);
    const seventh = await c2.post("/paste/proposals", { target: t2, exportName: "retryWithBackoff" });
    expect(seventh.json.reason).toMatch(/call limit reached/);
    expect(two.m.calls).toHaveLength(6);
  });
});

describe("pasted code reaches non-contributor Meta models only", () => {
  it("the guard refuses a contributor id even with ATLAS_ALLOW_CONTRIBUTOR=1, and an unknown id", () => {
    process.env.ATLAS_ALLOW_CONTRIBUTOR = "1";
    expect(pastedCodeModelRefusal("muse-wonder-1.0-contributor")).toMatch(/contributor model .*never sent to one/);
    expect(pastedCodeModelRefusal("muse-spark-1.3:Contributor")).toMatch(/contributor model/);
    expect(pastedCodeModelRefusal("gpt-x")).toMatch(/not a Meta model id Atlas knows/);
    expect(pastedCodeModelRefusal("muse-wonder-1.0")).toBeNull();
    expect(pastedCodeModelRefusal("muse-spark-1.3")).toBeNull();
    expect(pastedCodeModelRefusal("meta-models/muse-spark-open-1026")).toBeNull();
  });

  it("Wonder set to a contributor id: the chat is never called, nothing is counted or spent", async () => {
    process.env.ATLAS_ALLOW_CONTRIBUTOR = "1";
    const m = mockModels();
    const budget = createModelBudget({ spendCeilingUsd: 5 });
    const app = createApp({ modelBets: { chat: m.chat, budget }, paste: { proposer: { chat: m.chat, model: "muse-wonder-1.0-contributor" } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const r = await c.post("/paste/proposals", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, exportName: "retryWithBackoff" });
    expect(r.json.ok).toBe(false);
    expect(r.json.reason).toMatch(/contributor model/);
    expect(m.calls).toHaveLength(0);
    expect(budget.callsLastHour()).toBe(0);
    expect(budget.spentUsd()).toBe(0);
  });

  it("Spark set to a contributor id on a pasted round: no call, the slot says why; the same id still works on the fixture", async () => {
    process.env.ATLAS_ALLOW_CONTRIBUTOR = "1";
    const m = mockModels();
    const app = createApp({ modelBets: { chat: m.chat, model: "muse-spark-1.3-contributor", budget: createModelBudget({ spendCeilingUsd: 5 }) } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const exp = await c.post("/experiments", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, params: allowedA });
    expect(exp.status).toBe(200);
    const slots = await c.post(`/experiments/${exp.json.experiment.id}/model-bets`, {});
    expect(slots.json.model.status).toBe("no_usable_answer");
    expect(slots.json.model.reason).toMatch(/contributor model/);
    expect(m.calls).toHaveLength(0);
    // The public fixture is public code: there the existing switch still applies (the mocked chat is reached).
    const t = await c.post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" });
    const e2 = await c.post("/experiments", { target: { ref: t.json.ref, codeSha256: t.json.codeSha256 }, params: { shape: "retry-scenario", failTimes: 0, failure: "error" } });
    await c.post(`/experiments/${e2.json.experiment.id}/model-bets`, {});
    expect(m.calls.length).toBeGreaterThan(0);
    expect(m.calls[0]!.model).toBe("muse-spark-1.3-contributor");
  });
});

describe("D18 and D19: the betting models see exactly the bet screen's text, and never Wonder's claim", () => {
  it("Spark's and Spark Open's prompts hold the seenContext the page shows, byte for byte, and no claim", async () => {
    const { app, m } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const props = await c.post("/paste/proposals", { target, exportName: "retryWithBackoff" });
    const exp = await c.post("/experiments", { target, proposalId: props.json.proposals[0].id }, { "x-atlas-claimant": "both" });
    expect(exp.status).toBe(200);
    const seen: string = exp.json.seenContext;
    expect(seen).toContain("What will run: Atlas calls retryWithBackoff(fetchIt, 3, 100).");
    expect(seen).toContain("> 2| export async function retryWithBackoff");
    expect(seen).toContain("1. What does retryWithBackoff do? Answer: one of returned, threw, never_settled, still_running_at_watch_limit.");
    expect(seen).not.toContain("zebra-claim-7731");
    await c.post(`/experiments/${exp.json.experiment.id}/model-bets`, {});
    const bettors = m.calls.filter((a) => a.role === "claimant");
    expect(bettors.map((a) => a.model).sort()).toEqual(["meta-models/muse-spark-open-1026", "muse-spark-1.3"]);
    for (const a of bettors) {
      const user = a.messages.find((x) => x.role === "user")!.content;
      const block = user.slice(user.indexOf(SEEN_CONTEXT_HEADING) + SEEN_CONTEXT_HEADING.length + 1, user.indexOf("\n\nQUESTIONS"));
      expect(block).toBe(seen);
      for (const msg of a.messages) expect(msg.content).not.toContain("zebra-claim-7731");
    }
    // Both models got the same bytes.
    expect(bettors[0]!.messages).toEqual(bettors[1]!.messages);
  });
});

describe("a whole pasted round (real sandbox, real judge)", () => {
  it("paste → proposal → bets → run → verdicts → proof card that verifies, kept in memory only", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const props = await c.post("/paste/proposals", { target, exportName: "retryWithBackoff" });
    const exp = await c.post("/experiments", { target, proposalId: props.json.proposals[0].id });
    const id = exp.json.experiment.id;
    expect(exp.json.questions.map((q: { measures: string }) => q.measures)).toEqual(["outcome", "returnedJson", "virtualMs", "calls:fetchIt"]);
    const bets = await c.post("/bets", {
      experimentId: id,
      who: "human",
      bets: [
        { measures: "outcome", answer: { kind: "enum", value: "returned" } },
        { measures: "returnedJson", answer: { kind: "json", value: { ok: true } } },
        { measures: "calls:fetchIt", answer: { kind: "integer", value: 3 } },
      ],
    });
    expect(bets.status).toBe(200);
    const run = await c.post("/runs", { experimentId: id });
    expect(run.status).toBe(200);
    const r = run.json as { run: Run; verdicts: Verdict[]; bets: Bet[]; proof: { ok: boolean; runId: string; published: boolean } };
    expect(r.run.controlPassed).toBe(true);
    expect(r.run.result.measured).toMatchObject({ outcome: "returned", returnedJson: '{"ok":true}', virtualMs: 100, "calls:fetchIt": 2 });
    const v = (who: string, m: string) => r.verdicts.find((x) => x.betId === r.bets.find((b) => b.who === who && b.measures === m)!.id)!.outcome;
    expect(v("human", "outcome")).toBe("matched");
    expect(v("human", "returnedJson")).toBe("matched");
    expect(v("human", "calls:fetchIt")).toBe("not_matched");
    expect(v("model:muse-spark-1.3", "virtualMs")).toBe("matched");
    expect(r.proof.ok).toBe(true);
    expect(r.proof.published).toBe(false);
    const file = (await c.get(`/proofs/${r.run.id}`)).json as AtlasFile;
    expect(verifyAtlasFile(file).ok).toBe(true);
    expect(file.target.source).toBe(RETRY_SRC);
    expect(file.experiments[0]!.proposedBy).toEqual({ role: "investigator", model: "muse-wonder-1.0" });
    const replay = await c.get(`/replay/${r.run.id}`);
    expect(replay.json).toMatchObject({ measuredEqual: true, sameOutcomes: true, controlPassed: true });
  }, 60_000);

  it("code that imports a package: every verdict is can't check with the reason (never 'threw')", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: 'import axios from "axios";\nexport async function get(u: string) { return (await axios.get(u)).data; }\n' });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const exp = await c.post("/experiments", { target, params: { shape: "call-function", exportName: "get", args: [{ kind: "json", value: "https://example.com" }] } });
    expect(exp.json.experiment.proposedBy).toEqual({ role: "human" });
    await c.post("/bets", { experimentId: exp.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }] });
    const run = await c.post("/runs", { experimentId: exp.json.experiment.id });
    expect(run.json.run.result.measured.outcome).toBeUndefined();
    expect(run.json.run.result.notMeasured.wholeRun).toMatch(/the code needs axios/);
    for (const v of run.json.verdicts as Verdict[]) {
      expect(v.outcome).toBe("cant_check");
      expect(v.reason).toMatch(/axios/);
    }
  }, 60_000);

  it("a person's test the gate refuses is kept and shown with the reason, and can never run", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const exp = await c.post("/experiments", { id: "mine1", target, params: refusedB });
    expect(exp.status).toBe(422);
    expect(exp.json.error).toMatch(/gate: rejected \(.*never_settle needs an async stand-in/);
    expect(exp.json.experiment.gate.allowed).toBe(false);
    const run = await c.post("/runs", { experimentId: "mine1" });
    expect(run.status).toBe(422);
    expect(run.json.error).toMatch(/nothing ran/);
  });

  it("Muse Code and the Adversary are never asked about pasted code", async () => {
    const fixer = mockModels();
    const { app } = makeApp({ fixer: { chat: fixer.chat, museExec: null }, adversary: { chat: fixer.chat } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const exp = await c.post("/experiments", { target, params: allowedA });
    await c.post("/bets", { experimentId: exp.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
    const run = await c.post("/runs", { experimentId: exp.json.experiment.id });
    const ch = await c.post("/changes", { runId: run.json.run.id });
    expect(ch.json.reason).toMatch(/not asked \(changes to pasted code are not built yet\)/);
    const adv = await c.post("/adversary", { runId: run.json.run.id });
    expect(adv.json.reason).toMatch(/not asked \(what else on pasted code is not built yet\)/);
    expect(fixer.calls).toHaveLength(0);
  }, 60_000);
});
