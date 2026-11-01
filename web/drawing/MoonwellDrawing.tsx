// R3 phase 2: Moonwell's price flow, from one recorded run (D55). Takes the place of the price pipe.
// The caption carries the allowed wording; a D20 "in theory" run says so. Nothing from a run that may not be shown as fact.

import { useMemo, useState } from "react";
import { moonwellFlow } from "../../renderer/authors/moonwell";
import type { Bet, Run, Verdict } from "../../src/types";
import { Drawing } from "./Drawing";
import { useDarkScheme, useReducedMotion } from "./media";
import { sizedHeight } from "./RunPath";
import type { Mounted } from "../../renderer/live/mount";

// One empty list, kept: a new `[]` each render would redraw the drawing each render.
const NO_BETS: readonly Bet[] = [];
const NO_VERDICTS: readonly Verdict[] = [];

export function MoonwellDrawing({ run, bets = NO_BETS, verdicts = NO_VERDICTS, theory, captions, still = false, beforeChange = false }: { beforeChange?: boolean;  run: Run; bets?: readonly Bet[]; verdicts?: readonly Verdict[]; /** D20: the words every screen must carry for a change wired "in theory". */ theory?: string[]; captions?: string[]; /** A proof card: the finished picture, no motion. */ still?: boolean }) {
  const dark = useDarkScheme();
  const reduced = useReducedMotion();
  const spec = useMemo(() => {
    const s = moonwellFlow({ run, bets: [...bets], verdicts: [...verdicts], origin: still ? "proof-file" : "this-run", ...(beforeChange ? { beforeChange: true } : {}), ...(captions ? { fileCaptions: captions } : {}) });
    return theory?.length ? { ...s, captions: [...theory.map((words) => ({ words, provenance: "plain-code" as const })), ...s.captions] } : s;
  }, [run, bets, verdicts, theory, captions]);
  const [height, setHeight] = useState<number | null>(null);
  const play = (m: Mounted | null) => {
    const p = m?.player;
    if (!p) return;
    if (still) {
      p.showAll();
      return;
    }
    void (async () => {
      p.rewind();
      for (let i = 0; i < spec.steps.length; i++) await p.playStep(i);
      for (const mark of spec.marks) await p.landMark(mark);
      p.showCaptions();
    })();
  };
  return (
    <section className="r-moonwell" data-testid="price-pipe" aria-label="The price flow">
      <Drawing spec={spec} theme={dark ? "dark" : "light"} className="r-moonwell-sheet" style={{ height: height ?? 420 }} hover={false} pan={false} maxScale={1} minScale={0.3} {...(reduced ? { reducedMotion: true } : {})} onMount={(m, narrow) => {
          play(m);
          if (m) setHeight(sizedHeight(m, narrow));
        }} />
    </section>
  );
}
