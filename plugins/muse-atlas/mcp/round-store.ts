// L1: what lets a round survive a restart of this program, and what says why the program stopped. Node only, no network.
//
// Plain words: Muse Code runs this program. On Oct 31 it was gone when the person replied after 32 minutes, so the choice
// failed with "Broken pipe", and nothing recorded why. The Atlas server still held the round, under this program's session
// id. So two small files live in Muse's data folder for the plugin (MUSE_PLUGIN_DATA_DIR), both mode 600:
// - rounds-<workspace>.json: the session id and what the tools remember about each round. No code, no invite. It holds
//   the questions, and the person's answers that didn't match. A restarted program reads it and carries on with the
//   same round. One file per workspace, so two Muse sessions in two folders do not mix.
// - last-error.log: the last 40 lines of what happened to this program (started, stopped, errors). One line each, invite
//   and anything shaped like a code removed. Never environment variables, never code. A "started" with no "stopped" after
//   it means the process was killed outright, which no program can log.
// With no data folder, nothing is written and the rounds stay in memory, as before.

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_LOG_LINES = 40;
const MAX_LINE = 500;
/** Rounds kept in the file, newest last. */
const MAX_ROUNDS = 20;
const SESSION = /^[A-Za-z0-9_-]{1,64}$/;

export interface RuntimeLog {
  note(kind: string, message: string): void;
  /** The newest line that is a problem (not a plain start or a normal stop), or null. */
  lastProblem(): string | null;
}

export const LOG_FILE = "last-error.log";
const CALM = new Set(["started", "stopped"]);

/** One line, no hidden line breaks, the invite and anything shaped like an invite removed. */
export function cleanLine(message: string, invite: string | null): string {
  let s = String(message);
  if (invite) s = s.split(invite).join("<invite>");
  s = s.replace(/atlas_[A-Za-z0-9_-]{20,}/g, "<invite>").replace(/\s+/g, " ").trim();
  return s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s;
}

function writePrivate(path: string, text: string): void {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** The log. It never throws: a log that cannot be written must not become the reason the program stops. */
export function createRuntimeLog(dataDir: string | undefined, invite: string | null, now: () => Date = () => new Date()): RuntimeLog {
  const path = dataDir ? join(dataDir, LOG_FILE) : null;
  const read = (): string[] => {
    if (!path) return [];
    try {
      return readFileSync(path, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  return {
    note(kind, message) {
      if (!path) return;
      try {
        mkdirSync(dataDir!, { recursive: true });
        writePrivate(path, `${[...read(), `${now().toISOString()} ${kind}: ${cleanLine(message, invite)}`].slice(-MAX_LOG_LINES).join("\n")}\n`);
      } catch {
        // nothing to do: there is nowhere left to say it
      }
    },
    lastProblem() {
      for (const line of read().reverse()) {
        const kind = /^\S+ ([^:]+):/.exec(line)?.[1];
        if (kind && !CALM.has(kind)) return line;
      }
      return null;
    },
  };
}

export interface SavedRounds<R> {
  session?: string;
  rounds: Record<string, R>;
}
export interface RoundStore<R> {
  load(): SavedRounds<R>;
  save(session: string, rounds: Map<string, R>): void;
}

/** The rounds of one workspace, or null with no data folder. A file it cannot read counts as empty, and says so in the log. */
export function createRoundStore<R>(dataDir: string | undefined, workspace: string, log?: RuntimeLog): RoundStore<R> | null {
  if (!dataDir) return null;
  const path = join(dataDir, `rounds-${createHash("sha256").update(workspace, "utf8").digest("hex").slice(0, 16)}.json`);
  return {
    load() {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return { rounds: {} };
      }
      try {
        const o = JSON.parse(text) as { session?: unknown; rounds?: unknown };
        const rounds = o.rounds && typeof o.rounds === "object" && !Array.isArray(o.rounds) ? (o.rounds as Record<string, R>) : {};
        return { ...(typeof o.session === "string" && SESSION.test(o.session) ? { session: o.session } : {}), rounds };
      } catch (e) {
        log?.note("saved-rounds", `could not read the saved rounds, so they are not used: ${e instanceof Error ? e.message : String(e)}`);
        return { rounds: {} };
      }
    },
    save(session, rounds) {
      try {
        mkdirSync(dataDir, { recursive: true });
        writePrivate(path, JSON.stringify({ session, rounds: Object.fromEntries([...rounds].slice(-MAX_ROUNDS)) }));
      } catch (e) {
        log?.note("saved-rounds", `could not save the rounds, so a restart would lose them: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
