// G1 review round 2: a shared hourly allowance (for example GitHub's 60 requests an hour) split into shares.
//
// Plain words: each dev invite code gets its own small share; all dev codes together get at most `devsTotal`; the
// owner's code has its own separate allowance that devs can never touch; a request with no code (a local server) and
// the server itself share `other`. So a dev who uses up its share, or devs who use up theirs, never stop the owner.

import { spenderOf } from "./context";

const HOUR_MS = 60 * 60 * 1000;

export interface ShareLimits {
  perDev: number;
  devsTotal: number;
  owner: number;
  other: number;
}

export interface ShareLimit {
  /** Counts one for the current spender, or says why not. */
  take(): { ok: true } | { ok: false; reason: string };
}

export function createShareLimit(limits: ShareLimits, what: string, now: () => number = Date.now): ShareLimit {
  const times = new Map<string, number[]>();
  const recent = (k: string) => {
    const t = (times.get(k) ?? []).filter((x) => now() - x < HOUR_MS);
    times.set(k, t);
    return t;
  };
  return {
    take() {
      const who = spenderOf();
      const keys: { key: string; cap: number; why: string }[] =
        who.kind === "owner"
          ? [{ key: who.key, cap: limits.owner, why: `the owner's ${limits.owner} ${what} an hour are used` }]
          : who.kind === "dev"
            ? [
                { key: who.key, cap: limits.perDev, why: `this invite may make ${limits.perDev} ${what} an hour` },
                { key: "devs", cap: limits.devsTotal, why: `invited developers together may make ${limits.devsTotal} ${what} an hour (the rest is kept for the owner)` },
              ]
            : [{ key: "other", cap: limits.other, why: `this server makes at most ${limits.other} ${what} an hour` }];
      for (const k of keys) if (recent(k.key).length >= k.cap) return { ok: false, reason: `call limit reached: ${k.why}` };
      for (const k of keys) recent(k.key).push(now());
      return { ok: true };
    },
  };
}

/** GitHub reads (a pull request, a repo folder): defaults sized for GitHub's 60 unauthenticated requests an hour. */
export const DEFAULT_GITHUB_SHARES: ShareLimits = { perDev: 10, devsTotal: 25, owner: 25, other: 50 };
