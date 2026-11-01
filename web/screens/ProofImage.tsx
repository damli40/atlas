// D60: the proof card's image, one 16:9 picture: it is also the film's end frame and the link preview. It is an inline SVG in the
// page, so what you see is exactly what Copy image gives. The moment's two lines, the marks in one row, the three bettors by
// Meta's model names, "Judged by plain code", the mark's note (D21), the run id and a short hash.

import { useRef, useState } from "react";
import { MARK_PRE_EXISTING_CAPTION } from "../../src/captions";
import { momentOfRows } from "../../src/moment";
import type { AtlasFile } from "../../src/types";
import type { Api } from "../api";
import { Mark } from "../machines/scoreboard/Scoreboard";
import { scoreboardMarks } from "../machines/scoreboard/marks";
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

export interface ProofImageProps {
  card: ReturnType<typeof proofCardModel>;
  file: AtlasFile;
  lines: ReturnType<typeof bettorLines>;
  names: Record<string, string>;
  api?: Pick<Api, "keepProof">;
  download?: string;
  downloadName?: string;
  /** The label PRE-EXISTING.md requires on anything showing that code. */
  preExisting?: string | null;
}

export function ProofImage({ card, file, lines, names, api, download, downloadName, preExisting = null }: ProofImageProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const run = file.runs[0];
  const rows = card.bets.map((b) => ({ who: b.who, name: b.who === "human" ? "You" : (names[b.who] ?? b.who), measures: b.measures, question: b.measures, said: b.said, observed: b.observed, outcome: b.outcome ?? null }));
  const moment = run ? momentOfRows(rows, run) : null;
  const marks = scoreboardMarks(file.verdicts, file.bets).slice(0, 6);
  const exp = file.experiments[0];
  const title = exp?.params.shape === "call-function" ? exp.params.exportName : file.target.kind === "pasted" ? "pasted code" : "the proposal";
  const runLines = moment ? wrap(moment.run, 42, 3) : [];
  const youLine = moment?.you ? wrap(moment.you, 70, 1)[0]! : null;
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
  const copyLink = async () => {
    const link = `${location.origin}${location.pathname}?proof=${encodeURIComponent(card.runId)}`;
    const kept = await (api?.keepProof(card.runId) ?? Promise.resolve({ kept: false as boolean, words: undefined as string | undefined })).catch(() => ({ kept: false, words: undefined }));
    await navigator.clipboard?.writeText(link).catch(() => {});
    setSaid(kept.kept ? "Link copied. Anyone with it can read this card. Your code stays out of it." : `Link copied. ${kept.words ?? "It lasts until this server restarts."}`);
  };
  if (!moment) return null;
  return (
    <section className="pc-image-wrap" aria-label="the proof card as one image" data-testid="pc-image">
      <svg ref={ref} className="pc-image" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: you bet ${moment.you ?? "nothing"}; the run ${moment.run}`} xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width={W} height={H} fill="#f5f1e7" />
        <text x="56" y="70" fontFamily={SANS} fontWeight="600" fontSize="22" fill="#1f1b1d">Atlas</text>
        <text x="130" y="70" fontFamily={MONO} fontWeight="500" fontSize="22" fill="#1f1b1d">{title.slice(0, 44)}</text>
        <text x={W - 56} y="70" textAnchor="end" fontFamily={MONO} fontSize="16" fill="#6b6358">{`run ${card.runId}`}</text>
        <line x1="56" x2={W - 56} y1="96" y2="96" stroke="#dcd4c3" />
        {youLine && (
          <>
            <text x="56" y="142" fontFamily={SANS} fontWeight="500" fontSize="16" letterSpacing=".6" fill="#6b6358">YOU BET</text>
            <text x="56" y="176" fontFamily={MONO} fontWeight="500" fontSize="24" fill="#1f1b1d">{youLine}</text>
          </>
        )}
        <rect x="56" y="206" width="5" height={32 + runLines.length * 56} fill={moment.kind === "not_matched" ? "#b5372c" : moment.kind === "matched" ? "#2c5f9e" : "#1f1b1d"} />
        <text x="80" y="226" fontFamily={SANS} fontWeight="500" fontSize="16" letterSpacing=".6" fill="#6b6358">THE RUN</text>
        {runLines.map((l, i) => (
          <text key={i} x="80" y={274 + i * 56} fontFamily={MONO} fontWeight="500" fontSize="44" letterSpacing="-1" fill="#1f1b1d">{l}</text>
        ))}
        <g color="#1f1b1d">
          {marks.map((m, i) => (
            <g key={m.key} transform={`translate(${56 + i * 112} 450)`}>
              <svg x="0" y="0" width="92" height="92" viewBox="0 0 100 100">
                <Mark mark={m} still names={names} size={92} />
              </svg>
            </g>
          ))}
        </g>
        <text x="56" y="566" fontFamily={SANS} fontSize="14" fill="#6b6358">{"One mark per question, a dot for each bettor (solid: you). A line reaching the bar: matched. Stopping short: didn't match. Dashed: can't check."}</text>
        {lines.slice(0, 3).map((l, i) => (
          <text key={l.who} x="56" y={604 + i * 24} fontFamily={SANS} fontSize="16" fill="#1f1b1d">
            {`${l.who === "human" ? "You" : (names[l.who] ?? l.who).replace(/ · via .*$/, "")}: ${bettorLineWords(l)}`.slice(0, 110)}
          </text>
        ))}
        <text x={W - 56} y="628" textAnchor="end" fontFamily={SANS} fontWeight="500" fontSize="16" fill="#1f1b1d">Judged by plain code</text>
        <text x={W - 56} y="652" textAnchor="end" fontFamily={MONO} fontSize="14" fill="#6b6358">{hash ? `sealed ${hash}` : ""}</text>
        <text x="56" y="694" fontFamily={SANS} fontSize="12.5" fill="#6b6358">{MARK_PRE_EXISTING_CAPTION}</text>
        {preExisting && <text x={W - 56} y="694" textAnchor="end" fontFamily={SANS} fontWeight="500" fontSize="12.5" fill="#6b4d00">{preExisting.slice(0, 64)}</text>}
      </svg>
      <div className="pc-share">
        <button type="button" className="u1-btn" onClick={() => void copyImage()} data-testid="pc-copy-image">Copy image</button>
        <button type="button" className="u1-btn" onClick={() => void copyLink()} data-testid="pc-copy-link">Copy link</button>
        {download && (
          <a className="u1-btn pc-dl" href={download} download={downloadName} data-testid="pc-download-top">Download file</a>
        )}
        {said && <span className="u1-sub" role="status" data-testid="pc-share-said">{said}</span>}
      </div>
    </section>
  );
}
