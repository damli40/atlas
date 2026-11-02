// R6: short natural names for the parts of a drawn file, written by a Meta model from the code alone (what each part is FOR). AI proposes,
// plain code decides: this file is the check. A name that is too long, has a digit or a sign, or uses a word that judges the code is dropped,
// and that part keeps the name plain code split from its identifier. Pure.

/** Words a name may not use: they would judge the code or promise how it behaves, which only a run can show. */
export const NAME_BANNED = ["fails", "failure", "bug", "broken", "wrong", "right", "correct", "always", "never", "safe", "unsafe", "fixed", "error", "crash"] as const; // wording-lint: allow (the words a name is refused for, not words said to anyone)
export const NAME_MAX_WORDS = 4;
export const NAME_MAX_CHARS = 40;

/** One name, cleaned to small letters and single spaces, or the reason it is refused. */
export function checkName(raw: unknown): { ok: true; name: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "not text" };
  const name = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (name === "") return { ok: false, reason: "empty" };
  if (name.length > NAME_MAX_CHARS) return { ok: false, reason: `longer than ${NAME_MAX_CHARS} characters` };
  if (!/^[a-z]+(?:[ -][a-z]+)*$/.test(name)) return { ok: false, reason: "only letters, spaces and hyphens are allowed" };
  const words = name.split(" ");
  if (words.length > NAME_MAX_WORDS) return { ok: false, reason: `more than ${NAME_MAX_WORDS} words` };
  // Each piece of a word too ("crash-proof" holds "crash"), and a plural ("errors", "bugs").
  const banned = name.split(/[ -]/).find((w) => NAME_BANNED.some((b) => w === b || w === `${b}s` || w === `${b}es`));
  if (banned) return { ok: false, reason: `uses "${banned}", a word that judges the code` };
  return { ok: true, name };
}

/** The model's answer, checked: one name per part plain code drew, in that order. Unknown parts are dropped; a bad or missing name leaves its part out. */
export function checkNames(answer: unknown, parts: readonly string[]): { names: Record<string, string>; refused: number } {
  const got = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as { names?: unknown }).names : undefined;
  const map = got && typeof got === "object" && !Array.isArray(got) ? (got as Record<string, unknown>) : {};
  const names: Record<string, string> = {};
  let refused = 0;
  for (const part of parts) {
    if (!Object.prototype.hasOwnProperty.call(map, part)) continue;
    const c = checkName(map[part]);
    if (c.ok) names[part] = c.name;
    else refused++;
  }
  return { names, refused };
}

/** Who wrote the names, as the screen and the bettors are told. */
export const NAMER_WORDS = {
  marker: "named by Muse Wonder, Meta's AI",
  panel: (name: string) => `Meta's AI calls this: ${name} (its words, not a check)`,
  unavailable: (reason: string) => `Natural names unavailable: ${reason}`,
} as const;

/** D19: the lines every AI bettor gets when the person's screen shows natural names, labelled as the naming model's words. */
export function namesForBettors(names: Readonly<Record<string, string>>, model: string): string[] {
  const list = Object.entries(names);
  if (list.length === 0) return [];
  return [`Short names for the parts, written by ${model} (Meta's AI) from the code alone and shown on the person's screen. Its words, not a check:`, ...list.map(([part, name]) => `- ${part}: ${name}`)];
}
