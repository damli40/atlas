// Retries an async operation with exponential backoff: waits 100 ms, then 200 ms, then 400 ms, ...
export async function retryWithBackoff(op, maxAttempts) {
  let delay = 100;
  for (let attempt = 1; ; attempt++) {
    try {
      return await op(attempt);
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}
