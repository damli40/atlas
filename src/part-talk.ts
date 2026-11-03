// R14: Muse Wonder talks about one part of the drawing, in three new places. AI proposes, plain code decides: this file is the check
// for all three. Pure.
//
// 1. The pick (before a bet): Muse Wonder marks ONE box, with a short reason about the person's record and the part's role. The
//    reason goes through the file summary's checker (src/file-summary.ts): no word about how a call ends, no number, no judgment.
// 2. The run captions (after the run): one short plain caption per recorded step of the act. Refused: claim words, digits, and a
//    caption that contradicts the step's recorded kind where plain code can tell (a return on a throw step, and so on).
// 3. The answer (after the bet is locked): a short answer about one part. Refused: claim words ("safe", "correct", "works"...).
//
// None of these is a check. The screen says so, and none of them is ever on the proof picture.

import { checkSummaryLine } from "./file-summary";

/** Word beginnings that judge code or claim trust. A caption or an answer may say what a part does, never that it is good or bad. */
export const CLAIM_STEMS = [
  "verif", "secur", "trust", "audit", "approv", "safe", "robust", "reliab", "guarant", "flaw", "perfect", "correct", // wording-lint: allow (refused words, never shown)
  "bug", "fix", "wrong", "vulnerab", "exploit", "accura", "dependab", "flawless", "foolproof", "bulletproof", "airtight", "watertight", // wording-lint: allow
] as const;
/** Whole words that judge code or claim trust. */
export const CLAIM_WORDS = [
  "ok", "okay", "fine", "good", "bad", "clean", "works", "working", "worked", "proven", "prove", "proves", "proved", "harmless", "harmful",
  "sound", "soundly", "solid", "solidly", "proper", "properly", "right", "broken", "ideal", "flawed", "valid", "invalid", "tested", "untested", // wording-lint: allow
] as const;
/** Phrases Atlas never puts on screen (the Moonwell wording rules), matched as whole words in small letters. */
export const CLAIM_PHRASES = ["caught before shipping", "ai caused", "hangs forever", "re proven", "research shows", "first", "claude", "as expected", "no problem", "no problems", "no issue", "no issues"] as const; // wording-lint: allow

const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z]+/).filter((w) => w !== "");

/** The first claim word or phrase in a text, or null. Matched at the start of each word, and after "un", "in" or "non". */
export function claimIn(text: string): string | null {
  const words = wordsOf(text);
  const flat = ` ${words.join(" ")} `;
  const phrase = CLAIM_PHRASES.find((p) => flat.includes(` ${p} `));
  if (phrase) return phrase;
  for (const w of words) {
    const bare = [w, ...["un", "in", "non"].filter((p) => w.startsWith(p) && w.length > p.length + 2).map((p) => w.slice(p.length))];
    if (bare.some((b) => (CLAIM_WORDS as readonly string[]).includes(b) || CLAIM_STEMS.some((s) => b.startsWith(s)))) return w;
  }
  return null;
}

type Checked = { ok: true; text: string } | { ok: false; reason: string };

