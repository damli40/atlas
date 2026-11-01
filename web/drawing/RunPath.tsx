// R3 phase 2: "what happened", from one run's measured trace. Takes the place of the call timeline and the retry machine.
// Trust: the author (renderer/authors/what-happened.ts) draws nothing for a run that may not be shown as fact, and says why.
// `still`: a proof card: the finished picture, no motion.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Bet, Experiment, Run, Verdict } from "../../src/types";
import { retryDemo, whatHappened } from "../../renderer/authors/what-happened";
import type { Mounted } from "../../renderer/live/mount";
import { useDarkScheme, useReducedMotion } from "./media";
import { Drawing } from "./Drawing";

export interface RunPathProps {
  run: Run;
  experiment?: Pick<Experiment, "params"> | undefined;
  bets?: readonly Bet[];
  verdicts?: readonly Verdict[];
  title?: string;
  kicker?: string;
  still?: boolean;
  /** The retry demo: the code is pre-existing, and the drawing says so. */
  retry?: boolean;
  testid?: string;
  /** Whoever is looking did not place this bet. */
  stranger?: boolean;
}

/** The height at which the whole drawing shows at the width the page gives it. */
export function sizedHeight(m: Mounted, narrow: boolean): number {
  const { w, h } = m.size();
  if (h === 0) return 200;
  const room = narrow ? Math.min(typeof window === "undefined" ? 390 : window.innerWidth, 720) : Math.min(1100, w);
  return Math.ceil(h * Math.min(1, room / Math.max(1, w)));
}

// One empty list, kept: a new `[]` each render would redraw the drawing each render.
const NO_BETS: readonly Bet[] = [];
const NO_VERDICTS: readonly Verdict[] = [];

export function RunPath({ run, experiment, bets = NO_BETS, verdicts = NO_VERDICTS, title, kicker, still = false, retry = false, testid = "run-path", stranger = false }: RunPathProps) {
  const dark = useDarkScheme();
  const reduced = useReducedMotion();
  const spec = useMemo(() => {
    // The retry demo marks each model's bet as well as the person's (D10). On a call's path only the person's are marked.
    const shown = retry ? [...bets] : bets.filter((b) => b.who === "human");
    // A proof card reads a saved file. Everywhere else in the app the run has just happened on this server.
    const input = { run, ...(experiment ? { experiment } : {}), bets: shown, verdicts: [...verdicts], origin: still ? ("proof-file" as const) : ("this-run" as const), ...(stranger ? { stranger: true } : {}), ...(title ? { title } : {}), ...(kicker ? { kicker } : {}) };
    return retry ? retryDemo(input) : whatHappened(input);
  }, [run, experiment, bets, verdicts, title, kicker, retry, still, stranger]);
  const [m, setM] = useState<Mounted | null>(null);
  const [token, setToken] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    const p = m?.player;
    if (!p) return;
    if (still && first.current) {
      first.current = false;
      p.showAll();
      return;
    }
    first.current = false;
    let live = true;
    void (async () => {
      p.rewind();
      for (let i = 0; i < spec.steps.length && live; i++) await p.playStep(i);
      for (const mark of spec.marks) if (live) await p.landMark(mark);
      if (live) p.showCaptions();
    })();
    return () => {
      live = false;
      p.skip();
    };
  }, [m, token, still, spec]);
  // The sheet grows to show the whole path at the drawing's own size (a page scrolls; a path should not need panning here).
  const [height, setHeight] = useState<number | null>(null);
  return (
    <section className="r-runpath" data-testid={testid}>
      <Drawing spec={spec} theme={dark ? "dark" : "light"} className="r-runpath-sheet" style={{ height: height ?? 240 }} hover={false} pan={false} {...(reduced ? { reducedMotion: true } : {})} onMount={(x, narrow) => {
          setM(x);
          if (x) setHeight(sizedHeight(x, narrow));
        }} maxScale={1} minScale={0.3} />
      {!still && m?.player && spec.steps.length > 0 && (
        <button type="button" className="r-again" onClick={() => setToken((t) => t + 1)} data-testid="run-path-again">
          play it again
        </button>
      )}
    </section>
  );
}
