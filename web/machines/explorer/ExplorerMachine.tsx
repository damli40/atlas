// X2: the explorer machine as a card (Anatomy's Plate) plus the part card beside it. The only input is the
// explorer model (model.ts, from a job's verified outline). The drawing is figure.mjs's SVG string: built here in
// the browser with the Anatomy kit, the same code the saved demo page and the audit use. Every model sentence on
// the card is React text (escaped); the SVG escapes the names it engraves.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { Plate } from "../iso/react/draw";
import { stillNow, useVisible } from "../env";
import { buildFigure, type Figure } from "./figure.mjs";
import { authorOf, joinWords, spanText, type BetChoice, type Box, type ExplorerModel } from "./model";
import { applyPick } from "./pick";

const DARK = "(prefers-color-scheme: dark)";
function useDark(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const q = window.matchMedia(DARK);
      q.addEventListener("change", changed);
      return () => q.removeEventListener("change", changed);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK).matches,
    () => false,
  );
}

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
}

export function ExplorerMachine({ model, onBet, betUnavailable, betBusy = null, theme, initialPick = null }: ExplorerMachineProps) {
  const dark = useDark();
  const shown = theme ?? (dark ? "dark" : "light");
  const built = useMemo((): { fig: Figure; error: null } | { fig: null; error: string } => {
    if (model.notShown !== null) return { fig: null, error: model.notShown };
    try {
      return { fig: buildFigure(model), error: null };
    } catch (e) {
      return { fig: null, error: `The machine could not be drawn: ${e instanceof Error ? e.message : String(e)}. The parts and joins are listed below.` };
    }
  }, [model]);
  const [picked, setPicked] = useState<string | null>(initialPick);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const touched = useRef(initialPick !== null);
  const visible = useVisible(stageRef);
  const box = picked ? (model.boxes.find((b) => b.id === picked) ?? null) : null;

  useEffect(() => {
    if (rootRef.current) applyPick(rootRef.current, model.boxes, picked);
  }, [picked, model, built]);

  // Idle tour: a new part every 4 s until the reader touches the figure; never under reduced motion or offscreen.
  useEffect(() => {
    if (stillNow() || !visible || !built.fig) return;
    let i = 0;
    const t = setInterval(() => {
      if (touched.current) return;
      setPicked(model.boxes[i++ % model.boxes.length]!.id);
    }, 4000);
    return () => clearInterval(t);
  }, [visible, built, model]);

  const pickFrom = (e: PointerEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest?.("[data-hit]");
    if (!hit) return;
    touched.current = true;
    setPicked(hit.getAttribute("data-hit"));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const order = model.boxes.map((b) => b.id);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      touched.current = true;
      const i = picked ? order.indexOf(picked) : -1;
      const n = order.length;
      setPicked(order[i < 0 ? (e.key === "ArrowRight" ? 0 : n - 1) : (i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]!);
    } else if (e.key === "Escape") {
      touched.current = true;
      setPicked(null);
    }
  };

  const codeOnly = model.lines.filter((l) => l.status === "code-only").length;
  const typeOnly = model.lines.filter((l) => l.typeOnly).length;
  const drawnOf = (b: Box) => b.joins.filter((j) => j.drawn).length;
  const readout = box ? `${box.name.text} · ${drawnOf(box)} ${drawnOf(box) === 1 ? "line" : "lines"}` : `${model.boxes.length} parts · ${model.lines.length} lines`;
  return (
    <div className="ex-wrap">
    <div className="iso ex ex-page" data-theme={shown === "light" ? "light" : undefined} ref={rootRef} data-testid="explorer-machine">
      <div className="ex-main">
        {built.fig ? (
          <Plate
            fig="Fig X2"
            title={`${model.source}${model.commit ? ` @ ${model.commit.slice(0, 7)}` : ""}`}
            hint="hover a box · Tab, then ← → · Esc"
            readout={readout}
            keys={[
              { mark: "raised", label: "A box: a part whose lines plain code confirmed. Taller box = more lines" },
              { mark: "edge", label: `A steel line: plain code found an import, call or use (${model.lines.length - codeOnly} that Wonder named too)` },
              { mark: "dotted", label: `Two tag collars: found by plain code only, Wonder did not name it (${codeOnly})` },
              { mark: "lit", label: "The part you picked and its lines; the rest steps back" },
            ]}
            caption={`Drawn only from Atlas's checked outline of ${model.source}${model.commit ? ` at commit ${model.commit.slice(0, 7)}` : ""} (${model.files.length} files). Muse Wonder (${model.model}) proposed the parts and joins and wrote every name and purpose; plain code checked them against the files. A box is a part whose lines plain code confirmed; it is as tall as the lines it covers, and its plate shows Wonder's name for it. A steel line is a join plain code found: thick for calls, thin for imports and uses, braided for type-only imports (${typeOnly}, no link at run time). "Lines confirmed" means the lines exist where Wonder said; it does not mean Wonder's sentence about a part is true.`}
          >
            <div
              className="iso-stage ex-stage"
              ref={stageRef}
              tabIndex={0}
              role="group"
              aria-label="Code explorer machine. Use left and right arrows to pick a part; Escape clears."
              onPointerOver={pickFrom}
              onClick={pickFrom}
              onKeyDown={onKey}
              data-testid="explorer-stage"
              dangerouslySetInnerHTML={{ __html: built.fig.svg }}
            />
          </Plate>
        ) : (
          <div className="card notice" role="note" data-testid="explorer-not-drawn">
            <p className="label">Fig X2 · not drawn</p>
            <p>{built.error}</p>
          </div>
        )}
      </div>
      <div className="ex-aside">
        <PartCard model={model} box={box} onPick={(id) => { touched.current = true; setPicked(id); }} {...(onBet ? { onBet } : {})} {...(betUnavailable ? { betUnavailable } : {})} betBusy={betBusy} />
        <Lists model={model} />
      </div>
    </div>
    </div>
  );
}

