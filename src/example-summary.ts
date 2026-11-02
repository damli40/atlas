// R9: the built-in example's file summary, kept in the page like its natural names, so showing it costs nothing. Recorded once from a real
// muse-wonder-1.0 call on 2026-11-02 (732 tokens in, 517 out, $0.0133; tests/evidence/R9/record-summary.mts, its output in
// tests/evidence/R9/example-summary-recorded.json), word for word, and checked by the same plain code as any answer (src/file-summary.ts)
// every time it is served.
export const EXAMPLE_SUMMARY_MODEL = "muse-wonder-1.0";
export const EXAMPLE_SUMMARY_RECORDED_ON = "2026-11-02";
export const EXAMPLE_SUMMARY = {
  purpose: "This file fetches a price from a flaky source, waiting longer between each try when an attempt does not succeed.",
  io: "It takes a way to fetch a quote and returns the fetched value after trying up to a set number of times.",
  parts: {
    backoffMs: "Calculates the growing wait before another try.",
    sleep: "Pauses for the given amount of time.",
    fetchWithRetry: "Tries fetching, pausing longer between tries, then gives up.",
    getPrice: "Fetches a price using the retry helper with preset settings.",
  },
} as const satisfies { purpose: string; io: string | null; parts: Record<string, string> };
