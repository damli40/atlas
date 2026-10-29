// E3: the "paste any code" routes and the per-session memory they keep.
//
// Routes (server/app.ts registers them; the round itself then uses the usual POST /experiments, /bets, /runs):
// - GET /paste/languages → which languages this server can run (a language with no runner shows "coming").
// - POST /paste {code, language?} → plain code reads the file: its language (guessed by src/paste-language.ts,
//   or the person's choice), its exported functions, and anything that would make the whole run "can't check"
//   (an import, CommonJS exports). The file is kept in THIS session's memory only: never written to disk or the
//   repo, never logged in full (the log line says only its language, line count and fingerprint).
// - POST /paste/proposals {target, exportName} → Muse Wonder (muse-wonder-1.0) proposes up to 3 tests as strict
//   JSON (server/meta/roles/proposer.ts); src/gate.ts checks each. Refused ones are kept and shown with the
//   reason, never run. Its claim sentence is held back (see /paste/claim).
// - POST /paste/claim {experimentId} → Muse Wonder's claim sentence for the proposals that experiment came from,
//   only once the person's bets on it are sealed (or it ran). Before that, every bettor sees the same text
//   (D19), and the betting models never see the claim at all (D18).
//
// Model calls that carry pasted code go through server/meta/pasted-guard.ts (non-contributor Meta models only),
// then the shared model budget, and count against the per-address and per-session limits.

import { spenderOf } from "./access/context";
import type { Context, Hono } from "hono";
import { nanoid } from "nanoid";
import { prototypeKeyIn } from "./paste-keys";
export { prototypeKeyIn };
import { z } from "zod";
import { describeCall, visibleText } from "../src/gate";
import { guessLanguage } from "../src/paste-language";
import { fileOutline } from "../src/file-outline";
import { PASTED_LANGUAGES, PASTED_MAX_BYTES, makePastedTarget, utf8Bytes, type FoundExport, type PastedLanguage } from "../src/pasted-code";
import type { ExperimentShape, Target } from "../src/types";
import { PASTE_WORDS, WONDER_DISPLAY } from "../src/paste-words";
import { LANGUAGE_NAME, pastedFileBlock, pastedLines } from "../src/paste-context";
import { PASTED_RUNNERS, type PastedRunners } from "../runners/pasted-registry";
import type { ChatArgs, ChatResult } from "./meta/client";
import { guardPastedChat } from "./meta/pasted-guard";
import { PROPOSER_MODEL, runProposer, type Proposal } from "./meta/roles/proposer";
import { oneLine, sessionEmitter, type AgentLog } from "./log/agentlog";
import { BAD_SESSION, sessionIdOf } from "./log/sse";
import type { ModelBudget } from "./meta/budget";
import type { BetStore } from "./bets";

/** The JSON body of POST /paste may be larger than other routes' (64 KB of code, escaped as JSON). */
export const PASTE_BODY_BYTES = 512 * 1024;
/** Pasted files one session keeps (the oldest drops first). */
export const MAX_PASTES_PER_SESSION = 5;
/** Sessions whose pastes are kept (the least recently used drops first). 200 × 5 × 64 KB is at most about 64 MB. */
export const MAX_PASTE_SESSIONS = 200;
/** G1 review M6: paste sessions one dev invite code may hold (its own oldest is dropped first). */
export const MAX_PASTE_SESSIONS_PER_CODE = 10;
/** Pastes one client address may send an hour (sessions are free to make; env ATLAS_PASTES_PER_IP_PER_HOUR). */
export const DEFAULT_PASTES_PER_IP_PER_HOUR = 60;
/** Wonder proposal requests one session may make (each is 1–2 paid calls). */
export const MAX_PROPOSALS_PER_SESSION = 3;
/**
 * E3 review B3/M5: the most lines a pasted file may have. The bet screen numbers every line, so 64 KB of empty lines
 * became a 645,000-character text per round (1.3 MB of memory each) and a ~200k-token prompt. 2,000 lines keep the
 * numbered text under about 82 KB.
 */
