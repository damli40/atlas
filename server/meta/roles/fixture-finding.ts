// The one finding the Claimant works on today. It is a fixture finding, written by hand: the
// Investigator (the model that finds these) arrives Oct 30. Until then this stands in, and every
// place that shows it must show FIXTURE_FINDING_LABEL beside it.
//
// The lines are the retry loop in tests/fixtures/with-rpc-retry.ts: fixture lines 49–66, which are
// lines 69–86 of the original file (the fixture's verbatim block starts at original line 31 on
// fixture line 11). `verified` is set by plain code: the quoted snippet must be in those lines.
//
// The claim is written neutrally on purpose ("People expect X; the code does Y" about the loop as
// a whole). An earlier claim described one scenario, and the Claimant tested only that scenario in
// 5 of 5 live runs (tests/evidence/D02-02). The claim must not point at any one experiment.
//
// What the Claimant sees around the finding: the whole verbatim block (the retry constants at the
// top AND the whole function), not just lines ±20, because the defaults decide the outcome of most
// experiments and sit more than 20 lines above the loop. See fixtureContextRange().

import type { Finding } from "../../../src/types";

export const FIXTURE_FINDING_LABEL = "fixture finding, written by hand (Investigator arrives Oct 30)";

export const FIXTURE_FILE = "tests/fixtures/with-rpc-retry.ts";

export const FIXTURE_FINDING_ID = "fixture-retry-1";

const FINDING_FIELDS = {
  id: FIXTURE_FINDING_ID,
  file: FIXTURE_FILE,
  lineStart: 49,
  lineEnd: 66,
  kind: "retry" as const,
  claim:
    "People expect withRpcRetry to turn a flaky chain read into a dependable one within a short, predictable time; the code repeats the read in a loop whose number of calls, waits between them and final result depend on its attempt and delay settings and on how each call behaves.",
  quotedSnippet: "for (let i = 1; i <= attempts; i++) {\n    try { return await fn(); }",
  proposedBy: { role: "investigator" as const, model: "none: written by hand" },
};

const BEGIN_MARK = "---- BEGIN VERBATIM";
const END_MARK = "---- END VERBATIM";

/**
 * The lines the Claimant is shown for the fixture finding: everything between the BEGIN and END
 * VERBATIM markers (fixture lines 11–66 today: the retry constants, the options, and the whole
 * function). Found from the markers, not hard-coded, so an edit above the block cannot shift it.
 * Undefined when the markers are missing (the caller then falls back to lines ±20).
 */
export function fixtureContextRange(fileText: string): { from: number; to: number } | undefined {
  const lines = fileText.split("\n");
  const begin = lines.findIndex((l) => l.includes(BEGIN_MARK));
  const end = lines.findIndex((l) => l.includes(END_MARK));
  if (begin === -1 || end === -1 || end - begin < 2) return undefined;
  // 0-based marker index + 1 = the marker's line number; the block starts on the next line.
  return { from: begin + 2, to: end };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** True when the lines exist in the file and the quoted snippet (whitespace-normalised) is inside them. */
export function snippetMatches(fileText: string, f: Pick<Finding, "lineStart" | "lineEnd" | "quotedSnippet">): boolean {
  const lines = fileText.split("\n");
  if (!Number.isInteger(f.lineStart) || !Number.isInteger(f.lineEnd)) return false;
  if (f.lineStart < 1 || f.lineEnd < f.lineStart || f.lineEnd > lines.length) return false;
  const slice = squash(lines.slice(f.lineStart - 1, f.lineEnd).join("\n"));
  const quote = squash(f.quotedSnippet);
  return quote.length > 0 && slice.includes(quote);
}

/** The fixture finding, with `verified` computed against the file text given. */
export function fixtureFinding(fileText: string): Finding {
  return { ...FINDING_FIELDS, proposedBy: { ...FINDING_FIELDS.proposedBy }, verified: snippetMatches(fileText, FINDING_FIELDS) };
}
