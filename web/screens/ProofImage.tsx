// D60: the proof card's image, one 16:9 picture: it is also the film's end frame and the link preview. It is an inline SVG in the
// page, so what you see is exactly what Copy image gives. The moment's two lines, the marks in one row, the three bettors by
// Meta's model names, "Judged by plain code", the mark's note (D21), the run id and a short hash.

import { useRef, useState } from "react";
import { MARK_PRE_EXISTING_CAPTION } from "../../src/captions";
import { theoryCaptions } from "../../src/change";
import { momentOfRows } from "../../src/moment";
import type { AtlasFile } from "../../src/types";
import type { Api } from "../api";
import { Mark } from "../machines/scoreboard/Scoreboard";
import { scoreboardMarks } from "../machines/scoreboard/marks";
import { plainField } from "./ProofCard";
import { bettorLineWords, type bettorLines, type proofCardModel } from "./proofcard-model";

const W = 1280;
const H = 720;
const SANS = `"Geist",ui-sans-serif,system-ui,sans-serif`;
const MONO = `"Geist Mono",ui-monospace,Menlo,monospace`;

/** Lines of about `n` characters, on spaces. Geist Mono is exactly fixed-width, so for the run's fact this is exact. */
function wrap(text: string, n: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > n) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  if (out.length > max) {
    const kept = out.slice(0, max);
    kept[max - 1] = `${kept[max - 1]!.slice(0, n - 1)}…`;
    return kept;
  }
  return out;
}

/** The SVG as a file: its styles written on each element, the two fonts inside it. */
async function asFile(svg: SVGSVGElement): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const t = to[i] as SVGElement;
    for (const k of ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "opacity", "color"]) t.setAttribute(k, cs.getPropertyValue(k));
  });
  const font = async (url: string, family: string) => {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");font-weight:100 900}`;
  };
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = (await font("/fonts/geist-latin-wght.woff2", "Geist")) + (await font("/fonts/geist-mono-latin-wght.woff2", "Geist Mono"));
  copy.prepend(style);
  copy.setAttribute("width", String(W * 2));
  copy.setAttribute("height", String(H * 2));
  return new XMLSerializer().serializeToString(copy);
}

