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


/**
 * Review round 2 (M-B): Muse Wonder's pick is only WHICH part: an exact name from the parts Atlas can call. Its free text is never shown.
 */
export function checkPick(answer: unknown, bettable: readonly string[]): { ok: true; part: string } | { ok: false; reason: string } {
  const a = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, unknown>) : {};
  if (typeof a.part !== "string" || !bettable.includes(a.part)) return { ok: false, reason: "it picked no part Atlas can call in this file" };
  return { ok: true, part: a.part };
}

/**
 * The reason on screen, built by plain code from two things: the kind of question the person misses (their own record, not about the code)
 * and the part's already-checked summary line, which every bettor's text holds, or its natural name. No word of it is Muse's free text.
 */
export function pickReasonWords(kindPhrase: string, part: { line?: string | null; name?: string | null }, missed: { notMatched: number; n: number }): string {
  const role = part.line ? ` Muse Wonder's line for this part: ${part.line}` : part.name ? ` Muse Wonder calls this part "${part.name}".` : "";
  return `You missed ${missed.notMatched} of ${missed.n} ${kindPhrase}.${role}`;
}

/**
 * R16 (review M5): Muse Wonder picks a part for you only from a kind of question with at least this many judged bets, so the
 * sentence never rests on one miss. Fewer: nothing is asked ($0) and the usual choice stays.
 */
export const PICK_MIN_BETS = 3;

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
 * Review round 2 (M-C): Muse Wonder never captions how the run ended. Each step is either "caption" (Muse may add a line) or "plain"
 * (plain code's words only): the ending, a sequence call's ending, and everything after the ending are plain.
 */
export type StepKind = "caption" | "plain";

/**
 * Words about how a call or a run turns out, refused in every caption (whole words and their forms, small letters). "failure" and
 * "failures" as a noun about an earlier try stay allowed, as in R9's summary ("after the first failure").
 */
export const CAPTION_OUTCOME_WORDS = [
  "return", "returns", "returned", "returning", "get", "gets", "got", "getting", "gotten", "produce", "produces", "produced", "producing",
  "provide", "provides", "provided", "providing", "give", "gives", "gave", "given", "giving", "yield", "yields", "yielded", "yielding",
  "deliver", "delivers", "delivered", "delivering", "result", "results", "resulted", "value", "values", "succeed", "succeeds", "succeeded",
  "succeeding", "success", "successful", "successfully", "work", "works", "worked", "working", "fail", "fails", "failed", "failing",
  "throw", "throws", "threw", "thrown", "throwing", "raise", "raises", "raised", "raising", "reject", "rejects", "rejected", "rejecting",
  "rejection", "timeout", "timeouts", "done", "finish", "finishes", "finished", "finishing", "end", "ends", "ended", "ending", "hang",
  "hangs", "hung", "hanging", "never", "stall", "stalls", "stalled", "stalling", "forever", "complete", "completes", "completed",
  "completing", "completion", "resolve", "resolves", "resolved", "outcome", "crash", "crashes", "crashed",
] as const;
export const CAPTION_OUTCOME_PHRASES = ["hands back", "hand back", "handed back", "error out", "errors out", "errored out", "times out", "time out", "timed out", "timing out", "gives up", "give up", "gave up", "giving up", "comes back", "came back", "come back", "failure of the call", "failure of this call"] as const;

/** One caption, or why it is refused. */
export function checkCaption(raw: unknown): Checked {
  const c = checkLine(raw, { words: CAPTION_MAX_WORDS, chars: CAPTION_MAX_CHARS, digits: false });
  if (!c.ok) return c;
  const words = wordsOf(c.text);
  const flat = ` ${words.join(" ")} `;
  const phrase = CAPTION_OUTCOME_PHRASES.find((x) => flat.includes(` ${x} `));
  if (phrase) return { ok: false, reason: `says "${phrase}", which is about how a call turns out` };
  const w = words.find((x) => (CAPTION_OUTCOME_WORDS as readonly string[]).includes(x));
  if (w) return { ok: false, reason: `uses "${w}", a word about how a call turns out` };
  return c;
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
    if (kind === "plain") {
      refused++;
      reasons.push(`step ${i}: plain code's words only (the ending)`);
      return;
    }
    const c = checkCaption(got[String(i)]);
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
    "Earlier, after locking a bet, the person asked Muse Wonder (Meta's AI) about parts with these names (in this file or another with a part of the same name). The person's page showed these same words. Its words, not a check:",
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
  // R16 (review M2): the visible label in front of each live caption while the run plays (same ink as the caption).
  captionLabel: "★ Muse Wonder:",
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
  askFull: "You have asked the most questions Atlas keeps for this part.",
  // R16 (review M1): one line on the example's part panel, with or without a code (DAMI: placeholder wording).
  askExample: "Ask works on your own files.",
  askRefused: "Muse Wonder's answer didn't pass Atlas's checks, so it isn't shown.",
  // 4. the pick
  pickHeading: "Muse Wonder's pick for you",
  pickLegend: "Muse Wonder chose the part from your record; the words below are Atlas's. Not a check.",
  pickAccept: "Bet on this part",
  pickOther: "Pick another part",
  pickNoRecord: `Not enough judged bets of one kind yet (Atlas waits for ${PICK_MIN_BETS}), so Muse Wonder's usual choice is used. Play a few rounds and Atlas aims at what you miss.`,
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
  what: "Atlas remembers, for each of your bets: the kind of question, whether it matched, and whether the test made something fail. Never your code, the bet's question or what you bet.",
  asks: "Questions you ask about a part, and Muse Wonder's answers, ARE kept, in the server's memory, by the part's name: the AIs that bet with you get the same words in your later rounds on any file with a part of that name, so nobody bets on more than the others.",
  whereInvite: "Kept for your invite code in this browser, on this server's disk: it is still here after a restart.",
  whereInviteMemory: "Kept for your invite code in this browser, in the server's memory only: a restart clears it.",
  // R16: past the code's cap of browsers (DAMI: placeholder wording).
  whereShared: "Kept for your invite code on this server, shared with the code's other late browsers.",
  whereBrowserDisk: "Kept for this browser on this server (no invite code), on disk.",
  whereMemory: "Kept for this browser in the server's memory only (no invite code): a restart clears it.",
  how: "How Muse Wonder uses it: when it writes a test, and when it picks a part for you, it is told only the kinds of question you miss most, with their counts. The AIs that bet with you are never told your record.",
} as const;
