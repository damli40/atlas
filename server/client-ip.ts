// Who is asking, by network address (S5, day-5 review).
//
// Plain words: a session id is any header value the client chooses, so a per-session cap stops nobody
// who simply sends a new one each time. The caps on EVM runs, EVM replays and model calls are also
// counted per client address, which a client cannot change as freely.
// - By default the address is the TCP socket's remote address (what the server actually sees).
// - Behind a proxy (Modal, Fly, a load balancer) every request comes from the proxy, so with
//   ATLAS_TRUST_PROXY=1 the address is read from X-Forwarded-For instead. E3 review M6: a proxy APPENDS the
//   address it saw, so only the RIGHT-MOST hop was written by the proxy; anything to its left came from the
//   client and can be anything (sending a new first hop each time let 70 of 70 pastes through a 60-an-hour cap).
//   ATLAS_TRUST_PROXY_HOPS (default 1) says how many proxies in a row append: the client is that many hops from
//   the right. Only turn this on behind a proxy that appends the header itself.
// - IPv6 addresses are grouped by their /64 (one home or one server usually holds a whole /64), and
//   "::ffff:1.2.3.4" is read as 1.2.3.4.
// - When neither is available (an in-process test request), every such request shares one key, "unknown".
// No I/O besides reading the request.

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

export const UNKNOWN_CLIENT = "unknown";

/** Reads ATLAS_TRUST_PROXY: only the exact value "1" turns it on. */
export const trustProxyFromEnv = (env: Record<string, string | undefined> = process.env): boolean => env.ATLAS_TRUST_PROXY === "1";

/** One address, normalised to the key the limits count by; null when it is not an IP address. */
export function clientKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let a = raw.trim();
  if (a.startsWith("[") && a.includes("]")) a = a.slice(1, a.indexOf("]")); // "[::1]:443"
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
  if (v4mapped) a = v4mapped[1]!;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(a);
  if (v4) {
    const parts = v4.slice(1, 5).map(Number);
    return parts.every((n) => n <= 255) ? parts.join(".") : null;
  }
  if (/^[0-9a-f:]+$/i.test(a) && a.includes(":") && a.length <= 45) {
    // Expand "::" and keep the first four groups (the /64).
    const [head, tail] = a.toLowerCase().split("::") as [string, string | undefined];
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    if (a.split("::").length > 2 || h.length + t.length > 8) return null;
    const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
  }
  return null;
}

/** The key the caps count this request under. */
/**
 * How many proxies in a row append to X-Forwarded-For: ATLAS_TRUST_PROXY_HOPS, a whole number 1–10; unset means 1.
 * E3 review r2 M4: any other value THROWS (the server refuses to start), because a wrong count silently counts the
 * wrong address: too many brings back the client-written hop, too few makes every visitor share the proxy's key.
 */
export function trustedHopsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ATLAS_TRUST_PROXY_HOPS;
  if (raw === undefined) return 1;
  if (!/^(?:[1-9]|10)$/.test(raw.trim())) throw new Error(`ATLAS_TRUST_PROXY_HOPS must be a whole number from 1 to 10 (how many proxies in a row append to X-Forwarded-For); got ${JSON.stringify(raw.slice(0, 20))}`);
  return Number(raw.trim());
}

/** The rule the per-address caps use, in plain words (printed at startup). */
export function describeClientRule(trustProxy: boolean, hops: number): string {
  return trustProxy
    ? `the ${hops === 1 ? "right-most" : `${hops}th from the right`} address in X-Forwarded-For (ATLAS_TRUST_PROXY=1, ATLAS_TRUST_PROXY_HOPS=${hops}); a request without it falls back to the socket address`
    : "the socket's remote address (ATLAS_TRUST_PROXY is not 1)";
}

export function clientIpOf(c: Context, trustProxy: boolean, hops: number = trustedHopsFromEnv()): string {
  if (trustProxy) {
    const all = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const key = clientKey(all[all.length - hops]);
    if (key) return key;
  }
  try {
    return clientKey(getConnInfo(c).remote.address) ?? UNKNOWN_CLIENT;
  } catch {
    return UNKNOWN_CLIENT; // no socket (an in-process request)
  }
}
