// Who is asking, by network address (S5, day-5 review).
//
// Plain words: a session id is any header value the client chooses, so a per-session cap stops nobody
// who simply sends a new one each time. The caps on EVM runs, EVM replays and model calls are also
// counted per client address, which a client cannot change as freely.
// - By default the address is the TCP socket's remote address (what the server actually sees).
// - Behind a proxy (Modal, Fly, a load balancer) every request comes from the proxy, so with
//   ATLAS_TRUST_PROXY=1 the address is the FIRST hop in X-Forwarded-For instead. Only turn that on behind
//   a proxy that sets the header itself; otherwise a client could write any address there.
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
export function clientIpOf(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const first = c.req.header("x-forwarded-for")?.split(",")[0];
    const key = clientKey(first);
    if (key) return key;
  }
  try {
    return clientKey(getConnInfo(c).remote.address) ?? UNKNOWN_CLIENT;
  } catch {
    return UNKNOWN_CLIENT; // no socket (an in-process request)
  }
}
