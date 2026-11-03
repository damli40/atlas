// R14: three routes where Muse Wonder talks about one part of the drawing. Each works the way R6's names and R9's summary do: its own
// call, plain code checks every word (src/part-talk.ts), a per-client hourly limit, the shared model budget, and never on the proof
// picture or in the proof file. None of them is open to a visitor with no invite code (the gate keeps them closed; each route also
// refuses the open example's principal, in case).
//
// - POST /paste/pick {target}: before a bet. From the person's own record (plain code's counts of the kinds of question they miss), Muse
//   Wonder marks ONE part Atlas can call, with a short reason. No record yet: nothing is asked ($0), and the page uses the usual choice.
// - POST /paste/captions {experimentId, steps}: after the run. One short caption per step the page plays. Plain code works out what each
//   step was from its OWN copy of the run where it can (a call's answer, how the run ended), and refuses a caption that contradicts it.
//   Steps that don't match the recorded run are refused before anything is asked.
// - POST /paste/ask {experimentId, part, question}: only once the person's bet on that round is sealed (D19: before that, a person could
//   get an answer the AI bettors can't). The answer is kept for this file under this person (their invite code, else their browser), and
//   every LATER round on the same file puts it in the text every bettor gets, so the AIs and the person stay on the same words.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { fileOutline } from "../src/file-outline";
import { describeCall } from "../src/gate";
import { asksForBettors, CAPTION_MAX_STEPS, checkQuestion, type StepKind } from "../src/part-talk";
import { KIND_PHRASE } from "../src/part-talk";
import { weakSpots, weakSpotSummary, type TrackRecord } from "../src/track-record";
import type { ExperimentShape } from "../src/types";
import { pathItems, type PathItem } from "../renderer/authors/what-happened";
import { isExampleVisitor } from "./access/context";
import { refuseOwnCode } from "./access/example-lane";
import type { BetStore } from "./bets";
import type { ChatArgs, ChatResult } from "./meta/client";
import { runAsk, runCaptions, runPick, PART_TALK_MODEL, type CaptionResult, type PickResult } from "./meta/roles/part-talk";
import { sessionEmitter, type AgentLog } from "./log/agentlog";
import { BAD_SESSION, sessionIdOf } from "./log/sse";
import type { Paste } from "./paste";

type Limit = (c: Context) => { ok: true } | { ok: false; reason: string };

export interface PartTalkDeps {
  agentLog: AgentLog;
  betStore: BetStore;
  paste: Paste;
  /** Muse Wonder's chat, already wrapped by the pasted-code guard and the shared budget. Absent: nothing is asked. */
  chat?: (a: ChatArgs) => Promise<ChatResult>;
  /** This person's track record (plain code). */
  recordOf: (c: Context, sessionId: string) => TrackRecord;
  /**
   * Who the person is (the track record's key: the invite code's id, else this browser, else the session), as an opaque string. The
   * answers to their questions are kept under it, so a new tab or session on the same file still puts them in every bettor's text.
   */
  whoOf: (c: Context, sessionId: string) => string;
  takePick: Limit;
  takeCaptions: Limit;
  takeAsk: Limit;
}

