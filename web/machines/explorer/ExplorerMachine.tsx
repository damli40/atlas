// X2, redrawn in R3 phase 2 (D55): the explorer's chart plus the part card beside it. The only input is the explorer model
// (model.ts, from a job's verified outline). Atlas authors a spec from it (renderer/authors/code-chart.ts) and the renderer
// draws only that. Every model sentence on the card is React text (escaped); the renderer escapes the names it draws.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { explorerSpec } from "../../../renderer/authors/code-chart";
import type { Mounted } from "../../../renderer/live/mount";
import { idFromAttr } from "../../../renderer/words";
import { Drawing } from "../../drawing/Drawing";
import { useDarkScheme } from "../../drawing/media";
import { arrowOf, authorOf, chalkText, joinWords, lineWord, spanText, type BetChoice, type Box, type ExplorerModel } from "./model";
import { plural } from "../../../src/words";
import type { LabelsAnswer } from "../../../src/failure-labels";
import { FailureLabels, FL_WORDS } from "../../screens/FailureLabels";

export interface ExplorerMachineProps {
  model: ExplorerModel;
  /** Present when the outline came from a live job on this server (the hand-off can read the file). */
  onBet?: (choice: BetChoice, box: Box) => void;
  /** Why betting is not offered (a saved outline has no code here). */
  betUnavailable?: string;
  /** Busy handing off (reading the file). */
  betBusy?: string | null;
  theme?: "light" | "dark";
  /** Evidence pages: pick this part at start and hold still. */
  initialPick?: string | null;
  /** X3 (D28): plain code's common-failure labels per part id (GET /outline/jobs/:id/labels). Absent: not shown. */
  labels?: Record<string, LabelsAnswer> | null;
  /** X3 review M2: labels are held while a round on this code has bets still to seal. */
  labelsHeld?: boolean;
}

export function ExplorerMachine({ model, onBet, betUnavailable, betBusy = null, theme, initialPick = null, labels = null, labelsHeld = false }: ExplorerMachineProps) {
  const dark = useDarkScheme();
  const shown = theme ?? (dark ? "dark" : "light");
  const [picked, setPicked] = useState<string | null>(initialPick);
  const box = picked ? (model.boxes.find((b) => b.id === picked) ?? null) : null;
  // Plain code's failure labels that claim something about the code go on the chart (D50); common patterns stay on the card.
  const tagWords = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [id, a] of Object.entries(labels ?? {})) {
      const claimed = a.labels.filter((l) => l.label !== "common pattern").map((l) => `${l.label}: ${l.name}`);
      if (claimed.length) out[id] = claimed.slice(0, 2);
    }
    return out;
  }, [labels]);
  const spec = useMemo(() => explorerSpec(model, { labels: labelsHeld ? {} : tagWords }), [model, tagWords, labelsHeld]);
  const mounted = useRef<Mounted | null>(null);
  useEffect(() => {
    mounted.current?.pick(picked);
  }, [picked]);

  // Review B1: no idle tour on the live screen. The picked part changes only when the reader picks.

  // Hover picks only on a real pointer move: scrolling the page under a still pointer fires "over" events, and a
  // part must not change because the reader scrolled (found in the live click-through).
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const hoverPick = (e: PointerEvent<HTMLDivElement>) => {
    const last = lastPointer.current;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    if (!last || (last.x === e.clientX && last.y === e.clientY)) return;
    pickFrom(e);
  };
  const pickFrom = (e: PointerEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest?.("[data-node]");
    if (!hit) return;
    setPicked(idFromAttr(hit.getAttribute("data-node")!));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const order = model.boxes.map((b) => b.id);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
        const i = picked ? order.indexOf(picked) : -1;
      const n = order.length;
      setPicked(order[i < 0 ? (e.key === "ArrowRight" ? 0 : n - 1) : (i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]!);
    } else if (e.key === "Escape") {
        setPicked(null);
    }
  };

  const drawnOnce = useRef(false);
  const drawnOf = (b: Box) => b.joins.filter((j) => j.drawn).length;
  // Review minor 3: "lines" on the card means code lines; the machine's connections are "joins drawn".
  const readout = box ? `${box.name.text} · ${plural(drawnOf(box), "join")} drawn` : `${plural(model.boxes.length, "part")} · ${plural(model.lines.length, "join")} drawn`;
  return (
    <div className="ex-wrap">
    <div className="rr-host ex ex-page" data-theme={shown} data-testid="explorer-machine">
      <div className="ex-main">
        {model.notShown !== null ? (
          <div className="card notice" role="note" data-testid="explorer-not-drawn">
            <p>{model.notShown}</p>
          </div>
        ) : (
          <div
            className="ex-stage r-ex-stage"
            role="group"
            aria-label="Code explorer chart. Tab to a part; arrows walk its joins; Enter picks it."
            onPointerMove={hoverPick}
            onClick={pickFrom}
            onKeyDown={onKey}
            data-testid="explorer-stage"
          >
            <Drawing
              spec={spec}
              theme={shown}
              className="r-ex-sheet"
              maxScale={1.1}
              minScale={0.6}
              onMount={(m) => {
                mounted.current = m;
                m?.pick(picked);
                const p = m?.player;
                if (p && !drawnOnce.current) void p.entrance();
                drawnOnce.current = true;
              }}
              onSelect={(id) => setPicked(id)}
            />
            <p className="r-ex-readout" data-readout="">{readout}</p>
          </div>
        )}
        <p className="r-ex-caption" data-testid="explorer-caption">{`Drawn only from Atlas's checked outline of ${model.source}${model.commit ? ` at commit ${model.commit.slice(0, 7)}` : ""} (${plural(model.files.length, "file")}). Muse Wonder (${model.model}) proposed the parts and wrote every name and purpose; plain code checked them against the files and found the joins. "Lines confirmed" means the lines exist where Wonder said; it does not mean Wonder's sentence about a part is true.`}</p>
      </div>
      <div className="ex-aside">
        <PartCard model={model} box={box} onPick={(id) => setPicked(id)} {...(onBet ? { onBet } : {})} {...(betUnavailable ? { betUnavailable } : {})} betBusy={betBusy} labels={box && labels ? (labels[box.id] ?? null) : null} labelsHeld={labelsHeld} />
        <Lists model={model} />
      </div>
    </div>
    </div>
  );
}

