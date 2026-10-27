// A deadline with AbortSignal.timeout: the work wins if it finishes first, otherwise the timeout's error.
export async function withDeadline(work, ms) {
  const signal = AbortSignal.timeout(ms);
  return await new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    work().then(resolve, reject);
  });
}
