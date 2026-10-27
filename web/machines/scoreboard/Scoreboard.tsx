// The scoreboard IS the Atlas mark: two dots, two leaning lines, one bar (brand/atlas-logo).
// Drawn only from the verdicts and the list of who placed each bet; see marks.ts for how each
// verdict shows. Under prefers-reduced-motion it renders the end state with no animation classes.

import { useSyncExternalStore } from "react";
import type { Outcome, Verdict } from "../../../src/types";
import { MARK, scoreboardMarks, type Bettor, type DotState, type MarkState } from "./marks";
import { MARK_PRE_EXISTING_CAPTION } from "../../../src/captions";

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };
const STILLNESS = "(prefers-reduced-motion: reduce)";

function asksForStillness(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(STILLNESS).matches;
}

/** True when the reader asked for reduced motion (read on the first render, so the end state paints first). */
export function useStill(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const q = window.matchMedia(STILLNESS);
      q.addEventListener("change", changed);
      return () => q.removeEventListener("change", changed);
    },
    asksForStillness,
    () => false,
  );
}

/**
 * The bettor's name as shown. A model's name always carries its Meta model id (D10: Meta model names stay
 * visible on screen), e.g. "Muse Spark 1.3 (muse-spark-1.3)"; with no display name, the id itself.
 */
export const bettorName = (who: string, names: Record<string, string>) => {
  if (who === "human") return "You";
  const id = who.replace(/^model:/, "");
  const shown = names[who];
  return shown && shown.includes(id) ? shown : shown ? `${shown} (${id})` : id;
};
const name = bettorName;

function Dot({ d, still, i }: { d: DotState; still: boolean; i: number }) {
  const delay = { animationDelay: `${0.25 + i * 0.12}s` };
  const lineDelay = { animationDelay: `${i * 0.12}s` };
  return (
    <g data-bettor={d.who} data-outcome={d.outcome ?? "none"}>
      {d.line && (
        <path
          className={`sb-line${still ? "" : d.line.dashed ? " sb-fade" : " sb-grow"}`}
          data-dashed={d.line.dashed ? "" : undefined}
          data-faint={d.line.faint ? "" : undefined}
          data-reaches-bar={d.line.reachesBar ? "" : undefined}
          d={`M${d.line.x1.toFixed(2)} ${d.line.y1.toFixed(2)}L${d.line.x2.toFixed(2)} ${d.line.y2.toFixed(2)}`}
          pathLength={1}
          style={still ? undefined : lineDelay}
        />
      )}
      {d.kind === "model" && d.filled ? (
        // A matched model keeps its ring (who it is) and fills its centre (the verdict).
        <>
          <circle className="sb-ring" cx={d.cx} cy={d.cy} r={d.r} />
          <circle className={`sb-dot${still ? "" : " sb-fill"}`} data-filled="" cx={d.cx} cy={d.cy} r={d.r - MARK.ring / 2 - 1.4} style={still ? undefined : delay} />
        </>
      ) : d.filled ? (
        <circle className="sb-dot" data-filled="" cx={d.cx} cy={d.cy} r={d.r} />
      ) : (
        <circle className="sb-ring" data-faint={d.outcome === null ? "" : undefined} cx={d.cx} cy={d.cy} r={d.kind === "person" ? d.r - MARK.ring / 2 : d.r} />
      )}
      {d.noReading && <path className="sb-noreading" d={`M${(d.cx - d.r * 0.42).toFixed(2)} ${d.cy}H${(d.cx + d.r * 0.42).toFixed(2)}`} />}
    </g>
  );
}

export function Mark({ mark, still, names = {}, size = 96 }: { mark: MarkState; still: boolean; names?: Record<string, string>; size?: number }) {
  const label = mark.dots.map((d) => `${name(d.who, names)}: ${d.outcome ? SAY[d.outcome] : "no bet"}`).join(". ");
  return (
    <svg className="sb-mark" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} data-measures={mark.measures}>
      {mark.dots.map((d, i) => (
        <Dot key={d.who} d={d} still={still} i={i} />
      ))}
      <rect className="sb-bar" x={MARK.barX} y={MARK.barY} width={MARK.barW} height={MARK.barH} rx={MARK.barH / 2} />
    </svg>
  );
}

export interface ScoreboardProps {
  verdicts: Verdict[];
  /** Who placed each bet (the judged bets). Only id, who and measures are read, plus the question text. */
  bets: Bettor[];
  /** Display names for model bettors, e.g. { "model:muse-spark-1.3": "Muse Spark 1.3" }. */
  names?: Record<string, string>;
  /** Force the end state (reduced motion). Defaults to the reader's setting. */
  still?: boolean;
  /** D07-04: false hides the per-mark "who · outcome" list (the proof card prints one list for all marks). */
  who?: boolean;
  /** D07-04: the mark's drawn size in px (CSS may still scale it). */
  size?: number;
}

/** One mark per question, each with its question underneath (the question text is the bet's own). */
export function Scoreboard({ verdicts, bets, names, still, who = true, size }: ScoreboardProps) {
  const asked = useStill();
  const calm = still ?? asked;
  const marks = scoreboardMarks(verdicts, bets);
  if (marks.length === 0) return null;
  return (
    <>
    <div className="sb" data-testid="scoreboard" data-still={calm ? "" : undefined}>
      {marks.map((m) => (
        <figure key={m.key} className="sb-item">
          <Mark mark={m} still={calm} names={names ?? {}} {...(size ? { size } : {})} />
          {/* S6 (day-5 review): who bet and how it came out, as visible text, not only in aria-label. */}
          {who && (
            <ul className="sb-who" data-testid="sb-who">
              {m.dots.map((d) => (
                <li key={d.who} data-bettor={d.who}>
                  {name(d.who, names ?? {})} · {d.outcome ? SAY[d.outcome] : "no bet"}
                </li>
              ))}
            </ul>
          )}
          <figcaption className="muted small">{m.question}</figcaption>
        </figure>
      ))}
    </div>
    {/* D21: the mark is the pre-existing Atlas logo; the scoreboard that draws it is hackathon work. Always shown with it. */}
    <p className="sb-premark muted small" data-testid="sb-premark">
      {MARK_PRE_EXISTING_CAPTION}
    </p>
    </>
  );
}
