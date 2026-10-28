// E3 review round 2: one test (or more) per finding. Models mocked; sandbox, gate, judge and seals real.

import "../tools/jsdom-globals";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { localExecutor } from "../../runners/executor/local";
import { pythonSandboxExecutor } from "../../runners/executor/sandbox-exec-python";
import { createApp } from "../../server/app";
import { describeClientRule, trustedHopsFromEnv } from "../../server/client-ip";
import { createProofStore } from "../../server/evm-round";
import { createModelBudget } from "../../server/meta/budget";
import { MAX_PASTED_PROMPT_CHARS, guardPastedChat } from "../../server/meta/pasted-guard";
import { buildBetOnlyMessages, pastedSeenCap } from "../../server/meta/roles/claimant-bets";
import { MAX_PASTED_ROUNDS_PER_SESSION } from "../../server/paste";
import { removeSandboxLeftovers } from "../../server/sandbox-leftovers";
import { serverOptions } from "../../server/wiring";
import { BOUNDS, gate, questionsFor } from "../../src/gate";
import { pastedFileBlock } from "../../src/paste-context";
import { verifySeal } from "../../src/seal";
import type { Run } from "../../src/types";
import { CallTimeline } from "../../web/machines/calltimeline/CallTimeline";
import { timelineModel } from "../../web/machines/calltimeline/model";
import { RETRY_SRC, allowedA, client, makeApp, mockModels } from "../tools/paste-fixtures";
import { mkdirSync, mkdtempSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tgt = (p: { json: Record<string, any> }) => ({ ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 });
const outcome = (v: string) => ({ measures: "outcome", answer: { kind: "enum", value: v } });

describe("r2 B1: a cut trace states only exact counts", () => {
  const MANY = "export async function many(f, g, n){ let s=0; for(let i=0;i<n;i++) s+=f(); if(n>0) s+=await g(); return s; }\n";
  const run = async (n: number): Promise<Run> => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: MANY });
    const e = await c.post("/experiments", {
      target: tgt(p),
      params: { shape: "call-function", exportName: "many", args: [{ kind: "stand-in", name: "f", async: false, calls: [{ do: "return", value: 1 }], then: "repeat_last" }, { kind: "stand-in", name: "g", async: true, calls: [{ do: "return", value: 1, afterMs: 5 }], then: "repeat_last" }, { kind: "json", value: n }] },
    });
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    return (await c.post("/runs", { experimentId: e.json.experiment.id })).json.run as Run;
  };
  for (const n of [499, 1000]) {
    it(`the reviewer's case, n = ${n}: no "stopped watching", no answer breakdown, the counts exact`, async () => {
      const r = await run(n);
      expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 5, returnedJson: String(n + 1), "calls:f": n, "calls:g": 1 });
      expect(r.trace.some((t) => t.event === "trace_cut")).toBe(true);
      const m = timelineModel(r);
      expect(m.detail).toBe(`f: ${n.toLocaleString("en-US")} calls · g: 1 call`);
      const h = renderToStaticMarkup(<CallTimeline run={r} still theme="light" />);
      expect(h).not.toMatch(/stopped watching|not answered|returned\)/);
      expect(h).toContain("returned at 5 ms");
    }, 60_000);
  }
});

describe("r2 B2: the bettor text names the language that runs", () => {
  const ADD = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
  const params = { shape: "call-function", exportName: "add", args: [{ kind: "json", value: 1 }, { kind: "json", value: 2 }] };
  it("paste as JS, test; re-paste as TS, same test: TypeScript. Another session, TS, same test: TypeScript", async () => {
    const { app } = makeApp();
    const a = client(app);
    const p1 = await a.post("/paste", { code: ADD, language: "js" });
    expect((await a.post("/experiments", { target: tgt(p1), params })).json.seenContext).toMatch(/^Code: one pasted JavaScript file/);
    const p2 = await a.post("/paste", { code: ADD, language: "ts" });
    expect((await a.post("/experiments", { target: tgt(p2), params })).json.seenContext).toMatch(/^Code: one pasted TypeScript file/);
    const b = client(app);
    const p3 = await b.post("/paste", { code: ADD, language: "ts" });
    expect((await b.post("/experiments", { target: tgt(p3), params })).json.seenContext).toMatch(/^Code: one pasted TypeScript file/);
  });
});

