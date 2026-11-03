// R14: Muse Wonder talks about one part: the pick from the person's record (before a bet), captions for the run (after it), and answers
// to a question about one part (after the bet is locked). Plain code checks every word; the parity rule (D19) holds; visitors with no
// invite code get none of it (401, no model call); none of it is ever on the proof picture. Every model mocked, $0.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { asksForBettors, checkAnswer, checkCaption, checkCaptions, checkPick, claimIn, contradicts, KIND_PHRASE, PART_TALK_WORDS, REMEMBER_WORDS } from "../../src/part-talk";
import { checkSummaryLine } from "../../src/file-summary";
import { ASK_TASK, CAPTION_TASK, PICK_TASK, buildPickMessages } from "../../server/meta/roles/part-talk";
import { stepKinds } from "../../server/part-talk";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { memoryTrackStore } from "../../server/track-store";
import { pathItems } from "../../renderer/authors/what-happened";
import { EXAMPLE_ROUTES, isExampleRoute, withInviteGate } from "../../server/access/gate";
import { openInviteStore } from "../../server/access/store";
import { fileOutline } from "../../src/file-outline";
import { machineParts } from "../../renderer/authors/machine";
import { benchModel } from "../../web/machines/bench/model";
import { allowedC, client, makeApp, mockModels, RETRY_SRC } from "../tools/paste-fixtures";
import type { TrackEntry } from "../../src/track-record";

const BROWSER = "r14-browser-aaaaaaaaaaaa";
const H = { "x-atlas-browser": BROWSER };

describe("plain code's checks", () => {
  it("the pick: a part Atlas can call, and a reason that passes the summary's checker (no ending, no number, no judgment)", () => {
    const ok = checkPick({ part: "retryWithBackoff", reason: "You often miss timing questions; this part waits between tries" }, ["retryWithBackoff"]);
    expect(ok).toEqual({ ok: true, part: "retryWithBackoff", reason: "You often miss timing questions; this part waits between tries" });
    expect(checkPick({ part: "VERSION", reason: "You often miss timing questions." }, ["retryWithBackoff"]).ok).toBe(false);
    const leaks = [
      "You often miss timing questions; this part returns nothing after three tries", // an ending and a number
      "You often miss value questions; this part gives up and throws", // an ending
      "You miss timing questions; this part waits a second between tries", // a time unit
      "You miss timing questions; this part waits 100 ms", // a digit
      "You often miss timing questions; this part is safe", // a judgment
      "This part never finishes when the source stalls", // an ending
      "You missed twice here", // a number as a word
    ];
    for (const r of leaks) expect(checkPick({ part: "retryWithBackoff", reason: r }, ["retryWithBackoff"]).ok, r).toBe(false);
  });
  it("each kind's words for the pick pass the checker themselves", () => {
    for (const [k, phrase] of Object.entries(KIND_PHRASE)) expect(checkSummaryLine(`You often miss ${phrase}; this part keeps a cache.`, { words: 22, chars: 160 }).ok, k).toBe(true);
  });
  it("captions: claim words and digits are refused; a caption may not contradict its step's recorded kind", () => {
    expect(checkCaption("The fetch tries again after a pause", "quiet").ok).toBe(true);
    expect(checkCaption("The helper hands the price back to the caller", "end-returned").ok).toBe(true);
    for (const [t, k] of [
      ["The call returns the price", "end-threw"],
      ["It gives back the cached value", "call-threw"],
      ["The fetch throws an error", "end-returned"],
      ["The call rejects", "call-returned"],
      ["It finishes with a value", "end-unsettled"],
      ["The call returned the price", "quiet"],
      ["It succeeds", "helper-threw"],
    ] as const)
      expect(checkCaption(t, k), `${t} on ${k}`).toMatchObject({ ok: false });
    for (const t of ["The retry is safe", "This works fine", "The loop is correct", "This was fixed", "Waits 200 ms", "A bug in the loop", "The first try"]) expect(checkCaption(t, "other").ok, t).toBe(false); // wording-lint: allow
    expect(contradicts("anything", "other")).toBeNull();
  });
  it("captions: refused ones are dropped and counted; keys past the steps are refused", () => {
    const r = checkCaptions({ captions: { "0": "Atlas starts the call", "1": "It returns the price", "7": "extra", x: "y" } }, ["quiet", "end-threw"]);
    expect(r.captions).toEqual({ 0: "Atlas starts the call" });
    expect(r.refused).toBe(3);
  });
  it("answers: claim words are refused (safe, correct, works, fixed, bug...), off topic is said as such", () => {
    expect(checkAnswer({ answer: "It calls the fetcher and waits longer after each failed try, up to 3 tries." })).toMatchObject({ ok: true });
    for (const a of ["This part is safe to use.", "It works.", "The loop is correct.", "This is fixed now.", "There is a bug here.", "It is reliable.", "It is unsafe.", "Research shows this is fine."]) expect(checkAnswer({ answer: a }).ok, a).toBe(false); // wording-lint: allow
    expect(checkAnswer({ offTopic: true })).toEqual({ ok: false, offTopic: true });
    expect(checkAnswer({ answer: Array.from({ length: 61 }, () => "word").join(" ") }).ok).toBe(false);
    expect(claimIn("It hands the value to the caller.")).toBeNull();
  });
  it("D19: the lines later bettors get name the question, the answer and whose words they are", () => {
    const lines = asksForBettors([{ part: "f", question: "What does f do?", answer: "It waits.", model: "muse-wonder-1.0" }]);
    expect(lines[0]).toMatch(/after locking a bet.*same words.*not a check/);
    expect(lines[1]).toBe('- f: asked "What does f do?"; muse-wonder-1.0 answered: It waits.');
  });
});

