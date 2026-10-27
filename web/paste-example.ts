// E3: the example the paste screen offers ("Use an example"). An ordinary retry-with-backoff, written for this
// hackathon (not pre-existing). Atlas does not say whether it is correct; a run shows what it does.

export const PASTE_EXAMPLE = `// Retry a flaky call, waiting longer after each failure.
export async function retryWithBackoff(fetchIt: () => Promise<unknown>, attempts: number = 3, baseMs: number = 100) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchIt();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}
`;
