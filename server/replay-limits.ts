// Limits on GET /replay for EVM runs (S5, days 3–4 review).
//
// Plain words: an EVM replay starts a local fork of Base (anvil) and makes paid archive-RPC reads for
// 30–90 s. Without a limit, anyone could start many at once. So EVM replays are capped four ways:
// - at once, across the whole server (default 1) and per session (default 1);
// - per rolling hour, across the whole server (default 10) and per session (default 3).
// A replay over any cap is refused with HTTP 429 and a plain reason; nothing is started.
// Each cap can be set from the environment (small whole numbers only). No I/O besides reading env.
//
// The same kind of gate also caps POST /runs on the EVM runner (each run is a fork + paid reads too):
// defaults 2 at once and 20 an hour for the server, 1 at once and 6 an hour per session, env
// ATLAS_RUNS_MAX_CONCURRENT, ATLAS_RUNS_MAX_PER_HOUR, ATLAS_RUNS_SESSION_MAX_CONCURRENT,
// ATLAS_RUNS_SESSION_MAX_PER_HOUR. A run over a cap is refused with 429 before its bets are frozen,
// so the person can press Run again later.
//
// S5 (day-5 review): a session id is whatever header the client sends, so the per-session caps alone
// stop nobody who sends a new one each time. Two more caps, counted per client address
// (server/client-ip.ts):
// - per client address, at once and per rolling hour (runs: 2 at once, 8 an hour; replays: 1, 4);
// - a reserved slice of the server's hourly quota (runs: the last 4 of 20; replays: the last 2 of 10)
//   that only a "new" client may use: one that has started none in the last hour. So one heavy client
//   (or a few) cannot use up the hour and lock everyone else out.
// Env: ATLAS_RUNS_IP_MAX_CONCURRENT, ATLAS_RUNS_IP_MAX_PER_HOUR, ATLAS_RUNS_RESERVED_FOR_NEW_CLIENTS, and
// the same with ATLAS_REPLAY_ for replays.

import { UNKNOWN_CLIENT } from "./client-ip";

export interface ReplayLimits {
  globalConcurrent: number;
  globalPerHour: number;
  sessionConcurrent: number;
  sessionPerHour: number;
  /** Per client address (server/client-ip.ts). Absent = no per-address cap. */
  ipConcurrent?: number;
  ipPerHour?: number;
  /** The last this-many of globalPerHour may be used only by a client with no start in the last hour. Absent = 0. */
  reservedForNewClients?: number;
}

export const DEFAULT_REPLAY_LIMITS: Required<ReplayLimits> = { globalConcurrent: 1, globalPerHour: 10, sessionConcurrent: 1, sessionPerHour: 3, ipConcurrent: 1, ipPerHour: 4, reservedForNewClients: 2 };

const ENV: Record<keyof ReplayLimits, string> = {
  globalConcurrent: "ATLAS_REPLAY_MAX_CONCURRENT",
  globalPerHour: "ATLAS_REPLAY_MAX_PER_HOUR",
  sessionConcurrent: "ATLAS_REPLAY_SESSION_MAX_CONCURRENT",
  sessionPerHour: "ATLAS_REPLAY_SESSION_MAX_PER_HOUR",
  ipConcurrent: "ATLAS_REPLAY_IP_MAX_CONCURRENT",
  ipPerHour: "ATLAS_REPLAY_IP_MAX_PER_HOUR",
  reservedForNewClients: "ATLAS_REPLAY_RESERVED_FOR_NEW_CLIENTS",
};

export const DEFAULT_RUN_LIMITS: Required<ReplayLimits> = { globalConcurrent: 2, globalPerHour: 20, sessionConcurrent: 1, sessionPerHour: 6, ipConcurrent: 2, ipPerHour: 8, reservedForNewClients: 4 };