/** A chat that answers each R14 task, and otherwise answers like the usual mock. Counts each task's calls. */
function talkingModels(answers: { pick?: unknown; captions?: unknown | ((all: string) => unknown); ask?: unknown }) {
  const base = mockModels();
  const seen = { pick: [] as ChatArgs[], captions: [] as ChatArgs[], ask: [] as ChatArgs[] };
  const reply = (v: unknown): ChatResult => ({ ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.001 }, content: JSON.stringify(v) });
  const chat = async (a: ChatArgs): Promise<ChatResult> => {
    const all = a.messages.map((m) => m.content).join("\n");
    if (all.includes(PICK_TASK)) return seen.pick.push(a), reply(answers.pick ?? {});
    if (all.includes(CAPTION_TASK)) return seen.captions.push(a), reply(typeof answers.captions === "function" ? (answers.captions as (s: string) => unknown)(all) : (answers.captions ?? {}));
    if (all.includes(ASK_TASK)) return seen.ask.push(a), reply(answers.ask ?? {});
    return base.chat(a);
  };
  return { chat, seen, calls: base.calls };
}
const budget = async () => (await import("../../server/meta/budget")).createModelBudget({ spendCeilingUsd: 5 });

async function pasted(m: ReturnType<typeof talkingModels>, over: Parameters<typeof makeApp>[0] = {}) {
  const { app } = makeApp({ modelBets: { chat: m.chat, budget: await budget(), sparkOpen: { available: true } }, paste: { proposer: { chat: m.chat } }, ...over });
  const c = client(app);
  const p = await c.post("/paste", { code: RETRY_SRC }, H);
  const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
  return { app, c, t };
}
const ENUM = (v: string) => ({ kind: "enum", value: v });

