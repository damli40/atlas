const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cachedGet(key: string, fetcher: (k: string) => Promise<unknown>, ttlMs: number): Promise<unknown> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = fetcher(key);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function readThreeTimes(fetcher: (k: string) => Promise<unknown>, gapMs: number): Promise<unknown[]> {
  const a = cachedGet("user:1", fetcher, 100);
  const b = cachedGet("user:1", fetcher, 100);
  const first = await Promise.all([a, b]);
  await new Promise((r) => setTimeout(r, gapMs));
  const c = await cachedGet("user:1", fetcher, 100);
  return [...first, c];
}
