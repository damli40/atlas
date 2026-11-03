// R13 review M2: is this SVG only what Atlas's drawing code writes? A strict reader, not a pattern match.
//
// Plain words: the picture comes from the Atlas server, and the plugin writes it into the person's project, where they may open
// it in a browser. A browser runs scripts in an SVG file, follows its links and loads what it points at. So the plugin reads the
// whole file as XML, element by element, and accepts it only if every element and attribute is one Atlas's renderer writes:
// - elements: the shapes, text and grouping the machine and the box chart use; nothing that can load, link, run or animate
//   (no script, foreignObject, a, image, use, feImage, animate, set, iframe...);
// - attributes: a fixed list, plus data-* labels; no namespace prefix at all (so no xlink:href and no a:script), no href, no on*;
// - values: a url( may only point inside the file (#id); no backslash anywhere in an attribute or the stylesheet;
// - the stylesheet: only the @font-face rules Atlas writes, with the fonts inline as base64;
// - no comments, CDATA, processing instructions or DOCTYPE (no entity tricks); entities limited to the five XML ones and
//   numeric ones, decoded before the values are checked.
// Text between tags (a file name in the caption, a function name) is never looked at as markup: it is text, already escaped.
// No dependency: Node has no XML parser, and the plugin installs nothing, so this reads the small subset itself.

const SVG_NS = "http://www.w3.org/2000/svg";

const ELEMENTS = new Set(["svg", "g", "title", "style", "defs", "rect", "path", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "pattern", "mask", "clipPath"]);
const ATTRIBUTES = new Set([
  "xmlns", "class", "id", "role", "aria-label", "viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "visibility",
  "font-family", "font-size", "font-style", "font-weight", "letter-spacing", "text-anchor", "dominant-baseline", "pathLength",
  "patternUnits", "maskUnits", "mask", "clip-path", "clipPathUnits", "tabindex", "focusable",
]);
/** Attributes that are only labels: a browser never styles, links or runs from them. */
const INERT = new Set(["aria-label", "class", "id", "role"]);
const FONT_FACE = /@font-face\{font-family:"(?:Atlas Besley|Geist Mono)";src:url\("data:font\/woff2;base64,[A-Za-z0-9+/]+=*"\) format\("woff2"\);font-style:(?:normal|italic);font-weight:400\}/y;

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const SPACE = /\s*/y;

function decode(raw: string): string | null {
  let bad = false;
  const out = raw.replace(/&([^;\s&]*);?/g, (m, body: string) => {
    if (!m.endsWith(";")) return ((bad = true), "");
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (body in named) return named[body]!;
    const num = /^#(\d{1,7})$/.exec(body) ?? null;
    const hex = /^#x([0-9a-fA-F]{1,6})$/.exec(body) ?? null;
    const code = num ? Number(num[1]) : hex ? parseInt(hex[1]!, 16) : NaN;
    if (!Number.isFinite(code) || code > 0x10ffff) return ((bad = true), "");
    return String.fromCodePoint(code);
  });
  return bad ? null : out;
}

/** Null when the SVG holds only what Atlas's renderer writes; otherwise the first reason it does not. */
export function svgProblem(svg: string): string | null {
  if (typeof svg !== "string" || svg.length === 0) return "empty";
  let i = 0;
  const stack: string[] = [];
  let sawRoot = false;
  const at = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(svg);
    if (m) i = re.lastIndex;
    return m;
  };
  while (i < svg.length) {
    const lt = svg.indexOf("<", i);
    const text = svg.slice(i, lt < 0 ? svg.length : lt);
    if (text.length > 0) {
      if (stack.length === 0) {
        if (text.trim() !== "") return "text outside the picture";
      } else {
      if (decode(text) === null) return "a broken entity in the text";
      // The only element whose text a browser reads as code is <style>: there, only Atlas's own font rules.
      if (stack[stack.length - 1] === "style") {
        let j = 0;
        while (j < text.length) {
          FONT_FACE.lastIndex = j;
          if (!FONT_FACE.exec(text)) return "a stylesheet that is not Atlas's font rules";
          j = FONT_FACE.lastIndex;
        }
      }
      }
    }
    if (lt < 0) break;
    i = lt;
    if (svg.startsWith("</", i)) {
      i += 2;
      const n = at(NAME);
      at(SPACE);
      if (!n || svg[i] !== ">") return "a broken closing tag";
      i += 1;
      if (stack.pop() !== n[0]) return "tags that do not match";
      continue;
    }
    if (svg.startsWith("<!", i) || svg.startsWith("<?", i)) return "a comment, CDATA, DOCTYPE or processing instruction";
    i += 1;
    const n = at(NAME);
    if (!n) return "a broken tag";
    const tag = n[0];
    if (tag.includes(":")) return `an element with a namespace prefix (${tag})`;
    if (!ELEMENTS.has(tag)) return `an element Atlas never writes (${tag})`;
    if (stack.length === 0) {
      if (sawRoot) return "more than one picture";
      if (tag !== "svg") return "a root that is not <svg>";
      sawRoot = true;
    }
    const seen = new Set<string>();
    for (;;) {
      const sp = at(SPACE);
      if (svg.startsWith("/>", i) || svg[i] === ">") break;
      if (!sp || sp[0] === "") return "a broken attribute list";
      const a = at(NAME);
      if (!a) return "a broken attribute";
      const name = a[0];
      if (svg[i] !== "=" || svg[i + 1] !== '"') return "an attribute without a double-quoted value";
      const end = svg.indexOf('"', i + 2);
      if (end < 0) return "an unclosed attribute value";
      const raw = svg.slice(i + 2, end);
      i = end + 1;
      if (raw.includes("<")) return "a < inside an attribute";
      if (seen.has(name)) return `a repeated attribute (${name})`;
      seen.add(name);
      if (name.includes(":")) return `an attribute with a namespace prefix (${name})`;
      if (!ATTRIBUTES.has(name) && !/^data-[a-z][a-z0-9-]*$/.test(name)) return `an attribute Atlas never writes (${name})`;
      const value = decode(raw);
      if (value === null) return `a broken entity in ${name}`;
      // Labels a browser never reads as style or link (they may hold a file's name, which may hold anything): not checked further.
      if (INERT.has(name) || name.startsWith("data-")) continue;
      if (value.includes("\\")) return `a backslash in ${name}`;
      if (name === "xmlns" && (tag !== "svg" || value !== SVG_NS)) return "a namespace other than SVG's";
      const lower = value.toLowerCase();
      for (const u of lower.matchAll(/url\s*\(/g)) {
        if (!/^url\(#[A-Za-z0-9_-]+\)/.test(lower.slice(u.index))) return `a url( in ${name} that points outside the picture`;
      }
      if (/javascript:|data:/.test(lower)) return `a link-like value in ${name}`;
    }
    if (stack.length === 0 && seen.has("xmlns") === false) return "a picture without the SVG namespace";
    if (svg.startsWith("/>", i)) i += 2;
    else {
      i += 1;
      stack.push(tag);
    }
    if (!sawRoot) return "no picture";
  }
  if (stack.length > 0) return "tags left open";
  if (!sawRoot) return "no picture";
  return null;
}

export const svgLooksSafe = (svg: string) => svgProblem(svg) === null;