export const PASTED_MAX_LINES = 2_000;
/** E3 review r3 M2: all shared pasted sources together, at most this many bytes (the one pasted longest ago drops first). */
export const MAX_RETAINED_SOURCE_BYTES = 64 * 1024 * 1024;
/** E3 review B3: all pasted files kept, across sessions, at most this many bytes (the oldest session drops first). */
export const MAX_RETAINED_PASTE_BYTES = 32 * 1024 * 1024;
/** E3 review B3: bet-screen texts kept (one per distinct text, shared by every round that uses it). */
export const MAX_CONTEXTS = 500;
/** E3 review r2 B3: numbered files kept (each is rebuilt from the stored source when dropped). */
export const MAX_BLOCKS = 50;
/** E3 review r2 B3: pasted rounds one session keeps (its oldest that is not running drops first). */
export const MAX_PASTED_ROUNDS_PER_SESSION = 20;
/** E3 review r2 B3: all pasted rounds together, in characters of bettor text and run (the oldest not running drops first). */
export const MAX_PASTED_ROUND_CHARS = 64 * 1024 * 1024;
/**
 * E3 review r2 M1: how long pasted code and everything made from it is kept in memory (pastes, bettor texts, proposal
 * sets, rounds and proof files). The privacy sentence on screen states this number.
 */
export const PASTE_TTL_MS = 2 * 60 * 60 * 1000;
/** E3 review r3 B1: how often expired pastes are swept (besides before every request). */
export const PASTE_SWEEP_MS = 60 * 1000;

export interface PasteOptions {
  /** Muse Wonder for test proposals. Absent: no model is asked and the answer says so. */
  proposer?: { chat: (args: ChatArgs) => Promise<ChatResult>; model?: string; /** E3 review r2 minor 1: the server's shared budget. */ budget?: ModelBudget };
  /** Which languages run here (default runners/pasted-registry.ts). Tests pass their own. */
  runners?: PastedRunners;
  /** Tests only: receives the paste store's counters (the memory regression test reads them). */
  expose?: (p: { stats: () => { blocks: number; contexts: number; sessions: number; retainedBytes: number } }) => void;
}

export interface PastedEntry {
  /** UTF-8 bytes of the source (for the retained-bytes cap). */
  bytes: number;
  /** When it was pasted (ms; for PASTE_TTL_MS). */
  at: number;
  target: Target;
  exports: FoundExport[];
  /** Why the whole run would be "can't check", found before running (null: nothing found). */
  refusal: string | null;
}

interface ProposalSet {
  id: string;
  codeSha256: string;
  exportName: string;
  model: string;
  claim: string | null;
  proposals: Proposal[];
  /** When the set was made (ms; for PASTE_TTL_MS). */
  at: number;
  /**
   * E3 review B2: set when the claim was shown. From then on the set is closed: no experiment can be made from it
   * (as proposed or edited), and no bet can be added to a round made from it.
   */
  claimShownAt?: string;
}

const pasteBody = z
  .object({
    code: z.string().max(PASTED_MAX_BYTES * 2, "the code is longer than Atlas reads"),
    language: z.enum(["js", "ts", "py"]).optional(),
  })
  .strict();