describe("r2 B3: every text of a test counts, measured as bettors read it; nothing refused is kept; rounds are capped", () => {
  it("messages and names count toward the 4,096 budget, each hidden character as its 6-character escape", () => {
    const ctx = { shapes: ["call-function"] as const, exportNames: ["f"] };
    const steps = (msg: string) => [{ kind: "stand-in", name: "g", async: false, calls: Array.from({ length: 50 }, () => ({ do: "throw", errorName: "E", message: msg })), then: "repeat_last" }];
    // 50 messages of 50 U+0085: 2,500 raw characters, 15,000 as escapes: refused.
    const hidden = gate({ shape: "call-function", exportName: "f", args: steps("\u0085".repeat(50)) }, { ...ctx, shapes: [...ctx.shapes] });
    expect(hidden.allowed).toBe(false);
    if (!hidden.allowed) expect(hidden.reason).toMatch(/names and messages, with hidden characters written as escapes\) are 15\d{3} characters; the limit is 4096/);
    // The same count of plain characters fits only when it is under the budget.
    const plain = gate({ shape: "call-function", exportName: "f", args: steps("m".repeat(79)) }, { ...ctx, shapes: [...ctx.shapes] });
    expect(plain.allowed).toBe(true); // 1 + 50 × (1 + 79) = 4,001 ≤ 4,096
    const over = gate({ shape: "call-function", exportName: "f", args: steps("m".repeat(81)) }, { ...ctx, shapes: [...ctx.shapes] });
    expect(over.allowed).toBe(false); // 1 + 50 × 82 = 4,101
    expect(BOUNDS.argsJsonChars).toBe(4096);
  });

  it("25 distinct tests on the largest file keep ONE numbered file and only their small test parts", async () => {
    let stats: () => { contexts: number; blocks: number } = () => ({ contexts: -1, blocks: -1 });
    const { app } = makeApp({ paste: { expose: (p) => (stats = p.stats) } });
    const c = client(app);
    const code = "export function f(a){return a}\n" + "\n".repeat(1_990) + "// " + "x".repeat(60_000) + "\n";
    const p = await c.post("/paste", { code });
    const sizes: number[] = [];
    for (let i = 0; i < 25; i++) {
      const e = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: i }] } });
      expect(e.status).toBe(200);
      sizes.push(e.json.seenContext.length);
    }
    expect(stats().contexts).toBe(25);
    expect(stats().blocks).toBe(1);
    expect(new Set(sizes).size).toBeLessThanOrEqual(2); // only the number in the test changes
  }, 60_000);

  it(`a session keeps at most ${MAX_PASTED_ROUNDS_PER_SESSION} pasted rounds: its oldest is dropped (never one that is running)`, async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const ids: string[] = [];
    for (let i = 0; i < MAX_PASTED_ROUNDS_PER_SESSION + 3; i++) ids.push((await c.post("/experiments", { target: tgt(p), params: { ...allowedA, watchLimitMs: 1000 + i } })).json.experiment.id);
    expect((await c.post("/bets", { experimentId: ids[0], who: "human", bets: [outcome("returned")] })).status).toBe(404);
    expect((await c.post("/bets", { experimentId: ids.at(-1), who: "human", bets: [outcome("returned")] })).status).toBe(200);
  });
});