describe("POST /paste/ask: only after the bet is locked (D19)", () => {
  it("is refused before the person's bet is sealed, with no model call; after it, the answer comes back checked", async () => {
    const m = talkingModels({ ask: { answer: "It calls the fetcher, and after each failed try it waits longer before the next." } });
    const { c, t } = await pasted(m);
    const e = await c.post("/experiments", { target: t, params: allowedC }, H);
    const id = e.json.experiment.id as string;
    const before = await c.post("/paste/ask", { experimentId: id, part: "retryWithBackoff", question: "What does this part do?" }, H);
    expect(before.status).toBe(409);
    expect(before.json.locked).toBe(false);
    expect(m.seen.ask).toHaveLength(0);
    expect((await c.post("/bets", { experimentId: id, who: "human", measures: "outcome", answer: ENUM("threw") }, H)).status).toBe(200);
    const after = await c.post("/paste/ask", { experimentId: id, part: "retryWithBackoff", question: "What does this part do?" }, H);
    expect(after.json).toMatchObject({ ok: true, model: "muse-wonder-1.0", part: "retryWithBackoff" });
    expect(m.seen.ask).toHaveLength(1);
    expect(m.seen.ask[0]).toMatchObject({ role: "investigator", model: "muse-wonder-1.0" });
    // The question goes in as data, with the part's lines; never the test or Wonder's sentence.
    const text = m.seen.ask[0]!.messages.map((x) => x.content).join("\n");
    expect(text).toContain('"What does this part do?"');
    expect(text).not.toMatch(/zebra-claim|stand-in|People expect/);
  });
  it("refuses claim words and says off topic plainly; an unknown part or an empty question asks nothing", async () => {
    for (const [ask, want] of [
      [{ answer: "This retry is safe and works." }, { ok: false, reason: expect.stringMatching(/plain code refused/) }], // wording-lint: allow
      [{ offTopic: true }, { ok: false, offTopic: true }],
    ] as const) {
      const m = talkingModels({ ask });
      const { c, t } = await pasted(m);
      const e = await c.post("/experiments", { target: t, params: allowedC }, H);
      await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
      expect((await c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "retryWithBackoff", question: "Is it any good?" }, H)).json).toMatchObject(want);
      expect((await c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "nope", question: "?" }, H)).status).toBe(400);
      expect((await c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "retryWithBackoff", question: "   " }, H)).status).toBe(400);
      expect(m.seen.ask).toHaveLength(1);
    }
  });
  it("D19: an answer is in every bettor's text of the NEXT round on the same file, and on the person's page (seenContext)", async () => {
    const m = talkingModels({ ask: { answer: "It waits a little longer after each failed try (r14-answer-5521)." } });
    const { c, t } = await pasted(m);
    const e = await c.post("/experiments", { target: t, params: allowedC }, H);
    expect(e.json.seenContext).not.toContain("r14-answer-5521");
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    await c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "retryWithBackoff", question: "Why the wait?" }, H);
    const next = await c.post("/experiments", { target: t, params: { ...allowedC, args: [allowedC.args[0], { kind: "json", value: 2 }, { kind: "json", value: 100 }] } }, { ...H, "x-atlas-claimant": "both" });
    expect(next.json.seenContext).toContain("r14-answer-5521");
    await c.post(`/experiments/${next.json.experiment.id}/model-bets`, {}, H);
    const later = m.calls.filter((x) => x.role === "claimant").slice(-2);
    expect(later).toHaveLength(2);
    for (const b of later) expect(b.messages.map((x) => x.content).join("\n")).toContain("r14-answer-5521");
  });
  it("has its own hourly limit per client", async () => {
    const was = process.env.ATLAS_ASKS_PER_CLIENT_PER_HOUR;
    process.env.ATLAS_ASKS_PER_CLIENT_PER_HOUR = "2";
    try {
      const m = talkingModels({ ask: { answer: "It waits between tries." } });
      const { c, t } = await pasted(m);
      const e = await c.post("/experiments", { target: t, params: allowedC }, H);
      await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
      const q = (n: number) => c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "retryWithBackoff", question: `Question ${n}?` }, H);
      expect((await q(1)).json.ok).toBe(true);
      expect((await q(2)).json.ok).toBe(true);
      const third = await q(3);
      expect(third.json.ok).toBe(false);
      expect(third.json.reason).toMatch(/questions about a part/);
      expect(m.seen.ask).toHaveLength(2);
    } finally {
      if (was === undefined) delete process.env.ATLAS_ASKS_PER_CLIENT_PER_HOUR;
      else process.env.ATLAS_ASKS_PER_CLIENT_PER_HOUR = was;
    }
  });
});