const targetRef = z.object({ ref: z.string().min(1).max(200), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) });
const proposalsBody = z.object({ target: targetRef, exportName: z.string().min(1).max(100) }).strict();
const claimBody = z.object({ experimentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict();

const reasonOf = (err: z.ZodError) =>
  err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join(".") : "body"}: ${i.message}`)
    .join("; ");

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

export interface PasteDeps {
  agentLog: AgentLog;
  betStore: BetStore;
  /** The shared model budget (absent when the server asks no model). */
  budget?: ModelBudget;
  /** Per-address model-round limit, shared with model bets (S5). */
  takeModelRound: (c: Context) => { ok: true } | { ok: false; reason: string };
  /** Per-address paste limit. */
  takePaste: (c: Context) => { ok: true } | { ok: false; reason: string };
  /** E3 review r3 B1: where runs happen on this server (the page's privacy sentence is built from it). */
  executorKind: "local" | "modal";
}

export function createPaste(opts: PasteOptions, deps: PasteDeps) {
  const runners = opts.runners ?? PASTED_RUNNERS;
  const sessions = new Map<string, Map<string, PastedEntry>>();
  /** G1 review M6: which spender opened each paste session. */
  const sessionWho = new Map<string, string>();
  const sets = new Map<string, Map<string, ProposalSet>>(); // session → set id → set
  const proposalCount = new Map<string, number>();
  /** experiment id → the proposal set it came from (session-scoped by the round store itself). */
  const experimentSet = new Map<string, { sessionId: string; setId: string }>();
  const proposerModel = opts.proposer?.model ?? PROPOSER_MODEL;
  /** E3 review B3: one bet-screen text (its test part) per distinct text, shared by every round that uses it. */
  const contexts = new Map<string, string>();
  /** E3 review r2 B3: the numbered file, one per (file, marked line). */
  const blocks = new Map<string, string>();
  /** E3 review r2 B3: every pasted round kept, oldest first, with the source it uses. */
  const roundsKept = new Map<string, { sessionId: string; chars: number; sourceKey: string }>();
  /**
   * E3 review r3 M2: ONE copy of each pasted source, per (fingerprint, language), shared by every paste entry, round and
   * proof file that uses it, and counted once in the round budget. `pastedAt` is the last time anyone pasted it: it is
   * kept PASTE_TTL_MS after that, then the source and everything made from it are dropped (B1: the sentence says so).
   */
  const sources = new Map<string, { target: Target; bytes: number; pastedAt: number }>();
  const sourceKeyOf = (t: Pick<Target, "codeSha256" | "language">) => `${t.codeSha256}:${t.language ?? "?"}`;
  // Order matters: the guard refuses contributor ids before the budget counts or spends anything.
  const proposerChat = opts.proposer && deps.budget ? guardPastedChat(deps.budget.wrap(opts.proposer.chat)) : undefined;

  const touch = <V>(m: Map<string, V>, key: string, make: () => V, max: number): V => {
    let v = m.get(key);
    if (v !== undefined) m.delete(key);
    else v = make();
    m.set(key, v);
    while (m.size > max) m.delete(m.keys().next().value!);
    return v;
  };

  const runnable = (lang: PastedLanguage) => runners[lang] !== undefined;

  /** Characters the round budget counts: every round's own size, plus each distinct source the rounds use, once. */
  const budgetUsed = (): number => {
    let total = 0;
    const used = new Set<string>();
    for (const v of roundsKept.values()) {
      total += v.chars;
      used.add(v.sourceKey);
    }
    for (const k of used) total += sources.get(k)?.bytes ?? 0;
    return total;
  };
  /** E3 review r3 minor 1: the over-cap session gives up its own oldest unprotected rounds first, then others' oldest. */
  const enforce = (sessionId: string, current: string, keep: (sid: string, id: string) => boolean): { sessionId: string; experimentId: string }[] => {
    const drop: { sessionId: string; experimentId: string }[] = [];
    const droppable = (sid: string, id: string) => id !== current && !keep(sid, id);
    const take = (sid: string, id: string) => {
      roundsKept.delete(id);
      drop.push({ sessionId: sid, experimentId: id });
    };
    const mine = () => [...roundsKept].filter(([, v]) => v.sessionId === sessionId);
    for (const [id] of mine()) {
      if (mine().length <= MAX_PASTED_ROUNDS_PER_SESSION) break;
      if (droppable(sessionId, id)) take(sessionId, id);
    }
    for (const [id] of mine()) {
      if (budgetUsed() <= MAX_PASTED_ROUND_CHARS) break;
      if (droppable(sessionId, id)) take(sessionId, id);
    }
    for (const [id, v] of [...roundsKept]) {
      if (budgetUsed() <= MAX_PASTED_ROUND_CHARS) break;
      if (droppable(v.sessionId, id)) take(v.sessionId, id);
    }
    return drop;
  };

  /**
   * E3 review r3 M2: all shared sources together stay under MAX_RETAINED_SOURCE_BYTES. Past it, the source pasted
   * longest ago goes first, with its paste entries and rounds (its proof files lose their source and are dropped when
   * next read), unless a protected round (running, or holding sealed bets that have not run) uses it.
   */
  const trimSources = (current: string) => {
    let total = 0;
    for (const v of sources.values()) total += v.bytes;
    for (const [k, v] of [...sources]) {
      if (total <= MAX_RETAINED_SOURCE_BYTES) break;
      if (k === current) continue;
      const users = [...roundsKept].filter(([, r]) => r.sourceKey === k);
      const isProtected = users.some(([id, r]) => {
        const round = deps.betStore.peek(r.sessionId)?.get(id);
        return round !== undefined && (round.status === "running" || (round.status === "open" && round.bets.some((b) => b.who === "human")));
      });
      if (isProtected) continue;
      sources.delete(k);
      total -= v.bytes;
      for (const [id, r] of users) {
        roundsKept.delete(id);
        deps.betStore.peek(r.sessionId)?.delete(id);
      }
      for (const [sid, m] of sessions) {
        for (const [ek, e] of m) if (sourceKeyOf(e.target) === k) m.delete(ek);
        if (m.size === 0) sessions.delete(sid);
      }
    }
  };

  /** E3 review B3: keep all pastes under MAX_RETAINED_PASTE_BYTES, dropping the least recently used session first. */
  const trimRetained = () => {
    let total = 0;
    for (const m of sessions.values()) for (const e of m.values()) total += e.bytes;
    for (const [sid, m] of sessions) {
      if (total <= MAX_RETAINED_PASTE_BYTES) break;
      for (const e of m.values()) total -= e.bytes;
      sessions.delete(sid);
    }
  };

  /** The session's pasted target with this ref and fingerprint, or undefined. */
  const entryOf = (sessionId: string, t: { ref: string; codeSha256: string }): PastedEntry | undefined => {
    const e = sessions.get(sessionId)?.get(t.codeSha256);
    return e && e.target.ref === t.ref ? e : undefined;
  };

  const languages = () => PASTED_LANGUAGES.map((l) => ({ language: l, name: LANGUAGE_NAME[l], runnable: runnable(l) }));

  function register(app: Hono) {
    app.get("/paste/languages", (c) => c.json({ languages: languages(), maxBytes: PASTED_MAX_BYTES, executor: deps.executorKind, privacy: PASTE_WORDS.notStored(deps.executorKind) }));

    app.post("/paste", async (c) => {
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      // E3 review minor 6: JSON only, so another website cannot send a "simple" text/plain request from a visitor's browser.
      if (!/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "send the code as JSON (content-type: application/json)" }, 415);
      const raw = await readJson(c.req.raw);
      if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
      const parsed = pasteBody.safeParse(raw.body);
      if (!parsed.success) return c.json({ error: reasonOf(parsed.error) }, 400);
      const { code } = parsed.data;
      if (code.trim() === "") return c.json({ error: "the pasted code is empty" }, 400);
      const bytes = utf8Bytes(code);
      if (bytes > PASTED_MAX_BYTES) return c.json({ error: `the pasted code is ${bytes} bytes; Atlas reads one file of at most ${PASTED_MAX_BYTES} bytes (64 KB)` }, 413);
      // E3 review r2 minor 2: a lone CR is a line ending to JavaScript and Python but not to Atlas's export scan, so
      // such a file is refused with a plain fix; every other ending (CRLF, LF, U+2028, U+2029) is counted as a line.
      if (/\r(?!\n)/.test(code)) return c.json({ error: "the code uses a lone carriage return (CR) as a line ending; save it with LF or CRLF line endings and paste it again" }, 400);
      const lineCount = pastedLines(code).length;
      if (lineCount > PASTED_MAX_LINES) return c.json({ error: `the pasted code has ${lineCount} lines; Atlas reads one file of at most ${PASTED_MAX_LINES.toLocaleString("en-US")} lines` }, 413);
      // E3 review minor 7: counted only once the paste is one Atlas will read (a refused size costs nothing).
      const perIp = deps.takePaste(c);
      if (!perIp.ok) return c.json({ error: `paste not read: ${perIp.reason}` }, 429);
      const guess = guessLanguage(code);
      const language: PastedLanguage = parsed.data.language ?? guess.language;
      const lang = { chosen: language, guessed: guess.language, why: guess.why, chosenBy: parsed.data.language ? ("person" as const) : ("plain code" as const) };
      const runner = runners[language];
      const made = makePastedTarget(code, language);
      // E3 review r3 M2: reuse the one shared copy of this source (and mark it as pasted now).
      const known = sources.get(sourceKeyOf(made));
      const target = known?.target ?? made;
      if (runners[language]) {
        sources.delete(sourceKeyOf(made)); // most recently pasted last
        sources.set(sourceKeyOf(made), { target, bytes, pastedAt: Date.now() });
        trimSources(sourceKeyOf(made));
      }
      const lines = lineCount;
      if (!runner) {
        // A language with no runner here: nothing is kept and nothing about the code is guessed.
        return c.json({ target: { kind: target.kind, ref: target.ref, codeSha256: target.codeSha256, language }, language: lang, languages: languages(), runnable: false, reason: PASTE_WORDS.pythonNotYet, exports: [], cantCheck: null, lines });
      }
      const read = runner.read(code);
      const entry: PastedEntry = { bytes, at: Date.now(), target, exports: read.exports, refusal: read.refusal };
      // G1 review M6: a dev invite code holds at most MAX_PASTE_SESSIONS_PER_CODE paste sessions; a new one past that
      // drops the code's OWN least recently used one, never another person's.
      const who = spenderOf();
      if (!sessions.has(sessionId) && who.kind === "dev") {
        const own = [...sessions.keys()].filter((k) => sessionWho.get(k) === who.key);
        if (own.length >= MAX_PASTE_SESSIONS_PER_CODE) {
          sessions.delete(own[0]!);
          sessionWho.delete(own[0]!);
        }
      }
      const mine = touch(sessions, sessionId, () => new Map<string, PastedEntry>(), MAX_PASTE_SESSIONS);
      sessionWho.set(sessionId, who.key);
      while (sessionWho.size > MAX_PASTE_SESSIONS * 2) sessionWho.delete(sessionWho.keys().next().value!);
      // E3 review M1: a second paste of the same code REPLACES the first (its language may differ), never keeps it.
      mine.delete(target.codeSha256);
      mine.set(target.codeSha256, entry);
      while (mine.size > MAX_PASTES_PER_SESSION) mine.delete(mine.keys().next().value!);
      trimRetained();
      try {
        deps.agentLog.emit(sessionId, {
          role: "human",
          action: oneLine(`pastes one ${LANGUAGE_NAME[language]} file (${lines} lines, sha256 ${target.codeSha256.slice(0, 12)}…, ${read.exports.length} exports)`),
          ref: { kind: "target", id: target.codeSha256 },
        });
      } catch {
        // a refused log line never stops the paste
      }
      return c.json({
        target: { kind: target.kind, ref: target.ref, codeSha256: target.codeSha256, language },
        language: lang,
        languages: languages(),
        runnable: true,
        exports: read.exports,
        cantCheck: read.refusal,
        lines,
        // U1 (D47): the file's functions and which calls which, by plain code (the drawing shows this before any test).
        outline: fileOutline(code, language),
      });
    });

    app.post("/paste/proposals", async (c) => {
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      const raw = await readJson(c.req.raw);
      if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
      const parsed = proposalsBody.safeParse(raw.body);
      if (!parsed.success) return c.json({ error: reasonOf(parsed.error) }, 400);
      const entry = entryOf(sessionId, parsed.data.target);
      if (!entry) return c.json({ error: "this session has no pasted file with that ref and fingerprint: paste it first (POST /paste)" }, 400);
      const exp = entry.exports.find((e) => e.name === parsed.data.exportName);
      if (!exp) return c.json({ error: `the pasted file has no export named "${parsed.data.exportName}"; it exports ${entry.exports.map((e) => e.name).join(", ") || "nothing"}` }, 400);
      const display = WONDER_DISPLAY;
      const notAsked = (reason: string) => c.json({ ok: false, model: proposerModel, display, reason: `not asked (${reason})`, proposals: [] });
      if (!opts.proposer || !proposerChat || !deps.budget) return notAsked("this server asks no Meta model for tests");
      // E3 review minor 5: a file plain code already knows is "can't check" costs no model call.
      if (entry.refusal) return notAsked(`every run of this file would be can't check: ${visibleText(entry.refusal)}`);
      const used = proposalCount.get(sessionId) ?? 0;
      if (used >= MAX_PROPOSALS_PER_SESSION) return notAsked(`call limit reached: this session already asked for tests ${MAX_PROPOSALS_PER_SESSION} times`);
      const byIp = deps.takeModelRound(c);
      if (!byIp.ok) return notAsked(byIp.reason);
      proposalCount.set(sessionId, used + 1);
      const r = await runProposer(
        {
          source: entry.target.source!,
          language: entry.target.language!,
          exportName: exp.name,
          exportLine: exp.line,
          exportNames: entry.exports.map((e) => e.name),
          model: proposerModel,
        },
        { chat: proposerChat, log: sessionEmitter(deps.agentLog, sessionId) },
      );
      const setId = `ps_${nanoid(10)}`;
      const set: ProposalSet = { id: setId, codeSha256: entry.target.codeSha256, exportName: exp.name, model: r.model, claim: r.ok ? visibleText(r.claim) : null, proposals: r.proposals, at: Date.now() };
      touch(sets, sessionId, () => new Map<string, ProposalSet>(), MAX_PASTE_SESSIONS).set(setId, set);
      const shown = r.proposals.map((p) => ({
        id: p.id,
        attempt: p.attempt,
        params: p.params,
        // E3 review minor 2: hidden characters in a reason are shown as escapes.
        gate: p.gate.allowed ? p.gate : { allowed: false as const, reason: visibleText(p.gate.reason) },
        // Plain code's description of what the test does (only for an allowed test: refused params may not be readable).
        ...(p.gate.allowed ? { says: describeCall(p.params as Extract<ExperimentShape, { shape: "call-function" }>) } : {}),
      }));
      return c.json({
        ok: r.ok,
        model: r.model,
        display,
        setId,
        ...(r.ok ? {} : { reason: r.reason }),
        proposals: shown,
        claimHeld: r.ok,
        usage: r.usage ?? null,
      });
    });

    app.post("/paste/claim", async (c) => {
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      const raw = await readJson(c.req.raw);
      if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
      const parsed = claimBody.safeParse(raw.body);
      if (!parsed.success) return c.json({ error: reasonOf(parsed.error) }, 400);
      const id = parsed.data.experimentId;
      const round = deps.betStore.peek(sessionId)?.get(id);
      const link = experimentSet.get(id);
      if (!round || !link || link.sessionId !== sessionId) return c.json({ error: `this session has no experiment ${id} made from Muse Wonder's proposals` }, 404);
      const set = sets.get(sessionId)?.get(link.setId);
      if (!set || set.claim === null) return c.json({ error: "Muse Wonder wrote no usable claim for these proposals" }, 404);
      // E3 review B2: only once EVERY bet on this round is frozen (its run has started), for every bettor. Then the
      // proposal set is closed: no new experiment, edited test or bet can come from it.
      if (round.status === "open") return c.json({ error: "Muse Wonder's sentence is shown once this round's bets are frozen (when its run starts), so every bettor bets on the same information" }, 409);
      set.claimShownAt ??= new Date().toISOString();
      return c.json({ model: set.model, display: WONDER_DISPLAY, claim: set.claim });
    });
  }

  return {
    register,
    runnable,
    runners,
    /** The session's pasted target for POST /experiments (undefined when this session never pasted it). */
    entryOf,
    /**
     * A proposal of this session on this code, for POST /experiments {proposalId} (as proposed: it must be allowed)
     * or {editedFrom} (edited by the person: any proposal). Refused once the set's claim was shown (B2).
     */
    proposalOf(sessionId: string, proposalId: string, codeSha256: string, edited = false): { set: ProposalSet; proposal: Proposal } | { error: string; status: 400 | 409 | 422 } {
      for (const set of sets.get(sessionId)?.values() ?? []) {
        const p = set.proposals.find((x) => x.id === proposalId);
        if (!p) continue;
        if (set.codeSha256 !== codeSha256) return { error: `proposal ${proposalId} was made for other code`, status: 400 };
        if (set.claimShownAt) return { error: `Muse Wonder's sentence about these tests was shown at ${set.claimShownAt}, so they are closed: no new round can come from them`, status: 409 };
        if (!edited && !p.gate.allowed) return { error: `the gate refused proposal ${proposalId}, so it can never run: ${visibleText(p.gate.reason)}`, status: 422 };
        return { set, proposal: p };
      }
      return { error: `this session has no proposal ${proposalId}`, status: 400 };
    },
    /** E3 review B2: why no more bets may be sealed on this round (its proposal set's claim was shown), or null. */
    betsClosed(sessionId: string, experimentId: string): string | null {
      const link = experimentSet.get(experimentId);
      if (!link || link.sessionId !== sessionId) return null;
      const set = sets.get(sessionId)?.get(link.setId);
      return set?.claimShownAt ? `Muse Wonder's sentence about this round's tests was shown at ${set.claimShownAt}, so no more bets can be sealed on it` : null;
    },
    /**
     * E3 review r2 B3: the test part of a bettor text, built and length-checked BEFORE it is cached; one copy per
     * distinct text (the key holds every input that appears in it: file, language, export line, writer, test, repeat).
     */
    headFor(key: string, build: () => string, fits: (head: string) => string | null): { ok: true; head: string } | { ok: false; reason: string } {
      const known = contexts.get(key);
      if (known !== undefined) {
        contexts.delete(key);
        contexts.set(key, known);
        return { ok: true, head: known };
      }
      const head = build();
      const why = fits(head);
      if (why) return { ok: false, reason: why };
      contexts.set(key, head);
      while (contexts.size > MAX_CONTEXTS) contexts.delete(contexts.keys().next().value!);
      return { ok: true, head };
    },
    /** E3 review r2 B3: the numbered file, one copy per (file, marked line), rebuilt from the source when it was dropped. */
    fileBlock(codeSha256: string, source: string, mark: number): string {
      const key = `${codeSha256}:${mark}`;
      let b = blocks.get(key);
      if (b === undefined) {
        b = pastedFileBlock(source, mark);
        blocks.set(key, b);
        while (blocks.size > MAX_BLOCKS) blocks.delete(blocks.keys().next().value!);
      }
      return b;
    },
    /**
     * E3 review r2 B3 / r3 M2 and minor 1: every pasted round, oldest first, with its size; each distinct source it uses
     * counts once. A session keeps at most MAX_PASTED_ROUNDS_PER_SESSION and all rounds together at most
     * MAX_PASTED_ROUND_CHARS. Past either, the session that went over gives up its OWN oldest round first; only then
     * the oldest of others. A protected round (running, or holding sealed bets that have not run) is never dropped.
     * Returns the rounds to drop.
     */
    trackRound(sessionId: string, experimentId: string, chars: number, sourceKey: string, keep: (sid: string, id: string) => boolean): { sessionId: string; experimentId: string }[] {
      roundsKept.set(experimentId, { sessionId, chars, sourceKey });
      return enforce(sessionId, experimentId, keep);
    },
    /** Adds the run's size to a pasted round's count (after its run), and enforces the budget again (r3 minor 1). */
    noteRoundChars(experimentId: string, more: number, keep: (sid: string, id: string) => boolean): { sessionId: string; experimentId: string }[] {
      const r = roundsKept.get(experimentId);
      if (!r) return [];
      r.chars += more;
      return enforce(r.sessionId, experimentId, keep);
    },
    /** The characters the round budget counts (rounds + each distinct source once). For tests. */
    roundBudgetUsed: () => budgetUsed(),
    sourceKeyOf,
    /** E3 review r3 M2: a pasted target with its shared source, or undefined once the source expired. */
    sourceTarget(t: Pick<Target, "codeSha256" | "language">): Target | undefined {
      return sources.get(sourceKeyOf(t))?.target;
    },
    /**
     * E3 review r2 M1 / r3 B1: a source is dropped PASTE_TTL_MS after it was last pasted, with every paste entry, bettor
     * text, numbered file, proposal set and round made from it. Returns the rounds to drop; the app drops their proof
     * files too (they re-attach the source from here, so a dropped source means no source anywhere).
     */
    expire(now = Date.now()): { sessionId: string; experimentId: string }[] {
      const gone = new Set<string>();
      for (const [k, v] of sources) {
        if (now - v.pastedAt < PASTE_TTL_MS) continue;
        sources.delete(k);
        gone.add(k);
      }
      if (gone.size === 0) return [];
      const shas = new Set([...gone].map((k) => k.split(":")[0]!));
      for (const [sid, m] of sessions) {
        for (const [k, e] of m) if (gone.has(sourceKeyOf(e.target))) m.delete(k);
        if (m.size === 0) sessions.delete(sid);
      }
      for (const [sid, m] of sets) {
        for (const [k, v] of m) if (shas.has(v.codeSha256)) m.delete(k);
        if (m.size === 0) sets.delete(sid);
      }
      for (const k of [...contexts.keys()]) if (shas.has(k.split("\n")[0]!)) contexts.delete(k);
      for (const k of [...blocks.keys()]) if (shas.has(k.split(":")[0]!)) blocks.delete(k);
      const old: { sessionId: string; experimentId: string }[] = [];
      for (const [id, v] of roundsKept) if (gone.has(v.sourceKey)) old.push({ sessionId: v.sessionId, experimentId: id });
      for (const o of old) roundsKept.delete(o.experimentId);
      return old;
    },
    /** For the memory regression test. */
    stats: () => ({ blocks: blocks.size, contexts: contexts.size, sessions: sessions.size, retainedBytes: [...sessions.values()].reduce((n, m) => n + [...m.values()].reduce((k, e) => k + e.bytes, 0), 0) }),
    /** Remembers which proposal set an experiment came from (for /paste/claim). */
    linkExperiment(experimentId: string, sessionId: string, setId: string) {
      experimentSet.set(experimentId, { sessionId, setId });
      while (experimentSet.size > MAX_PASTE_SESSIONS * 50) experimentSet.delete(experimentSet.keys().next().value!);
    },
  };
}

export type Paste = ReturnType<typeof createPaste>;
