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
  intro: "Paste one JavaScript or TypeScript file that exports a function. Atlas runs it in a sandbox with no network, no files and no packages.",
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
  randomNote: "Code that uses Math.random or crypto randomness can give a different result on each run: Atlas does not seed them.",
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
