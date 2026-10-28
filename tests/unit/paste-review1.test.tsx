// E3 review round 1: one test (or more) per finding. Models mocked; sandbox, gate, judge and seals real.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createProofStore } from "../../server/evm-round";
import { createModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { SEEN_CONTEXT_HEADING } from "../../server/meta/roles/claimant-bets";
import { MAX_PASTED_CALL_USD, MAX_PASTED_PROMPT_CHARS, estimatedCallUsd, guardPastedChat } from "../../server/meta/pasted-guard";
import { createSandboxGate } from "../../server/replay-limits";
import { serverOptions } from "../../server/wiring";
import { PASTED_MAX_LINES } from "../../server/paste";
import { verifyAtlasFile } from "../../src/atlasfile";
import { PASTE_BET_INSTRUCTION, testJson } from "../../src/paste-context";
import { PASTE_WORDS } from "../../src/paste-words";
import { MAX_TRACE_EVENTS } from "../../runners/ts/call-harness";
import type { AtlasFile, Run } from "../../src/types";
import { renderToStaticMarkup } from "react-dom/server";
import { CallTimeline } from "../../web/machines/calltimeline/CallTimeline";
import { CLAIM, RETRY_SRC, WONDER_ANSWER, allowedA, client, makeApp, mockModels } from "../tools/paste-fixtures";

const ROOT = join(__dirname, "../..");
const tgt = (p: { json: Record<string, any> }) => ({ ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 });
const outcome = (v: string) => ({ measures: "outcome", answer: { kind: "enum", value: v } });
const env0 = { ...process.env };
afterEach(() => {
  for (const k of ["ATLAS_ALLOW_CONTRIBUTOR", "ATLAS_PASTES_PER_IP_PER_HOUR", "ATLAS_PROPOSER"]) {
    if (env0[k] === undefined) delete process.env[k];
    else process.env[k] = env0[k];
  }
});

describe("B1 (D19): the bettor text never cuts a value; it equals everything the person sees about the test", () => {
  it("a value longer than 60 characters reaches every model in full, and the page's JSON view is in the text byte for byte", async () => {
    const { app, m } = makeApp();
    const c = client(app);
    const src = "export function echo(x, f) { return f(x); }\n";
    const p = await c.post("/paste", { code: src });
    const long = "A".repeat(55) + "SECRET_TAIL_ZZZ";
    const params = { shape: "call-function", exportName: "echo", args: [{ kind: "json", value: long }, { kind: "stand-in", name: "f", async: false, calls: [{ do: "throw", errorName: "E", message: "m".repeat(55) + "MESSAGE_TAIL_ONLY_PERSON_SEES" }], then: "repeat_last" }] };
    const exp = await c.post("/experiments", { target: tgt(p), params }, { "x-atlas-claimant": "both" });
    const seen: string = exp.json.seenContext;
    expect(seen).toContain("SECRET_TAIL_ZZZ");
    expect(seen).toContain("MESSAGE_TAIL_ONLY_PERSON_SEES");
    // The page's "The test as JSON" view renders testJson(params): the same bytes are in the text.
    expect(seen).toContain(`The test exactly, as JSON (what Atlas runs): ${testJson(exp.json.experiment.params)}`);
    await c.post(`/experiments/${exp.json.experiment.id}/model-bets`, {});
    const bettors = m.calls.filter((a) => a.role === "claimant");
    expect(new Set(bettors.map((a) => a.model)).size).toBe(2); // the mock's answer fits the example, so each model also gets one repair try
    for (const a of bettors) {
      const user = a.messages.find((x) => x.role === "user")!.content;
      expect(user.slice(user.indexOf(SEEN_CONTEXT_HEADING) + SEEN_CONTEXT_HEADING.length + 1, user.indexOf("\n\nQUESTIONS"))).toBe(seen);
      expect(user).toContain("MESSAGE_TAIL_ONLY_PERSON_SEES");
    }
  });
});

describe("B2 (D18/D19): the claim opens only after every bet is frozen, then its proposals are closed", () => {
  it("the review's sequence A: seal one bet, ask for the claim (refused), seal more (fine), run, then the claim; no bet after", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const props = await c.post("/paste/proposals", { target: tgt(p), exportName: "retryWithBackoff" });
    const e = await c.post("/experiments", { target: tgt(p), proposalId: props.json.proposals[0].id });
    const id = e.json.experiment.id;
    expect((await c.post("/bets", { experimentId: id, who: "human", bets: [{ measures: "calls:fetchIt", answer: { kind: "integer", value: 2 } }] })).status).toBe(200);
    const early = await c.post("/paste/claim", { experimentId: id });
    expect(early.status).toBe(409);
    expect(JSON.stringify(early.json)).not.toContain("zebra-claim-7731");
    expect((await c.post("/bets", { experimentId: id, who: "human", bets: [outcome("returned")] })).status).toBe(200);
    await c.post("/runs", { experimentId: id });
    const late = await c.post("/paste/claim", { experimentId: id });
    expect(late.json.claim).toBe(CLAIM);
  }, 60_000);

  it("the review's sequence B: once the claim was read, the set is closed: no new round, no edited test, no bet on an open round from it", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const props = await c.post("/paste/proposals", { target: tgt(p), exportName: "retryWithBackoff" });
    const [a, , cc] = props.json.proposals;
    const e1 = await c.post("/experiments", { target: tgt(p), proposalId: a.id });
    const e2 = await c.post("/experiments", { target: tgt(p), proposalId: cc.id }); // made before the claim, still open
    expect(e2.status).toBe(200);
    await c.post("/bets", { experimentId: e1.json.experiment.id, who: "human", bets: [outcome("returned")] });
    await c.post("/runs", { experimentId: e1.json.experiment.id });
    expect((await c.post("/paste/claim", { experimentId: e1.json.experiment.id })).status).toBe(200);
    const again = await c.post("/experiments", { target: tgt(p), proposalId: a.id });
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/so they are closed/);
    const edited = await c.post("/experiments", { target: tgt(p), params: allowedA, editedFrom: a.id });
    expect(edited.status).toBe(409);
    const bet = await c.post("/bets", { experimentId: e2.json.experiment.id, who: "human", bets: [outcome("threw")] });
    expect(bet.status).toBe(409);
    expect(bet.json.error).toMatch(/no more bets can be sealed on it/);
  }, 60_000);
});

