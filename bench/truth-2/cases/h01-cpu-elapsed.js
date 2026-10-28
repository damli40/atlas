// Times some CPU work with the wall clock.
export function timeWork() {
  const t0 = Date.now();
  const p0 = performance.now();
  let x = 0;
  for (let i = 0; i < 3e7; i++) x = (x + i) % 1000003;
  return { dateMs: Date.now() - t0, perfMsOver1: performance.now() - p0 > 1, x };
}
// Busy-waits 50 ms.
export function spinWait() {
  const end = Date.now() + 50;
  while (Date.now() < end) {}
  return "waited";
}
