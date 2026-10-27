// The scoreboard's model: a pure function from the judged verdicts (and who placed each bet) to the
// state of every part of the mark. No drawing here, so a test can read the states directly.
//
// The mark is the Atlas logo (brand/atlas-logo/atlas-mark.svg): one dot per bettor at the top
// (solid = the person, hollow = a model), one leaning line from each dot toward one bar.
// How a verdict shows, decided once here:
// - matched      : the dot is filled (a model keeps its ring and fills its centre, so it still reads
//                  as the model) and its line runs all the way down onto the bar.
// - not_matched  : the dot keeps its own look (the person's stays solid, a model's stays hollow)
//                  and the line stops short of the bar, with a clear gap.
// - cant_check   : the dot is an outline with a short level dash inside (an instrument showing
//                  no reading), and the line is dashed and faint and stops short, like a guess
//                  that was never put to the test. It never reaches the bar.
// - no verdict   : (a bettor with no judged bet on this question) a faint outline dot, no line.

import type { Bet, Outcome, Verdict } from "../../../src/types";

/** Who placed a bet, as the verdict screen knows it. */
export type Bettor = Pick<Bet, "id" | "who" | "measures"> & Partial<Pick<Bet, "question">>;

export interface DotState {
  who: string;
  /** The person draws as a solid dot, a model as a ring (the logo's two dots). */
  kind: "person" | "model";
  outcome: Outcome | null;
  /** Centre of the dot in the 100 × 100 mark. */
  cx: number;
  cy: number;
  r: number;
  /** Filled dot (true) or ring (false). */
  filled: boolean;
  /** The short level dash inside the ring, for "can't check". */
  noReading: boolean;
  /** The line from the dot toward the bar; null when there is no verdict to show. */
  line: { x1: number; y1: number; x2: number; y2: number; dashed: boolean; faint: boolean; reachesBar: boolean } | null;
}

export interface MarkState {
  measures: string;
  question: string;
  dots: DotState[];
}

/** Logo geometry (viewBox 0 0 100 100), from brand/atlas-logo/atlas-mark.svg. */
export const MARK = {
  dotY: 28,
  personR: 9,
  modelR: 7.5,
  ring: 4,
  barX: 24,
  barY: 69,
  barW: 52,
  barH: 11,
  lineFromGap: 4,
  /** A line that does not reach the bar stops at this share of the way down. */
  shortShare: 0.55,
} as const;

/** Dot centres across the top: the logo's 30 and 70 for two bettors, spread evenly for more. */
function dotXs(n: number): number[] {
  if (n <= 1) return [30];
  if (n === 2) return [30, 70];
  return Array.from({ length: n }, (_, i) => 22 + (56 * i) / (n - 1));
}

/** Where each line lands on the bar: close to the middle, never crossing its neighbour. */
function landXs(n: number): number[] {
  if (n <= 1) return [46];
  return Array.from({ length: n }, (_, i) => 44 + (12 * i) / (n - 1));
}

const isPerson = (who: string) => who === "human";

/** One mark per question that has at least one judged bet; the person first, then models by name. */
export function scoreboardMarks(verdicts: Verdict[], bettors: Bettor[]): MarkState[] {
  const byId = new Map(bettors.map((b) => [b.id, b]));
  const questions: string[] = [];
  for (const v of verdicts) {
    const b = byId.get(v.betId);
    if (b && !questions.includes(b.measures)) questions.push(b.measures);
  }
  const whoAll = [...new Set(bettors.map((b) => b.who))].sort((a, b) => (isPerson(a) === isPerson(b) ? a.localeCompare(b) : isPerson(a) ? -1 : 1));
  return questions.map((measures) => {
    const xs = dotXs(whoAll.length);
    const lands = landXs(whoAll.length);
    const dots = whoAll.map((who, i): DotState => {
      const bet = bettors.find((b) => b.who === who && b.measures === measures);
      const verdict = bet ? verdicts.find((v) => v.betId === bet.id) : undefined;
      const outcome = verdict?.outcome ?? null;
      const kind = isPerson(who) ? "person" : "model";
      const r = kind === "person" ? MARK.personR : MARK.modelR;
      const cx = xs[i]!;
      const startY = MARK.dotY + r + MARK.lineFromGap;
      const landX = lands[i]!;
      const fullX = landX;
      const fullY = MARK.barY;
      const share = outcome === "matched" ? 1 : MARK.shortShare;
      const line =
        outcome === null
          ? null
          : {
              x1: cx + (fullX - cx) * ((startY - MARK.dotY) / (fullY - MARK.dotY)),
              y1: startY,
              x2: cx + (fullX - cx) * ((startY + (fullY - startY) * share - MARK.dotY) / (fullY - MARK.dotY)),
              y2: startY + (fullY - startY) * share,
              dashed: outcome === "cant_check",
              faint: outcome === "cant_check",
              reachesBar: outcome === "matched",
            };
      return {
        who,
        kind,
        outcome,
        cx,
        cy: MARK.dotY,
        r,
        filled: outcome === "matched" || (kind === "person" && outcome === "not_matched"),
        noReading: outcome === "cant_check",
        line,
      };
    });
    const q = bettors.find((b) => b.measures === measures)?.question ?? measures;
    return { measures, question: q, dots };
  });
}