describe("B3 / M5: bounded bet text and prompts; one text per test, shared by its rounds", () => {
  it("a file of more than 2,000 lines is refused before it is kept or counted", async () => {
    const { app } = makeApp();
    const r = await client(app).post("/paste", { code: "export function f(a){return a}\n" + "\n".repeat(PASTED_MAX_LINES + 5) });
    expect(r.status).toBe(413);
    expect(r.json.error).toMatch(/at most 2,000 lines/);
  });

  it("50 rounds of the same test on a 2,000-line file keep ONE bet-screen text, and every round's text is the same", async () => {
    let stats: () => { contexts: number; retainedBytes: number } = () => ({ contexts: -1, retainedBytes: -1 });
    const { app } = makeApp({ paste: { expose: (p) => (stats = p.stats) } });
    const c = client(app);
    const code = "export function f(a){return a}\n" + "\n".repeat(PASTED_MAX_LINES - 2);
    const p = await c.post("/paste", { code });
    const texts = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const e = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] } });
      expect(e.status).toBe(200);
      texts.add(e.json.seenContext);
    }
    expect(texts.size).toBe(1);
    expect([...texts][0]!.length).toBeLessThan(150_000);
    expect(stats().contexts).toBe(1);
    expect(stats().retainedBytes).toBe(Buffer.byteLength(code));
  }, 60_000);

  it("a call carrying pasted code is refused, unsent, when its prompt is too long or it could cost too much", async () => {
    let sent = 0;
    const chat = guardPastedChat(async () => {
      sent++;
      return { ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, usd: 0 } };
    });
    const big = await chat({ role: "investigator", model: "muse-wonder-1.0", messages: [{ role: "user", content: "x".repeat(MAX_PASTED_PROMPT_CHARS + 1) }] });
    expect(big).toMatchObject({ ok: false, notSent: true });
    expect(estimatedCallUsd({ model: "muse-wonder-1.0", messages: [{ role: "user", content: "x".repeat(100_000) }] })).toBeLessThan(MAX_PASTED_CALL_USD);
    const pricey = await chat({ role: "investigator", model: "muse-wonder-1.0", messages: [{ role: "user", content: "x" }], maxTokens: 200_000 });
    expect(pricey).toMatchObject({ ok: false, notSent: true });
    expect((pricey as { reason: string }).reason).toMatch(/could cost up to/);
    expect(sent).toBe(0);
  });
});

