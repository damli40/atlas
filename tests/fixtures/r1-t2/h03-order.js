// setImmediate vs a 0 ms timer, and nextTick vs a promise callback.
export async function immediateVsTimeout() {
  const log = [];
  setTimeout(() => log.push("timeout"), 0);
  setImmediate(() => log.push("immediate"));
  await new Promise((r) => setTimeout(r, 5));
  return log;
}
export async function tickVsPromise() {
  const log = [];
  process.nextTick(() => log.push("nextTick"));
  Promise.resolve().then(() => log.push("promise"));
  await new Promise((r) => setTimeout(r, 1));
  return log;
}
