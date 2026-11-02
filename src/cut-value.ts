// Pure, no imports: a long value cut only between items, with how much is hidden. The renderer may use it.

/**
 * A value too long for its place, cut only where one item ends (after a comma, or before a closing bracket), never inside a number, a key or a word,
 * and saying how much is hidden: `{"count":3,"median":10, … (2 more items)}`. Short enough already: as it is.
 */
export function cutValue(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const close = chars[chars.length - 1] === "}" || chars[chars.length - 1] === "]" ? chars[chars.length - 1]! : "";
  let depth = 0;
  let inStr = false;
  let cut = -1;
  for (let i = 0; i < chars.length && i < max - 14; i++) {
    const c = chars[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) cut = i;
  }
  if (cut > 0 && close) {
    const rest = chars.slice(cut + 1, chars.length - 1).join("");
    let n = 0;
    let d = 0;
    let q = false;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]!;
      if (q) {
        if (c === "\\") i++;
        else if (c === '"') q = false;
        continue;
      }
      if (c === '"') q = true;
      else if (c === "{" || c === "[") d++;
      else if (c === "}" || c === "]") d--;
      else if (c === "," && d === 0) n++;
    }
    const items = n + 1;
    return `${chars.slice(0, cut + 1).join("")} … (${items} more item${items === 1 ? "" : "s"})${close}`;
  }
  // No item to stop at: a long string or number. It is cut at a space if there is one, and says how many characters are hidden.
  let at = max - 16;
  const space = chars.slice(0, at).lastIndexOf(" ");
  if (space > max / 2) at = space;
  return `${chars.slice(0, at).join("")}… (${chars.length - at} more characters)`;
}