describe("r2 M2 (coordinator's decision): a repeat is accepted, said, and its bets sealed with repeat: true", () => {
  it("the same test after a run: 200, 'a repeat' in the bettor text, every bet (person and model) repeat: true and sealed", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const e1 = await c.post("/experiments", { target: tgt(p), params: allowedA });
    await c.post("/bets", { experimentId: e1.json.experiment.id, who: "human", bets: [outcome("returned")] });
    await c.post("/runs", { experimentId: e1.json.experiment.id });
    const e2 = await c.post("/experiments", { target: tgt(p), params: allowedA });
    expect(e2.status).toBe(200);
    expect(e2.json.repeatOf).toBe(e1.json.experiment.id);
    expect(e2.json.seenContext).toContain(`This test is a repeat of a test already run in this session (${e1.json.experiment.id})`);
    await c.post("/bets", { experimentId: e2.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const r2 = await c.post("/runs", { experimentId: e2.json.experiment.id });
    expect(r2.json.bets.length).toBeGreaterThan(1);
    for (const b of r2.json.bets) {
      expect(b.repeat).toBe(true);
      expect(verifySeal(b)).toBe(true);
      expect(verifySeal({ ...b, repeat: undefined })).toBe(false);
    }
  }, 60_000);
});

describe("r2 M3: one size limit, derived from the prompt cap", () => {
  it("a bettor text of exactly the cap makes a prompt of exactly the prompt cap, which the guard sends; one more is refused", async () => {
    const questions = questionsFor({ shape: "call-function", exportName: "f", args: [] }, {});
    const cap = pastedSeenCap(questions, MAX_PASTED_PROMPT_CHARS);
    const msgs = (n: number) => buildBetOnlyMessages({ seenContext: "x".repeat(n), seenInstruction: null, questions } as never);
    expect(msgs(cap).reduce((k, m) => k + m.content.length, 0)).toBe(MAX_PASTED_PROMPT_CHARS);
    let sent = 0;
    const chat = guardPastedChat(async () => {
      sent++;
      return { ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, usd: 0 } };
    });
    expect((await chat({ role: "claimant", model: "muse-spark-1.3", messages: msgs(cap) })).ok).toBe(true);
    expect((await chat({ role: "claimant", model: "muse-spark-1.3", messages: msgs(cap + 1) })).ok).toBe(false);
    expect(sent).toBe(1);
  });
});

describe("r2 M4: the proxy-hop setting", () => {
  it("an invalid value throws (the server refuses to start); valid values and unset work; the rule is described", () => {
    for (const bad of ["0", "11", "abc", "", "1.5"]) expect(() => trustedHopsFromEnv({ ATLAS_TRUST_PROXY_HOPS: bad })).toThrow(/ATLAS_TRUST_PROXY_HOPS must be a whole number from 1 to 10/);
    expect(trustedHopsFromEnv({})).toBe(1);
    expect(trustedHopsFromEnv({ ATLAS_TRUST_PROXY_HOPS: "2" })).toBe(2);
    expect(describeClientRule(true, 1)).toMatch(/right-most address in X-Forwarded-For/);
    expect(describeClientRule(false, 1)).toMatch(/socket's remote address/);
    const before = process.env.ATLAS_TRUST_PROXY_HOPS;
    process.env.ATLAS_TRUST_PROXY_HOPS = "zero";
    try {
      expect(() => createApp()).toThrow(/ATLAS_TRUST_PROXY_HOPS/);
    } finally {
      if (before === undefined) delete process.env.ATLAS_TRUST_PROXY_HOPS;
      else process.env.ATLAS_TRUST_PROXY_HOPS = before;
    }
  });
});

describe("r2 M1: privacy", () => {
  it("a stranger's proof view has no source and no session log; the owner's has both", async () => {
    const { app } = makeApp();
    const a = client(app);
    const p = await a.post("/paste", { code: RETRY_SRC });
    const e = await a.post("/experiments", { target: tgt(p), params: allowedA });
    await a.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const id = (await a.post("/runs", { experimentId: e.json.experiment.id })).json.run.id;
    const mine = (await a.get(`/proofs/${id}`)).json;
    expect(mine.agentLog.length).toBeGreaterThan(0);
    const theirs = (await client(app).get(`/proofs/${id}`)).json;
    expect(theirs.agentLog).toEqual([]);
    expect(theirs.target.source).toBeUndefined();
    expect(theirs.verdicts.length).toBe(mine.verdicts.length);
  }, 60_000);

  it("leftover sandbox folders older than 10 minutes are deleted at startup; younger ones and other folders are left", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-leftover-test-"));
    const old = join(dir, "atlas-exec-old");
    const young = join(dir, "atlas-pyexec-young");
    const other = join(dir, "someone-else");
    for (const d of [old, young, other]) mkdirSync(d);
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(old, longAgo, longAgo);
    utimesSync(other, longAgo, longAgo);
    expect(removeSandboxLeftovers(dir)).toBe(1);
    expect([existsSync(old), existsSync(young), existsSync(other)]).toEqual([false, true, true]);
  });
});

