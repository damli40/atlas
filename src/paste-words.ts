// Every sentence the "paste any code" flow shows, in one place (E3).
//
// Plain words: Dami writes the final public copy later. Keeping every string of the paste flow here means that
// rewrite touches one file. The rules the words follow:
// - "matched" / "didn't match" / "can't check" (D15). Never "right", "wrong" or "correct".
// - Meta model names stay visible (D10): each model is named by product name AND id.
// - A model's own sentence is labelled as the model's words, never as a verdict.
// No I/O. Safe to load in the browser and on the server.

import type { PastedLanguage } from "./pasted-code";

/** Muse Wonder proposes the tests in the paste flow; named by product name AND id (D10). */
export const WONDER_MODEL = "muse-wonder-1.0";
export const WONDER_DISPLAY = "Muse Wonder 1.0 (muse-wonder-1.0)";

export const PASTE_WORDS = {
  modeButton: "Paste your own code",
  heading: "1. Paste one file",
  // R1: Python runs too (E2/E4). A language this server cannot run is labelled "(coming)" in the picker.
  intro: "Paste one file: JavaScript or TypeScript that exports a function, or Python with a top-level function. Atlas runs it in a sandbox with no network, no files and no packages.",
  codeLabel: "Your code (one file, at most 64 KB)",
  languageLabel: "Language",
  languageAuto: (detected: string) => `Atlas reads it as ${detected}`,
  readButton: "Read it",
  // E3 review M4: every place the code goes is named. (Dami rewrites the final copy; it must stay true.)
  // E3 review r2 M1 / r3 B1: built from the server's real configuration, so it is literally true on the server that
  // shows it: where runs happen (this machine, or Modal), and the real time limit (server/paste.ts PASTE_TTL_MS, 2 hours
  // after the last paste, checked every minute and before every request; PASTE_SWEEP_MS).
  notStored: (executor: "local" | "modal") =>
    [
      "Your code is kept in this server's memory until 2 hours after you last pasted it, then deleted (checked every minute); it is never put in the repo.",
      executor === "modal"
        ? "For each run it is sent to Modal (a cloud company that runs sandboxes) and written into a throwaway Modal container that has no network and is shut down when the run ends."
        : "For each run it is written to a temporary folder on this server, used by the sandbox and deleted when the run ends; a folder left by a run that was cut short (the server stopped mid-run) is deleted at the next server start at least 10 minutes later.",
      "Atlas sends it to Muse Wonder and Muse Spark on Meta's API (never to a contributor model, which may train on it), and to Baseten when Muse Spark Open bets.",
      "A shared proof link shows the function's name, the test, the results (including error messages, which can quote names from your code) and the models' bets and explanations, but not your code itself.",
    ].join(" "),
  repeatNote: (id: string) => `This test is a repeat of a test you've already seen run (${id}). Its bets are marked as a repeat.`,
  // R1 (D36): Atlas now pins randomness to a recorded seed, and pins the time zone and locale, so a re-run of the
  // same test should match. A difference means the result depends on something Atlas does not control.
  replayDiffers: "Atlas pins the seed, the time zone and the locale, so a re-run of the same test should give the same result; this one did not, so the result depends on something Atlas does not control",
  exportsHeading: "2. Pick the function to call",
  noExports: "Atlas found no exported function in this file. Write `export function name(...)`.",
  exportLine: (name: string, line: number, declaredAs: string) => `${name} (line ${line}, ${declaredAs})`,
  cantCheckEarly: (reason: string) => `Can't check: ${reason}. You can still run it: the run will say "can't check" with this reason.`,
  proposalsHeading: "3. Choose a test",
  askWonder: "Ask Muse Wonder for tests",
  writeOwn: "Write my own test",
  wonderThinking: (model: string) => `${model} is reading your code and proposing tests…`,
  proposalAllowed: "Allowed by Atlas's gate",
  proposalRefused: (reason: string) => `Refused by Atlas's gate, so it will never run: ${reason}`,
  useProposal: "Use this test",
  editProposal: "Edit it first",
  proposalEditedNote: "Edited by you, so Atlas records this test as yours.",
  claimHidden: "Muse Wonder also wrote one sentence about your code. It is shown after the bets are sealed, so every bettor bets on the same information.",
  claimLabel: (model: string) => `${model} said (its own words, not a verdict):`,
  formHeading: "Your test",
  formHint: "Every field is checked by Atlas's gate before anything runs.",
  formArgs: "Arguments",
  formAddJson: "Add a value",
  formAddStandIn: "Add a stand-in function",
  formStandInHelp: "A stand-in is a fake function Atlas passes in. You decide what it does on each call.",
  formRemove: "Remove",
  formAddStep: "Add a call",
  formThen: "After the last call",
  formThenRepeat: "do the last call again",
  formThenThrow: "throw AtlasStandInExhausted",
  formWatch: "Watch for (virtual ms)",
  formSubmit: "Use my test",
  betsHeading: "4. Place your bets",
  betsIntro: "Answer any question you want to bet on. Leave one blank to skip it. Bets are sealed before the run.",
  seenHeading: "What every bettor sees",
  seenNote: (models: string, n: number) => `${models} ${n === 1 ? "gets" : "get"} exactly this text and the same questions, and never ${n === 1 ? "sees" : "see"} Muse Wonder's sentence.`,
  sealButton: "Seal my bets",
  runHeading: "5. Run it",
  runButton: "Run it",
  running: "Running your function in the sandbox…",
  verdictHeading: "6. Whose bet matched",
  factsHeading: "What the run measured",
  noUnit: "no bet compares this field yet, so a bet on it is can't check",
  wholeRunCantCheck: (reason: string) => `Can't check: ${reason}.`,
  controlNotPassed: (reason: string) => `Can't check: Atlas's known-case check did not match (${reason}).`,
  proofHeading: "7. Proof card",
  proofMissing: (reason: string) => `No proof card for this run: ${reason}.`,
  languageAutoOption: "Atlas decides",
  exampleButton: "Use an example",
  restartButton: "Start again",
  languageYouChose: (name: string) => `You chose ${name}.`,
  linesAndPrint: (lines: number) => `${lines} lines · fingerprint`,
  exportsFound: "Atlas found these exports (by plain code, no model):",
  chosenTest: (id: string, who: string) => `This round runs test ${id}, written by ${who}. Allowed by Atlas's gate.`,
  writtenByEdited: (proposalId: string) => `you, edited from Muse Wonder 1.0 (muse-wonder-1.0)'s test ${proposalId}`,
  writtenByYou: "you",
  skipOption: "(skip this one)",
  proposedCount: (n: number) => `proposed ${n} ${n === 1 ? "test" : "tests"}`,
  testAsJson: "The test as JSON",
  needAnswer: "Answer at least one question to bet.",
  needJson: (q: string) => `"${q}" needs a JSON value (text needs "quotes").`,
  needNumber: (q: string, how: string) => `"${q}" needs ${how}.`,
  runNotShown: (id: string) => `Run ${id}. Nothing from it is shown as fact.`,
  runLine: (id: string, matched: boolean, executor: string) => `Run ${id} · known-case check ${matched ? "matched first" : "did not match"} · ${executor} sandbox`,
  factField: "field",
  factValue: "the code",
  factCantCheck: (why: string) => `can't check: ${why}`,
  formJsonArg: (n: number) => `Argument ${n}, a value (JSON)`,
  formJsonPlaceholder: '3, "text" or {"a": 1}',
  formStandInArg: (n: number) => `Argument ${n}, a stand-in named`,
  formAsync: "async (returns a promise)",
  formCall: (n: number) => `Call ${n}`,
  formReturns: "returns",
  formThrows: "throws",
  formNeverAnswers: "never answers",
  formValue: "value (JSON)",
  formAfter: "answers after (virtual ms)",
  formErrorName: "error name",
  formMessage: "message",
  formCallsOnce: (name: string) => `Atlas calls ${name} once with these arguments, in order.`,
  formNotJson: (where: string, text: string) => `${where}: "${text.length > 40 ? `${text.slice(0, 39)}…` : text}" is not JSON (text needs "quotes").`,
  formNotWholeMs: (where: string) => `${where}: "answers after" must be a whole number of ms.`,
  formWatchNotWhole: "The watch limit must be a whole number of ms.",
  pythonComing: "Python (coming)",
  pythonNotYet: "Python runs are coming: this server has no Python runner yet. JavaScript and TypeScript run now.",
} as const;