const entry = (i: number, type: TrackEntry["type"], outcome: TrackEntry["outcome"]): TrackEntry => ({ runId: `run_${i}`, betId: `bet_${i}`, sealedHash: "a".repeat(64), type, outcome, repeat: false, at: new Date(2026, 10, 1, 10, i).toISOString(), path: "something failed" });

describe("POST /paste/pick: Muse Wonder aims at what this person misses", () => {
  it("with no record yet, nothing is asked ($0) and the page is told so", async () => {
    const m = talkingModels({ pick: { part: "retryWithBackoff", reason: "x" } });
    const { c, t } = await pasted(m);
    const r = await c.post("/paste/pick", { target: t }, H);
    expect(r.json).toMatchObject({ ok: false, noRecord: true });
    expect(m.seen.pick).toHaveLength(0);
  });
  it("with a record, it is told the kinds and counts only, and its pick and reason come back checked", async () => {
    const track = memoryTrackStore();
    track.add({ kind: "browser", id: BROWSER }, [entry(1, "timing", "not_matched"), entry(2, "timing", "not_matched"), entry(3, "outcome", "matched")]);
    const m = talkingModels({ pick: { part: "retryWithBackoff", reason: "You often miss timing questions; this part waits longer between tries" } });
    const { c, t } = await pasted(m, { trackStore: track });
    const r = await c.post("/paste/pick", { target: t }, H);
    expect(r.json).toMatchObject({ ok: true, part: "retryWithBackoff", reason: "You often miss timing questions; this part waits longer between tries" });
    const text = m.seen.pick[0]!.messages.map((x) => x.content).join("\n");
    expect(text).toContain("timing (2 of 2 didn't match");
    expect(text).toContain(`timing: "${KIND_PHRASE.timing}"`);
    expect(text).not.toMatch(/run_1|bet_1|aaaaaaaa/);
    // Asked once per file and record: a second request is the same answer, no new call.
    await c.post("/paste/pick", { target: t }, H);
    expect(m.seen.pick).toHaveLength(1);
  });
  it("a reason that leaks an outcome is refused, and the page falls back (refused: true)", async () => {
    const track = memoryTrackStore();
    track.add({ kind: "browser", id: BROWSER }, [entry(1, "outcome", "not_matched")]);
    for (const reason of ["You often miss questions on how a call ends; this part throws after the last try", "This part returns nothing", "You miss these; it waits three times"]) {
      const m = talkingModels({ pick: { part: "retryWithBackoff", reason } });
      const { c, t } = await pasted(m, { trackStore: track });
      const r = await c.post("/paste/pick", { target: t }, H);
      expect(r.json, reason).toMatchObject({ ok: false, refused: true });
    }
  });
  it("the pick prompt names only parts Atlas can call", () => {
    const parts = fileOutline(RETRY_SRC, "ts").parts.filter((p) => p.kind === "function");
    const text = buildPickMessages({ source: RETRY_SRC, language: "ts", bettable: parts, record: "timing (2 of 2 didn't match)", kinds: ["timing"] }).map((x) => x.content).join("\n");
    expect(text).toContain("- retryWithBackoff (lines");
    expect(text).not.toContain("- VERSION");
  });
});

