// The control's reference functions for "call-function" runs. Written by hand and shipped in the repo; no
// model wrote or chose them, and Atlas never changes them at run time.
//
// Plain words: before any verdict on pasted code counts, Atlas runs THIS file through exactly the same
// sandbox, worker and harness as the pasted code, with fixed experiments whose results are known in advance
// (runners/ts/call-runner.ts, CALL_CONTROL_CASES). Each function exercises one part of the machinery: JSON
// arguments in and out, a plain stand-in that returns then throws then runs out, an async stand-in with
// virtual delays, the code's own setTimeout / setInterval / Date / performance.now on the virtual clock, a
// call that can never settle, a throw, a call cut off by the watch limit, a value that is not JSON, and a
// stand-in called after the call already returned. If any measured fact differs from the known answer, the
// control fails and every verdict on pasted code is "can't check".
//
// This file is loaded as target.ts, so it must stay plain TypeScript that Node's type stripping runs (no
// enums, no namespaces) and it must import nothing.

/** JSON in, JSON out. Known answer: returned {"nested":{"none":null,"ok":true},"sum":42,"tags":["c","b","a"]} at 0 ms. */
export function combine(a: { x: number; tags: string[] }, b: number): unknown {
  return { sum: a.x + b, tags: [...a.tags].reverse(), nested: { ok: true, none: null } };
}

/** A plain stand-in: returns, then throws a TypeError, then has no step left (throw_exhausted). */
export function useSyncStandIn(get: (k: string) => unknown): unknown {
  const first = get("a");
  let second = "no throw";
  try {
    get("b");
  } catch (e) {
    const err = e as Error;
    second = `${err instanceof TypeError}:${err.name}:${err.message}`;
  }
  let third = "no throw";
  try {
    get("c");
  } catch (e) {
    third = (e as Error).name;
  }
  return { first, second, third };
}

/** An async stand-in with virtual delays, the code's own setTimeout, and the virtual Date / performance clocks. */
export async function useAsyncStandIn(fetchRate: () => Promise<unknown>): Promise<unknown> {
  const t0 = Date.now();
  const p0 = performance.now();
  const a = await fetchRate(); // step 1: returns 7 after 1500 ms
  let b = "no throw";
  try {
    await fetchRate(); // step 2: throws RangeError
  } catch (e) {
    b = (e as Error).name;
  }
  await new Promise((r) => setTimeout(r, 250));
  const c = await fetchRate(); // step 3: returns "c" after 100 ms
  const d = await fetchRate(); // repeat_last: step 3 again
  return { a, b, c, d, elapsed: Date.now() - t0, perf: performance.now() - p0, year: new Date().getUTCFullYear() };
}

/** Waits on a stand-in that never answers: nothing is left that could wake it. */
export async function waitsForever(lookup: () => Promise<unknown>): Promise<unknown> {
  return await lookup();
}

/** Throws a named error with the given message. */
export function throwsNamed(message: string): never {
  const e = new Error(message);
  e.name = "ReferenceCheckError";
  throw e;
}

/** Waits 60 s of virtual time; with a 1000 ms watch limit it is still running when Atlas stops watching. */
export async function sleepsLong(): Promise<string> {
  await new Promise((r) => setTimeout(r, 60_000));
  return "late";
}

/** Returns undefined, which JSON cannot hold: returnedType is measured, returnedJson is not. */
export function returnsUndefined(): undefined {
  return undefined;
}

/** setInterval on the virtual clock: three ticks of 400 ms, then clearInterval. Known answer: 3 at 1200 ms. */
export async function ticks(): Promise<number> {
  let n = 0;
  await new Promise<void>((resolve) => {
    const h = setInterval(() => {
      n += 1;
      if (n === 3) {
        clearInterval(h);
        resolve();
      }
    }, 400);
  });
  return n;
}

/** Returns at once and calls the stand-in 500 ms later: the call returned at 0 ms, the stand-in was called once. */
export function laterCall(ping: () => unknown): string {
  setTimeout(() => ping(), 500);
  return "now";
}

/**
 * R1 (D36): the pins. Math.random and crypto.randomUUID draw from Atlas's seeded generator (seed 20260101 in the
 * control), the time zone is UTC and the locale is en-US. Known answer in CALL_CONTROL_CASES (C10-pins).
 */
export function pinned(): unknown {
  return { r: Math.random(), u: crypto.randomUUID(), h: new Date(0).getHours(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, n: (1234.5).toLocaleString() };
}
