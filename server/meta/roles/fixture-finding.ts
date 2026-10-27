// The one finding the Claimant works on today. It is a fixture finding, written by hand: the
// Investigator (the model that finds these) arrives Oct 30. Until then this stands in, and every
// place that shows it must show FIXTURE_FINDING_LABEL beside it.
//
// The lines are the retry loop in tests/fixtures/with-rpc-retry.ts: fixture lines 49–66, which are
// lines 69–86 of the original file (the fixture's verbatim block starts at original line 31 on
// fixture line 11). `verified` is set by plain code: the quoted snippet must be in those lines.

import type { Finding } from "../../../src/types";

export const FIXTURE_FINDING_LABEL = "fixture finding, written by hand (Investigator arrives Oct 30)";

export const FIXTURE_FILE = "tests/fixtures/with-rpc-retry.ts";

const FINDING_FIELDS = {
  id: "fixture-retry-1",
  file: FIXTURE_FILE,
  lineStart: 49,
  lineEnd: 66,
  kind: "retry" as const,
  claim:
    "People expect withRpcRetry to give up on a failing or silent chain read within a bounded time; the code retries a failing read with set waits and sets no time limit of its own on a read that never answers.",
  quotedSnippet: "for (let i = 1; i <= attempts; i++) {\n    try { return await fn(); }",
  proposedBy: { role: "investigator" as const, model: "none: written by hand" },
};

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