describe("r2 minors", () => {
  it("minor 1: a proposer-only server keeps the shared spend ceiling", async () => {
    const m = mockModels();
    const budget = createModelBudget({ spendCeilingUsd: 1, spentAtStartUsd: 1 }); // already at the ceiling
    const opts = serverOptions({ ATLAS_MODEL_BETS: "off", ATLAS_INVESTIGATOR: "off", ATLAS_FIXER: "off", ATLAS_ADVERSARY: "off" }, { makeChat: () => m.chat, budget, sparkOpen: { available: false, reason: "test" }, proofs: createProofStore({ publish: false }), refusals: () => {} });
    const c = client(createApp(opts));
    const p = await c.post("/paste", { code: RETRY_SRC });
    const r = await c.post("/paste/proposals", { target: tgt(p), exportName: "retryWithBackoff" });
    expect(r.json.ok).toBe(false);
    expect(m.calls).toHaveLength(0);
  });

  it("minor 2: a lone CR is refused with a fix; U+2028 counts as a line toward the cap", async () => {
    const { app } = makeApp();
    const c = client(app);
    const cr = await c.post("/paste", { code: "export function f(){return 1}\rexport function g(){return 2}\r" });
    expect(cr.status).toBe(400);
    expect(cr.json.error).toMatch(/lone carriage return/);
    const ls = await c.post("/paste", { code: "export function f(){return 1}" + " ".repeat(2_001) });
    expect(ls.status).toBe(413);
  });

  it("minor 5: no owner on record → the source is withheld even with no session header", async () => {
    const { app } = makeApp();
    const a = client(app);
    const p = await a.post("/paste", { code: RETRY_SRC });
    const e = await a.post("/experiments", { target: tgt(p), params: allowedA });
    await a.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const id = (await a.post("/runs", { experimentId: e.json.experiment.id })).json.run.id;
    const none = (await (await app.request(`/proofs/${id}`)).json()) as Record<string, any>;
    expect(none.target.source).toBeUndefined();
  }, 60_000);

  it("minor 6: hidden and direction characters in the file are escaped in the bettor text", () => {
    const block = pastedFileBlock("const a = 'x‮y';\nexport const b = 1;\n", 2);
    expect(block).toBe("  1| const a = 'x\\u202ey';\n> 2| export const b = 1;");
  });
});

describe("after E4: pasted code runs on the executor the server chose (ATLAS_EXECUTOR), with E4's control reuse", () => {
  it("with a (fake) Modal executor, a pasted JS round and a pasted Python round both run on it; the proof files name modal and the control relied on", async () => {
    const { createModalExecutor } = await import("../../runners/executor/modal.ts");
    const { emulatingBackend } = await import("./modal-fakes");
    const { forgetReusableControls } = await import("../../runners/ts/call-runner.ts");
    forgetReusableControls();
    const b = emulatingBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const spy = vi.spyOn(localExecutor, "exec");
    const pySpy = vi.spyOn(pythonSandboxExecutor, "exec");
    const m = mockModels();
    const app = createApp({ executor: ex, modelBets: { chat: m.chat, budget: createModelBudget() } });
    const c = client(app);
    for (const [code, fn] of [["export function add(a, b) { return a + b; }\n", "add"], ["def add(a, b):\n    return a + b\n", "add"]] as const) {
      const p = await c.post("/paste", { code });
      const e = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: fn, args: [{ kind: "json", value: 1 }, { kind: "json", value: 2 }] } });
      await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "returnedJson", answer: { kind: "json", value: 3 } }] });
      const r = await c.post("/runs", { experimentId: e.json.experiment.id });
      expect(r.json.run.executor).toBe("modal");
      expect(r.json.run.result.measured).toMatchObject({ outcome: "returned", returnedJson: "3" });
      const file = (await c.get(`/proofs/${r.json.run.id}`)).json;
      expect(file.runs[0].executor).toBe("modal");
      expect(file.runs[0].controlPassed).toBe(true);
      const checks = file.runs[0].trace.find((t: { event: string }) => t.event === "call_checks").data;
      expect(checks.controlRunId).toBe(file.runs[0].controlRunId);
      expect(typeof checks.controlRunId).toBe("string");
    }
    expect(spy).not.toHaveBeenCalled();
    expect(pySpy).not.toHaveBeenCalled();
    pySpy.mockRestore();
    expect(b.rec.specs.length).toBeGreaterThanOrEqual(4); // 2 controls + 2 runs, every one a Modal sandbox
    spy.mockRestore();
  }, 120_000);
});

