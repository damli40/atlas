// The plugin's only network code: JSON requests to the Atlas HTTP API named in the config.
//
// Plain words:
// - Every request goes to config.url + a fixed Atlas route. There is no other address in this file.
// - The invite code rides in the `x-atlas-invite` header (G1). It is never put in a URL, a log line or an answer;
//   any error text is scrubbed of it before it leaves this file.
// - Atlas keeps one "session" per person (the `x-atlas-session` header it hands back on the first answer). This
//   client keeps it in memory for as long as Muse Code keeps this MCP server running, so a pasted file, its
//   proposals, the bets and the run all belong to the same session. Nothing is written to disk.
// - This file never judges anything: it returns the server's JSON as it came, or a plain reason why there is none.

import { randomBytes } from "node:crypto";
import type { AtlasConfig } from "./config.ts";

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export type AtlasAnswer<T> =
  | { ok: true; status: number; json: T }
  | { ok: false; status: number | null; kind: "unreachable" | "needs-invite" | "budget" | "limit" | "refused" | "server-error" | "not-json"; reason: string; json?: unknown };

export interface AtlasClient {
  get<T>(path: string): Promise<AtlasAnswer<T>>;
  post<T>(path: string, body: unknown): Promise<AtlasAnswer<T>>;
  /** The Atlas session this plugin uses (never secret: it names the session, it grants nothing without the invite). */
  session(): string;
}

/** How to get an invite code, said once, in one place. */
export const HOW_TO_GET_INVITE =
  "Ask the person who runs this Atlas server for an invite code (they make one with `pnpm tsx tools/invites.ts create --name <you>`), then set it in the shell that starts muse: export ATLAS_INVITE=<your code>, and start muse again.";

/** A server sentence that means a money limit was reached (G1 words: "daily budget", "spend ceiling", "reserve"). */
export const BUDGET_WORDS = /budget is used up|daily budget|spend ceiling|kept for the owner|lifetime budget|total budget/i;

export const DEFAULT_TIMEOUT_MS = 240_000;

export function createAtlasClient(config: AtlasConfig, opts: { fetch?: Fetch; timeoutMs?: number } = {}): AtlasClient {
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // One session id per MCP server process (1-64 letters, digits, _ or -, as Atlas requires). Made here, so the very
  // first request already belongs to it; a server that hands back another id wins (it is the one Atlas keeps).
  let session: string = `muse_${randomBytes(12).toString("base64url")}`;
  const scrub = (s: string) => (config.invite ? s.split(config.invite).join("<invite>") : s);

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<AtlasAnswer<T>> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("internal: Atlas paths start with one /");
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (config.invite) headers["x-atlas-invite"] = config.invite;
    headers["x-atlas-session"] = session;
    if (config.claimant && method === "POST" && path === "/experiments") headers["x-atlas-claimant"] = config.claimant;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(config.url + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal });
    } catch (e) {
      const why = ctrl.signal.aborted ? `no answer within ${Math.round(timeoutMs / 1000)} s` : scrub(e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));
      return { ok: false, status: null, kind: "unreachable", reason: `the Atlas server at ${config.url} did not answer (${why}). Is it running? Start it with \`pnpm server\` in the Atlas repo, or check ATLAS_URL.` };
    } finally {
      clearTimeout(timer);
    }
    session = res.headers.get("x-atlas-session") ?? session;
    const text = await res.text().catch(() => "");
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, kind: "not-json", reason: `the server at ${config.url} answered HTTP ${res.status} with something that is not Atlas's JSON; check ATLAS_URL points at the Atlas API (not the web page)` };
    }
    const serverSays = scrub(typeof (json as { error?: unknown })?.error === "string" ? (json as { error: string }).error : "");
    if (res.status === 401) {
      return { ok: false, status: 401, kind: "needs-invite", reason: `Atlas needs an invite code for this, so nothing was sent to a model and nothing ran${serverSays ? ` (the server said: ${serverSays})` : ""}. ${HOW_TO_GET_INVITE}`, json };
    }
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, json: json as T };
    if (BUDGET_WORDS.test(serverSays)) return { ok: false, status: res.status, kind: "budget", reason: `your invite's budget is used up, so Atlas did not spend more: ${serverSays}`, json };
    if (res.status === 429) return { ok: false, status: 429, kind: "limit", reason: `Atlas's rate limit: ${serverSays || "too many requests"}. Wait a little and try again.`, json };
    if (res.status >= 500) return { ok: false, status: res.status, kind: "server-error", reason: serverSays || `the Atlas server answered HTTP ${res.status}`, json };
    return { ok: false, status: res.status, kind: "refused", reason: serverSays || `the Atlas server refused the request (HTTP ${res.status})`, json };
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    session: () => session,
  };
}