describe("B4: a run with tens of thousands of calls keeps a bounded trace, exact counts and a file that verifies", () => {
  it("3,000 calls: the trace is cut at the cap with the reason; calls:f is exact; the proof verifies; the timeline is not drawn", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: "export function many(f, n){let s=0;for(let i=0;i<n;i++)s+=f();return s}\n" });
    const e = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "many", args: [{ kind: "stand-in", name: "f", async: false, calls: [{ do: "return", value: 1 }], then: "repeat_last" }, { kind: "json", value: 3000 }] } });
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const r = await c.post("/runs", { experimentId: e.json.experiment.id });
    const run = r.json.run as Run;
    expect(run.result.measured).toMatchObject({ outcome: "returned", returnedJson: "3000", "calls:f": 3000 });
    expect(run.trace.length).toBeLessThanOrEqual(MAX_TRACE_EVENTS + 10);
    const cut = run.trace.find((t) => t.event === "trace_cut")!;
    // `kept` is exactly the events before the trace_cut line (the endings are kept past the cap).
    expect(cut.data).toMatchObject({ kept: run.trace.indexOf(cut) });
    expect(run.trace.indexOf(cut)).toBeGreaterThanOrEqual(MAX_TRACE_EVENTS);
    expect(JSON.stringify(r.json).length).toBeLessThan(400_000);
    const file = (await c.get(`/proofs/${run.id}`)).json as AtlasFile;
    expect(verifyAtlasFile(file).ok).toBe(true);
    const h = renderToStaticMarkup(<CallTimeline run={run} still theme="light" />);
    expect(h).toContain("more events than Atlas keeps");
    expect(h).not.toContain("<svg");
  }, 60_000);
});

describe("B5: sandbox starts are capped, and pasted replays belong to their session", () => {
  it("a pasted round's replay: 403 for another session and for no session; 200 for its own", async () => {
    const { app } = makeApp();
    const a = client(app);
    const p = await a.post("/paste", { code: RETRY_SRC });
    const e = await a.post("/experiments", { target: tgt(p), params: allowedA });
    await a.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const run = await a.post("/runs", { experimentId: e.json.experiment.id });
    const id = run.json.run.id;
    expect((await client(app).get(`/replay/${id}`)).status).toBe(403);
    expect((await app.request(`/replay/${id}`)).status).toBe(403);
    expect((await a.get(`/replay/${id}`)).status).toBe(200);
  }, 60_000);

  it("parallel runs past the concurrency cap are refused with 429 (fixture code too)", async () => {
    const m = mockModels();
    const app = createApp({ modelBets: { chat: m.chat, budget: createModelBudget() }, sandboxGate: createSandboxGate({ globalConcurrent: 1, globalPerHour: 100, sessionConcurrent: 1, sessionPerHour: 100, ipConcurrent: 1, ipPerHour: 100 }) });
    const ready = async () => {
      const c = client(app);
      const t = await c.post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" });
      const e = await c.post("/experiments", { target: { ref: t.json.ref, codeSha256: t.json.codeSha256 }, params: { shape: "retry-scenario", failTimes: 1, failure: "error" } });
      await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 2 } }] });
      return () => c.post("/runs", { experimentId: e.json.experiment.id });
    };
    const [r1, r2] = [await ready(), await ready()];
    const out = await Promise.all([r1(), r2()]);
    expect(out.map((o) => o.status).sort()).toEqual([200, 429]);
    expect(out.find((o) => o.status === 429)!.json.error).toMatch(/at most 1 sandbox run\(s\) at once/);
  }, 60_000);
});