async function asPng(svg: SVGSVGElement): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([await asFile(svg)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, no) => {
      img.onload = () => ok();
      img.onerror = () => no(new Error("the image could not be drawn"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = W * 2;
    c.height = H * 2;
    c.getContext("2d")!.drawImage(img, 0, 0, W * 2, H * 2);
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** D63, said before anything is written. A placeholder for Dami's final words. */
export const KEEP_WORDS = "This makes a public link: anyone with it can read this card for 30 days. The file's text is left out, but the values it returned or threw and the AI bettors' reasons stay on the card, and those can quote your code. You can delete the link.";

export interface ProofImageProps {
  card: ReturnType<typeof proofCardModel>;
  file: AtlasFile;
  lines: ReturnType<typeof bettorLines>;
  names: Record<string, string>;
  api?: Pick<Api, "keepProof" | "unkeepProof">;
  download?: string;
  downloadName?: string;
  /** The label PRE-EXISTING.md requires on anything showing that code. */
  preExisting?: string | null;
  /** Whoever is looking did not place this bet. An image the bettor copies keeps "you". */
  stranger?: boolean;
}

export function ProofImage({ card, file, lines, names, api, download, downloadName, preExisting = null, stranger = false }: ProofImageProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [keptUntil, setKeptUntil] = useState<string | null>((file as { keptCard?: { until: string } }).keptCard?.until ?? null);
  const run = file.runs[0];
  const rows = card.bets.map((b) => ({ who: b.who, name: b.who === "human" ? (names.human ?? "You") : (names[b.who] ?? b.who), measures: b.measures, question: plainField(b.measures), said: b.said, observed: b.observed, outcome: b.outcome ?? null }));
  const moment = run ? momentOfRows(rows, run, file.target.language) : null;
  const marks = scoreboardMarks(file.verdicts, file.bets);
  const exp = file.experiments[0];
  // A title per kind of round: the image travels alone, so it has to say what it is about.
  const title = exp?.params.shape === "call-function" ? exp.params.exportName : run?.runner === "evm" ? "Moonwell MIP-X43: 1 cbETH, on a Base fork" : exp?.params.shape === "retry-scenario" ? "withRpcRetry" : "pasted code";
  const unitless = moment !== null && /^[\d,.]+$/.test(moment.run.trim());
  const runWords = moment ? (unitless && moment.measures ? `${moment.run} (${plainField(moment.measures)})` : moment.run) : "";
  const runLines = moment ? wrap(runWords, 42, 3) : [];
  const youLines = moment?.you ? wrap(unitless && moment.measures ? `${moment.you} (${plainField(moment.measures)})` : moment.you, 72, 2) : [];
  // D20: this image can travel alone, so what it shows and what the change was are on it.
  const beforeChange = file.change ? "This shows the run before the change." : null;
  const theory = theoryCaptions(file.change);
  const hash = (file.bets[0]?.sealedHash ?? "").slice(0, 10);
  const copyImage = async () => {
    if (!ref.current) return;
    try {
      const blob = await asPng(ref.current);
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setSaid("The image is on your clipboard.");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${card.runId}.png`;
        a.click();
        setSaid("This browser can't copy images, so it was downloaded.");
      }
    } catch (e) {
      setSaid(`The image could not be made: ${(e as Error).message}`);
    }
  };
  const link = () => `${location.origin}${location.pathname}?proof=${encodeURIComponent(card.runId)}`;
  /** The clipboard may refuse: then the link is shown, never "copied". */
  const toClipboard = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(link());
      return true;
    } catch {
      return false;
    }
  };
  // Someone reading a shared card can pass its link on. Making a link is for the person who ran the round.
  const reader = (file as { sourceWithheld?: boolean }).sourceWithheld === true && !keptUntil;
  const copied = (ok: boolean, rest: string) => setSaid(ok ? `Link copied. ${rest}`.trim() : `Copy this link: ${link()} ${rest}`.trim());
  const makeLink = async () => {
    setAsking(false);
    const a = await (api?.keepProof(card.runId) ?? Promise.resolve({ kept: false, words: undefined as string | undefined })).catch(() => ({ kept: false, words: "the server could not be reached" }));
    const ok = await toClipboard();
    if (a.kept) {
      setKeptUntil((a as { until?: string }).until ?? "kept");
      copied(ok, "Anyone with it can read this card for 30 days.");
    } else copied(ok, `No public link was made: ${a.words ?? "this server keeps no cards"}. This address works only while the round is on the server: up to 2 hours.`);
  };
  const copyLink = async () => {
    if (keptUntil || reader || !api) return copied(await toClipboard(), "");
    setAsking(true);
  };
  const deleteLink = async () => {
    const ok = await api?.unkeepProof(card.runId).catch(() => false);
    if (ok) {
      setKeptUntil(null);
      setSaid("The public link is deleted.");
    } else setSaid("The link could not be deleted.");
  };
  if (!moment) return null;
  // The picture closes up around however many lines the run takes.
  const runEnd = 238 + runLines.length * 56;
  const changeY = runEnd + 26;
  const marksY = runEnd + (beforeChange || theory.length > 0 ? 44 : 24);
  const shownMarks = marks.slice(0, 8);
  return (
    <section className="pc-image-wrap" aria-label="the proof card as one image" data-testid="pc-image">
      <svg ref={ref} className="pc-image" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: you bet ${moment.you ?? "nothing"}; the run ${moment.run}`} xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width={W} height={H} fill="#f5f1e7" />
        <text x="56" y="70" fontFamily={SANS} fontWeight="600" fontSize="22" fill="#1f1b1d">Atlas</text>
        <text x="130" y="70" fontFamily={MONO} fontWeight="500" fontSize="22" fill="#1f1b1d">{title.slice(0, 44)}</text>
        <text x={W - 56} y="70" textAnchor="end" fontFamily={MONO} fontSize="16" fill="#6b6358">{`run ${card.runId}`}</text>
        <line x1="56" x2={W - 56} y1="96" y2="96" stroke="#dcd4c3" />
        {youLines.length > 0 && (
          <>
            <text x="56" y="132" fontFamily={SANS} fontWeight="500" fontSize="16" letterSpacing=".6" fill="#6b6358">{stranger ? "THE BET" : "YOU BET"}</text>
            {youLines.map((l, i) => (
              <text key={i} x="56" y={162 + i * 26} fontFamily={MONO} fontWeight="500" fontSize="22" fill="#1f1b1d">{l}</text>
            ))}
          </>
        )}
        <rect x="56" y="206" width="5" height={32 + runLines.length * 56} fill={moment.kind === "not_matched" ? "#b5372c" : moment.kind === "matched" ? "#2c5f9e" : "#1f1b1d"} />
        <text x="80" y="226" fontFamily={SANS} fontWeight="500" fontSize="16" letterSpacing=".6" fill="#6b6358">THE RUN</text>
        {runLines.map((l, i) => (
          <text key={i} x="80" y={274 + i * 56} fontFamily={MONO} fontWeight="500" fontSize="44" letterSpacing="-1" fill="#1f1b1d">{l}</text>
        ))}
        <g color="#1f1b1d">
          {shownMarks.map((m, i) => (
            <g key={m.key} transform={`translate(${56 + i * 118} ${marksY})`}>
              <svg x="0" y="0" width="100" height="100" viewBox="0 0 100 100">
                <Mark mark={m} still names={names} size={100} />
              </svg>
            </g>
          ))}
        </g>
        <text x="56" y={marksY + 124} fontFamily={SANS} fontSize="15" fill="#6b6358">{"One mark per question, a dot for each bettor (solid: the person). A line reaching the bar: matched. Stopping short: didn't match. Dashed: can't check."}</text>
        {lines.slice(0, 3).map((l, i) => (
          <text key={l.who} x="56" y={marksY + 156 + i * 25} fontFamily={SANS} fontSize="17" fill="#1f1b1d">
            {`${l.who === "human" ? (names.human ?? "You") : (names[l.who] ?? l.who).replace(/ · via .*$/, "")}: ${bettorLineWords(l)}`.slice(0, 110)}
          </text>
        ))}
        <text x={W - 56} y="628" textAnchor="end" fontFamily={SANS} fontWeight="500" fontSize="16" fill="#1f1b1d">Judged by plain code</text>
        <text x={W - 56} y="652" textAnchor="end" fontFamily={MONO} fontSize="14" fill="#6b6358">{hash ? `sealed ${hash}` : ""}</text>
        {(beforeChange || theory.length > 0) && (
          <text x="56" y={changeY} fontFamily={SANS} fontWeight="500" fontSize="15" fill="#6b4d00" data-testid="pc-image-change">{[beforeChange, ...theory].filter(Boolean).join(" ").slice(0, 170)}</text>
        )}
        <text x="56" y="694" fontFamily={SANS} fontSize="14" fill="#6b6358">{MARK_PRE_EXISTING_CAPTION}</text>
        {preExisting && <text x={W - 56} y="694" textAnchor="end" fontFamily={SANS} fontWeight="500" fontSize="13" fill="#6b4d00">{preExisting.length > 62 ? "Pre-existing code: listed in PRE-EXISTING.md" : preExisting}</text>}
      </svg>
      <div className="pc-share">
        <button type="button" className="u1-btn" onClick={() => void copyImage()} data-testid="pc-copy-image">Copy image</button>
        <button type="button" className="u1-btn" onClick={() => void copyLink()} data-testid="pc-copy-link">Copy link</button>
        {download && (
          <a className="u1-btn pc-dl" href={download} download={downloadName} data-testid="pc-download-top">Download file</a>
        )}
        {keptUntil && api && !reader && (
          <button type="button" className="u1-btn" onClick={() => void deleteLink()} data-testid="pc-delete-link">Delete public link</button>
        )}
        {asking && (
          <div className="pc-ask" role="group" aria-label="Make a public link" data-testid="pc-link-ask">
            <p>{KEEP_WORDS}</p>
            <button type="button" className="u1-btn u1-primary" onClick={() => void makeLink()} data-testid="pc-link-yes">Make the public link</button>
            <button type="button" className="u1-btn" onClick={() => setAsking(false)} data-testid="pc-link-no">Not now</button>
          </div>
        )}
        {said && <span className="u1-sub" role="status" data-testid="pc-share-said">{said}</span>}
      </div>
    </section>
  );
}
