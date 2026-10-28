// G1 (D33): the invite codes, stored as hashes outside the repo.
//
// Plain words: an invite code is a long random password Dami gives to one developer. Atlas never keeps the code
// itself. It keeps a fingerprint of it: HMAC-SHA-256 of the code, keyed with a secret "pepper" that lives only on the
// server (env ATLAS_INVITE_PEPPER, or the file `pepper` next to the store, readable by its owner only). Someone who
// copies the store file still cannot use or guess the codes without the pepper.
//
// Files, all in one folder outside the repo (ATLAS_INVITES_DIR; default ~/.config/atlas/), folder mode 700, files 600:
// - invites.json: the codes' fingerprints, labels, roles, budgets, revoked-at. Written ONLY by tools/invites.ts.
// - pepper: 32 random bytes as hex (made by tools/invites.ts the first time, if the env var is not set).
// The server re-reads invites.json whenever the file changes (checked on every request), so a code made or revoked
// with the tool takes effect on the next request, with no restart.

import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InviteRole } from "./context";

export const DEFAULT_DAILY_USD = 3; // D34
export const DEFAULT_MAX_CONCURRENT = 4;
/** Where invites, the ledger and the spend log live unless ATLAS_INVITES_DIR says otherwise. */
export const defaultAccessDir = (env: Record<string, string | undefined> = process.env): string => env.ATLAS_INVITES_DIR?.trim() || join(homedir(), ".config", "atlas");

export interface Invite {
  /** A short public id ("inv_" + 10 hex), safe to print and log. Never derived from the code. */
  id: string;
  /** Who it is for, as Dami typed it. Logged instead of the code. */
  label: string;
  role: InviteRole;
  /** HMAC-SHA-256(pepper, code), hex. */
  hash: string;
  /** Dollars per UTC day; null = no daily cap (the owner's default). */
  dailyUsd: number | null;
  /** Dollars over the code's whole life; null = no lifetime cap. */
  totalUsd: number | null;
  /** Spends (model calls and sandboxes) running at once for this code. */
  maxConcurrent: number;
  createdAt: string;
  revokedAt: string | null;
}

interface StoreFile {
  version: 1;
  invites: Invite[];
}

/** A code: "atlas_" + 32 base64url characters (24 random bytes, 192 bits). */
export const newCode = (): string => `atlas_${randomBytes(24).toString("base64url")}`;
export const looksLikeCode = (s: string): boolean => /^atlas_[A-Za-z0-9_-]{32}$/.test(s);

export const hashCode = (pepper: string, code: string): string => createHmac("sha256", pepper).update(code, "utf8").digest("hex");

/** Makes the folder (mode 700) if needed. */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Writes a file atomically (temp file, then rename), mode 600. */
export function writePrivate(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

/** Refuses a secret file that others on the machine could read. */
function checkPrivate(path: string): void {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`${path} can be read by other users (mode ${mode.toString(8)}); run chmod 600 on it`);
}

/**
 * The pepper: ATLAS_INVITE_PEPPER (at least 32 characters), else <dir>/pepper. `create` true makes the file when
 * neither exists (the tool does this; the server never does). Undefined when there is none.
 */
export function loadPepper(dir: string, env: Record<string, string | undefined> = process.env, create = false): string | undefined {
  const fromEnv = env.ATLAS_INVITE_PEPPER?.trim();
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("ATLAS_INVITE_PEPPER must be at least 32 characters");
    return fromEnv;
  }
  const file = join(dir, "pepper");
  if (existsSync(file)) {
    checkPrivate(file);
    const p = readFileSync(file, "utf8").trim();
    if (p.length < 32) throw new Error(`${file} holds fewer than 32 characters`);
    return p;
  }
  if (!create) return undefined;
  ensureDir(dir);
  const p = randomBytes(32).toString("hex");
  writePrivate(file, `${p}\n`);
  return p;
}

export type Verified = { ok: true; invite: Invite } | { ok: false; reason: string };

