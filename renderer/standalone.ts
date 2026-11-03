// R13: a drawing as a file that stands on its own. Pure: the caller hands in the fonts (server/drawing.ts reads them). The drawing
// itself comes from the same pure code the page uses (renderer/authors/machine.ts for the machine, renderer/live/draw.ts for the chart).
//
// Plain words:
// - On the page, the drawing's colours and lines come from a stylesheet (MACHINE_CSS, RENDERER_CSS). A file opened on its own
//   has no page around it, so every class's look is written onto each element as plain SVG attributes (fill, stroke, ...).
//   Only the "resting" look is copied: hover, focus and run states (rules with [data-...], :hover, descendants) are left out,
//   because a still picture has no pointer and no run.
// - The page's fonts go inside the file (base64, given by the caller), so the words keep the widths plain code measured them at.
// - A caption band under the drawing says what it is and where it came from, in words. When a lid carries a name Meta's AI
//   wrote, the caption carries the same legend the page shows (NAMER_WORDS.legend).
import { MACHINE_CSS } from "./machine/pencil";
import { RENDERER_CSS } from "./live/style";
import { esc, wrapWords } from "./words";

/** The SVG attributes a class's look may set. Anything else in the stylesheet (cursor, transition, outline) is for the live page. */
const PRESENTATION = new Set(["fill", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "font-family", "font-style", "font-weight", "letter-spacing", "visibility"]);

interface Rule {
  classes: string[];
  props: [string, string][];
  order: number;
}

/** The light theme's colours, from the page's own stylesheet (the `.rr-host` rule). */
export function themeVars(css = RENDERER_CSS): Map<string, string> {
  const host = /\.rr-host\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const vars = new Map<string, string>();
  for (const m of host.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) vars.set(m[1]!, m[2]!.trim());
  return vars;
}

/** The stylesheet's plain class rules (`.a`, `.a.b`, and lists of them), with every var() replaced by its light-theme value. */
export function classRules(css: string, vars: Map<string, string>): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props: [string, string][] = [];
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const name = d.slice(0, i).trim();
      if (!PRESENTATION.has(name)) continue;
      const value = d.slice(i + 1).trim().replace(/var\((--[\w-]+)\)/g, (_, v: string) => vars.get(v) ?? "currentColor");
      props.push([name, value]);
    }
    if (props.length === 0) continue;
    for (const sel of m[1]!.split(",")) {
      const s = sel.trim();
      if (!/^(\.[A-Za-z0-9_-]+)+$/.test(s)) continue; // states and descendants are the live page's
      rules.push({ classes: s.slice(1).split("."), props, order: order++ });
    }
  }
  // CSS: more classes win; then the later rule.
  return rules.sort((a, b) => a.classes.length - b.classes.length || a.order - b.order);
}

const attrValue = (v: string) => esc(v.replace(/"/g, "'"));

/** Writes each element's class look onto it as attributes. Elements without a class are left as they are. */
export function flattenClasses(svg: string, rules: Rule[]): string {
  return svg.replace(/<([a-zA-Z][\w-]*)(\s[^<>]*?)?(\/?)>/g, (whole, tag: string, attrs: string | undefined, self: string) => {
    if (!attrs) return whole;
    const cls = /\sclass="([^"]*)"/.exec(attrs)?.[1];
    if (!cls) return whole;
    const mine = new Set(cls.split(/\s+/).filter(Boolean));
    const look = new Map<string, string>();
    for (const r of rules) if (r.classes.every((c) => mine.has(c))) for (const [k, v] of r.props) look.set(k, v);
    if (look.size === 0) return whole;
    let out = attrs;
    for (const [k, v] of look) {
      const re = new RegExp(`\\s${k}="[^"]*"`);
      out = re.test(out) ? out.replace(re, ` ${k}="${attrValue(v)}"`) : `${out} ${k}="${attrValue(v)}"`;
    }
    return `<${tag}${out}${self}>`;
  });
}