function PartCard({ model, box, onPick, onBet, betUnavailable, betBusy }: { model: ExplorerModel; box: Box | null; onPick: (id: string) => void; onBet?: (c: BetChoice, b: Box) => void; betUnavailable?: string; betBusy: string | null }) {
  if (!box)
    return (
      <section className="ex-card" aria-label="part" data-testid="part-card">
        <p className="ex-card-label">Pick a box</p>
        <p className="ex-muted">Hover, click or Tab to a box to see its part: the name and purpose sentence Muse Wonder ({model.model}) wrote, the real file lines plain code confirmed, its joins, and the functions you can bet on.</p>
      </section>
    );
  const names = new Map(model.boxes.map((b) => [b.id, b.name.text]));
  return (
    <section className="ex-card" aria-label="part" aria-live="polite" data-testid="part-card">
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
            <span>{`${j.kind} ${j.dir === "out" ? "→" : "←"} `}</span>
            {names.has(j.other) ? (
              <button type="button" className="ex-join-btn" onClick={() => onPick(j.other)}>
                {names.get(j.other)}
              </button>
            ) : (
              <span>{j.other}</span>
            )}{" "}
            <span className="ex-status" data-s={j.status}>
              {j.drawn ? (j.status === "code-only" ? "line with tag collars" : j.typeOnly ? "braided line" : "steel line") : "no line"}
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
    </section>
  );
}

function Lists({ model }: { model: ExplorerModel }) {
  const names = new Map(model.boxes.map((b) => [b.id, b.name.text]));
  const nameOf = (id: string) => names.get(id) ?? id;
  return (
    <section className="ex-side" aria-label="joins not drawn" data-testid="chalk-list">
      <h2>Not drawn as lines</h2>
      <p className="ex-muted">Joins only Muse Wonder ({model.model}) states, with the parts named in its words. A chalk tag is not a connection.</p>
      <ul className="ex-chalks">
        {model.chalk.length === 0 ? <li className="ex-muted">None: plain code found every join Wonder named.</li> : null}
        {model.chalk.map((c) => (
          <li className="ex-chalk" key={c.id} data-chalk={c.id}>
            <span className="ex-chalk-tag">{`${nameOf(c.from)} → ${nameOf(c.to)} · ${c.kind}`}</span> <span className="ex-chalk-words">{`${c.words}.${c.reason && c.reason !== c.words ? ` ${c.reason}` : ""}`}</span>
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
