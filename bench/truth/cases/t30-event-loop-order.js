// The order in which a timer, a promise callback and a queued microtask run.
export async function order() {
  const log = [];
  setTimeout(() => log.push("timeout"), 0);
  Promise.resolve().then(() => log.push("microtask"));
  queueMicrotask(() => log.push("queueMicrotask"));
  log.push("sync");
  await new Promise((r) => setTimeout(r, 5));
  return log;
}
