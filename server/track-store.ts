// X3 (D27): where each person's track record is kept, on the server.
//
// Plain words. "A person" is whoever the request comes from:
// - hosted (G1 invite codes on): the invite code's id (never the code itself);
// - local (no invite codes): this browser, by a random id the page keeps in localStorage and sends in the
//   x-atlas-browser header; a request without one falls back to its session id.
// The person is never stored as given: the key is a SHA-256 of it, so the folder holds no session id, browser id or
// invite id that could be used to act as that person.
//
// On disk (diskTrackStore), following G1's store pattern (server/access/store.ts): one folder next to the invite
// store (ATLAS_INVITES_DIR, default ~/.config/atlas/, mode 700), one small file per person (mode 600), written
// atomically (temp file, then rename) after every judged round. So a record survives a restart. Each file holds
// only TrackEntry lines (src/track-record.ts): ids, seal hashes, question groups and verdict outcomes. Never code.
//
// Limits, so a flood of made-up browser ids cannot fill the disk: at most MAX_ENTRIES_PER_PERSON entries per person
// (the oldest drop first) and MAX_PEOPLE files (the one written longest ago is deleted first).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, writePrivate } from "./access/store";
import { QUESTION_TYPES, type TrackEntry } from "../src/track-record";

export const MAX_ENTRIES_PER_PERSON = 1_000;
export const MAX_PEOPLE = 2_000;
/** The folder name inside the access store's folder. */
export const TRACK_DIR_NAME = "track-record";

export type PersonKind = "invite" | "browser" | "session";
export interface Person {
  kind: PersonKind;
  /** The raw id (invite id, browser id or session id). Only its hash is ever stored. */
  id: string;
}

export interface TrackStore {
  /** Adds one round's entries (an entry whose bet is already kept is not added twice). */
  add(p: Person, entries: readonly TrackEntry[]): void;
  /** Every kept entry of this person, oldest first. */
  entries(p: Person): TrackEntry[];
  /** Where it is kept ("memory" or the folder). */
  readonly where: string;
}

/** The stored key of a person: sha256("<kind>:<id>"), 32 hex characters. */
export const personKey = (p: Person): string => createHash("sha256").update(`${p.kind}:${p.id}`, "utf8").digest("hex").slice(0, 32);

const OUTCOMES = new Set(["matched", "not_matched", "cant_check"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A stored entry is used only when it has exactly the shape the server writes (a hand-edited file cannot add code). */
function cleanEntry(e: unknown): TrackEntry | null {
  if (!e || typeof e !== "object") return null;
  const x = e as Record<string, unknown>;
  if (typeof x.runId !== "string" || !ID.test(x.runId)) return null;
  if (typeof x.betId !== "string" || !ID.test(x.betId)) return null;
  if (typeof x.sealedHash !== "string" || !/^[0-9a-f]{64}$/.test(x.sealedHash)) return null;
  if (typeof x.type !== "string" || !(QUESTION_TYPES as readonly string[]).includes(x.type)) return null;
  if (typeof x.outcome !== "string" || !OUTCOMES.has(x.outcome)) return null;
  if (typeof x.repeat !== "boolean") return null;
  if (x.side !== undefined && x.side !== "under" && x.side !== "over") return null;
  if (typeof x.at !== "string" || Number.isNaN(Date.parse(x.at))) return null;
  return { runId: x.runId, betId: x.betId, sealedHash: x.sealedHash, type: x.type as TrackEntry["type"], outcome: x.outcome as TrackEntry["outcome"], repeat: x.repeat, ...(x.side ? { side: x.side as "under" | "over" } : {}), at: x.at };
}

function merged(old: readonly TrackEntry[], more: readonly TrackEntry[]): TrackEntry[] {
  const seen = new Set(old.map((e) => e.betId));
  const all = [...old];
  for (const e of more) {
    const c = cleanEntry(e);
    if (!c || seen.has(c.betId)) continue;
    seen.add(c.betId);
    all.push(c);
  }
  return all.length > MAX_ENTRIES_PER_PERSON ? all.slice(all.length - MAX_ENTRIES_PER_PERSON) : all;
}

/** In memory only (tests, and a server built without a folder). Same limits. */
export function memoryTrackStore(): TrackStore {
  const m = new Map<string, TrackEntry[]>();
  return {
    where: "memory",
    add(p, entries) {
      const k = personKey(p);
      const next = merged(m.get(k) ?? [], entries);
      m.delete(k);
      m.set(k, next);
      while (m.size > MAX_PEOPLE) m.delete(m.keys().next().value!);
    },
    entries: (p) => [...(m.get(personKey(p)) ?? [])],
  };
}

/** One file per person in `<dir>/track-record/`, written atomically, mode 600 (G1's pattern). */
export function diskTrackStore(accessDir: string, opts: { maxPeople?: number } = {}): TrackStore {
  const dir = join(accessDir, TRACK_DIR_NAME);
  ensureDir(accessDir);
  ensureDir(dir);
  const maxPeople = opts.maxPeople ?? MAX_PEOPLE;
  const fileOf = (k: string) => join(dir, `${k}.json`);
  /** key → last write time (ms), oldest first; read once at start. */
  const written = new Map<string, number>();
  for (const [k, t] of readdirSync(dir)
    .filter((f) => /^[0-9a-f]{32}\.json$/.test(f))
    .map((f) => [f.slice(0, 32), statSync(join(dir, f)).mtimeMs] as const)
    .sort((a, b) => a[1] - b[1]))
    written.set(k, t);
  const read = (k: string): TrackEntry[] => {
    const path = fileOf(k);
    if (!existsSync(path)) return [];
    try {
      const f = JSON.parse(readFileSync(path, "utf8")) as { version?: number; entries?: unknown };
      if (f.version !== 1 || !Array.isArray(f.entries)) return [];
      return f.entries.map(cleanEntry).filter((e): e is TrackEntry => e !== null);
    } catch {
      return []; // an unreadable file counts as no record; the next round's write replaces it
    }
  };
  return {
    where: dir,
    add(p, entries) {
      if (entries.length === 0) return;
      const k = personKey(p);
      const next = merged(read(k), entries);
      writePrivate(fileOf(k), JSON.stringify({ version: 1, kind: p.kind, entries: next }));
      written.delete(k);
      written.set(k, Date.now());
      while (written.size > maxPeople) {
        const oldest = written.keys().next().value!;
        written.delete(oldest);
        try {
          unlinkSync(fileOf(oldest));
        } catch {
          // already gone
        }
      }
    },
    entries: (p) => read(personKey(p)),
  };
}