describe("M1: a re-paste with another language replaces the language", () => {
  it("TypeScript pasted as JavaScript, then again as TypeScript: the round runs as TypeScript", async () => {
    const { app } = makeApp();
    const c = client(app);
    await c.post("/paste", { code: RETRY_SRC, language: "js" });
    const p = await c.post("/paste", { code: RETRY_SRC, language: "ts" });
    const e = await c.post("/experiments", { target: tgt(p), params: allowedA });
    expect(e.json.experiment.target.language).toBe("ts");
    expect(e.json.seenContext).toMatch(/^Code: one pasted TypeScript file/);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const r = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(r.json.run.result.measured.outcome).toBe("returned");
  }, 60_000);
});

describe("M2: the models read only the person's instruction, never Moonwell's", () => {
  it("outside the bettor text the prompt holds only answer-format lines; no 'USD'; the instruction is the paste one, inside the text", async () => {
    const { app, m } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const e = await c.post("/experiments", { target: tgt(p), params: allowedA });
    await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    const user = m.calls.find((a) => a.role === "claimant")!.messages.find((x) => x.role === "user")!.content;
    const seen: string = e.json.seenContext;
    expect(seen).toContain(`How to bet: ${PASTE_BET_INSTRUCTION}`);
    const outside = user.replace(seen, "");
    expect(outside).not.toMatch(/USD|best estimate/);
    expect(user).not.toMatch(/in USD/);
  });
});

describe("M3: the real server's wiring asks Muse Wonder for tests", () => {
  const deps = (chat: (a: ChatArgs) => Promise<ChatResult>) => ({ makeChat: () => chat, budget: createModelBudget({ spendCeilingUsd: 1 }), sparkOpen: { available: false as const, reason: "test" }, proofs: createProofStore({ publish: false }), refusals: () => {} });
  it("serverOptions (what server/index.ts builds) wires the proposer; ATLAS_PROPOSER=off turns it off", async () => {
    const m = mockModels();
    const on = createApp(serverOptions({}, deps(m.chat)));
    const c = client(on);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const r = await c.post("/paste/proposals", { target: tgt(p), exportName: "retryWithBackoff" });
    expect(r.json.ok).toBe(true);
    expect(m.calls.some((a) => a.model === "muse-wonder-1.0")).toBe(true);
    const off = createApp(serverOptions({ ATLAS_PROPOSER: "off" }, deps(m.chat)));
    const c2 = client(off);
    const p2 = await c2.post("/paste", { code: RETRY_SRC });
    expect((await c2.post("/paste/proposals", { target: tgt(p2), exportName: "retryWithBackoff" })).json.reason).toMatch(/not asked/);
    expect(readFileSync(join(ROOT, "server/index.ts"), "utf8")).toMatch(/serverOptions\(process\.env/);
  });
});

describe("M4: the source is the owning session's, and the sentence on screen is true", () => {
  it("GET /proofs: the owner gets the source; another session or none gets the card without it", async () => {
    const { app } = makeApp();
    const a = client(app);
    const p = await a.post("/paste", { code: RETRY_SRC });
    const e = await a.post("/experiments", { target: tgt(p), params: allowedA });
    await a.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    const id = (await a.post("/runs", { experimentId: e.json.experiment.id })).json.run.id;
    expect((await a.get(`/proofs/${id}`)).json.target.source).toBe(RETRY_SRC);
    const other = (await client(app).get(`/proofs/${id}`)).json;
    expect(other.target.source).toBeUndefined();
    expect(other.experiments[0].target.source).toBeUndefined();
    expect(other.sourceWithheld).toBe(true);
    expect(other.target.codeSha256).toBe(p.json.target.codeSha256);
    const none = (await (await app.request(`/proofs/${id}`)).json()) as Record<string, any>;
    expect(JSON.stringify(none)).not.toContain("retryWithBackoff(fetchIt: () =>");
  }, 60_000);

  it("the privacy sentence names every place the code goes", () => {
    for (const w of ["2 hours after you last pasted it", "checked every minute", "temporary folder on this server", "deleted when the run ends", "at least 10 minutes later", "Meta's API", "contributor", "Baseten", "error messages, which can quote names", "not your code itself"]) expect(PASTE_WORDS.notStored("local")).toContain(w);
  });
});

describe("M6: behind a proxy, the per-address paste limit counts the hop the proxy added", () => {
  it("a new first X-Forwarded-For hop each time does not get past the limit", async () => {
    process.env.ATLAS_PASTES_PER_IP_PER_HOUR = "3";
    const { app } = makeApp({ trustProxy: true });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.request("/paste", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `9.9.9.${i}, 203.0.113.7` }, body: JSON.stringify({ code: RETRY_SRC }) });
      codes.push(res.status);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429, 429]);
  });
});

