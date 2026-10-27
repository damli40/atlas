// One redaction for everything that leaves the EVM runner.
//
// Plain words: the Base RPC URL is a secret. Providers put the account key in the path
// (".../v2/<key>") or in the host itself ("<endpoint-id>.base-mainnet.<provider>"), and anvil and
// viem echo the URL inside their error messages. Every error message, trace reason and stored string
// that leaves runners/evm goes through redactRpc() first, so none of these reach the agent-log SSE, an
// HTTP body, a log line or an .atlas.json:
// - the full URL                 → "<rpc>"
// - its host (and host:port)     → "<rpc-host>"
// - each host label left of the registrable domain (the endpoint id), unless it is a generic word
//   like "base-mainnet"          → "<rpc-host>"
// - each path segment or query value of 6+ characters (12+ when it is all hex digits, so it cannot
//   match inside an address), and any user:password → "<rpc>"
// Matching ignores case. No I/O.

const GENERIC_LABEL = /^(base|mainnet|base-mainnet|testnet|sepolia|rpc|api|node|nodes|eth|www|http|https|archive)$/i;

/**
 * Long enough to be a secret and not a common word or a piece of chain data. A token made only of
 * hex digits needs 12+ characters, so it cannot match inside an address or hash the runner records.
 */
const distinctive = (t: string, min: number) => t.length >= (/^[0-9a-f]+$/i.test(t) ? 12 : min);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pieces of a secret URL that must never be shown, longest first, each with its replacement. */
export function secretPieces(secret: string): Array<{ text: string; as: "<rpc>" | "<rpc-host>" }> {
  const out: Array<{ text: string; as: "<rpc>" | "<rpc-host>" }> = [{ text: secret, as: "<rpc>" }];
  try {
    const u = new URL(secret);
    out.push({ text: u.href, as: "<rpc>" });
    const bare = u.href.replace(/\/+$/, "");
    if (bare.length > 0) out.push({ text: bare, as: "<rpc>" });
    if (u.host) out.push({ text: u.host, as: "<rpc-host>" });
    if (u.hostname) out.push({ text: u.hostname, as: "<rpc-host>" });
    const labels = u.hostname.split(".");
    // Labels left of the last two ("quiknode.pro") identify the endpoint; an IP address has none.
    if (labels.length > 2 && !/^\d+$/.test(labels.at(-1) ?? "")) {
      for (const l of labels.slice(0, -2)) if (distinctive(l, 4) && !GENERIC_LABEL.test(l)) out.push({ text: l, as: "<rpc-host>" });
    }
    const path = u.pathname.replace(/^\/+|\/+$/g, "");
    if (distinctive(path, 6)) out.push({ text: path, as: "<rpc>" });
    for (const seg of u.pathname.split("/")) if (distinctive(seg, 6)) out.push({ text: seg, as: "<rpc>" });
    for (const [, v] of u.searchParams) if (distinctive(v, 6)) out.push({ text: v, as: "<rpc>" });
    if (u.password) out.push({ text: decodeURIComponent(u.password), as: "<rpc>" });
    if (u.username.length >= 4) out.push({ text: decodeURIComponent(u.username), as: "<rpc>" });
  } catch {
    /* not a URL: the whole value is the only piece */
  }
  const seen = new Set<string>();
  return out
    .filter((p) => p.text.length > 0 && !seen.has(p.text.toLowerCase()) && (seen.add(p.text.toLowerCase()), true))
    .sort((a, b) => b.text.length - a.text.length);
}

/** Replace every piece of `secret` in `text`. */
export function redact(text: string, secret: string | undefined): string {
  if (!secret) return text;
  let out = text;
  for (const p of secretPieces(secret)) out = out.replace(new RegExp(escapeRe(p.text), "gi"), p.as);
  return out;
}

/** Redact against every RPC URL the runner may have used (the env's and any passed in). */
export function redactRpc(text: string, ...extra: Array<string | undefined>): string {
  let out = text;
  for (const s of [process.env.BASE_RPC_URL, ...extra]) out = redact(out, s);
  return out;
}

/** An error's message, redacted. */
export const why = (e: unknown, ...extra: Array<string | undefined>): string => redactRpc(e instanceof Error ? e.message : String(e), ...extra);

/** A new Error with the redacted message (the original, which may hold the URL, is dropped). */
export function redactedError(e: unknown, ...extra: Array<string | undefined>): Error {
  const err = new Error(why(e, ...extra));
  const applied = (e as { applied?: unknown } | null)?.applied;
  if (applied !== undefined) Object.assign(err, { applied: scrubDeep(applied, ...extra) });
  return err;
}

/** Every string inside a JSON-like value, redacted (keys too). Used on a Run before it leaves the runner. */
export function scrubDeep<T>(value: T, ...extra: Array<string | undefined>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redactRpc(v, ...extra);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [redactRpc(k, ...extra), walk(x)]));
    return v;
  };
  return walk(value) as T;
}
