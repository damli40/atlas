// H1 (D52): the hosted server on Fly.io: one origin for the page and the API, and the checks that stop it from starting
// in an unsafe state.
//
// Plain words:
// - ONE ORIGIN. The browser loads the page and calls the API from the same address (G1 review B5: the invite cookie is
//   only trusted on requests from Atlas's own page). In development Vite serves the page and forwards /api/* to the
//   API with "/api" cut off. In production this file does the same job: GET /assets/... and every page path come from
//   the built page (dist/, made by `vite build`), and /api/... goes to the API with "/api" cut off. /health is also
//   answered directly, for Fly's health check.
// - HOSTED MODE (ATLAS_HOSTED=1, set in fly.toml). The server refuses to start, with one line per problem, unless every
//   host rule from G1 and E4 holds: invite codes on, an https public origin (on *.fly.dev it must be this app's own
//   address), every run on Modal with a Modal token present, the invite store on the mounted volume, the visitor's
//   address read from Fly's own header, and the built page present. A second server on the same store is refused by
//   the store lock (server/access/store.ts), as before.
// - SETUP MODE. The very first deploy has no invite code yet, and the full server refuses to start without one. So the
//   container starts in setup mode instead (server/host.ts): /health answers, everything else is 503 with a plain
//   sentence, nothing is spent and nothing is started. The operator then makes the owner code on the machine and
//   restarts the app.
// - Any non-macOS machine (no sandbox-exec) must run every pasted run on Modal: pasted Python runs only inside macOS's
//   sandbox-exec locally, so on Linux without ATLAS_EXECUTOR=modal the server refuses to start.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { defaultAccessDir, loadPepper, openInviteStore } from "./access/store";

/** Where `vite build` writes the page (the repo's dist/). */
export const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));
/** Where fly.toml mounts the volume, unless ATLAS_VOLUME_DIR says otherwise. */
export const DEFAULT_VOLUME_DIR = "/data";

/**
 * ATLAS_HOSTED: "1" on the hosted server (fly.toml sets it). Unset or "0" elsewhere. Any other value THROWS. A Fly
 * machine (FLY_APP_NAME is set by Fly on every machine) without ATLAS_HOSTED=1 also throws, so a fly.toml that lost
 * the line can never start an unchecked server.
 */
export function hostedFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.ATLAS_HOSTED?.trim();
  if (raw !== undefined && raw !== "0" && raw !== "1") throw new Error(`ATLAS_HOSTED must be "1" (the hosted server) or "0"/unset; got ${JSON.stringify(raw.slice(0, 20))}`);
  if (raw !== "1" && env.FLY_APP_NAME) throw new Error("this is a Fly.io machine (FLY_APP_NAME is set) but ATLAS_HOSTED is not 1: the hosted checks would be skipped, so the server does not start. Set ATLAS_HOSTED=1 in fly.toml [env]");
  return raw === "1";
}

/** What the checks need to know about this machine (tests pass their own). */
export interface HostFacts {
  platform: string;
  /** macOS sandbox-exec is available (server/meta/roles/fixer.ts osSandbox). */
  sandboxExec: boolean;
  /** The folder is a mount point (its device differs from its parent's), so files there live on the volume. */
  isMountPoint: (path: string) => boolean;
  exists: (path: string) => boolean;
}

export function isMountPoint(path: string): boolean {
  try {
    const p = resolve(path);
    if (p === dirname(p)) return false; // "/" itself is not a volume
    return statSync(p).dev !== statSync(dirname(p)).dev;
  } catch {
    return false;
  }
}

/** Null when this machine may run pasted code with the configured executor; else why not (one sentence). */
export function executorProblem(env: Record<string, string | undefined>, facts: Pick<HostFacts, "platform" | "sandboxExec">): string | null {
  if (facts.platform === "darwin" && facts.sandboxExec) return null;
  if (env.ATLAS_EXECUTOR?.trim() === "modal") return null;
  return `this machine (${facts.platform}) has no macOS sandbox-exec, so pasted Python cannot run in Atlas's local sandbox: set ATLAS_EXECUTOR=modal (every pasted run in a throwaway Modal sandbox)`;
}

