// A wait on an unref'd timer: in a real Node process with nothing else alive, the process exits first.
export async function unrefWait() {
  await new Promise((r) => setTimeout(r, 100).unref());
  return "done";
}
// AbortSignal.timeout is unref'd in Node too.
export async function abortOnly() {
  const s = AbortSignal.timeout(100);
  await new Promise((_, rej) => s.addEventListener("abort", () => rej(s.reason)));
  return "unreachable";
}
