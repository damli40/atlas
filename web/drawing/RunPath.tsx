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
}

export function RunPath({ run, experiment, bets = [], verdicts = [], title, kicker, still = false, retry = false, testid = "run-path" }: RunPathProps) {
  const dark = useDarkScheme();
  const reduced = useReducedMotion();
  const spec = useMemo(() => {
    const human = bets.filter((b) => b.who === "human");
    const input = { run, ...(experiment ? { experiment } : {}), bets: human, verdicts: [...verdicts], ...(title ? { title } : {}), ...(kicker ? { kicker } : {}) };
    return retry ? retryDemo(input) : whatHappened(input);
  }, [run, experiment, bets, verdicts, title, kicker, retry]);
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
  const height = spec.notShown !== undefined ? undefined : Math.max(320, Math.min(760, 130 + spec.nodes.length * 118));
  return (
    <section className="r-runpath" data-testid={testid}>
      <Drawing spec={spec} theme={dark ? "dark" : "light"} className="r-runpath-sheet" style={{ height: height ?? 180 }} hover={false} pan={!still} {...(reduced ? { reducedMotion: true } : {})} onMount={(x) => setM(x)} maxScale={1} />
      {!still && m?.player && spec.steps.length > 0 && (
        <button type="button" className="r-again" onClick={() => setToken((t) => t + 1)} data-testid="run-path-again">
          play it again
        </button>
      )}
    </section>
  );
}
