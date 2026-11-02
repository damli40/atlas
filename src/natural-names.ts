// R6: short natural names for the parts of a drawn file, written by a Meta model from the code alone (what each part is FOR). AI proposes,
// plain code decides: this file is the check. A name that is too long, has a digit or a sign, uses a word that judges the code or says how
// it behaves when run, repeats another part's name, or reads as another part's own name is dropped, and that part keeps the name plain code
// split from its identifier. Pure.

/**
 * Word beginnings a name may not use: judgments, trust or status words, and words about how code behaves or breaks. Only a run can show
 * any of that. Matched at the start of each word, and again after "un", "in" or "non" ("untrusted", "insecure"). Purpose words such as
 * "retry", "fetch" or "cache" are not here: a name may say what a part is for.
 */
export const NAME_BANNED_STEMS = [
  "verif", "secur", "trust", "test", "audit", "approv", "safe", "robust", "reliab", "guarant", "flaw", "perfect", "correct", "valid", // wording-lint: allow (words a name is refused for, never shown)
  "fail", "crash", "error", "bug", "broke", "break", "leak", "forever", "infinite", "unbounded", "endless", "hang", "hung", "throw", // wording-lint: allow
  "exception", "vulnerab", "exploit", "backdoor", "wrong", "right", "always", "never", "sometimes", "fix", "race", "prone", "risk", "danger", // wording-lint: allow
] as const;
/** Whole words a name may not use: short judgments that would match too much as a beginning. */
export const NAME_BANNED_WORDS = ["ok", "okay", "fine", "good", "bad", "clean", "works", "working", "worked", "atlas", "issue", "issues", "prove", "proven", "proves", "proved", "harmless", "harmful", "sure", "certain", "checked", "buggy"] as const; // wording-lint: allow
export const NAME_MAX_WORDS = 4;
/** About what a lid can show at reading size: a longer name would only ever be in the panel, never on the drawing. */
export const NAME_MAX_CHARS = 16;
/** The most parts the machine draws (renderer/authors/machine.ts MACHINE_PART_LIMIT; a test holds them equal). More, and the page shows the chart, so no names are asked for. */
export const NAMES_PART_LIMIT = 8;

const judged = (word: string): boolean => {
  const bare = [word, ...["un", "in", "non"].filter((p) => word.startsWith(p) && word.length > p.length + 2).map((p) => word.slice(p.length))];
  return bare.some((w) => (NAME_BANNED_WORDS as readonly string[]).includes(w) || NAME_BANNED_STEMS.some((s) => w.startsWith(s)));
};

/** One name, cleaned to small letters and single spaces, or the reason it is refused. */
export function checkName(raw: unknown): { ok: true; name: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "not text" };
  const name = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (name === "") return { ok: false, reason: "empty" };
  if (name.length > NAME_MAX_CHARS) return { ok: false, reason: `longer than ${NAME_MAX_CHARS} characters` };
  if (!/^[a-z]+(?:[ -][a-z]+)*$/.test(name)) return { ok: false, reason: "only letters, spaces and hyphens are allowed" };
  const words = name.split(" ");
  if (words.length > NAME_MAX_WORDS) return { ok: false, reason: `more than ${NAME_MAX_WORDS} words` };
  // Each piece of a hyphenated word too ("crash-proof" holds "crash").
  // "off by one" is a flaw's name; "back-off" is a purpose: the phrase is refused, not the word.
  if (/(^| )off by /.test(name)) return { ok: false, reason: `says "off by", which names a flaw` };
  const banned = name.split(/[ -]/).find(judged);
  if (banned) return { ok: false, reason: `uses "${banned}", a word that judges the code or says how it behaves` };
  return { ok: true, name };
}

/** An identifier in small words, the way a name would read ("fetchWithRetry" → "fetch with retry"). Only for comparing. */
const asWords = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_$]+/g, " ").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The model's answer, checked: one name per part plain code drew. Unknown parts are dropped; a bad or missing name leaves its part out. Two
 * parts given the same name both keep their own, and so does a part whose name reads as another part's identifier ("sleep" called "price lookup"
 * when getPrice is there): either would point the eye at the wrong box.
 */
export function checkNames(answer: unknown, parts: readonly string[]): { names: Record<string, string>; refused: number } {
  const got = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as { names?: unknown }).names : undefined;
  const map = got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : {};
  const ok = new Map<string, string>();
  let refused = 0;
  for (const part of parts) {
    if (!Object.prototype.hasOwnProperty.call(map, part)) continue;
    const c = checkName(map[part]);
    if (c.ok) ok.set(part, c.name);
    else refused++;
  }
  const names: Record<string, string> = {};
  for (const [part, name] of ok) {
    const twice = [...ok.entries()].some(([p, n]) => p !== part && n === name);
    const another = parts.some((p) => p !== part && (asWords(p) === name || p.toLowerCase() === name.replace(/[ -]/g, "")));
    if (twice || another) refused++;
    else names[part] = name;
  }
  return { names, refused };
}

/** Who wrote the names, as the screen and the bettors are told. */
export const NAMER_WORDS = {
  marker: "named by Muse Wonder, Meta's AI",
  legend: "★ names: Muse Wonder's words (Meta's AI), not a check",
  panel: (name: string) => `Meta's AI calls this: ${name} (its words, not a check)`,
  unavailable: (reason: string) => `Natural names unavailable: ${reason}`,
} as const;

/** D19: the lines every AI bettor gets when names were sent to the person's page, labelled as the naming model's words. */
export function namesForBettors(names: Readonly<Record<string, string>>, model: string): string[] {
  const list = Object.entries(names);
  if (list.length === 0) return [];
  return [`Names ${model} (Meta's AI) suggested for the parts, from the code alone. The person's drawing may show some of them. Its words, not a check:`, ...list.map(([part, name]) => `- ${part}: ${name}`)];
}