const RUN_ENV: Record<keyof ReplayLimits, string> = {
  globalConcurrent: "ATLAS_RUNS_MAX_CONCURRENT",
  globalPerHour: "ATLAS_RUNS_MAX_PER_HOUR",
  sessionConcurrent: "ATLAS_RUNS_SESSION_MAX_CONCURRENT",
  sessionPerHour: "ATLAS_RUNS_SESSION_MAX_PER_HOUR",
  ipConcurrent: "ATLAS_RUNS_IP_MAX_CONCURRENT",
  ipPerHour: "ATLAS_RUNS_IP_MAX_PER_HOUR",
  reservedForNewClients: "ATLAS_RUNS_RESERVED_FOR_NEW_CLIENTS",
};

function limitsFromEnv(defaults: Required<ReplayLimits>, names: Record<keyof ReplayLimits, string>, env: Record<string, string | undefined>): ReplayLimits {
  const out = { ...defaults };
  for (const k of Object.keys(names) as (keyof ReplayLimits)[]) {
    const raw = env[names[k]];
    if (raw === undefined || !/^\d{1,4}$/.test(raw.trim())) continue;
    const n = Number(raw.trim());
    if (n <= 1000) out[k] = n;
  }
  return out;
}

/** The replay limits from the environment; a missing or unusable value (not a whole number 0–1000) keeps the default. */
export const replayLimitsFromEnv = (env: Record<string, string | undefined> = process.env): ReplayLimits => limitsFromEnv(DEFAULT_REPLAY_LIMITS, ENV, env);
/** The EVM run limits (POST /runs) from the environment, same rules. */
export const runLimitsFromEnv = (env: Record<string, string | undefined> = process.env): ReplayLimits => limitsFromEnv(DEFAULT_RUN_LIMITS, RUN_ENV, env);

const HOUR_MS = 60 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 1000;

export interface ReplayGate {
  /** Take a slot, or say why not. Call release() when the replay ends (also on error). */
  take(sessionId: string, clientIp?: string): { ok: true; release: () => void } | { ok: false; reason: string };
}

type Counted = { running: number; started: number[] };

/** A map of counters that never holds more than MAX_TRACKED entries (it drops the oldest idle one). */
function counters() {
  const m = new Map<string, Counted>();
  return (key: string): Counted => {
    let s = m.get(key);
    if (!s) {
      s = { running: 0, started: [] };
      m.set(key, s);
      while (m.size > MAX_TRACKED_SESSIONS) {
        const oldest = [...m.entries()].find(([, v]) => v.running === 0);
        if (!oldest) break;
        m.delete(oldest[0]);
      }
    }
    return s;
  };
}

/** `what` names the thing being capped in the refusal ("EVM replay" or "EVM run"). */
export function createReplayGate(limits: ReplayLimits = replayLimitsFromEnv(), now: () => number = Date.now, what = "EVM replay"): ReplayGate {
  let running = 0;
  let started: number[] = [];
  const sessionOf = counters();
  const ipOf = counters();
  const recent = (xs: number[]) => xs.filter((t) => now() - t < HOUR_MS);
  const reserved = Math.min(limits.reservedForNewClients ?? 0, limits.globalPerHour);

  return {
    take(sessionId, clientIp = UNKNOWN_CLIENT) {
      started = recent(started);
      const s = sessionOf(sessionId);
      const ip = ipOf(clientIp);
      s.started = recent(s.started);
      ip.started = recent(ip.started);
      const isNew = ip.started.length === 0;
      if (running >= limits.globalConcurrent) return { ok: false, reason: `the server runs at most ${limits.globalConcurrent} ${what}(s) at once and one is running; try again when it finishes` };
      if (s.running >= limits.sessionConcurrent) return { ok: false, reason: `this session runs at most ${limits.sessionConcurrent} ${what}(s) at once and one is running` };
      if (limits.ipConcurrent !== undefined && ip.running >= limits.ipConcurrent) return { ok: false, reason: `one client address runs at most ${limits.ipConcurrent} ${what}(s) at once and that many are running` };
      if (started.length >= limits.globalPerHour) return { ok: false, reason: `the server allows ${limits.globalPerHour} ${what}s an hour and that many have started in the last hour` };
      if (!isNew && started.length >= limits.globalPerHour - reserved) {
        return { ok: false, reason: `the server's last ${reserved} ${what}s this hour are kept for clients that have not started one yet, and this client address already has` };
      }
      if (s.started.length >= limits.sessionPerHour) return { ok: false, reason: `this session may start ${limits.sessionPerHour} ${what}s an hour and has started that many in the last hour` };
      if (limits.ipPerHour !== undefined && ip.started.length >= limits.ipPerHour) return { ok: false, reason: `one client address may start ${limits.ipPerHour} ${what}s an hour and this one has started that many in the last hour` };
      running++;
      s.running++;
      ip.running++;
      const t = now();
      started.push(t);
      s.started.push(t);
      ip.started.push(t);
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          running--;
          s.running--;
          ip.running--;
        },
      };
    },
  };
}