function PartCard({ model, box, onPick, onBet, betUnavailable, betBusy, labels, labelsHeld }: { model: ExplorerModel; box: Box | null; onPick: (id: string) => void; onBet?: (c: BetChoice, b: Box) => void; betUnavailable?: string; betBusy: string | null; labels: LabelsAnswer | null; labelsHeld: boolean }) {
  if (!box)
    return (
      <section className="ex-card" aria-label="part" data-testid="part-card">
        <p className="ex-card-label">Pick a box</p>
        <p className="ex-muted">Hover, click or Tab to a box to see its part: the name and purpose sentence Muse Wonder ({model.model}) wrote, the real file lines plain code confirmed, its joins, and the functions you can bet on.</p>
      </section>
    );
  const boxIds = new Set(model.boxes.map((b) => b.id));
  return (
    <section className="ex-card" aria-label="part" data-testid="part-card">
      <p className="ex-card-label">Part · lines confirmed</p>
      <h3>{box.name.text}</h3>
      <p className="ex-by">Name by {authorOf(box.name.by)}</p>
      <div className="ex-quote">
        <p className="ex-quote-by">{`${authorOf(box.purpose.by)} says what this part is for:`}</p>
        <blockquote>{box.purpose.text}</blockquote>
      </div>
      <p className="ex-muted">Plain code checked that these lines exist, on whole definitions. It did not check the sentence above.</p>
      <p className="ex-card-label">Real lines ({box.lines})</p>
      <ul className="ex-ranges">
        {box.spans.map((s) => (
          <li key={`${s.path}:${s.lineStart}`}>{spanText(s)}</li>
        ))}
      </ul>
      <p className="ex-muted ex-commit">{model.commit ? `${model.source} at commit ${model.commit}` : `uploaded files, sha256 ${model.codeSha256.slice(0, 16)}…`}</p>
      <p className="ex-card-label">Joins ({box.joins.length})</p>
      <ul className="ex-joins">
        {box.joins.map((j) => (
          <li key={`${j.id}:${j.dir}`}>
            <span>{`${j.kind} ${arrowOf(j.dir)} `}</span>
            {boxIds.has(j.other) ? (
              <button type="button" className="ex-join-btn" onClick={() => onPick(j.other)}>
                {model.partNames[j.other] ?? j.other}
              </button>
            ) : (
              <span>{`${model.partNames[j.other] ?? j.other} (not confirmed)`}</span>
            )}{" "}
            <span className="ex-status" data-s={j.status}>
              {lineWord(j)}
            </span>
            <span className="ex-muted">{` ${joinWords(j)}${j.codeEdges ? ` (${j.codeEdges} code ${j.codeEdges === 1 ? "link" : "links"})` : ""}.`}</span>
            {j.note ? <span className="ex-muted">{` Plain code's note: ${j.note}.`}</span> : null}
          </li>
        ))}
      </ul>
      <p className="ex-card-label">Bet on a function ({box.bets.length})</p>
      {box.bets.length === 0 ? (
        <p className="ex-muted">Plain code found no exported function in these lines.</p>
      ) : (
        <>
          {betUnavailable ? <p className="ex-muted">{betUnavailable}</p> : <p className="ex-muted">Opens the paste flow with this file and the function picked: the same gate, the same sealed bets as any pasted code.</p>}
          <ul className="ex-bets">
            {box.bets.map((c) => (
              <li key={`${c.path}#${c.name}`}>
                <button type="button" className="ex-bet-btn" disabled={!onBet || !c.ok || betBusy !== null} onClick={() => onBet?.(c, box)} data-testid={`bet-${c.name}`}>
                  {`Bet on ${c.name}`}
                </button>
                <span className="ex-muted">{` ${c.path}:${c.line}`}</span>
                {!c.ok && c.why ? <span className="ex-muted">{` Not offered: ${c.why}.`}</span> : null}
                {c.ok && c.note ? <span className="ex-muted ex-note">{` ${c.note}.`}</span> : null}
              </li>
            ))}
          </ul>
          {betBusy ? <p className="ex-muted" role="status">{betBusy}</p> : null}
        </>
      )}
      {labelsHeld ? (
        <>
          <p className="ex-card-label">{FL_WORDS.heading}</p>
          <p className="ex-muted" data-testid="labels-held">{FL_WORDS.held}</p>
        </>
      ) : null}
      {labels && !labelsHeld ? (
        <>
          <p className="ex-card-label">{FL_WORDS.heading}</p>
          <FailureLabels answer={labels} idPrefix={`part-${box.id}`} showPath compact />
        </>
      ) : null}
    </section>
  );
}

