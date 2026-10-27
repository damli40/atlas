// Day-7 review M2: removes a secret from text even when only part of it is there.
//
// A provider's error body may echo a piece of the key it refused ("Invalid API key bt-abc123def456...").
// Atlas does not control that text, so every run of 12 or more characters that also appears inside the
// secret is replaced, not only an exact copy of the whole secret. 12 characters is long enough that an
// ordinary word or id will not match by chance, and short enough to catch a printed prefix.

export const MIN_SECRET_PIECE = 12;

export function redactSecret(text: string, secret: string | undefined, mark = "[redacted]"): string {
  if (!secret) return text;
  if (secret.length < MIN_SECRET_PIECE) return text.split(secret).join(mark);
  let out = text;
  for (let i = 0; i + MIN_SECRET_PIECE <= secret.length; i++) {
    const piece = secret.slice(i, i + MIN_SECRET_PIECE);
    let at = out.indexOf(piece);
    while (at !== -1) {
      // Grow the match both ways while text and secret still agree, then replace the whole run.
      let from = at;
      let to = at + MIN_SECRET_PIECE;
      let s = i;
      let e = i + MIN_SECRET_PIECE;
      while (from > 0 && s > 0 && out[from - 1] === secret[s - 1]) {
        from--;
        s--;
      }
      while (to < out.length && e < secret.length && out[to] === secret[e]) {
        to++;
        e++;
      }
      out = out.slice(0, from) + mark + out.slice(to);
      at = out.indexOf(piece, from + mark.length);
    }
  }
  return out;
}
