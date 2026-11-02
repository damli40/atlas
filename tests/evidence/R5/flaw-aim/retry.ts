const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function backoff(n: number) { return 100 * 2 ** n; }
function shouldRetry(e: Error) { return e.message.includes("429"); }
async function attempt(f: () => Promise<string>) { return await f(); }
export async function withRetry(f: () => Promise<string>, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await attempt(f); } catch (e) { if (!shouldRetry(e as Error)) throw e; await sleep(backoff(i)); }
  }
  throw new Error("gave up");
}
