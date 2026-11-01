// R3: words made safe to draw, and measured in the real font. Pure; no I/O.
//
// Plain words: names come from code a stranger pasted, so they may hold newlines, right-to-left overrides, invisible
// characters or a thousand letters. Before anything is drawn, hidden characters are shown as a dot, runs of space become
// one space, and long text is cut with an ellipsis (the whole name stays in the tooltip and the list).

import { METRICS } from "./metrics";

/** Bidi controls, zero-width characters, line and paragraph separators, other control characters. */
const HIDDEN = new RegExp("[\\u0000-\\u0008\\u000e-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\ufeff\\ufff9-\\ufffb]", "g");

/** The most characters of any one text that are ever measured or drawn. */
export const MAX_CHARS = 400;

export function cleanWords(raw: string): string {
  const breaks = new RegExp("[\\t\\n\\v\\f\\r\\u0085\\u2028\\u2029]+", "g");
  const s = String(raw).replace(breaks, " ").replace(HIDDEN, "·").replace(/ {2,}/g, " ").trim();
  const chars = Array.from(s);
  return chars.length > MAX_CHARS ? `${chars.slice(0, MAX_CHARS - 1).join("")}…` : s;
}

/** A spec id as a plain-ASCII attribute value, whatever the id holds; the player and the checks turn it back. */
export function idAttr(id: string): string {
  try {
    return encodeURIComponent(id);
  } catch {
    // A lone half of a surrogate pair: not valid text, so it cannot be encoded as it is.
    return encodeURIComponent(Array.from(id, (c) => (c.length === 1 && c >= "\ud800" && c <= "\udfff" ? "?" : c)).join(""));
  }
}
export const idFromAttr = (a: string): string => decodeURIComponent(a);

/** Escapes text for SVG or HTML, in text or inside a quoted attribute. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type Face = "regular" | "italic";
/** Extra space between letters, as a share of the font size, per face. The drawing's CSS uses the same numbers. */
export const TRACKING: Record<Face, number> = { regular: 0.022, italic: 0.012 };

/** How wide the text is at this size, in the font the page draws it in. A character outside the font gets a fair guess. */
export function textWidth(text: string, size: number, face: Face): number {
  const table = METRICS[face];
  let w = 0;
  let n = 0;
  for (const ch of text) {
    n++;
    const known = table[ch];
    if (known !== undefined) w += known;
    else w += (ch.codePointAt(0) ?? 0) >= 0x1100 ? 1000 : 640;
  }
  return (w / 1000) * size + TRACKING[face] * size * Math.max(0, n - 1);
}

/** Splits at spaces and, for one long word, inside it (camelCase humps, then anywhere). */
function pieces(word: string, max: number, size: number, face: Face): string[] {
  if (textWidth(word, size, face) <= max) return [word];
  const out: string[] = [];
  let cur = "";
  for (const ch of word) {
    const hump = cur.length > 3 && /[a-z0-9]$/.test(cur) && /[A-Z]/.test(ch) && textWidth(cur, size, face) > max * 0.55;
    if (hump || textWidth(cur + ch, size, face) > max) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Lines at most `max` wide, at most `maxLines` of them; the last gets an ellipsis if text was left over. */
export function wrapWords(text: string, max: number, size: number, face: Face, maxLines: number): string[] {
  const words = text.split(" ").flatMap((w) => pieces(w, max, size, face));
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size, face) > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.length ? lines : [""];
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last.length > 1 && textWidth(`${last}…`, size, face) > max) last = Array.from(last).slice(0, -1).join("");
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}