/**
 * R1 (D36): the "conditions" line. When a result depends on something that is Atlas's rather than the code's (its
 * simulated clock, its pinned seed, its pinned time zone and locale, an order Node leaves open, a timer that does not
 * keep the process alive), the verdict screen and the proof card say so in these words. Plain code picks them from
 * the run's recorded condition kinds (src/conditions.ts); a model never writes them.
 */
export const CONDITION_WORDS = {
  heading: "Conditions",
  intro: "What this result depends on that is Atlas's, not the code's:",
  none: "None: the code read no clock, used no randomness and read no time zone or locale.",
  pins: (seed: string, timeZone: string, locale: string) => `seed ${seed} · time zone ${timeZone} · locale ${locale}`,
  clock: "This code read the clock. Atlas's clock is simulated (it starts at 2026-01-01T00:00:00Z and moves only while the code waits), so time-based values are Atlas's, not your machine's.",
  clockDuringWork:
    "This code read the clock before and after work that ran without waiting. Atlas's clock does not move during work, so the time it measured would be 0 here and not on your machine; Atlas did not report how the call ended.",
  randomness: (seed: string) =>
    `This code used randomness (Math.random, crypto random values, Python's random, uuid or secrets). Atlas pins it to seed ${seed}, so the random values are the ones that seed gives, the same on every Atlas run, not the ones your machine would give.`,
  hashSeed: (seed: string) =>
    `This code builds a set or calls hash(). Python orders a set of text by a hash seed that changes every time Python starts; Atlas pins that seed to ${seed}, so an order that comes from a set is Atlas's pinned one, not your machine's.`,
  timeZoneOrLocale: (timeZone: string, locale: string) =>
    `This code read the time zone or the locale (local hours, toLocaleString, Intl, Python's localtime, ...). Atlas runs every call in time zone ${timeZone} with locale ${locale}, so local times and formats are ${timeZone} / ${locale} ones, not your machine's.`,
  timerOrder:
    "This code queued callbacks whose order Node leaves open (a 0 ms timer next to setImmediate, or process.nextTick next to promise callbacks). The order Atlas ran them in is Atlas's choice, so Atlas did not report how the call ended.",
  unrefTimer:
    "This code waited on an unref'd timer, which does not keep a Node process alive. Whether it fires depends on what else keeps the process running, so Atlas did not report what depends on it.",
  unseededRandom:
    "This code used randomness Atlas cannot pin to its seed (crypto.subtle keys or randomized signatures), so Atlas did not report how the call ended.",
} as const;

/** How the language picker names each language, by whether a runner is registered for it. */
export function languageLabel(lang: PastedLanguage, runnable: boolean): string {
  const name = lang === "js" ? "JavaScript" : lang === "ts" ? "TypeScript" : "Python";
  return runnable ? name : `${name} (coming)`;
}

/** The outcome words of a call-function run, in plain words for the bet screen and the timeline. */
export const CALL_OUTCOME_SAY: Record<string, string> = {
  returned: "returns a value",
  threw: "throws an error",
  never_settled: "never settles (waits forever)",
  still_running_at_watch_limit: "still running when Atlas stops watching",
};

/** The verdict words (D15). The same three everywhere. */
export const VERDICT_SAY = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" } as const;
