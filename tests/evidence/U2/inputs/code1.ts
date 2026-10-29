const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(url: string, opts: RequestInit = {}, retries = 3): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`retryable status ${res.status}`);
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      lastErr = err;
      const backoff = 2 ** attempt * 200 + Math.random() * 100;
      await sleep(backoff);
    }
  }
  throw lastErr;
}