function Lists({ model }: { model: ExplorerModel }) {
  const nameOf = (id: string) => model.partNames[id] ?? id;
  return (
    <section className="ex-side" aria-label="joins not drawn" data-testid="chalk-list">
      <h2>Not drawn as lines</h2>
      <p className="ex-muted">Joins only Muse Wonder ({model.model}) states, with the parts named in its words. A chalk tag is not a connection.</p>
      <ul className="ex-chalks">
        {model.chalk.length === 0 ? <li className="ex-muted">None: plain code found every join Wonder named.</li> : null}
        {model.chalk.map((c) => (
          <li className="ex-chalk" key={c.id} data-chalk={c.id}>
            <span className="ex-chalk-tag">{`${nameOf(c.from)} → ${nameOf(c.to)} · ${c.kind}`}</span> <span className="ex-chalk-words">{chalkText(c)}</span>
          </li>
        ))}
      </ul>
      {model.unconfirmed.length ? (
        <>
          <h2>Parts not confirmed (not drawn)</h2>
          <ul>
            {model.unconfirmed.map((u) => (
              <li key={u.id}>
                {u.name.text} <span className="ex-by">(name by {authorOf(u.name.by)})</span>: {u.reasons.join("; ")}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {model.notDrawn.length ? (
        <>
          <h2>Joins found but not drawn</h2>
          <ul>
            {model.notDrawn.map((n) => (
              <li key={n.id}>{`${nameOf(n.from)} → ${nameOf(n.to)}: ${n.why}`}</li>
            ))}
          </ul>
        </>
      ) : null}
      {model.notInAnyPart.length ? (
        <>
          <h2>Files in no part</h2>
          <p className="ex-muted">{`${model.notInAnyPart.join(", ")}: an empty tray each.`}</p>
        </>
      ) : null}
      {model.skipped.length ? (
        <>
          <h2>Files Atlas did not read</h2>
          <ul>
            {model.skipped.map((s) => (
              <li key={s.path}>{`${s.path}: ${s.reason}`}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