describe("model bets on the returned value (json kind), and the one bet-context builder", () => {
  const ADD = "export function add(a, b) { return { sum: a + b }; }\n";
  const params = { shape: "call-function", exportName: "add", args: [{ kind: "json", value: 1 }, { kind: "json", value: 2 }] };
  const answer = (value: unknown) => ({ ok: true as const, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 }, content: JSON.stringify({ bets: [{ measures: "returnedJson", answer: { kind: "json", value }, rationale: "mock" }, { measures: "outcome", answer: { kind: "enum", value: "returned", options: ["returned", "threw", "never_settled", "still_running_at_watch_limit"] }, rationale: "mock" }, { measures: "virtualMs", answer: { kind: "number", value: 0, tolerancePct: 10, unit: "ms" }, rationale: "mock" }] }) });

  it("Muse Spark and Muse Spark Open (mocked) each bet the returned value of a function that returns: sealed and judged matched", async () => {
    const app = createApp({ modelBets: { chat: async () => answer({ sum: 3 }), budget: createModelBudget(), sparkOpen: { available: true } } });
    const c = client(app);
    const p = await c.post("/paste", { code: ADD });
    const e = await c.post("/experiments", { target: tgt(p), params }, { "x-atlas-claimant": "both" });
    const slots = (await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {})).json.models;
    expect(slots.map((s: { status: string }) => s.status)).toEqual(["sealed", "sealed"]);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const r = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(r.json.run.result.measured.returnedJson).toBe('{"sum":3}');
    for (const who of ["model:muse-spark-1.3", "model:meta-models/muse-spark-open-1026"]) {
      const bet = r.json.bets.find((b: { who: string; measures: string }) => b.who === who && b.measures === "returnedJson");
      expect(bet.answer).toEqual({ kind: "json", value: { sum: 3 } });
      expect(verifySeal(bet)).toBe(true);
      expect(r.json.verdicts.find((v: { betId: string }) => v.betId === bet.id).outcome).toBe("matched");
    }
  }, 60_000);

  it("a model's json bet has a person's limits: deeper than 98 levels or over 2,048 characters is not a usable answer", async () => {
    let deep: unknown = 1;
    for (let i = 0; i < 99; i++) deep = [deep];
    for (const bad of [deep, "x".repeat(2_100)]) {
      const app = createApp({ modelBets: { chat: async () => answer(bad), budget: createModelBudget() } });
      const c = client(app);
      const p = await c.post("/paste", { code: ADD });
      const e = await c.post("/experiments", { target: tgt(p), params });
      const slot = (await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {})).json.model;
      expect(slot.status).toBe("no_usable_answer");
      expect(slot.reason).toMatch(/not a JSON value Atlas can compare/);
    }
  });

  it("the server's bettor text equals pastedBetContext (the pure builder the benchmark imports), with no USD line", async () => {
    const { pastedBetContext } = await import("../../src/paste-context");
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: ADD });
    const e = await c.post("/experiments", { target: tgt(p), params });
    const target = { kind: "pasted" as const, ref: p.json.target.ref, codeSha256: p.json.target.codeSha256, language: "js" as const, source: ADD };
    const built = pastedBetContext({ experiment: { target, params: e.json.experiment.params, proposedBy: { role: "human" } }, questions: e.json.questions, exportLine: 1 });
    expect(e.json.seenContext).toBe(built);
    expect(built).not.toMatch(/USD/);
  });
});