/** One line of Muse Wonder's words, cleaned to single spaces, or why it is refused. */
function checkLine(raw: unknown, caps: { words: number; chars: number; digits: boolean }): Checked {
  if (typeof raw !== "string") return { ok: false, reason: "not text" };
  // Review M4: backticks are dropped, curly quotes and dashes read as plain ones, so ordinary model text (and Python's snake_case) stands.
  const text = raw.trim().replace(/`/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ");
  if (text === "") return { ok: false, reason: "empty" };
  if (text.length > caps.chars) return { ok: false, reason: `longer than ${caps.chars} characters` };
  if (!caps.digits && /[0-9]/.test(text)) return { ok: false, reason: "has a digit" };
  if (!/^[A-Za-z0-9_ ,.;:'"()?!/-]+$/.test(text)) return { ok: false, reason: "only letters, spaces and plain punctuation are allowed" };
  if (/[A-Za-z_]\(/.test(text)) return { ok: false, reason: "reads as code (a name right before a bracket)" };
  if (wordsOf(text).length === 0) return { ok: false, reason: "no words" };
  if (text.split(" ").length > caps.words) return { ok: false, reason: `more than ${caps.words} words` };
  const claim = claimIn(text);
  if (claim) return { ok: false, reason: `uses "${claim}", a word that judges the code or claims trust` };
  return { ok: true, text };
}

// ---- 1. the pick ----

export const PICK_REASON_MAX_WORDS = 22;
export const PICK_REASON_MAX_CHARS = 160;

/**
 * Muse Wonder's pick, checked. The part must be one of `bettable` (functions Atlas can call in this file). The reason goes through the
 * summary's own checker (no ending, no result, no number as digits or words, no judgment), with a few more words of room.
 */
export function checkPick(answer: unknown, bettable: readonly string[]): { ok: true; part: string; reason: string } | { ok: false; reason: string } {
  const a = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, unknown>) : {};
  if (typeof a.part !== "string" || !bettable.includes(a.part)) return { ok: false, reason: "it picked no part Atlas can call in this file" };
  const r = checkSummaryLine(a.reason, { words: PICK_REASON_MAX_WORDS, chars: PICK_REASON_MAX_CHARS });
  if (!r.ok) return { ok: false, reason: `plain code refused its reason (${r.reason})` };
  const claim = claimIn(r.text);
  if (claim) return { ok: false, reason: `plain code refused its reason (uses "${claim}")` };
  return { ok: true, part: a.part, reason: r.text };
}

/**
 * The words the pick prompt may use for each kind of question: each passes the summary's checker (so "returned value" is "value
 * questions": "returned" is a word about how a call ends, which the checker refuses).
 */
export const KIND_PHRASE: Readonly<Record<string, string>> = {
  outcome: "questions on how a call ends",
  "returned value": "value questions",
  timing: "timing questions",
  "call counts": "questions on how often a helper is called",
  "Moonwell price": "price questions",
};

// ---- 2. the run captions ----

export const CAPTION_MAX_WORDS = 12;
export const CAPTION_MAX_CHARS = 90;
/** The most steps one captions call covers (the act is folded to 24: renderer/authors/run-act.ts fitAct). */
export const CAPTION_MAX_STEPS = 24;

/**
 * What plain code knows a recorded step was, from the server's own copy of the run where it can tell:
 * - "*-returned" / "*-threw": the step's call or the run ended that way;
 * - "end-unsettled": the run never settled, or was still running when Atlas stopped;
 * - "quiet": nothing returned or threw at this step (Atlas called, time passed, Atlas waited);
 * - "other": plain code can't tell, so only the claim words are checked.
 */
export type StepKind = "call-returned" | "call-threw" | "end-returned" | "end-threw" | "end-unsettled" | "helper-threw" | "quiet" | "other";

// Review M5: wider lists, and a word right after "never", "not", "no", "doesn't", "without" (and the like) is not a claim that it happened.
const RETURN_CLAIM = /\b(returns?|returned|returning|resolves?|resolved|succeeds?|succeeded|success|successful(ly)?|gives? back|gave back|hands? back|hands? over|comes? back with|came back with|answers? with|answered with|yields?|yielded|delivers?|delivered)\b/gi;
const THROW_CLAIM = /\b(throws?|threw|thrown|throwing|raises?|raised|rejects?|rejected|crash(es|ed)?|errors? out|fails?|failed)\b/gi;
/** On a step where nothing has happened yet, only a past tense claims it did ("waits for it to return" is honest). */
const RETURN_PAST = /\b(returned|resolved|succeeded|gave back|came back with|answered with|yielded|delivered)\b/gi;
const THROW_PAST = /\b(threw|thrown|raised|rejected|crashed|failed|errored)\b/gi;
const ENDING_CLAIM = /\b(finish(es|ed)?|complete[sd]?|ends|ended|stops|stopped)\b/gi;
const NEGATED = /\b(never|not|no|doesn't|does not|didn't|did not|won't|without|nothing|before it|until it)\s+(\w+\s+)?$/i;

/** Why a caption contradicts what plain code knows about its step, or null. */
export function contradicts(text: string, kind: StepKind): string | null {
  const says = (re: RegExp): string | null => {
    for (const m of text.matchAll(re)) if (!NEGATED.test(text.slice(0, m.index))) return m[0];
    return null;
  };
  switch (kind) {
    case "call-threw":
    case "helper-threw":
    case "end-threw": {
      const w = says(RETURN_CLAIM);
      return w ? `says "${w}" on a step that threw` : null;
    }
    case "call-returned":
    case "end-returned": {
      // An earlier failure may be told on the step that returned ("after it fails twice, it returns"): only a throw word counts here,
      // unless the step is a single call's answer, where "fails" can only be about this call.
      const w = kind === "call-returned" ? says(THROW_CLAIM) : says(/\b(throws?|threw|thrown|throwing|raises?|raised|rejects?|rejected|crash(es|ed)?|errors? out)\b/gi);
      return w ? `says "${w}" on a step that returned` : null;
    }
    case "end-unsettled": {
      const w = says(RETURN_CLAIM) ?? says(THROW_CLAIM) ?? says(ENDING_CLAIM);
      return w ? `says "${w}" on a run that never ended` : null;
    }
    case "quiet": {
      const w = says(RETURN_PAST) ?? says(THROW_PAST);
      return w ? `says "${w}" on a step where nothing returned or threw` : null;
    }
    default:
      return null;
  }
}

/** One caption, checked against its step's kind. */
export function checkCaption(raw: unknown, kind: StepKind): Checked {
  const c = checkLine(raw, { words: CAPTION_MAX_WORDS, chars: CAPTION_MAX_CHARS, digits: false });
  if (!c.ok) return c;
  const why = contradicts(c.text, kind);
  return why ? { ok: false, reason: why } : c;
}

/** The model's captions, checked: {"captions": {"0": "...", ...}} keyed by step index. Refused ones are dropped and counted. */
export function checkCaptions(answer: unknown, kinds: readonly StepKind[]): { captions: Record<number, string>; refused: number; reasons: string[] } {
  const a = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, unknown>).captions : undefined;
  const got = a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
  const captions: Record<number, string> = {};
  const reasons: string[] = [];
  let refused = 0;
  kinds.forEach((kind, i) => {
    if (!Object.prototype.hasOwnProperty.call(got, String(i))) return;
    const c = checkCaption(got[String(i)], kind);
    if (c.ok) captions[i] = c.text;
    else {
      refused++;
      reasons.push(`step ${i}: ${c.reason}`);
    }
  });
  refused += Object.keys(got).filter((k) => !/^\d+$/.test(k) || Number(k) >= kinds.length).length;
  return { captions, refused, reasons };
}

// ---- 3. the answer ----

export const ASK_MAX_WORDS = 60;
export const ASK_MAX_CHARS = 420;
export const QUESTION_MAX_CHARS = 200;

/** The model's answer, checked: {"answer": "..."} or {"offTopic": true}. */
export function checkAnswer(answer: unknown): { ok: true; text: string } | { ok: false; offTopic: true } | { ok: false; reason: string } {
  const a = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, unknown>) : {};
  if (a.offTopic === true) return { ok: false, offTopic: true };
  const c = checkLine(a.answer, { words: ASK_MAX_WORDS, chars: ASK_MAX_CHARS, digits: true });
  return c.ok ? c : { ok: false, reason: c.reason };
}

/** A person's question, cleaned, or why it is not sent (nothing is asked). */
export function checkQuestion(raw: unknown): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "type a question" };
  const text = raw.trim().replace(/\s+/g, " ");
  if (text === "") return { ok: false, reason: "type a question" };
  if (text.length > QUESTION_MAX_CHARS) return { ok: false, reason: `a question may be at most ${QUESTION_MAX_CHARS} characters` };
  return { ok: true, text };
}

/** D19: the lines every AI bettor gets in a later round on the same file, when the person asked about its parts after a locked bet. */
export function asksForBettors(asks: readonly { part: string; question: string; answer: string; model: string }[]): string[] {
  if (asks.length === 0) return [];
  return [
    "Earlier, after locking a bet, the person asked Muse Wonder (Meta's AI) about parts of this file. The person's page showed these same words. Its words, not a check:",
    ...asks.map((a) => `- ${a.part}: asked "${a.question}"; ${a.model} answered: ${a.answer}`),
  ];
}

// ---- the words on screen (DAMI: every sentence below is placeholder wording; finish with /stop-slop and /copywriting) ----

export const PART_TALK_WORDS = {
  // 1. Bet on this part
  betOnPart: "Bet on this part",
  betOnPartPaid: "Meta's AI writes a test for this part (paid calls).",
  notCallable: "Atlas can only bet on a function that can be called from outside this file.",
  sameAsNow: "Your bet is on this part.",
  // 2. captions
  captionsLegend: "Muse Wonder's words (Meta's AI), not a check",
  captionsFold: (n: number) => `What the run did, step by step, with Muse Wonder's words (${n})`,
  captionsNone: "No words from Meta's AI this time: it was slow, a limit was reached, or its words didn't pass Atlas's checks.",
  // 3. ask
  askHeading: "Ask about this part",
  askLocked: "Ask after you lock your bet. Before that, everyone bets on the same words.",
  askPlaceholder: "What does this part do?",
  askGo: "Ask",
  askPaid: "One paid AI call.",
  askLegend: "Muse Wonder's answer (Meta's AI), not a check",
  askOffTopic: "Muse Wonder answers questions about this part only.",
  askFull: "You have asked the most questions Atlas keeps for this file.",
  askRefused: "Muse Wonder's answer didn't pass Atlas's checks, so it isn't shown.",
  // 4. the pick
  pickHeading: "Muse Wonder's pick for you",
  pickLegend: "Its words (Meta's AI), from your record. Not a check.",
  pickAccept: "Bet on this part",
  pickOther: "Pick another part",
  pickNoRecord: "No record yet, so Muse Wonder's usual choice is used. Play a few rounds and Atlas aims at what you miss.",
  pickRefused: "Muse Wonder's pick didn't pass Atlas's checks this time, so its usual choice is used.",
  pickExample: "Play a few rounds with your own code and Atlas aims at what you miss.",
  pickOtherHow: "Click any box on the drawing, then press Bet on this part.",
  // 5. the record
  recordLine: (kind: string, matched: number, n: number) => `Your record: ${kind} questions ${matched} of ${n} matched`,
  /** The kind of question as the record line says it. */
  recordKind: { outcome: "ending", "returned value": "value", timing: "timing", "call counts": "call count", "Moonwell price": "Moonwell price" } as Readonly<Record<string, string>>,
} as const;

/** The lines a record page states about what Atlas keeps and how Muse Wonder uses it (DAMI: placeholder wording). */
export const REMEMBER_WORDS = {
  what: "Atlas remembers, for each of your bets: the kind of question, whether it matched, and whether the test made something fail. Never your code, never the bet question's words, never your answer.",
  asks: "What you ask about a part after locking a bet is kept too, with Muse Wonder's answer, in the server's memory: the AIs that bet with you get the same words in your later rounds on that file, so nobody bets on more than the others.",
  whereInvite: "Kept for your invite code on this server, on disk: it is still here after a restart.",
  whereInviteMemory: "Kept for your invite code in the server's memory only: a restart clears it.",
  whereBrowserDisk: "Kept for this browser on this server (no invite code), on disk.",
  whereMemory: "Kept for this browser in the server's memory only (no invite code): a restart clears it.",
  how: "How Muse Wonder uses it: when it writes a test, and when it picks a part for you, it is told only the kinds of question you miss most, with their counts. The AIs that bet with you are never told your record.",
} as const;