const SHEET_CSS = MACHINE_CSS + RENDERER_CSS;
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/**
 * One SVG file: the drawing (an `<svg>` from the machine or the chart, with its own viewBox), its look written on every element,
 * the fonts inside, and a caption band underneath. `caption` lines are plain words; each is wrapped to the picture's width.
 */
export function standaloneSvg(o: { drawing: string; width: number; height: number; title: string; caption: string[]; /** @font-face rules for "Atlas Besley" and "Geist Mono"; empty: the words fall back to Georgia. */ fontCss?: string }): { svg: string; width: number; height: number } {
  const vars = themeVars();
  const paper = vars.get("--rr-paper") ?? "#f5f1e7";
  const ink = vars.get("--rr-ink") ?? "#1f1b1d";
  const soft = vars.get("--rr-soft") ?? "#5d5650";
  const pad = 24;
  const w = Math.max(640, Math.ceil(o.width) + pad * 2);
  const size = 15;
  const lines = o.caption.flatMap((c, i) => wrapWords(c, w - pad * 2, i === 0 ? size + 1 : size, i === 0 ? "regular" : "italic", 3).map((t) => ({ t, first: i === 0 })));
  const band = lines.length * (size + 7) + pad;
  const h = Math.ceil(o.height) + pad * 2 + band;
  // The drawing keeps its own viewBox; it is placed as a nested picture of its own size, with no interactive roles.
  const flat = flattenClasses(o.drawing, classRules(SHEET_CSS, vars));
  const rootEnd = flat.indexOf(">");
  if (!flat.startsWith("<svg") || rootEnd < 0) throw new Error("internal: a drawing is one <svg> element");
  // The root's own size goes; the nested picture gets the size and place given here (one width, one height: valid XML).
  const root = flat
    .slice(0, rootEnd)
    .replace(/\s(width|height|x|y)="[^"]*"/g, "")
    .replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `<svg x="${pad}" y="${pad}" width="${n1(o.width)}" height="${n1(o.height)}"`);
  const inner = (root + flat.slice(rootEnd))
    .replace(/ tabindex="-?\d+"/g, "")
    .replace(/ role="(button|group)"/g, "");
  const capY = Math.ceil(o.height) + pad * 2 + size;
  // The page's star (★) is not in the drawing's font, so a line that starts with it gets the lids' own star, drawn as a shape.
  const star = (x: number, y: number) => {
    const pts = Array.from({ length: 8 }, (_, k) => {
      const t = (k / 8) * Math.PI * 2;
      const d = k % 2 === 0 ? 5.5 : 1.8;
      return `${n1(x + Math.cos(t) * d)} ${n1(y + Math.sin(t) * d)}`;
    });
    return `<path d="M${pts.join("L")}Z" fill="#4a4f57"/>`;
  };
  const caption = lines
    .map((l, i) => {
      const y = capY + i * (size + 7);
      const starred = l.t.startsWith("\u2605 ");
      const text = starred ? l.t.slice(2) : l.t;
      return `${starred ? star(pad + 5, y - 5) : ""}<text x="${starred ? pad + 15 : pad}" y="${y}" font-family="'Atlas Besley',Georgia,serif" font-size="${l.first ? size + 1 : size}" font-style="${l.first ? "normal" : "italic"}" fill="${l.first ? ink : soft}">${esc(text)}</text>`;
    })
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.title)}">` +
    `<title>${esc(o.title)}</title><style>${(o.fontCss ?? "").replace(/<\//g, "")}</style>` +
    `<rect width="${w}" height="${h}" fill="${paper}"/>${inner}` +
    `<line x1="${pad}" x2="${w - pad}" y1="${Math.ceil(o.height) + pad * 2 - 6}" y2="${Math.ceil(o.height) + pad * 2 - 6}" stroke="${soft}" stroke-width="0.6" opacity="0.5"/>${caption}</svg>`;
  return { svg, width: w, height: h };
}