describe("minors", () => {
  it("a __proto__ key in Wonder's test is refused with the reason, not dropped", async () => {
    const m = mockModels();
    const bad = WONDER_ANSWER.replace('"exportName":"retryWithBackoff","args"', '"exportName":"retryWithBackoff","__proto__":{"watchLimitMs":5},"args"');
    const app = createApp({ modelBets: { chat: m.chat, budget: createModelBudget() }, paste: { proposer: { chat: async () => ({ ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 }, content: bad }) } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const r = await c.post("/paste/proposals", { target: tgt(p), exportName: "retryWithBackoff" });
    expect(r.json.proposals[0].gate).toEqual({ allowed: false, reason: expect.stringMatching(/a key named "__proto__"/) });
  });

  it("hidden characters show as escapes in a gate reason and in Wonder's sentence", async () => {
    const m = mockModels();
    const answer = JSON.stringify({ claim: "People expect ‮right‬; the code does left.", experiments: [{ shape: "call-function", exportName: "nope‮", args: [] }, allowedA] });
    const app = createApp({ modelBets: { chat: m.chat, budget: createModelBudget() }, paste: { proposer: { chat: async () => ({ ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 }, content: answer }) } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const r = await c.post("/paste/proposals", { target: tgt(p), exportName: "retryWithBackoff" });
    expect(r.json.proposals[0].gate.reason).toContain("\\u202e");
    expect(r.json.proposals[0].gate.reason).not.toContain("‮");
    const e = await c.post("/experiments", { target: tgt(p), proposalId: r.json.proposals[1].id });
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [outcome("returned")] });
    await c.post("/runs", { experimentId: e.json.experiment.id });
    const claim = (await c.post("/paste/claim", { experimentId: e.json.experiment.id })).json.claim as string;
    expect(claim).toContain("\\u202e");
    expect(claim).not.toContain("‮");
  }, 60_000);

  it("a 422 never echoes the pasted source", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const r = await c.post("/experiments", { target: tgt(p), params: { shape: "call-function", exportName: "retryWithBackoff", args: "nope" } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json)).not.toContain("fetchIt: () => Promise");
  });

  it("Muse Wonder is not asked about a file that is already can't check", async () => {
    const { app, m } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: 'import axios from "axios";\nexport async function get(u) { return axios.get(u); }\n' });
    const r = await c.post("/paste/proposals", { target: tgt(p), exportName: "get" });
    expect(r.json.reason).toMatch(/not asked \(every run of this file would be can't check: the code needs axios/);
    expect(m.calls).toHaveLength(0);
  });

  it("POST /paste takes JSON only (415 for text/plain)", async () => {
    const { app } = makeApp();
    const res = await app.request("/paste", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ code: RETRY_SRC }) });
    expect(res.status).toBe(415);
  });

  it("an oversize paste does not use up the quota", async () => {
    process.env.ATLAS_PASTES_PER_IP_PER_HOUR = "1";
    const { app } = makeApp();
    expect((await client(app).post("/paste", { code: "x".repeat(70_000) })).status).toBe(413);
    expect((await client(app).post("/paste", { code: RETRY_SRC })).status).toBe(200);
  });

  it("an edited Wonder test names both writers (D10), on the experiment and in the bettor text", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const props = await c.post("/paste/proposals", { target: tgt(p), exportName: "retryWithBackoff" });
    const id = props.json.proposals[0].id;
    const e = await c.post("/experiments", { target: tgt(p), params: { ...allowedA, watchLimitMs: 5000 }, editedFrom: id });
    expect(e.json.experiment.proposedBy).toEqual({ role: "human", editedFrom: { model: "muse-wonder-1.0", proposalId: id } });
    expect(e.json.seenContext).toContain(`Test written by: you (the person), edited from Muse Wonder 1.0 (muse-wonder-1.0)'s test ${id}.`);
  });
});
