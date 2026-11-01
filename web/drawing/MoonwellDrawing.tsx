// R3 phase 2: Moonwell's price flow, from one recorded run (D55). Takes the place of the price pipe.
// The caption carries the allowed wording; a D20 "in theory" run says so. Nothing from a run that may not be shown as fact.

import { useEffect, useMemo, useRef, useState } from "react";
import { moonwellFlow } from "../../renderer/authors/moonwell";
import type { Bet, Run, Verdict } from "../../src/types";
import { Drawing } from "./Drawing";
import { useDarkScheme, useReducedMotion } from "./media";
import { sizedHeight } from "./RunPath";
import { drawMoonwell } from "../../renderer/machine/machine";
import { MachineSheet, machineFirst, type MachineControl } from "./MachineView";
import type { Mounted } from "../../renderer/live/mount";

// One empty list, kept: a new `[]` each render would redraw the drawing each render.
const NO_BETS: readonly Bet[] = [];
const NO_VERDICTS: readonly Verdict[] = [];

export function MoonwellDrawing({ run, bets = NO_BETS, verdicts = NO_VERDICTS, theory, captions, still = false, beforeChange = false, compact = false, stranger = false, machine = false }: { stranger?: boolean; machine?: boolean; beforeChange?: boolean; /** Beside the moment: the moment says what this is, so the sheet has no big title. */ compact?: boolean;  run: Run; bets?: readonly Bet[]; verdicts?: readonly Verdict[]; /** D20: the words every screen must carry for a change wired "in theory". */ theory?: string[]; captions?: string[]; /** A proof card: the finished picture, no motion. */ still?: boolean }) {
  const dark = useDarkScheme();
  const reduced = useReducedMotion();
  const spec = useMemo(() => {
    const s = moonwellFlow({ run, bets: [...bets], verdicts: [...verdicts], origin: still ? "proof-file" : "this-run", ...(beforeChange ? { beforeChange: true } : {}), ...(stranger ? { stranger: true } : {}), ...(captions ? { fileCaptions: captions } : {}) });
    if (compact) {
      s.title = undefined;
      s.subtitle = undefined;
    }
    return theory?.length ? { ...s, captions: [...theory.map((words) => ({ words, provenance: "plain-code" as const })), ...s.captions] } : s;
  }, [run, bets, verdicts, theory, captions]);
  const [height, setHeight] = useState<number | null>(null);
  const useMachine = machine && machineFirst();
  const drawn = useMemo(() => (useMachine ? drawMoonwell(spec, { ended: still }) : null), [spec, still, useMachine]);
  const sheet = useRef<MachineControl | null>(null);
  // The run goes through the one pipe, then the ring lands on the number.
  useEffect(() => {
    if (!drawn || still) return;
    const c = sheet.current;
    if (!c) return;
    c.rewind();
    c.setScript(spec.steps.map((st) => ({ routes: st.edges.filter((e) => e === "e-price"), lamps: st.nodes.filter((n) => n === "feed" || n === "price") })));
    let live = true;
    void (async () => {
      for (let i = 0; i < spec.steps.length && live; i++) {
        c.play(i, 900);
        await new Promise((r) => setTimeout(r, reduced ? 0 : 950));
      }
      if (live) c.land();
    })();
    return () => {
      live = false;
    };
  }, [drawn, still, spec, reduced]);
  if (drawn && drawn.problems.length === 0) {
    return (
      <section className="r-moonwell m-flow-wrap" data-testid="price-pipe" aria-label="The price flow">
        <p className="m-kicker">{spec.kicker}</p>
        <p className="m-title">{spec.title}</p>
        <div className="m-flow">
          <MachineSheet ref={sheet} drawn={drawn} reduced={reduced} />
        </div>
        {spec.captions.map((c) => (
          <p key={c.words} className="m-cap">{c.words}</p>
        ))}
      </section>
    );
  }
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
