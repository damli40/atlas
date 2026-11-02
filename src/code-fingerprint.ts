// The code with comments and spaces taken out, keeping strings as they are. Moved here from web/screens/Studio.tsx in R6 so the server can
// use it too (natural names are shared between copies of a file that differ only in comments or spaces). Pure.

/**
 * The code with comments and spaces taken out, keeping strings as they are. A label's fingerprint only: it decides one sentence on
 * the screen, never a seal, a verdict or a repeat mark. Good enough to be wrong only on the side of saying less.
 */
export function codeFingerprint(source: string, language: string | undefined): string {
  let out = "";
  const py = language === "py";
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '"' || c === "'" || (c === "`" && !py)) {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j;
    } else if (py ? c === "#" : c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      if (py && out !== "" && !out.endsWith("\n")) out += "\n";
    } else if (!py && c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
    } else if (py ? (c === " " || c === "\t") && out.slice(out.lastIndexOf("\n") + 1).trim() !== "" : /\s/.test(c)) {
      continue;
    } else if (py && c === "\n" && (out === "" || out.endsWith("\n"))) {
      continue;
    } else out += c;
  }
  return out;
}

