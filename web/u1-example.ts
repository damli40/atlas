// U1: the example the drawing-first screen offers ("Try an example"). Written for this hackathon (not pre-existing):
// a price fetch that retries a flaky source with a growing wait. Four functions, so the drawing has joins to show.
// Atlas does not say whether it is correct; a run shows what it does.

export const U1_EXAMPLE = `// Fetch a price, retrying a flaky source with a growing wait.
function backoffMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(fetchIt: () => Promise<unknown>, attempts: number = 3, baseMs: number = 100) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchIt();
    } catch (e) {
      last = e;
      await sleep(backoffMs(i, baseMs));
    }
  }
  throw last;
}

export async function getPrice(fetchQuote: () => Promise<unknown>) {
  return fetchWithRetry(fetchQuote, 3, 100);
}
`;
