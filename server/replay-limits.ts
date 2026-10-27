// Limits on GET /replay for EVM runs (S5, days 3–4 review).
//
// Plain words: an EVM replay starts a local fork of Base (anvil) and makes paid archive-RPC reads for
// 30–90 s. Without a limit, anyone could start many at once. So EVM replays are capped four ways:
// - at once, across the whole server (default 1) and per session (default 1);
// - per rolling hour, across the whole server (default 10) and per session (default 3).
// A replay over any cap is refused with HTTP 429 and a plain reason; nothing is started.
// Each cap can be set from the environment (small whole numbers only). No I/O besides reading env.

export interface ReplayLimits {
  globalConcurrent: number;
  globalPerHour: number;
  sessionConcurrent: number;
  sessionPerHour: number;
}

export const DEFAULT_REPLAY_LIMITS: ReplayLimits = { globalConcurrent: 1, globalPerHour: 10, sessionConcurrent: 1, sessionPerHour: 3 };

const ENV: Record<keyof ReplayLimits, string> = {
  globalConcurrent: "ATLAS_REPLAY_MAX_CONCURRENT",
  globalPerHour: "ATLAS_REPLAY_MAX_PER_HOUR",
  sessionConcurrent: "ATLAS_REPLAY_SESSION_MAX_CONCURRENT",
  sessionPerHour: "ATLAS_REPLAY_SESSION_MAX_PER_HOUR",
};

/** The limits from the environment; a missing or unusable value (not a whole number 0–1000) keeps the default. */
export function replayLimitsFromEnv(env: Record<string, string | undefined> = process.env): ReplayLimits {
  const out = { ...DEFAULT_REPLAY_LIMITS };
  for (const k of Object.keys(ENV) as (keyof ReplayLimits)[]) {
    const raw = env[ENV[k]];
    if (raw === undefined || !/^\d{1,4}$/.test(raw.trim())) continue;
    const n = Number(raw.trim());
    if (n <= 1000) out[k] = n;
  }
  return out;
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 1000;

export interface ReplayGate {
  /** Take a slot, or say why not. Call release() when the replay ends (also on error). */
  take(sessionId: string): { ok: true; release: () => void } | { ok: false; reason: string };
}

export function createReplayGate(limits: ReplayLimits = replayLimitsFromEnv(), now: () => number = Date.now): ReplayGate {
  let running = 0;
  let started: number[] = [];
  const sessions = new Map<string, { running: number; started: number[] }>();
  const recent = (xs: number[]) => xs.filter((t) => now() - t < HOUR_MS);

  return {
    take(sessionId) {
      started = recent(started);
      let s = sessions.get(sessionId);
      if (!s) {
        s = { running: 0, started: [] };
        sessions.set(sessionId, s);
        while (sessions.size > MAX_TRACKED_SESSIONS) {
          const oldest = [...sessions.entries()].find(([, v]) => v.running === 0);
          if (!oldest) break;
          sessions.delete(oldest[0]);
        }
      }
      s.started = recent(s.started);
      if (running >= limits.globalConcurrent) return { ok: false, reason: `the server runs at most ${limits.globalConcurrent} EVM replay(s) at once and one is running; try again when it finishes` };
      if (s.running >= limits.sessionConcurrent) return { ok: false, reason: `this session runs at most ${limits.sessionConcurrent} EVM replay(s) at once and one is running` };
      if (started.length >= limits.globalPerHour) return { ok: false, reason: `the server allows ${limits.globalPerHour} EVM replays an hour and that many have started in the last hour` };
      if (s.started.length >= limits.sessionPerHour) return { ok: false, reason: `this session may start ${limits.sessionPerHour} EVM replays an hour and has started that many in the last hour` };
      running++;
      s.running++;
      const t = now();
      started.push(t);
      s.started.push(t);
      let released = false;
      const session = s;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          running--;
          session.running--;
        },
      };
    },
  };
}
