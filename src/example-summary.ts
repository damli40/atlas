// R9: the built-in example's file summary, kept in the page like its natural names, so showing it costs nothing. Recorded once from a real
// muse-wonder-1.0 call on 2026-11-02 under the review-M1 rules (no "in and out" sentence, no endings, no numbers): 1,021 tokens in, 311 out, $0.0103;
// tests/evidence/R9/record-summary.mts, its output in tests/evidence/R9/example-summary-recorded.json. Kept word for word, and checked by the
// same plain code as any answer (src/file-summary.ts) every time it is served. (The first recording, before the review, is in commit dcdcb58.)
export const EXAMPLE_SUMMARY_MODEL = "muse-wonder-1.0";
export const EXAMPLE_SUMMARY_RECORDED_ON = "2026-11-02";
export const EXAMPLE_SUMMARY = {
  purpose: "This file fetches a price from a flaky source while waiting longer between tries.",
  parts: {
    backoffMs: "Calculates a growing wait before another try.",
    sleep: "Pauses the program for a requested wait.",
    fetchWithRetry: "Tries fetching again while pausing between attempts.",
    getPrice: "Fetches a price using the retry helper.",
  },
} as const satisfies { purpose: string; parts: Record<string, string> };
