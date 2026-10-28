// retry.ts: call fetchIt until it succeeds, waiting longer after each failure.
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
