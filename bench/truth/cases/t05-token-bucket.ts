// A token bucket: 2 tokens, one more every 500 ms. Each send waits for a token and records when it went out.
export async function sendBurst(send: (i: number) => Promise<unknown>, count: number): Promise<number[]> {
  const capacity = 2;
  const refillMs = 500;
  let tokens = capacity;
  let last = Date.now();
  const start = Date.now();
  const sentAt: number[] = [];
  for (let i = 0; i < count; i++) {
    for (;;) {
      const now = Date.now();
      const gained = Math.floor((now - last) / refillMs);
      if (gained > 0) {
        tokens = Math.min(capacity, tokens + gained);
        last += gained * refillMs;
      }
      if (tokens > 0) break;
      await new Promise((r) => setTimeout(r, refillMs - (now - last)));
    }
    tokens--;
    await send(i);
    sentAt.push(Date.now() - start);
  }
  return sentAt;
}