describe("r3 B1: the privacy sentence is built from the server's configuration", () => {
  it("local: names this server's temporary folder and the restart rule; Modal: names Modal, a throwaway container, shut down after the run", async () => {
    const { createModalExecutor } = await import("../../runners/executor/modal.ts");
    const { emulatingBackend } = await import("./modal-fakes");
    const local = (await client(createApp()).get("/paste/languages")).json;
    expect(local.executor).toBe("local");
    expect(local.privacy).toContain("written to a temporary folder on this server");
    expect(local.privacy).toContain("deleted at the next server start at least 10 minutes later");
    expect(local.privacy).not.toMatch(/Modal/);
    const modal = (await client(createApp({ executor: createModalExecutor({ backend: emulatingBackend(), log: () => {} }) })).get("/paste/languages")).json;
    expect(modal.executor).toBe("modal");
    expect(modal.privacy).toContain("sent to Modal (a cloud company that runs sandboxes) and written into a throwaway Modal container that has no network and is shut down when the run ends");
    expect(modal.privacy).not.toMatch(/temporary folder on this server/);
    for (const p of [local.privacy, modal.privacy]) {
      expect(p).toContain("until 2 hours after you last pasted it, then deleted (checked every minute)");
      expect(p).toContain("Baseten");
    }
  });

  it("the 2-hour rule is exact: a source pasted 2 hours ago is gone, with its rounds and its proof file, at the next request", async () => {
    try {
      const { app } = makeApp();
      const a = client(app);
      const p = await a.post("/paste", { code: "export function one() { return 1; }\n" });
      const e = await a.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "one", args: [] } });
      await a.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
      const id = (await a.post("/runs", { experimentId: e.json.experiment.id })).json.run.id;
      expect((await a.get(`/proofs/${id}`)).status).toBe(200);
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() }); // after the run: the run itself waits on the real clock
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000 - 5_000);
      expect((await a.get(`/proofs/${id}`)).status).toBe(200); // just under 2 hours: still there
      vi.setSystemTime(Date.now() + 10_000);
      await new Promise((r) => setTimeout(r, 1_100)); // the on-request sweep runs at most once a second (real time)
      expect((await a.get(`/proofs/${id}`)).status).toBe(404);
      expect((await a.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "one", args: [] } })).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);
});

describe("r3 M1: a Python run past the 5,000-event cap keeps its ending; nothing is judged silently", () => {
  const MANY_PY = "def many(f, g, n):\n    s = 0\n    for i in range(n):\n        s += f()\n    if n > 0:\n        s += g()\n    return s\n";
  for (const n of [2_498, 3_000]) {
    it(`n = ${n}: the ending is kept, calls are exact, the proof verifies and replays`, async () => {
      const { app } = makeApp();
      const c = client(app);
      const p = await c.post("/paste", { code: MANY_PY });
      const sync = (name: string) => ({ kind: "stand-in", name, async: false, calls: [{ do: "return", value: 1 }], then: "repeat_last" });
      const e = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "many", args: [sync("f"), sync("g"), { kind: "json", value: n }] } });
      await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "returnedJson", answer: { kind: "json", value: n + 1 } }] });
      const r = await c.post("/runs", { experimentId: e.json.experiment.id });
      const run = r.json.run as Run;
      expect(run.result.measured).toMatchObject({ outcome: "returned", returnedJson: String(n + 1), "calls:f": n, "calls:g": 1 });
      expect(run.trace.filter((t) => t.event === "returned")).toHaveLength(1);
      // At n = 2,498 the cap is reached exactly at the ending (which is kept past it); at 3,000 calls are dropped and tallied.
      const cut = run.trace.find((t) => t.event === "trace_cut");
      if (n === 3_000) expect((cut!.data as { droppedCalls: Record<string, number> }).droppedCalls.f).toBeGreaterThan(0);
      expect(r.json.proof.ok).toBe(true);
      expect(r.json.verdicts[0].outcome).toBe("matched");
      expect((await c.get(`/proofs/${run.id}`)).status).toBe(200);
      expect((await c.get(`/replay/${run.id}`)).json.measuredEqual).toBe(true);
    }, 120_000);
  }
});

