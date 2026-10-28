// Timing on the clock: a zero-delay timer, a polling loop with a deadline, and a timestamp after a wait.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function zeroDelay() {
  await new Promise((r) => setTimeout(r, 0));
  return Date.now() - Date.UTC(2026, 0, 1);
}

export async function pollUntil(check, timeoutMs) {
  const start = Date.now();
  let tries = 0;
  while (Date.now() - start < timeoutMs) {
    tries++;
    if (await check()) return { ok: true, tries };
    await sleep(250);
  }
  return { ok: false, tries };
}

export async function isoLater() {
  await sleep(1500);
  return new Date().toISOString();
}