describe("POST /paste/captions: after the run, checked against the recorded run", () => {
  async function ranRound(captions: unknown | ((all: string) => unknown)) {
    const m = talkingModels({ captions });
    const { c, t } = await pasted(m);
    const e = await c.post("/experiments", { target: t, params: allowedC }, H);
    const id = e.json.experiment.id as string;
    await c.post("/bets", { experimentId: id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    return { m, c, id, e };
  }
  const stepsOf = (run: Parameters<typeof pathItems>[0]["run"]) => {
    const { items } = pathItems({ run, experiment: { params: allowedC as never } });
    const out: { words: string; field: string }[] = [];
    for (const it of items) {
      if (it.kind === "call") out.push({ words: `call ${it.n} to ${it.name}: ${it.answer ?? "no answer yet"}`, field: `run.trace: ${it.name} call ${it.n}` });
      if (it.kind === "end") out.push({ words: it.words, field: "run.result.measured.outcome" });
    }
    return out;
  };
  it("refuses before the run (409) and steps that don't match the run (422), with no model call", async () => {
    const { m, c, id } = await ranRound({});
    expect((await c.post("/paste/captions", { experimentId: id, steps: [{ words: "returned 1", field: "run.result.measured.outcome" }] }, H)).status).toBe(409);
    const run = await c.post("/runs", { experimentId: id }, H);
    expect(run.status).toBe(200);
    expect(run.json.run.result.measured.outcome).toBe("threw");
    // The run threw: a page that says it returned is refused before anything is asked.
    expect((await c.post("/paste/captions", { experimentId: id, steps: [{ words: "returned 1", field: "run.result.measured.outcome" }] }, H)).status).toBe(422);
    expect((await c.post("/paste/captions", { experimentId: id, steps: [{ words: "call 9 to ghost: x", field: "run.trace: ghost call 9" }] }, H)).status).toBe(422);
    expect(m.seen.captions).toHaveLength(0);
  }, 60_000);
  it("keeps captions true to their step; refuses a return on the throw, and claim words", async () => {
    const { m, c, id } = await ranRound((all: string) => {
      const n = (all.match(/^\d+\. /gm) ?? []).length;
      const caps: Record<string, string> = {};
      for (let i = 0; i < n - 1; i++) caps[String(i)] = i === 0 ? "The fetch is asked for a price and it is safe" : "The fetch is asked again after a pause"; // wording-lint: allow
      caps[String(n - 1)] = "The helper returns the price to the caller";
      return { captions: caps };
    });
    const run = await c.post("/runs", { experimentId: id }, H);
    const steps = stepsOf(run.json.run);
    expect(steps.length).toBeGreaterThan(2);
    const kinds = stepKinds(steps, run.json.run, { params: allowedC as never });
    expect(kinds?.at(-1)).toBe("end-threw");
    expect(kinds?.[0]).toBe("call-threw");
    const r = await c.post("/paste/captions", { experimentId: id, steps }, H);
    expect(r.json.ok).toBe(true);
    // Step 0 used a claim word, the last said "returns" on a throw: both dropped. The middle ones stand.
    expect(Object.keys(r.json.captions)).not.toContain("0");
    expect(Object.keys(r.json.captions)).not.toContain(String(steps.length - 1));
    expect(r.json.captions["1"]).toBe("The fetch is asked again after a pause");
    expect(m.seen.captions).toHaveLength(1);
    // The prompt holds the steps' plain words and the test; never a bettor's answer.
    const text = m.seen.captions[0]!.messages.map((x) => x.content).join("\n");
    expect(text).toContain(steps.at(-1)!.words);
    expect(text).not.toMatch(/"choice"|"value": "threw"|rationale/);
  }, 60_000);
  it("none of the three is ever on the proof card or in the proof file", async () => {
    const track = memoryTrackStore();
    track.add({ kind: "browser", id: BROWSER }, [entry(1, "timing", "not_matched")]);
    const PICK = "You often miss timing questions; this part waits longer between tries";
    const CAP = "The fetch is asked again after a short pause";
    const ANSWER = "It waits longer after each failed try (r14-proof-check).";
    const m = talkingModels({ pick: { part: "retryWithBackoff", reason: PICK }, captions: { captions: { "1": CAP } }, ask: { answer: ANSWER } });
    const { c, t } = await pasted(m, { trackStore: track });
    expect((await c.post("/paste/pick", { target: t }, H)).json.ok).toBe(true);
    const e = await c.post("/experiments", { target: t, params: allowedC }, H);
    const id = e.json.experiment.id as string;
    await c.post("/bets", { experimentId: id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    expect((await c.post("/paste/ask", { experimentId: id, part: "retryWithBackoff", question: "Why wait?" }, H)).json.ok).toBe(true);
    const run = await c.post("/runs", { experimentId: id }, H);
    expect((await c.post("/paste/captions", { experimentId: id, steps: stepsOf(run.json.run) }, H)).json.captions["1"]).toBe(CAP);
    const file = (await c.get(`/proofs/${run.json.run.id}`)).json;
    for (const w of [PICK, CAP, ANSWER, "r14-proof-check"]) expect(JSON.stringify(file)).not.toContain(w);
    const outline = fileOutline(RETRY_SRC, "ts");
    const model = benchModel({ fileName: "x", outline, test: null, source: RETRY_SRC, language: "ts" });
    const parts = machineParts({ ...model, tested: "retryWithBackoff" }, outline, RETRY_SRC, "ts");
    const { ProofCard } = await import("../../web/screens/ProofCard");
    const html = renderToStaticMarkup(createElement(ProofCard, { file: file as never, machineParts: parts, stranger: true }));
    for (const w of [PICK, CAP, ANSWER, "r14-proof-check", PART_TALK_WORDS.pickHeading, PART_TALK_WORDS.captionsLegend, PART_TALK_WORDS.askLegend]) expect(html).not.toContain(w);
  }, 60_000);
});

describe("the record (feature 5)", () => {
  it("bets on a part picked by Muse Wonder land in the record with the usual kinds; the page is told where the record is kept", async () => {
    const m = talkingModels({});
    const { c, t } = await pasted(m);
    const e = await c.post("/experiments", { target: t, params: allowedC }, H);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    const run = await c.post("/runs", { experimentId: e.json.experiment.id }, H);
    expect(run.json.track.after.lines.map((l: { type: string }) => l.type)).toEqual(["outcome"]);
    const rec = await c.get("/track-record");
    expect(rec.json.kept).toBe("memory");
  }, 60_000);
  it("the record page's words never say learn, teach, score, skill, right or wrong", () => {
    for (const w of Object.values(REMEMBER_WORDS)) expect(w).not.toMatch(/\b(learn|teach|score|skill|right|wrong)/i); // wording-lint: allow
    for (const w of Object.values(PART_TALK_WORDS)) if (typeof w === "string") expect(w).not.toMatch(/\b(learn|teach|score|skill|right|wrong|fixed|bug|first|caught before shipping|re-proven|research shows)\b/i); // wording-lint: allow
  });
});

describe("visitors with no invite code get none of it", () => {
  let dir = "";
  it("the three routes are not on the open example's list: 401 with the waitlist, and no model call", async () => {
    for (const path of ["/paste/pick", "/paste/captions", "/paste/ask"]) expect(isExampleRoute("POST", path), path).toBe(false);
    expect(EXAMPLE_ROUTES.some((r) => /pick|captions|ask/.test(String(r.path)))).toBe(false);
    dir = mkdtempSync(join(tmpdir(), "atlas-r14-"));
    const store = openInviteStore(dir, { env: { ATLAS_INVITE_PEPPER: "test-pepper-".padEnd(48, "x") } });
    const m = talkingModels({ pick: { part: "x", reason: "y" }, captions: {}, ask: { answer: "z" } });
    const { app } = makeApp({ modelBets: { chat: m.chat, budget: await budget(), sparkOpen: { available: true } }, paste: { proposer: { chat: m.chat } } });
    const gated = withInviteGate(app, { store, require: true, secureCookie: false, waitlistUrl: "https://example.com/waitlist" });
    for (const [path, body] of [
      ["/paste/pick", { target: { ref: "pasted:x", codeSha256: "a".repeat(64) } }],
      ["/paste/captions", { experimentId: "exp_1", steps: [{ words: "w", field: "f" }] }],
      ["/paste/ask", { experimentId: "exp_1", part: "f", question: "q?" }],
    ] as const) {
      const res = await gated.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(res.status, path).toBe(401);
      const json = (await res.json()) as { waitlist?: string; invite?: unknown };
      expect(json.waitlist).toBe("https://example.com/waitlist");
    }
    expect(m.seen.pick.length + m.seen.captions.length + m.seen.ask.length).toBe(0);
  });
});

describe("D19 across sessions", () => {
  it("an answer is kept for the person (their browser here), so a NEW session's round on the same file carries it too", async () => {
    const m = talkingModels({ ask: { answer: "It waits longer after each failed try (r14-cross-session-77)." } });
    const { app, c, t } = await pasted(m);
    const e = await c.post("/experiments", { target: t, params: allowedC }, H);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    expect((await c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "retryWithBackoff", question: "Why wait?" }, H)).json.ok).toBe(true);
    // A new tab: a new session, the same browser.
    const c2 = client(app);
    const p2 = await c2.post("/paste", { code: RETRY_SRC }, H);
    const e2 = await c2.post("/experiments", { target: { ref: p2.json.target.ref, codeSha256: p2.json.target.codeSha256 }, params: allowedC }, H);
    expect(e2.json.seenContext).toContain("r14-cross-session-77");
    // Someone else (another browser) gets none of it.
    const c3 = client(app);
    const p3 = await c3.post("/paste", { code: RETRY_SRC }, { "x-atlas-browser": "r14-browser-bbbbbbbbbbbb" });
    const e3 = await c3.post("/experiments", { target: { ref: p3.json.target.ref, codeSha256: p3.json.target.codeSha256 }, params: allowedC }, { "x-atlas-browser": "r14-browser-bbbbbbbbbbbb" });
    expect(e3.json.seenContext).not.toContain("r14-cross-session-77");
  });
});

describe("review round 1", () => {
  it("M1: a bet on a round written before the person's latest answer is refused; a new round carries the answer and takes bets", async () => {
    const m = talkingModels({ ask: { answer: "It waits between tries (r14-m1)." } });
    const { c, t } = await pasted(m);
    const a = await c.post("/experiments", { target: t, params: allowedC }, H);
    await c.post("/bets", { experimentId: a.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    // Round B is open (no bet yet); the person asks with round A's id.
    const b = await c.post("/experiments", { target: t, params: { ...allowedC, args: [allowedC.args[0], { kind: "json", value: 2 }, { kind: "json", value: 100 }] } }, H);
    expect((await c.post("/paste/ask", { experimentId: a.json.experiment.id, part: "retryWithBackoff", question: "Why?" }, H)).json.ok).toBe(true);
    const refused = await c.post("/bets", { experimentId: b.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    expect(refused.status).toBe(409);
    expect(refused.json.askedSince).toBe(true);
    const fresh = await c.post("/experiments", { target: t, params: { ...allowedC, args: [allowedC.args[0], { kind: "json", value: 4 }, { kind: "json", value: 100 }] } }, H);
    expect(fresh.json.seenContext).toContain("r14-m1");
    expect((await c.post("/bets", { experimentId: fresh.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H)).status).toBe(200);
  });
  it("M2: past 5 answers on a file no more asks are made (none is dropped), with no model call", async () => {
    const m = talkingModels({ ask: { answer: "It waits between tries." } });
    const { c, t } = await pasted(m);
    const e = await c.post("/experiments", { target: t, params: allowedC }, H);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", measures: "outcome", answer: ENUM("threw") }, H);
    for (let i = 0; i < 5; i++) expect((await c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "retryWithBackoff", question: `Q${i}?` }, H)).json.ok).toBe(true);
    const sixth = await c.post("/paste/ask", { experimentId: e.json.experiment.id, part: "retryWithBackoff", question: "Q6?" }, H);
    expect(sixth.json).toMatchObject({ ok: false, full: true });
    expect(m.seen.ask).toHaveLength(5);
  });
  it("M4/M5: ordinary text stands, negated or not-yet words are not claims, wider contradictions are caught", () => {
    expect(checkAnswer({ answer: "get_user_plan asks `fetch_plan` for the plan — then caches it." })).toMatchObject({ ok: true });
    for (const [t, k] of [["Waits for it to return", "quiet"], ["getPrice never returns", "end-unsettled"], ["The call never finished", "end-unsettled"], ["After it fails twice, the call returns the price", "end-returned"]] as const) expect(checkCaption(t, k), `${t} on ${k}`).toMatchObject({ ok: true });
    for (const [t, k] of [["fetchQuote fails with a type error", "call-returned"], ["It answers with the price", "call-threw"], ["The source came back with a price", "end-threw"], ["It hands over the value", "end-threw"]] as const) expect(checkCaption(t, k).ok, `${t} on ${k}`).toBe(false);
  });
});