const target = z.object({ ref: z.string().min(1).max(200), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const pickBody = z.object({ target }).strict();
const captionsBody = z.object({ experimentId: ID, steps: z.array(z.object({ words: z.string().min(1).max(200), field: z.string().min(1).max(160) }).strict()).min(1).max(CAPTION_MAX_STEPS) }).strict();
const askBody = z.object({ experimentId: ID, part: z.string().min(1).max(100), question: z.string().max(2_000) }).strict();

/** Asks kept per person per file for later bettor texts. Past this, no more asks on that file (none is ever dropped). */
export const ASKS_KEPT_PER_FILE = 5;
const MAX_SESSIONS = 200;

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/**
 * What plain code knows each step was, from the server's own copy of the run. Null: the step does not match the recorded run (the
 * request is refused and nothing is asked).
 */
export function stepKinds(steps: readonly { words: string; field: string }[], run: Parameters<typeof pathItems>[0]["run"], experiment: { params: ExperimentShape }): StepKind[] | null {
  const { items } = pathItems({ run, experiment });
  const outcome = (run.result?.measured as Record<string, unknown> | undefined)?.outcome;
  const end = items.find((x): x is Extract<PathItem, { kind: "end" }> => x.kind === "end");
  const calls = items.filter((x): x is Extract<PathItem, { kind: "call" }> => x.kind === "call");
  const answers = items.filter((x): x is Extract<PathItem, { kind: "answer" }> => x.kind === "answer");
  const turnEnds = items.filter((x): x is Extract<PathItem, { kind: "turn-end" }> => x.kind === "turn-end");
  const byAnswer = (words: string | null, good: boolean): StepKind => (words === null ? "quiet" : /^threw\b/.test(words) ? "call-threw" : good ? "call-returned" : "other");
  const out: StepKind[] = [];
  for (const s of steps) {
    const f = s.field;
    let m: RegExpExecArray | null;
    // Review minor 2: a folded step keeps its first step's field when its first and last match; its words start "steps N–M".
    if (/^steps \d+/.test(s.words)) {
      out.push("other");
      continue;
    }
    if (f === "run.trace: the start event" || f === "run.trace: calls begun at the same moment" || f === "run.trace: call_start" || f === "the test's own scripted wait" || f.startsWith("run.trace: event times on the virtual clock")) out.push("quiet");
    else if ((m = /^run\.trace: (.+)'s answer to call (\d+)$/.exec(f))) {
      const it = answers.find((a) => a.name === m![1] && a.n === Number(m![2]));
      if (!it) return null;
      out.push(byAnswer(it.words, it.good));
    } else if ((m = /^run\.trace: (.+) call (\d+)$/.exec(f))) {
      const it = calls.find((a) => a.name === m![1] && a.n === Number(m![2]));
      if (!it) return null;
      out.push(byAnswer(it.answer, it.good));
    } else if (f === "run.trace: call_returned / call_threw") {
      const it = turnEnds.find((t) => t.words === s.words);
      if (!it) return null;
      out.push(it.good ? "call-returned" : "call-threw");
    } else if (f.startsWith("run.result.measured.outcome")) {
      // The page's words must start with the server's own words for the ending (it may add the chute's line).
      if (!end || !s.words.startsWith(end.words.slice(0, 40))) return null;
      out.push(outcome === "returned" || /^returns?\b/.test(end.words) ? "end-returned" : outcome === "threw" || /^thr(ew|ows)\b/.test(end.words) ? "end-threw" : outcome === "never_settled" || outcome === "pending" || outcome === "still_running_at_watch_limit" || outcome === "stopped" ? "end-unsettled" : "other");
    } else if (f.startsWith("helpers.steps")) out.push(/ and throws$/.test(s.words) ? "helper-threw" : "other");
    else if (f === "run.trace: after the code had ended"  || f === "run.trace: where Atlas stops claiming" || f === "several recorded steps, folded" || /^steps \d+/.test(s.words)) out.push("other");
    else return null;
  }
  return out;
}

export function createPartTalk(deps: PartTalkDeps) {
  /** Per person (whoOf) and file: the person's questions and Muse Wonder's checked answers, latest last. */
  const asks = new Map<string, Map<string, { part: string; question: string; answer: string; model: string }[]>>();
  const picks = new Map<string, Promise<PickResult>>();
  const captions = new Map<string, Promise<CaptionResult>>();
  const keep = <V>(m: Map<string, V>, k: string, v: V) => {
    m.delete(k);
    m.set(k, v);
    while (m.size > MAX_SESSIONS * 5) m.delete(m.keys().next().value!);
  };

  /** The round of this session, with its file's source, or why not. */
  const roundOf = (sessionId: string, id: string) => {
    const round = deps.betStore.peek(sessionId)?.get(id);
    if (!round || round.experiment.target.kind !== "pasted") return null;
    const t = deps.paste.sourceTarget(round.experiment.target) ?? round.experiment.target;
    if (!t.source || !t.language) return null;
    return { round, source: t.source, language: t.language as "js" | "ts" | "py" };
  };

  function register(app: Hono) {
    app.post("/paste/pick", async (c) => {
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      if (isExampleVisitor()) return refuseOwnCode(c);
      const parsed = pickBody.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return c.json({ error: "body: send {target: {ref, codeSha256}}" }, 400);
      const entry = deps.paste.entryOf(sessionId, parsed.data.target);
      if (!entry || !entry.target.source || !entry.target.language) return c.json({ error: "this session has no pasted file with that ref and fingerprint: paste it first (POST /paste)" }, 400);
      const none = (reason: string, extra: Record<string, unknown> = {}) => c.json({ ok: false, model: PART_TALK_MODEL, reason, ...extra });
      const callable = new Set(entry.exports.map((e) => e.name));
      const bettable = fileOutline(entry.target.source, entry.target.language).parts.filter((p) => p.kind === "function" && callable.has(p.name));
      if (bettable.length === 0) return none("there is no function Atlas can call in this file");
      const record = deps.recordOf(c, sessionId);
      const said = weakSpotSummary(record);
      // No record of a missed question yet: nothing is asked, and the page keeps Muse Wonder's usual choice.
      if (!said) return none("no record yet", { noRecord: true, counted: record.counted });
      if (!deps.chat) return none("this server asks no Meta model");
      const kinds = weakSpots(record).map((l) => l.type);
      const key = `${sessionId}|${entry.target.codeSha256}|${record.counted}|${said}`;
      let p = picks.get(key);
      if (!p) {
        const allowed = deps.takePick(c);
        if (!allowed.ok) return none(allowed.reason);
        p = runPick({ source: entry.target.source, language: entry.target.language, bettable, record: said, kinds }, { chat: deps.chat, log: sessionEmitter(deps.agentLog, sessionId) }).catch((): PickResult => ({ ok: false, model: PART_TALK_MODEL, reason: "the model call failed" }));
        keep(picks, key, p);
        void p.then((r) => {
          if (!r.ok && picks.get(key) === p) picks.delete(key);
        });
      }
      const r = await p;
      if (!r.ok) return none(r.reason, { refused: /plain code refused|picked no part/.test(r.reason) });
      // The kinds plain code told it about, in the page's words (never the model's): the page may show them beside the pick.
      return c.json({ ok: true, model: r.model, part: r.part, reason: r.reason, kinds: kinds.map((k) => KIND_PHRASE[k] ?? k) });
    });

    app.post("/paste/captions", async (c) => {
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      if (isExampleVisitor()) return refuseOwnCode(c);
      const parsed = captionsBody.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return c.json({ error: "body: send {experimentId, steps: [{words, field}]} with 1 to 24 steps" }, 400);
      const got = roundOf(sessionId, parsed.data.experimentId);
      if (!got) return c.json({ error: `this session has no round ${parsed.data.experimentId} on pasted code` }, 404);
      const { round, source, language } = got;
      const none = (reason: string) => c.json({ ok: false, model: PART_TALK_MODEL, reason, captions: {} });
      // After the run only: every bet is sealed by then, so the captions can't reach a bettor before they bet.
      if (round.status !== "done" || !round.run) return c.json({ error: "captions are written once this round's run has finished" }, 409);
      const kinds = stepKinds(parsed.data.steps, round.run, round.experiment as { params: ExperimentShape });
      if (!kinds) return c.json({ error: "these steps do not match the recorded run, so nothing was asked" }, 422);
      if (!deps.chat) return none("this server asks no Meta model");
      const key = `${sessionId}|${round.run.id}|${JSON.stringify(parsed.data.steps)}`;
      let p = captions.get(key);
      if (!p) {
        const allowed = deps.takeCaptions(c);
        if (!allowed.ok) return none(allowed.reason);
        const test = round.experiment.params.shape === "call-function" ? describeCall(round.experiment.params, language) : "a test";
        p = runCaptions({ source, language, test, steps: parsed.data.steps.map((s) => s.words), kinds }, { chat: deps.chat, log: sessionEmitter(deps.agentLog, sessionId) }).catch((): CaptionResult => ({ ok: false, model: PART_TALK_MODEL, reason: "the model call failed" }));
        keep(captions, key, p);
        void p.then((r) => {
          if (!r.ok && captions.get(key) === p) captions.delete(key);
        });
      }
      const r = await p;
      return r.ok ? c.json({ ok: true, model: r.model, captions: r.captions, refused: r.refused }) : none(r.reason);
    });

    app.post("/paste/ask", async (c) => {
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      if (isExampleVisitor()) return refuseOwnCode(c);
      const parsed = askBody.safeParse(await readJson(c.req.raw));
      if (!parsed.success) return c.json({ error: "body: send {experimentId, part, question}" }, 400);
      const got = roundOf(sessionId, parsed.data.experimentId);
      if (!got) return c.json({ error: `this session has no round ${parsed.data.experimentId} on pasted code` }, 404);
      const { round, source, language } = got;
      // D19: only once the person's bet on this round is sealed. Before that a person could get words the AI bettors can't.
      if (!round.bets.some((b) => b.who === "human")) return c.json({ error: "ask after you lock your bet on this round: before that, every bettor bets on the same words", locked: false }, 409);
      const part = fileOutline(source, language).parts.find((p) => p.name === parsed.data.part);
      if (!part) return c.json({ error: `this file has no part named ${parsed.data.part}` }, 400);
      const q = checkQuestion(parsed.data.question);
      if (!q.ok) return c.json({ error: q.reason }, 400);
      const none = (reason: string, extra: Record<string, unknown> = {}) => c.json({ ok: false, model: PART_TALK_MODEL, reason, ...extra });
      if (!deps.chat) return none("this server asks no Meta model");
      // Review M2: answers are never dropped to make room (the person would still know one the AIs no longer get): past the cap, no ask.
      const kept = asks.get(deps.whoOf(c, sessionId))?.get(round.experiment.target.codeSha256)?.length ?? 0;
      if (kept >= ASKS_KEPT_PER_FILE) return none(`you have asked ${ASKS_KEPT_PER_FILE} questions about this file; Atlas keeps no more`, { full: true });
      const allowed = deps.takeAsk(c);
      if (!allowed.ok) return none(allowed.reason);
      const r = await runAsk({ source, language, part: { name: part.name, lineStart: part.lineStart, lineEnd: part.lineEnd }, question: q.text }, { chat: deps.chat, log: sessionEmitter(deps.agentLog, sessionId) }).catch(() => ({ ok: false as const, model: PART_TALK_MODEL, reason: "the model call failed" }));
      if (!r.ok) return none(r.reason, "offTopic" in r && r.offTopic ? { offTopic: true } : {});
      // Kept for this file in this session: every later round on it puts these words in every bettor's text (D19).
      const sha = round.experiment.target.codeSha256;
      const who = deps.whoOf(c, sessionId);
      const mine = asks.get(who) ?? new Map();
      const list = [...(mine.get(sha) ?? []), { part: part.name, question: q.text, answer: r.answer, model: r.model }];
      mine.set(sha, list);
      keep(asks, who, mine);
      return c.json({ ok: true, model: r.model, part: part.name, answer: r.answer });
    });
  }

  return {
    register,
    /** D19: the lines every bettor of a new round on this file gets, from this person's earlier questions about it (any session). */
    asksForText: (c: Context, sessionId: string, codeSha256: string): string[] => asksForBettors(asks.get(deps.whoOf(c, sessionId))?.get(codeSha256) ?? []),
    /** Review M1: how many answers this person holds about this file now. A round remembers it when its text is written. */
    askCount: (c: Context, sessionId: string, codeSha256: string): number => asks.get(deps.whoOf(c, sessionId))?.get(codeSha256)?.length ?? 0,
  };
}
