// Where the Atlas plugin finds the Atlas server and the person's invite code.
//
// Plain words:
// - The plugin talks to ONE address: the Atlas server named by ATLAS_URL (for example http://127.0.0.1:8787 for a
//   server on this machine, or the hosted https address). Nothing else is ever contacted.
// - The invite code (G1, `atlas_` + 32 characters) comes from the ATLAS_INVITE environment variable, or from a
//   config file in Muse's data folder for this plugin. It is never written into the plugin, never logged, and never
//   put in a tool's answer.
// - Muse Code passes a plugin's MCP server only the variables its manifest names ("env" in plugin.json), so the
//   person sets ATLAS_URL / ATLAS_INVITE in the shell that starts `muse`.
// - An invite code is a password, so it is only sent over https, or over plain http to this machine itself
//   (127.0.0.1, ::1 or localhost). Any other http address is refused before anything is sent.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const CLAIMANT_MODES = ["spark", "spark-open", "both"] as const;
export type ClaimantMode = (typeof CLAIMANT_MODES)[number];

export interface AtlasConfig {
  /** The Atlas HTTP API, without a trailing slash. */
  url: string;
  /** The invite code, or null when none is set (a server without invites needs none). */
  invite: string | null;
  /** Where the proof card page lives (the web app), or null to give only the API's .atlas.json link. */
  webUrl: string | null;
  /** Who bets besides the person (x-atlas-claimant). Unset: the server's default (Muse Spark 1.3 only). */
  claimant: ClaimantMode | null;
  /** Where each setting came from, for the "how is Atlas set up" answer. Never the invite itself. */
  from: { url: string; invite: string };
}

export type ConfigResult = { ok: true; config: AtlasConfig } | { ok: false; reason: string };

const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** Checks an Atlas address: https anywhere, http only to this machine. Returns the cleaned URL or a reason. */
export function checkAtlasUrl(raw: string, name = "ATLAS_URL"): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: `${name} is not a web address (it should look like http://127.0.0.1:8787 or https://atlas.example)` };
  }
  if (u.username || u.password) return { ok: false, reason: `${name} must not carry a user name or password; the invite code goes in ATLAS_INVITE` };
  if (u.search || u.hash) return { ok: false, reason: `${name} must be just the server's address, with no ?query or #fragment` };
  if (u.protocol === "http:" && !LOOPBACK.has(u.hostname)) {
    return { ok: false, reason: `${name} uses plain http to another machine (${u.hostname}); the invite code would travel unencrypted, so use https` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: `${name} must start with https:// (or http:// for this machine)` };
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

/** Invite codes look like `atlas_` + 32 letters, digits, `_` or `-` (tools/invites.ts). Checked so a typo fails early. */
export const INVITE_SHAPE = /^atlas_[A-Za-z0-9_-]{32}$/;

interface FileConfig {
  url?: unknown;
  invite?: unknown;
  webUrl?: unknown;
  claimant?: unknown;
}

/**
 * Reads the optional config file `<MUSE_PLUGIN_DATA_DIR>/config.json` ({"url", "invite", "webUrl", "claimant"}).
 * Because it can hold the invite, it must not be readable by other users of the machine (mode 600 or stricter).
 */
function readFileConfig(dataDir: string | undefined): { ok: true; cfg: FileConfig | null; path: string | null } | { ok: false; reason: string } {
  if (!dataDir) return { ok: true, cfg: null, path: null };
  const path = join(dataDir, "config.json");
  let st;
  try {
    st = statSync(path);
  } catch {
    return { ok: true, cfg: null, path: null };
  }
  if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
    return { ok: false, reason: `the plugin's config file can be read by other users of this machine; run: chmod 600 "${path}"` };
  }
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) return { ok: false, reason: "the plugin's config.json must be one JSON object" };
    return { ok: true, cfg: cfg as FileConfig, path };
  } catch {
    return { ok: false, reason: "the plugin's config.json is not valid JSON" };
  }
}

/**
 * A setting's value, or undefined when it is empty. Review m6: a value that is still a literal "${NAME}" (a Muse that
 * passed the manifest's placeholder through without filling it in) counts as unset, so config.json can still be used.
 */
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim()) ? v.trim() : undefined);

/** Loads the configuration from the environment first, then the config file. Pure apart from reading that file. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ConfigResult {
  const file = readFileConfig(env.MUSE_PLUGIN_DATA_DIR);
  if (!file.ok) return file;
  const cfg = file.cfg ?? {};
  const rawUrl = str(env.ATLAS_URL) ?? str(cfg.url);
  if (!rawUrl) {
    return { ok: false, reason: "Atlas is not set up: set ATLAS_URL to the Atlas server's address (for example http://127.0.0.1:8787) in the shell that starts muse, then start muse again" };
  }
  const url = checkAtlasUrl(rawUrl);
  if (!url.ok) return url;
  const invite = str(env.ATLAS_INVITE) ?? str(cfg.invite) ?? null;
  if (invite !== null && !INVITE_SHAPE.test(invite)) {
    return { ok: false, reason: "ATLAS_INVITE does not look like an Atlas invite code (atlas_ followed by 32 characters); check it was copied whole" };
  }
  const rawWeb = str(env.ATLAS_WEB_URL) ?? str(cfg.webUrl);
  let webUrl: string | null = null;
  if (rawWeb) {
    const w = checkAtlasUrl(rawWeb, "ATLAS_WEB_URL");
    if (!w.ok) return w;
    webUrl = w.url;
  }
  const rawClaimant = (str(env.ATLAS_CLAIMANT) ?? str(cfg.claimant))?.toLowerCase();
  if (rawClaimant !== undefined && !(CLAIMANT_MODES as readonly string[]).includes(rawClaimant)) {
    return { ok: false, reason: `ATLAS_CLAIMANT must be one of ${CLAIMANT_MODES.join(", ")}` };
  }
  return {
    ok: true,
    config: {
      url: url.url,
      invite,
      webUrl,
      claimant: (rawClaimant as ClaimantMode | undefined) ?? null,
      from: {
        url: str(env.ATLAS_URL) ? "ATLAS_URL" : "config.json",
        invite: invite === null ? "none set" : str(env.ATLAS_INVITE) ? "ATLAS_INVITE" : "config.json",
      },
    },
  };
}