/** A plain hourly counter per key (S5: model calls per client address). */
export function createHourlyLimit(perHour: number, what: string, now: () => number = Date.now) {
  const of = counters();
  const check = (key: string): { ok: true } | { ok: false; reason: string } => {
    const c = of(key);
    c.started = c.started.filter((t) => now() - t < HOUR_MS);
    return c.started.length >= perHour ? { ok: false, reason: `call limit reached: one client address may ask for ${perHour} ${what} an hour` } : { ok: true };
  };
  return {
    /** X1: say whether one more would be allowed, without counting it. */
    check,
    /** Count one, or say why not. */
    take(key: string): { ok: true } | { ok: false; reason: string } {
      const c = of(key);
      c.started = c.started.filter((t) => now() - t < HOUR_MS);
      if (c.started.length >= perHour) return { ok: false, reason: `call limit reached: one client address may ask for ${perHour} ${what} an hour` };
      c.started.push(now());
      return { ok: true };
    },
  };
}

/** The gate for POST /runs on the EVM runner (limits from ATLAS_RUNS_* by default). */
export const createRunGate = (limits: ReplayLimits = runLimitsFromEnv(), now: () => number = Date.now): ReplayGate => createReplayGate(limits, now, "EVM run");

/**
 * E3 review B5: every sandbox start (TypeScript runs, sweeps, change replays and replays; fixture and pasted code
 * alike) takes one of these slots. On Modal (D25) each start is a paid container, and pasted code is chosen by
 * whoever pastes it, so starts are capped at once and per hour, per session, per client address and overall.
 * Env ATLAS_SANDBOX_* (the same names as the run limits, with SANDBOX).
 */
export const DEFAULT_SANDBOX_LIMITS: Required<ReplayLimits> = { globalConcurrent: 4, globalPerHour: 1000, sessionConcurrent: 2, sessionPerHour: 120, ipConcurrent: 2, ipPerHour: 240, reservedForNewClients: 0 };
const SANDBOX_ENV: Record<keyof ReplayLimits, string> = {
  globalConcurrent: "ATLAS_SANDBOX_MAX_CONCURRENT",
  globalPerHour: "ATLAS_SANDBOX_MAX_PER_HOUR",
  sessionConcurrent: "ATLAS_SANDBOX_SESSION_MAX_CONCURRENT",
  sessionPerHour: "ATLAS_SANDBOX_SESSION_MAX_PER_HOUR",
  ipConcurrent: "ATLAS_SANDBOX_IP_MAX_CONCURRENT",
  ipPerHour: "ATLAS_SANDBOX_IP_MAX_PER_HOUR",
  reservedForNewClients: "ATLAS_SANDBOX_RESERVED_FOR_NEW_CLIENTS",
};
export const sandboxLimitsFromEnv = (env: Record<string, string | undefined> = process.env): ReplayLimits => limitsFromEnv(DEFAULT_SANDBOX_LIMITS, SANDBOX_ENV, env);
export const createSandboxGate = (limits: ReplayLimits = sandboxLimitsFromEnv(), now: () => number = Date.now): ReplayGate => createReplayGate(limits, now, "sandbox run");
