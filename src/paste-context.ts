// D19 for pasted code: every model that bets gets exactly what the person's bet screen shows. No more, no less.
//
// Plain words:
// - This file builds the "what every bettor sees" text ONCE. The server puts it in each betting model's prompt
//   (Muse Spark, Muse Spark Open) and returns the same string to the page, which shows it word for word above
//   the questions. So the two cannot drift apart.
// - It holds: the code's fingerprint and language, what will run (plain code's description of the call, from the
//   gate-checked experiment, never a model's words), who wrote the test, the watch limit, the questions with how
//   each is answered, one bet instruction, and the WHOLE pasted file with line numbers, the chosen function's
//   line marked.
// - It never holds Muse Wonder's claim sentence (D18), any run value, or any other bettor's answer. It takes no
//   input that could carry them: there is no parameter for a claim.
// Pure: the same input always gives the same string. No I/O.

import { CALL_DEFAULT_WATCH_LIMIT_MS, describeCall, visibleText, type Question } from "./gate";
import { canonicalJson } from "./seal";
import { CALL_OUTCOME_OPTIONS } from "./units";
import { CANT_TELL } from "./quiz";
import type { Experiment, ExperimentShape } from "./types";
import { plural } from "./words";
import { modelDisplay } from "./claimants";
import { WONDER_MODEL, WONDER_DISPLAY } from "./paste-words";
import { CALL_PINNED_LOCALE, CALL_PINNED_SEED, CALL_PINNED_TIME_ZONE } from "./conditions";

type CallShape = Extract<ExperimentShape, { shape: "call-function" }>;

/** The one bet instruction every bettor reads (the person on screen, each model in its prompt). */
export const PASTE_BET_INSTRUCTION =
  "Give your best estimate for each question. Decline only if you cannot form any estimate at all; if you decline, say why.";

export const LANGUAGE_NAME = { js: "JavaScript", ts: "TypeScript", py: "Python" } as const;

/**
 * A call-function question without its call description (which the screens show once, not on every question).
 * Any other question, or one that does not start with the description, is returned as it is.
 */
export function shortQuestionFor(text: string, params: ExperimentShape | undefined): string {
  if (!params || params.shape !== "call-function") return text;
  const said = describeCall(params);
  return text.startsWith(said) ? text.slice(said.length).trimStart() : text;
}

/** The test as the bet screen and every bettor see it, in full: canonical JSON (sorted keys), hidden characters escaped. */
export function testJson(params: unknown): string {
  return visibleText(canonicalJson(params));
}

/** How a question is answered, in the words the bet screen shows next to it. */
export function answerHow(q: Pick<Question, "kind" | "unit" | "options" | "tolerancePct" | "quiz">): string {
  switch (q.kind) {
    case "quiz":
      // U1 (D48): the options exactly as the quiz shows them, so every bettor reads the same choices (D19).
      return `pick one: ${(q.quiz ?? []).map((o) => `(${o.id}) ${o.label}`).join("; ")}; or ${CANT_TELL}`;
    case "enum":
      return `one of ${(q.options ?? CALL_OUTCOME_OPTIONS).join(", ")}`;
    case "json":
      return "a JSON value (matched when it is exactly the returned value, key order ignored)";
    case "integer":
      return q.unit === "ms" ? "a whole number of ms" : "a whole number";
    case "number":
      return `a number in ${q.unit}, matched within ${q.tolerancePct ?? 0}% of what the run measures`;
  }
}

/** Who wrote the test, in the same words for the screen and the prompt. Never a claim. */
export function testWrittenBy(p: Experiment["proposedBy"]): string {
  if (p.role === "human" && p.editedFrom) return `you (the person), edited from ${p.editedFrom.model === WONDER_MODEL ? WONDER_DISPLAY : modelDisplay(p.editedFrom.model)}'s test ${p.editedFrom.proposalId}`;
  return p.role === "human" ? "you (the person)" : p.model === WONDER_MODEL ? WONDER_DISPLAY : p.model ? modelDisplay(p.model) : p.role;
}

export interface PastedContextInput {
  experiment: Pick<Experiment, "target" | "params" | "proposedBy">;
  questions: readonly Question[];
  /** Line of the called export (from src/pasted-code.ts), marked ">" in the numbered file; absent = none marked. */
  exportLine?: number;
  /**
   * X3 review round 2 (D50): plain code's failure labels for the called function (src/failure-labels.ts
   * labelsForBettors), shown to every bettor before betting: the person's page and both betting models get these bytes.
   */
  labels?: readonly string[];
}