const inside = (child: string, parent: string): boolean => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Every reason the hosted server must not start, one plain sentence each (empty: it may start). Never includes a
 * secret's value; only whether a secret's NAME is set.
 */
export function hostedProblems(env: Record<string, string | undefined>, facts: HostFacts, distDir: string = DIST_DIR): string[] {
  const out: string[] = [];
  const set = (name: string) => (env[name]?.trim() ?? "") !== "";
  if (env.ATLAS_REQUIRE_INVITE?.trim() !== "1") out.push("invite codes are off: set ATLAS_REQUIRE_INVITE=1 (without it anyone who finds the address spends the credits)");
  const rawOrigin = env.ATLAS_PUBLIC_ORIGIN?.trim();
  if (!rawOrigin) out.push("ATLAS_PUBLIC_ORIGIN is not set: set it to the one https address that serves the page and the API, e.g. https://<app>.fly.dev");
  else {
    let u: URL | undefined;
    try {
      u = new URL(rawOrigin);
    } catch {
      out.push(`ATLAS_PUBLIC_ORIGIN is not an address: ${JSON.stringify(rawOrigin.slice(0, 60))}`);
    }
    if (u) {
      if (u.protocol !== "https:") out.push("ATLAS_PUBLIC_ORIGIN must start with https:// on the hosted server (the invite cookie is then always Secure)");
      const app = env.FLY_APP_NAME?.trim();
      if (app && u.hostname.endsWith(".fly.dev") && u.hostname !== `${app}.fly.dev`) out.push(`ATLAS_PUBLIC_ORIGIN is ${u.origin} but this Fly app is "${app}", whose address is https://${app}.fly.dev: the own-page check would refuse every visitor; fix [env] in fly.toml`);
    }
  }
  if (env.ATLAS_EXECUTOR?.trim() !== "modal") out.push("ATLAS_EXECUTOR is not modal: on the hosted server every pasted run must go to a throwaway Modal sandbox (D16, D25)");
  if (!set("MODAL_TOKEN_ID") || !set("MODAL_TOKEN_SECRET")) out.push("the Modal token is missing (MODAL_TOKEN_ID and MODAL_TOKEN_SECRET): run tools/fly-secrets.sh");
  const volume = env.ATLAS_VOLUME_DIR?.trim() || DEFAULT_VOLUME_DIR;
  if (!isAbsolute(volume)) out.push(`ATLAS_VOLUME_DIR must be an absolute folder; got ${JSON.stringify(volume.slice(0, 60))}`);
  else if (!facts.isMountPoint(volume)) out.push(`nothing is mounted at ${volume}: the invite codes, spend ledger and track records would vanish on the next deploy. Create the volume (fly volumes create) and keep [mounts] in fly.toml`);
  const store = env.ATLAS_INVITES_DIR?.trim();
  if (!store) out.push(`ATLAS_INVITES_DIR is not set: point it at a folder on the volume, e.g. ${volume}/atlas`);
  else if (!isAbsolute(store) || !inside(store, volume) || resolve(store) === resolve(volume)) out.push(`ATLAS_INVITES_DIR (${store}) is not a folder inside the volume (${volume}): the spend ledger would not survive a restart`);
  const usage = env.ATLAS_USAGE_PATH?.trim();
  if (!usage || !isAbsolute(usage) || !inside(usage, volume)) out.push(`ATLAS_USAGE_PATH must be a file on the volume (e.g. ${volume}/usage.jsonl), so the model usage log survives a restart`);
  if (env.FLY_APP_NAME) {
    if (env.ATLAS_TRUST_PROXY?.trim() !== "1" || env.ATLAS_CLIENT_IP_HEADER?.trim().toLowerCase() !== "fly-client-ip") out.push("on Fly.io the per-address limits must read the visitor's address from Fly's own header: set ATLAS_TRUST_PROXY=1 and ATLAS_CLIENT_IP_HEADER=fly-client-ip (Fly puts the app's own address right-most in X-Forwarded-For)");
  }
  if (!facts.exists(join(distDir, "index.html"))) out.push(`the built page is missing (${join(distDir, "index.html")}): run vite build in the image`);
  return out;
}

