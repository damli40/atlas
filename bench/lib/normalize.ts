// B1 review (minor 7): "no overlap" between bench M and bench T must survive a renamed variable or a changed space.
//
// Plain words: each case file is cut into its functions; each function's text is normalised (comments removed, every
// run of whitespace removed, every identifier renamed in order of first appearance: v1, v2, ...; keywords and
// string contents kept). Two functions that differ only in names, comments or layout then have the same normal form.

const JS_KEYWORDS = new Set("async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield".split(" "));
const PY_KEYWORDS = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));

function stripComments(src: string, py: boolean): string {
  // Keep strings; drop comments. A small scanner: enough for the corpora's plain code.
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < src.length && src[j] !== q) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (py && c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (!py && c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (!py && c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
    } else out += c;
  }
  return out;
}

/** The functions of a file as text: JS/TS `function` declarations (brace-matched), Python top-level `def` blocks. */
export function functionTexts(src: string, py: boolean): string[] {
  const s = stripComments(src, py);
  const out: string[] = [];
  if (py) {
    const lines = s.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/^(async\s+)?def\s/.test(lines[i]!)) continue;
      let j = i + 1;
      while (j < lines.length && (lines[j]!.trim() === "" || /^\s/.test(lines[j]!))) j++;
      out.push(lines.slice(i, j).join("\n"));
      i = j - 1;
    }
    return out;
  }
  const re = /\bfunction\b[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let depth = 0;
    let k = m.index + m[0].length - 1;
    for (; k < s.length; k++) {
      if (s[k] === "{") depth++;
      else if (s[k] === "}" && --depth === 0) break;
    }
    out.push(s.slice(m.index, k + 1));
  }
  return out;
}

/** Comments and whitespace gone, identifiers renamed in order of first appearance. */
export function normalizeFunction(text: string, py: boolean): string {
  const kw = py ? PY_KEYWORDS : JS_KEYWORDS;
  const names = new Map<string, string>();
  return text
    .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)/g, (all, str: string | undefined, id: string | undefined) => {
      if (str) return str;
      if (!id || kw.has(id)) return all;
      if (!names.has(id)) names.set(id, `v${names.size + 1}`);
      return names.get(id)!;
    })
    .replace(/\s+/g, "")
    .replace(py ? /$^/ : /;/g, "");
}
