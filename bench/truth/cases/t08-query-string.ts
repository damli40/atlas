// Parses "?a=1&a=2&b=x+y" into { a: ["1", "2"], b: "x y" }. A key without "=" gets "".
export function parseQuery(qs: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const body = qs.startsWith("?") ? qs.slice(1) : qs;
  if (body === "") return out;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    const key = decodeURIComponent((eq === -1 ? pair : pair.slice(0, eq)).replace(/\+/g, " "));
    const val = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    const prev = out[key];
    if (prev === undefined) out[key] = val;
    else if (Array.isArray(prev)) prev.push(val);
    else out[key] = [prev, val];
  }
  return out;
}