// ── one origin: the built page and the API ─────────────────────────────────────────────────────

type Fetcher = { fetch: (req: Request, env?: unknown) => Response | Promise<Response> };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Headers on every answer: no other site may frame Atlas (a framed page's clicks would count as Atlas's own page). */
export const SAFETY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "same-origin",
};

const withSafety = (res: Response): Response => {
  // Some answers (a fetch() Response from the API) have read-only headers; copy into a new Response then.
  try {
    for (const [k, v] of Object.entries(SAFETY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
    return res;
  } catch {
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(SAFETY_HEADERS)) if (!h.has(k)) h.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
};

/** The file under `root` a page path names, or null when it is outside root, hidden, or not a file. */
function fileFor(root: string, urlPath: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (p.includes("\0")) return null;
  const full = normalize(join(root, p));
  if (full !== root && !full.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  if (relative(root, full).split(sep).some((part) => part.startsWith("."))) return null; // no dotfiles
  try {
    // H1 review m1: the REAL path must also be inside root, so a symbolic link in dist/ cannot serve a file outside it.
    const real = realpathSync(full);
    const realRoot = realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep)) return null;
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** H1 review m2: the methods passed on at all. Anything else (TRACE, CONNECT, made-up ones) gets 405, never a 500. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/**
 * The production server: `api` (the invite gate in front of the app) under /api, the built page everywhere else.
 * - /api/x?y → the API's /x?y (the same rewrite the Vite proxy does in development).
 * - /health → the API's /health (Fly's check).
 * - GET/HEAD of a file in dist/ → that file (files under /assets/ have content hashes in their names, so they are
 *   cached for a year; index.html is never cached, so a deploy is seen at once).
 * - GET/HEAD of any other path that has no file extension → index.html (the page's own screens).
 * - Anything else → 404 (a POST outside /api never reaches the app).
 */
export function servePage(api: Fetcher, distDir: string = DIST_DIR): Hono {
  const root = resolve(distDir);
  const app = new Hono();
  const toApi = (req: Request, env: unknown, path: string): Promise<Response> => {
    const u = new URL(req.url);
    u.pathname = path;
    const init: RequestInit & { duplex?: "half" } = { method: req.method, headers: req.headers, signal: req.signal };
    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      init.body = req.body;
      init.duplex = "half";
    }
    return Promise.resolve(api.fetch(new Request(u, init), env));
  };
  app.all("*", async (c) => {
    const path = c.req.path;
    if (!ALLOWED_METHODS.has(c.req.method)) return withSafety(c.json({ error: `method ${c.req.method.slice(0, 20)} is not allowed` }, 405, { allow: [...ALLOWED_METHODS].join(", ") }));
    if (path === "/api" || path.startsWith("/api/")) return withSafety(await toApi(c.req.raw, c.env, path.slice(4) || "/"));
    if (path === "/health") return withSafety(await toApi(c.req.raw, c.env, "/health"));
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return withSafety(c.json({ error: "not found (the API is under /api)" }, 404));
    // A path with a hidden part (/.env, /.git/...) is never a page or a file: 404, not the page.
    if (path.split("/").some((part) => part.startsWith("."))) return withSafety(c.json({ error: "not found" }, 404));
    let file = path === "/" ? fileFor(root, "/index.html") : fileFor(root, path);
    if (!file && extname(path) === "") file = fileFor(root, "/index.html");
    if (!file || !existsSync(file)) return withSafety(c.json({ error: "not found" }, 404));
    const body = readFileSync(file);
    const isAsset = relative(realpathSync(root), file).startsWith(`assets${sep}`); // file is a real path (review m1)
    const headers: Record<string, string> = {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    };
    return withSafety(new Response(c.req.method === "HEAD" ? null : body, { status: 200, headers }));
  });
  return app;
}

// ── setup mode (first deploy, no invite code yet) ───────────────────────────────────────────────

export const SETUP_MESSAGE =
  "Atlas is not open yet: this server has no invite code. The operator makes the first (owner) code on the server, then restarts the app (tools/fly-setup.md). Nothing was run and no model was asked.";

/** The startup line in setup mode: the exact two commands the operator runs next. */
export const setupLine = (port: number, app: string | undefined): string =>
  `SETUP MODE on port ${port}: no invite code exists yet, so Atlas answers only /health and refuses everything else (503). Next, from your Mac: fly ssh console --app ${app ?? "<app>"} -C "/usr/local/bin/atlas-invites create --name dami --owner" (prints the code once), then: fly apps restart ${app ?? "<app>"}`;

/**
 * True when the hosted server should start in setup mode (server/host.ts): hosted, every check passes, the pepper is
 * set, and no invite code is active. Anything else goes to the full server, which refuses and says why.
 */
export function setupNeeded(env: Record<string, string | undefined>, facts: HostFacts): boolean {
  if (!hostedFromEnv(env)) return false;
  if (executorProblem(env, facts) !== null || hostedProblems(env, facts).length > 0) return false;
  const dir = defaultAccessDir(env);
  if (!loadPepper(dir, env, false)) return false; // a pepper problem is a secrets problem, not setup
  return openInviteStore(dir, { env, createPepper: false }).list().filter((i) => !i.revokedAt).length === 0;
}

/** Setup mode: /health and /api/health answer 200 with setup: true (Fly's check passes, so ssh works); all else 503. */
export function setupApp(): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: false, setup: true, reason: SETUP_MESSAGE }));
  app.get("/api/health", (c) => c.json({ ok: false, setup: true, reason: SETUP_MESSAGE }));
  app.all("*", (c) => withSafety(c.json({ error: SETUP_MESSAGE }, 503)));
  return app;
}

