// D06-02: the waves screen. A slider picks how many callers (1–200) call the real withRpcRetry at the
// same moment, each with the same failure pattern. Letting go of the slider runs the sweep in the
// sandbox (POST /sweeps); the chart counts the calls made in each slice of virtual time.
//
// Plain words on trust: the chart is drawn only from the run's measured call times, and only when
// src/trust.ts says the run may be shown as fact (the control matched and the sandbox finished).
// Otherwise the page shows the reason and no bars. The caption is always in the DOM: the chart
// shows a mechanism (every caller waits the same fixed time), not a real outage.

import { useEffect, useRef, useState } from "react";
import type { Run, Target } from "../../src/types";
import { notShownAsFact } from "../../src/trust";
import type { Api } from "../api";
import { bucketCallTimes, parseCallTimes, plural, wavesCaption, type Bucket } from "./scale-model";
import { FIXTURE_REF } from "../scenarios";

export const PATTERNS = [
  { id: "3", label: "the first 3 calls fail, the 4th answers", failTimes: 3 as const },
  { id: "always", label: "every call fails", failTimes: "always" as const },
] as const;
export type PatternId = (typeof PATTERNS)[number]["id"];

const BUCKET_MS = 250;
const fmt = (n: number) => n.toLocaleString("en-US");

export function ScaleScreen({ api }: { api: Api }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [callers, setCallers] = useState(200);
  const [pattern, setPattern] = useState<PatternId>("3");
  const [run, setRun] = useState<Run | null>(null);
  const [realMs, setRealMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.target(FIXTURE_REF).then(
      (t) => live && setTarget(t),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [api]);

  // One sweep at a time (the server runs one per session). A request made while one runs is kept, and
  // only the newest kept request runs next, so dragging the slider never piles up runs.
  const inFlight = useRef(false);
  const queued = useRef<{ n: number; p: PatternId } | null>(null);
  const sweep = async (n: number, p: PatternId) => {
    if (!target) return;
    if (inFlight.current) {
      queued.current = { n, p };
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      const failTimes = PATTERNS.find((x) => x.id === p)!.failTimes;
      const out = await api.sweep(target, { shape: "concurrency-sweep", callers: n, failTimes, failure: "error" });
      setRun(out.run);
      setRealMs(Math.round(performance.now() - t0));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) void sweep(next.n, next.p);
      else setBusy(false);
    }
  };

  // The first sweep runs as soon as the target is known, so the screen never opens empty.
  useEffect(() => {
    if (target) void sweep(callers, pattern);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return (
    <section className="card scale" aria-label="many callers at once" data-testid="scale">
      <h2>Many callers at once</h2>
      <p className="muted">
        Each caller runs the real <code>withRpcRetry</code> (pre-existing code, listed in PRE-EXISTING.md) against a fake chain read with the same failure pattern. All callers share one
        virtual clock in the sandbox, so waits cost no real time.
      </p>
      <div className="scale-controls">
        <label className="scale-slider">
          <span>
            Callers: <b data-testid="scale-callers">{callers}</b>
          </span>
          <input
            type="range"
            min={1}
            max={200}
            step={1}
            value={callers}
            aria-label="callers"
            onChange={(e) => setCallers(Number(e.target.value))}
            onPointerUp={(e) => void sweep(Number((e.target as HTMLInputElement).value), pattern)}
            onKeyUp={(e) => void sweep(Number((e.target as HTMLInputElement).value), pattern)}
          />
        </label>
        <label>
          Failure pattern{" "}
          <select
            value={pattern}
            onChange={(e) => {
              const p = e.target.value as PatternId;
              setPattern(p);
              void sweep(callers, p);
            }}
          >
            {PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {busy && <span className="running">running…</span>}
      </div>
      {run && <WavesChart run={run} realMs={realMs} />}
      <p className="scale-caption" data-testid="waves-caption">
        {wavesCaption(run?.result.measured, run ? notShownAsFact(run) === null : false)}
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The chart, from the run alone. Shows the trust reason instead of bars when the run may not be shown as fact. */
export function WavesChart({ run, realMs = null }: { run: Run; realMs?: number | null }) {
  const blocked = notShownAsFact(run);
  if (blocked) {
    return (
      <p className="notice" data-testid="waves-not-shown">
        {blocked}
      </p>
    );
  }
  const m = run.result.measured;
  if (typeof m.callTimesMs !== "string") {
    const why = run.result.notMeasured.callTimesMs ?? "the run did not measure the call times";
    return (
      <p className="notice" data-testid="waves-not-shown">
        can't check: {why}
      </p>
    );
  }
  const instants = parseCallTimes(m.callTimesMs);
  const buckets = bucketCallTimes(instants, BUCKET_MS);
  return (
    <figure className="waves" data-testid="waves">
      <BarChart buckets={buckets} />
      <figcaption className="muted small" data-testid="waves-summary">
        {plural(Number(m.callers), "caller")} made {plural(Number(m.calls), "call")} in {plural(Number(m.waveCount), "wave")}; the largest wave held {plural(Number(m.largestWave), "call")} at the same virtual
        millisecond. {fmt(Number(m.sameScheduleCallers))} of {plural(Number(m.callers), "caller")} called at exactly the same times. Bars: calls per {BUCKET_MS} ms of virtual time.
        {realMs !== null && ` This sweep took ${fmt(realMs)} ms of real time, control included.`}
      </figcaption>
      <table className="verdicts waves-table" data-testid="waves-table">
        <thead>
          <tr>
            <th>virtual time</th>
            <th>calls at that moment</th>
          </tr>
        </thead>
        <tbody>
          {instants.map((x) => (
            <tr key={x.t}>
              <td>{fmt(x.t)} ms</td>
              <td>{fmt(x.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const W = 720;
const H = 260;
const PAD = { l: 48, r: 12, t: 12, b: 36 };

function BarChart({ buckets }: { buckets: Bucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const span = buckets.length * BUCKET_MS;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (ms: number) => PAD.l + (ms / span) * innerW;
  const y = (n: number) => PAD.t + innerH - (n / max) * innerH;
  const barW = Math.max(2, innerW / buckets.length - 2);
  const tickEvery = span > 6000 ? 3000 : span > 2000 ? 1000 : BUCKET_MS * 2;
  const ticks: number[] = [];
  for (let t = 0; t <= span; t += tickEvery) ticks.push(t);
  return (
    <svg className="waves-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`calls per ${BUCKET_MS} ms of virtual time; tallest bar ${max} calls`}>
      <line className="waves-axis" x1={PAD.l} y1={PAD.t + innerH} x2={W - PAD.r} y2={PAD.t + innerH} />
      <text className="waves-tick" x={PAD.l - 6} y={y(max) + 4} textAnchor="end">
        {fmt(max)}
      </text>
      <text className="waves-tick" x={PAD.l - 6} y={PAD.t + innerH + 4} textAnchor="end">
        0
      </text>
      {ticks.map((t) => (
        <text key={t} className="waves-tick" x={x(t)} y={H - 16} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
      <text className="waves-tick" x={PAD.l + innerW / 2} y={H - 2} textAnchor="middle">
        virtual time (ms)
      </text>
      {buckets.map((b) =>
        b.count === 0 ? null : (
          <g key={b.from} data-testid="wave-bar" data-from={b.from} data-count={b.count}>
            <rect className="waves-bar" x={x(b.from) + 1} y={y(b.count)} width={barW} height={PAD.t + innerH - y(b.count)} rx={3} />
            <title>{`${fmt(b.from)}–${fmt(b.to)} ms: ${fmt(b.count)} calls`}</title>
          </g>
        ),
      )}
    </svg>
  );
}
