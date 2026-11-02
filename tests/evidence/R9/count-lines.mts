// R9 review: pass and refuse counts of the new checker on every summary line recorded so far (the old io sentences included, though the
// summary no longer has one). Run: pnpm exec tsx tests/evidence/R9/count-lines.mts

import { checkSummaryLine } from "../../../src/file-summary";
const sets: Record<string, string[]> = {
  "example, first recording (dcdcb58)": [
    "This file fetches a price from a flaky source, waiting longer between each try when an attempt does not succeed.",
    "It takes a way to fetch a quote and returns the fetched value after trying up to a set number of times.",
    "Calculates the growing wait before another try.", "Pauses for the given amount of time.", "Tries fetching, pausing longer between tries, then gives up.", "Fetches a price using the retry helper with preset settings."],
  "live sample getJson (dcdcb58)": [
    "This file fetches data from a web address and tries again a few times when needed.",
    "It takes a web address and a retry count and returns the parsed data or nothing.",
    "Fetches data with repeated attempts and pauses between them."],
  "example, re-recorded under the new rules": [
    "This file fetches a price from a flaky source while waiting longer between tries.",
    "Calculates a growing wait before another try.", "Pauses the program for a requested wait.", "Tries fetching again while pausing between attempts.", "Fetches a price using the retry helper."],
};
for (const [k, lines] of Object.entries(sets)) {
  const r = lines.map((l) => ({ l, c: checkSummaryLine(l, { words: 35, chars: 220 }) }));
  console.log(`${k}: ${r.filter((x) => x.c.ok).length} pass, ${r.filter((x) => !x.c.ok).length} refused`);
  for (const x of r) if (!x.c.ok) console.log(`  refused: "${x.l}" (${(x.c as { reason: string }).reason})`);
}
