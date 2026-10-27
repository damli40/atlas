// D04-04: where in the code to look. Two ways to choose the place a round works on:
// 1. Ask the Investigator (muse-wonder-1.0). Each place it returns was checked by plain code
//    against the file Atlas read ("checked against the file ✓"). The model's own sentence about the
//    place (its claim) is shown ONLY in the model panel below the list, labelled as the model's words.
//    It is never sent to the other model that bets (D18) and never part of a verdict.
// 2. Pick the lines yourself (pull requests): read the file, choose the lines; plain code checks
//    they exist. The round then records the finding as proposed by a person.

import { useState } from "react";
import type { Finding, Target } from "../../src/types";
import type { Api, InvestigateAnswer, PrTarget } from "../api";
import { fileLines } from "../../src/words";
import { costText, priceConfirmed } from "../../src/cost";

const MODEL_NAME: Record<string, string> = { "muse-wonder-1.0": "Muse Wonder 1.0 (muse-wonder-1.0)", "muse-spark-1.3": "Muse Spark 1.3 (muse-spark-1.3)" };
const modelName = (m: string) => MODEL_NAME[m] ?? m;

export function placeOf(f: Pick<Finding, "file" | "lineStart" | "lineEnd">): string {
  return fileLines(f.file, f.lineStart, f.lineEnd);
}

export interface FindingsProps {
  api: Api;
  target: Target | PrTarget | null;
  chosen: Finding | null;
  onChoose: (f: Finding) => void;
  /** Locked once the round's question is out. */
  locked: boolean;
  /** Pull requests: show "pick the lines yourself". */
  allowPick?: boolean;
}

export function FindingsPanel({ api, target, chosen, onChoose, locked, allowPick }: FindingsProps) {
  const [answer, setAnswer] = useState<InvestigateAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!target) return;
    setAsking(true);
    setError(null);
    try {
      setAnswer(await api.investigate(target));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <section className="card" aria-label="findings" data-testid="findings">
      <h2>Where could expectations break?</h2>
      {!answer && (
        <button type="button" onClick={ask} disabled={!target || asking || locked}>
          Ask the Investigator ({modelName("muse-wonder-1.0")})
        </button>
      )}
      {asking && (
        <p className="running" role="status">
          {modelName("muse-wonder-1.0")} is reading the code…
        </p>
      )}
      {answer && !answer.ok && (
        <p className="notice" data-testid="findings-none">
          {modelName(answer.model)}: no usable answer ({answer.reason ?? "no reason given"}).
        </p>
      )}
      {answer && answer.ok && (
        <>
          <p className="muted small">
            Found by {modelName(answer.model)}
            {answer.fellBack ? " (fallback model)" : ""}. Each place was checked by plain code against the file Atlas read.
            {/* Final review S7: a price Atlas has not confirmed (Muse Spark, used as the fallback) makes the figure an upper bound. */}
            {answer.usage ? ` Cost ${costText(answer.usage.usd, priceConfirmed(answer.model) && !answer.fellBack)}.` : ""}
          </p>
          <ul className="findings" data-testid="findings-list">
            {answer.findings.map((f) => (
              <li key={f.id} data-testid={`finding-${f.id}`} className={chosen?.id === f.id ? "chosen" : undefined}>
                <code>{placeOf(f)}</code> · {f.kind} · <span className="ok">checked against the file ✓</span> · {f.proposedBy.model}{" "}
                <button type="button" onClick={() => onChoose(f)} disabled={locked || chosen?.id === f.id}>
                  {chosen?.id === f.id ? "Chosen" : "Use this place"}
                </button>
              </li>
            ))}
          </ul>
          {answer.dropped.length > 0 && (
            <div className="muted small" data-testid="dropped-places">
              <p>{answer.dropped.length} place(s) removed by plain code:</p>
              <ul>
                {answer.dropped.map((d, i) => (
                  <li key={i}>
                    <code>{d.file}:{d.lineStart}–{d.lineEnd}</code>: {d.reason.replace(/^removed: /, "")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="model-panel" data-testid="investigator-panel">
            <h3>Model panel: what {modelName(answer.model)} said</h3>
            <p className="muted small">The model's own words about each place. Not a verdict, and not shown to the model that bets.</p>
            <ul className="seals">
              {answer.findings.map((f) => (
                <li key={f.id}>
                  <code>{placeOf(f)}</code>: "{f.claim}"
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {allowPick && target && "files" in target && <PickLines api={api} target={target} onChoose={onChoose} locked={locked} chosen={chosen} />}
      {chosen && (
        <p data-testid="chosen-finding">
          This round works on <code>{placeOf(chosen)}</code> ({chosen.proposedBy.role === "human" ? "picked by you" : `found by ${chosen.proposedBy.model}`}).
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PickLines({ api, target, onChoose, locked, chosen }: { api: Api; target: PrTarget; onChoose: (f: Finding) => void; locked: boolean; chosen: Finding | null }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(target.files.find((f) => f.path.endsWith("ChainlinkOracleConfigs.sol"))?.path ?? target.files[0]?.path ?? "");
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const text = target.files.find((f) => f.path === file)?.text ?? "";
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();

  const click = (n: number) => {
    if (from === null || to !== from || n < from) {
      setFrom(n);
      setTo(n);
    } else setTo(n);
  };
  const use = async () => {
    if (from === null || to === null) return;
    setError(null);
    try {
      onChoose(await api.pickLines(target, file, from, to));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="pick" data-testid="pick-lines">
      <h3>Or pick the lines yourself</h3>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} disabled={locked}>
          Read the files and pick lines
        </button>
      ) : (
        <>
          <label className="muted small">
            File{" "}
            <select data-testid="pick-file" value={file} onChange={(e) => (setFile(e.target.value), setFrom(null), setTo(null))} disabled={locked}>
              {target.files.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">Click a line to start; click a later line to end the range.</p>
          <pre className="code" data-testid="pick-code" tabIndex={0} aria-label="the file's lines">
            {lines.map((l, i) => {
              const n = i + 1;
              const sel = from !== null && to !== null && n >= from && n <= to;
              return (
                <div key={n} className={sel ? "line sel" : "line"} data-line={n} onClick={() => !locked && click(n)}>
                  <span className="ln">{n}</span>
                  {l || " "}
                </div>
              );
            })}
          </pre>
          <button type="button" data-testid="pick-use" onClick={use} disabled={locked || from === null || (chosen?.proposedBy.role === "human" && chosen.file === file && chosen.lineStart === from && chosen.lineEnd === to)}>
            {from === null ? "Choose lines first" : `Use ${placeOf({ file, lineStart: from, lineEnd: to ?? from })}`}
          </button>
          {error && <p className="notice">{error}</p>}
        </>
      )}
    </div>
  );
}