export interface InviteStore {
  readonly dir: string;
  /** Every invite (fingerprints included; never print `hash`). Re-read if the file changed. */
  list(): Invite[];
  /** The invite for this code, if it is real and not revoked. Re-reads the file first when it changed. */
  verify(code: string): Verified;
  /** The invite with this id, as of now (re-read if changed). */
  byId(id: string): Invite | undefined;
  /** Tool only: make a code. Returns the plaintext ONCE; only its fingerprint is stored. */
  create(opts: { label: string; role?: InviteRole; dailyUsd?: number | null; totalUsd?: number | null; maxConcurrent?: number; now?: Date }): { code: string; invite: Invite };
  /** Tool only: revoke by id or label. Returns the invites revoked. */
  revoke(idOrLabel: string, now?: Date): Invite[];
}

export function openInviteStore(dir: string, opts: { env?: Record<string, string | undefined>; createPepper?: boolean } = {}): InviteStore {
  const path = join(dir, "invites.json");
  let cached: StoreFile = { version: 1, invites: [] };
  let stamp = "";
  let pepper: string | undefined;
  const pepperNow = (create: boolean): string | undefined => (pepper ??= loadPepper(dir, opts.env ?? process.env, create));

  const read = (): StoreFile => {
    if (!existsSync(path)) {
      stamp = "";
      cached = { version: 1, invites: [] };
      return cached;
    }
    const st = statSync(path);
    const now = `${st.mtimeMs}:${st.size}:${st.ino}`;
    if (now === stamp) return cached;
    checkPrivate(path);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as StoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.invites)) throw new Error(`${path} is not an Atlas invite store`);
    cached = parsed;
    stamp = now;
    return cached;
  };
  const write = (f: StoreFile) => {
    ensureDir(dir);
    writePrivate(path, `${JSON.stringify(f, null, 2)}\n`);
  };

  return {
    dir,
    list: () => read().invites.map((i) => ({ ...i })),
    byId: (id) => read().invites.find((i) => i.id === id),
    verify(code) {
      const c = code.trim();
      if (!looksLikeCode(c)) return { ok: false, reason: "that is not an Atlas invite code" };
      const p = pepperNow(false);
      if (!p) return { ok: false, reason: "this server has no invite codes set up yet" };
      const h = hashCode(p, c);
      const found = read().invites.find((i) => i.hash === h);
      if (!found) return { ok: false, reason: "that invite code is not one Atlas knows" };
      if (found.revokedAt) return { ok: false, reason: "that invite code was revoked" };
      return { ok: true, invite: found };
    },
    create(o) {
      const label = o.label.trim();
      if (!/^[\w .@-]{1,60}$/.test(label)) throw new Error("--name must be 1 to 60 letters, digits, spaces or . @ - _");
      const p = pepperNow(opts.createPepper ?? true);
      if (!p) throw new Error("no pepper: set ATLAS_INVITE_PEPPER or let the tool create one");
      const f = read();
      if (f.invites.some((i) => i.label === label && !i.revokedAt)) throw new Error(`an active invite named "${label}" already exists; revoke it first or pick another name`);
      const role = o.role ?? "dev";
      const money = (v: number | null | undefined, name: string) => {
        if (v === null || v === undefined) return v;
        if (!Number.isFinite(v) || v < 0 || v > 1000) throw new Error(`${name} must be a dollar amount from 0 to 1000`);
        return v;
      };
      const daily = money(o.dailyUsd, "--daily-usd");
      const total = money(o.totalUsd, "--total-usd");
      const maxConcurrent = o.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
      if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 20) throw new Error("--max-concurrent must be a whole number from 1 to 20");
      const code = newCode();
      const invite: Invite = {
        id: `inv_${randomBytes(5).toString("hex")}`,
        label,
        role,
        hash: hashCode(p, code),
        dailyUsd: daily === undefined ? (role === "owner" ? null : DEFAULT_DAILY_USD) : daily,
        totalUsd: total ?? null,
        maxConcurrent,
        createdAt: (o.now ?? new Date()).toISOString(),
        revokedAt: null,
      };
      write({ version: 1, invites: [...f.invites, invite] });
      stamp = ""; // read again next time
      return { code, invite };
    },
    revoke(idOrLabel, now = new Date()) {
      const f = read();
      const hit = f.invites.filter((i) => !i.revokedAt && (i.id === idOrLabel || i.label === idOrLabel));
      if (hit.length === 0) return [];
      const at = now.toISOString();
      write({ version: 1, invites: f.invites.map((i) => (hit.includes(i) ? { ...i, revokedAt: at } : i)) });
      stamp = "";
      return hit.map((i) => ({ ...i, revokedAt: at }));
    },
  };
}