/**
 * E3 review r2 minor 2: every line ending JavaScript and Python accept (CRLF, CR, LF, U+2028, U+2029), so a file joined by
 * bare CRs is counted, capped and numbered as the lines it really has.
 */
export const LINE_BREAK = /\r\n|\r|\n|\u2028|\u2029/;
export function pastedLines(source: string): string[] {
  const lines = source.split(LINE_BREAK);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The numbered file at the end of the bettor text: one line per file line, the called function's line marked ">".
 * E3 review r2 minor 6: hidden and direction characters are written as escapes (visibleText), so the person's screen
 * and every model read the same order (a "Trojan Source" paste cannot render differently from what the models get).
 */
export function pastedFileBlock(source: string, mark: number): string {
  return pastedLines(source)
    .map((l, i) => `${i + 1 === mark ? ">" : " "} ${i + 1}| ${visibleText(l)}`)
    .join("\n");
}

/**
 * R1 review M5 / round 2 (M1): the pins, in one sentence every bettor sees before sealing: inside the shared bettor text
 * (the models' prompt and the page's "What every bettor sees" panel) and, the same bytes, above the bet questions.
 */
export function pinsSentence(language: "js" | "ts" | "py"): string {
  const loc = CALL_PINNED_LOCALE[language];
  return `Atlas runs it on a simulated clock starting 2026-01-01 UTC, in time zone ${CALL_PINNED_TIME_ZONE} with ${loc === "C" ? "a C" : `an ${loc}`} locale, with randomness seeded (seed ${CALL_PINNED_SEED}).`;
}

/** The pins line the page shows above the bet questions: taken from the shared bettor text itself (same bytes). */
export function pinsLineOf(seenContext: string | undefined, language: "js" | "ts" | "py"): string {
  const want = pinsSentence(language);
  return seenContext?.split("\n").find((l) => l === want) ?? want;
}

/** Everything in the bettor text above the numbered file (it depends on the test; the file block does not). */
export function pastedBetHead(input: PastedContextInput & { repeatOf?: string }): string {
  const t = input.experiment.target;
  const p = input.experiment.params;
  if (t.kind !== "pasted" || typeof t.source !== "string" || p.shape !== "call-function") {
    throw new Error("pastedBetContext needs a pasted target and a call-function experiment");
  }
  const call = p as CallShape;
  const lineCount = pastedLines(t.source).length;
  const lang = t.language ? LANGUAGE_NAME[t.language] : "code";
  const mark = input.exportLine ?? 0;
  const said = describeCall(call);
  return [
    `Code: one pasted ${lang} file, ${plural(lineCount, "line")}, fingerprint ${t.codeSha256.slice(0, 12)}…`,
    "Where it runs: Atlas's sandbox, with no network, no files and no packages, on a virtual clock that starts at 2026-01-01T00:00:00Z (waits cost no real time).",
    // R1 review M5: the pins are said to every bettor before sealing (a bet is about Atlas's run, so its settings count).
    pinsSentence(t.language ?? "js"),
    `What will run: ${said}`,
    `Test written by: ${testWrittenBy(input.experiment.proposedBy)}.`,
    // E3 review r2 M2 (coordinator's decision): a repeat is accepted and said, to the person and to every model alike.
    ...(input.repeatOf ? [`This test is a repeat of a test already run in this session (${input.repeatOf}); its result may already be known to the person.`] : []),
    `Atlas watches for at most ${(call.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS).toLocaleString("en-US")} ms of virtual time.`,
    "Questions (written by plain code):",
    // Each question starts with the call description above; it is said once there, not four times.
    ...input.questions.map((q, i) => `${i + 1}. ${q.text.startsWith(said) ? q.text.slice(said.length).trimStart() : q.text} Answer: ${answerHow(q)}.`),
    // E3 review B1: the exact test, in full. The "What will run" line and the questions shorten long values to 60
    // characters; this line never does, so every bettor has every value the person can see (the page's
    // "The test as JSON" view shows this same text).
    `The test exactly, as JSON (what Atlas runs): ${testJson(call)}`,
    ...(input.labels ?? []),
    `How to bet: ${PASTE_BET_INSTRUCTION}`,
    `The whole file, numbered as on screen${mark ? `, line ${mark} (where ${call.exportName} is declared) marked ">"` : ""}:`,
  ].join("\n");
}

/** The text a person sees on the paste bet screen, and the only context a betting model gets. */
export function pastedBetContext(input: PastedContextInput & { repeatOf?: string }): string {
  const t = input.experiment.target;
  return `${pastedBetHead(input)}\n${pastedFileBlock(t.source ?? "", input.exportLine ?? 0)}`;
}