// ── the one-line summary printed at startup ─────────────────────────────────────────────────────

export interface SummaryInput {
  env: Record<string, string | undefined>;
  activeCodes: number;
  ownerCodes: number;
  clientRule: string;
  museExec: boolean;
  metaKey: boolean;
  basetenKey: boolean;
}

/** One line, no secrets: where it runs, what it serves, who may spend, where runs go, which keys are present (yes/no). */
export function hostedSummary(s: SummaryInput): string {
  const e = s.env;
  const yes = (b: boolean) => (b ? "yes" : "NO");
  const has = (n: string) => (e[n]?.trim() ?? "") !== "";
  return [
    `hosted: Fly app ${e.FLY_APP_NAME ?? "(not on Fly)"}${e.FLY_REGION ? ` in ${e.FLY_REGION}` : ""}`,
    `page + API on ${e.ATLAS_PUBLIC_ORIGIN} (API under /api)`,
    `invite codes required (${s.activeCodes} active, ${s.ownerCodes} owner)`,
    "pasted runs on Modal (TypeScript and Python)",
    `store ${e.ATLAS_INVITES_DIR} on the volume ${e.ATLAS_VOLUME_DIR?.trim() || DEFAULT_VOLUME_DIR}`,
    `visitor address: ${s.clientRule}`,
    s.museExec ? "Muse Code: muse exec in sandbox-exec" : "Muse Code: not on this machine (no macOS sandbox-exec); the fixer asks the muse-spark-1.3 chat instead",
    `secrets present: Meta ${yes(s.metaKey)}, Baseten ${yes(s.basetenKey)}, Base RPC ${yes(has("BASE_RPC_URL"))}, Modal ${yes(has("MODAL_TOKEN_ID") && has("MODAL_TOKEN_SECRET"))}, invite pepper ${yes(has("ATLAS_INVITE_PEPPER"))}`,
  ].join("; ");
}