describe("r3 M2 and minor 1: one shared copy of each source, counted once; fair eviction", () => {
  it("two sessions pasting the same code share one source; 20 rounds on it count it once in the budget", async () => {
    let used = () => -1;
    const { app } = makeApp({ paste: { expose: (p) => (used = (p as unknown as { roundBudgetUsed: () => number }).roundBudgetUsed) } });
    const code = "export function f(a){return a}\n// " + "x".repeat(60_000) + "\n";
    const a = client(app);
    const b = client(app);
    const pa = await a.post("/paste", { code });
    await b.post("/paste", { code });
    for (let i = 0; i < 20; i++) await a.post("/experiments", { target: tgt(pa), params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: i }] } });
    const total = used();
    expect(total).toBeGreaterThan(60_000);
    expect(total).toBeLessThan(60_000 + 20 * 6_000); // the source once, plus 20 small test parts
  });

  it("over the overall cap, the session that went over gives up its own oldest round first; a round with the person's sealed bets is never dropped", async () => {
    const { createPaste, MAX_PASTED_ROUND_CHARS } = await import("../../server/paste");
    const { createBetStore } = await import("../../server/bets");
    const { createAgentLog } = await import("../../server/log/agentlog");
    const store = createPaste({}, { agentLog: createAgentLog(), betStore: createBetStore(), takeModelRound: () => ({ ok: true }), takePaste: () => ({ ok: true }), executorKind: "local" });
    const third = Math.floor(MAX_PASTED_ROUND_CHARS * 0.45);
    const none = () => false;
    expect(store.trackRound("A", "a1", third, "s1:js", none)).toEqual([]);
    expect(store.trackRound("B", "b1", third, "s2:js", none)).toEqual([]);
    expect(store.trackRound("B", "b2", Math.floor(MAX_PASTED_ROUND_CHARS * 0.2), "s3:js", none)).toEqual([{ sessionId: "B", experimentId: "b1" }]);
    // a protected round is kept: then another's round goes
    const protect = (sid: string, id: string) => id === "b2";
    expect(store.trackRound("B", "b3", third, "s4:js", protect)).toEqual([{ sessionId: "A", experimentId: "a1" }]);
  });
});

describe("r3 minors 2–4", () => {
  const playRun = async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: "export function one() { return 1; }\n" });
    const e = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "one", args: [] } });
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const id = (await c.post("/runs", { experimentId: e.json.experiment.id })).json.run.id;
    return (await c.get(`/proofs/${id}`)).json;
  };
  it("minor 2: verify refuses the four control-field tampers", async () => {
    const { verifyAtlasFile } = await import("../../src/atlasfile");
    const file = await playRun();
    expect(verifyAtlasFile(file).ok).toBe(true);
    const tamper = (f: (x: any) => void) => {
      const x = JSON.parse(JSON.stringify(file));
      f(x);
      return verifyAtlasFile(x);
    };
    const cc = (x: any) => x.runs[0].trace.find((t: { event: string }) => t.event === "call_checks");
    expect(tamper((x) => (cc(x).data.controlPassed = false)).ok).toBe(false);
    expect(tamper((x) => (cc(x).data.runtime = { executor: "modal", node: "v0" })).ok).toBe(false);
    expect(tamper((x) => (x.runs[0].executor = "modal")).ok).toBe(false);
    expect(tamper((x) => (x.runs[0].trace = x.runs[0].trace.filter((t: { event: string }) => t.event !== "call_checks"))).ok).toBe(false);
    expect(tamper((x) => delete cc(x).data.controlFinishedAt).ok).toBe(false);
  }, 60_000);

  it("minor 3: writing a default out (watchLimitMs 30000, afterMs 0) is still a repeat", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const e1 = await c.post("/experiments", { target: tgt(p), params: allowedA });
    await c.post("/bets", { experimentId: e1.json.experiment.id, who: "human", bets: [outcome("returned")] });
    await c.post("/runs", { experimentId: e1.json.experiment.id });
    const spelled = JSON.parse(JSON.stringify(allowedA));
    spelled.watchLimitMs = 30_000;
    spelled.args[0].calls[1].afterMs = 0;
    expect((await c.post("/experiments", { target: tgt(p), params: spelled })).json.repeatOf).toBe(e1.json.experiment.id);
  }, 60_000);

  it("minor 4: a json bet with a whole number beyond 2^53 is refused, for the person and for a model", async () => {
    const { jsonBetValueProblem } = await import("../../src/seal");
    expect(jsonBetValueProblem(JSON.parse("9007199254740993"))).toMatch(/beyond 2\^53/);
    expect(jsonBetValueProblem({ a: [JSON.parse("1e21")] })).toMatch(/beyond 2\^53/);
    expect(jsonBetValueProblem(9007199254740991)).toBeNull();
    expect(jsonBetValueProblem(1.5)).toBeNull();
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: "export function big() { return 1; }\n" });
    const e = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "big", args: [] } });
    const r = await app.request("/bets", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": c.session()! }, body: `{"experimentId":"${e.json.experiment.id}","who":"human","bets":[{"measures":"returnedJson","answer":{"kind":"json","value":9007199254740993}}]}` });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/beyond 2\^53/);
  });
});
