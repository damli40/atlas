// The waves chart's data, as a pure function of the run (D06-02). No drawing, no I/O.
//
// Plain words: the run lists every virtual moment at which callers called the chain read, and how
// many called at that moment ("0:200,3000:200,..."). The chart groups those moments into equal time
// buckets (e.g. 250 ms wide) and counts the calls in each. A bucket with no call shows 0; nothing is
// smoothed or invented.

export interface CallInstant {
  t: number;
  count: number;
}
export interface Bucket {
  /** Start of the bucket, virtual ms (inclusive). */
  from: number;
  /** End of the bucket, virtual ms (exclusive). */
  to: number;
  count: number;
}

/** "0:200,3000:200" → [{ t: 0, count: 200 }, { t: 3000, count: 200 }]: the `callTimesMs` format runners/ts/harness.ts runSweep writes. */
export function parseCallTimes(text: string): CallInstant[] {
  if (text === "") return [];
  return text.split(",").map((pair) => {
    const [t, count] = pair.split(":").map(Number);
    if (!Number.isFinite(t) || !Number.isSafeInteger(count)) throw new Error(`call times are not in the "t:count" form: ${pair}`);
    return { t: t!, count: count! };
  });
}

/** Equal buckets from 0 through the last call. Every call lands in exactly one bucket. */
export function bucketCallTimes(instants: readonly CallInstant[], widthMs: number): Bucket[] {
  if (!(widthMs > 0)) throw new Error("bucket width must be above 0 ms");
  const last = instants.reduce((a, x) => Math.max(a, x.t), 0);
  const n = Math.floor(last / widthMs) + 1;
  const out: Bucket[] = Array.from({ length: n }, (_, i) => ({ from: i * widthMs, to: (i + 1) * widthMs, count: 0 }));
  for (const x of instants) out[Math.floor(x.t / widthMs)]!.count += x.count;
  return out;
}

/** Share of all calls made at exactly one of the given virtual times (0..1). 0 when there are no calls. */
export function shareInWaves(instants: readonly CallInstant[], times: readonly number[]): number {
  const total = instants.reduce((a, x) => a + x.count, 0);
  if (total === 0) return 0;
  const want = new Set(times);
  return instants.filter((x) => want.has(x.t)).reduce((a, x) => a + x.count, 0) / total;
}

/** The DOM caption the waves chart carries when the run earns it (never an outage, never "hangs"). "fixed" means unchanging here, not a verdict. */
export const WAVES_CAPTION = "mechanism, not an incident: every caller retries on the same fixed schedule"; // wording-lint: allow
/** M2 (day-6 review): the caption when the run did not show every caller on one schedule (or has not run yet). */
export const WAVES_CAPTION_PLAIN = "mechanism, not an incident";

/**
 * M2: the full caption only when the run measured it: every caller called at exactly the same times
 * (sameScheduleCallers === callers). Otherwise only "mechanism, not an incident".
 */
export function wavesCaption(measured: Record<string, unknown> | null | undefined, shownAsFact: boolean): string {
  if (!measured || !shownAsFact) return WAVES_CAPTION_PLAIN;
  const n = measured.callers;
  return typeof n === "number" && n > 0 && measured.sameScheduleCallers === n ? WAVES_CAPTION : WAVES_CAPTION_PLAIN;
}

/** "1 caller", "200 callers". */
export const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
