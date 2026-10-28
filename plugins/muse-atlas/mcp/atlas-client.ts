// The plugin's only network code: JSON requests to the Atlas HTTP API named in the config.
//
// Plain words:
// - Every request goes to config.url + a fixed Atlas route. There is no other address in this file.
// - Redirects are NEVER followed (review B1). A 3xx answer is refused with a plain sentence, so the invite code and
//   the file can never be carried to an address the person did not set (fetch would otherwise re-send our own
//   x-atlas-invite header, and a 307/308 the whole body, to any host the redirect names).
// - One deadline covers the WHOLE request, answer body included (review M1), and the answer may be at most
//   MAX_ANSWER_BYTES long (2 MB); past that the request is stopped.
// - The invite code rides in the `x-atlas-invite` header (G1). It is never put in a URL, a log line or an answer;
//   any error text is scrubbed of it before it leaves this file.
// - Atlas keeps one "session" per person (`x-atlas-session`). This client makes one id per MCP server process, so a
//   pasted file, its proposals, the bets and the run all belong to the same session. Nothing is written to disk.
// - This file never judges anything: it returns the server's JSON as it came, or a plain reason why there is none.

import { randomBytes } from "node:crypto";
import type { AtlasConfig } from "./config.ts";

/** The subset of the WHATWG fetch the client uses (Node's fetch fits; tests may pass their own). */
export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: "manual" | "error" | "follow" },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}>;

export type AtlasAnswer<T> =
  | { ok: true; status: number; json: T }
  | { ok: false; status: number | null; kind: "unreachable" | "needs-invite" | "budget" | "limit" | "refused" | "redirect" | "too-big" | "server-error" | "not-json"; reason: string; json?: unknown };

export interface AtlasClient {
  get<T>(path: string, opts?: { timeoutMs?: number }): Promise<AtlasAnswer<T>>;
  post<T>(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<AtlasAnswer<T>>;
  /** The Atlas session this plugin uses (it names the session; it grants nothing without the invite). */
  session(): string;
}

/** How to get an invite code, said once, in one place. */
export const HOW_TO_GET_INVITE =
  "Ask the person who runs this Atlas server for an invite code (they make one with `pnpm tsx tools/invites.ts create --name <you>`), then set it in the shell that starts muse: export ATLAS_INVITE=<your code>, and start muse again.";

/** A server sentence that means a money limit was reached (G1 words: "daily budget", "spend ceiling", "reserve"). */
export const BUDGET_WORDS = /budget is used up|daily budget|spend ceiling|kept for the owner|lifetime budget|total budget/i;

/** One request, answer included, must finish within this (a run on a cold Modal sandbox takes well under a minute). */
export const DEFAULT_TIMEOUT_MS = 120_000;
/** The largest answer the plugin reads. Atlas's biggest answers (a run with its trace) are far below this. */
export const MAX_ANSWER_BYTES = 2 * 1024 * 1024;

class TooBig extends Error {}

/** Reads the answer body as UTF-8, stopping (and cancelling the stream) past `cap` bytes. Honors the abort signal. */
async function readCapped(res: Awaited<ReturnType<Fetch>>, cap: number, signal: AbortSignal): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) throw new TooBig();
  if (!res.body) {
    const t = await Promise.race([res.text(), new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true }))]);
    if (Buffer.byteLength(t) > cap) throw new TooBig();
    return t;
  }
  const reader = res.body.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("aborted");
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => {});
        throw new TooBig();
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export function createAtlasClient(config: AtlasConfig, opts: { fetch?: Fetch; timeoutMs?: number; maxAnswerBytes?: number } = {}): AtlasClient {
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init) as ReturnType<Fetch>);
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cap = opts.maxAnswerBytes ?? MAX_ANSWER_BYTES;
  // One session id per MCP server process (1-64 letters, digits, _ or -, as Atlas requires). Made here, so the very
  // first request already belongs to it; a server that hands back another id wins (it is the one Atlas keeps).
  let session = `muse_${randomBytes(12).toString("base64url")}`;
  const scrub = (s: string) => (config.invite ? s.split(config.invite).join("<invite>") : s);

  async function request<T>(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number): Promise<AtlasAnswer<T>> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("internal: Atlas paths start with one /");
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (config.invite) headers["x-atlas-invite"] = config.invite;
    headers["x-atlas-session"] = session;
    if (config.claimant && method === "POST" && path === "/experiments") headers["x-atlas-claimant"] = config.claimant;
    const ctrl = new AbortController();
    // Review M1: this one timer covers sending, the headers AND reading the whole answer.
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const late = () => `no complete answer within ${Math.round(timeoutMs / 1000)} s`;
    try {
      let res: Awaited<ReturnType<Fetch>>;
      try {
        res = await doFetch(config.url + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal, redirect: "manual" });
      } catch (e) {
        const why = ctrl.signal.aborted ? late() : scrub(e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));
        return { ok: false, status: null, kind: "unreachable", reason: `the Atlas server at ${config.url} did not answer (${why}). Is it running? Start it with \`pnpm server\` in the Atlas repo, or check ATLAS_URL.` };
      }
      // Review B1: a redirect is refused; nothing is sent to where it points.
      if (res.status >= 300 && res.status < 400) {
        let where = "another address";
        try {
          const loc = res.headers.get("location");
          if (loc) where = new URL(loc, config.url).origin;
        } catch {
          // keep "another address"
        }
        void res.body?.cancel().catch(() => {});
        return { ok: false, status: res.status, kind: "redirect", reason: `the server at ${config.url} answered with a redirect (HTTP ${res.status}) to ${scrub(where)}. Atlas never follows redirects, so nothing was sent there. Set ATLAS_URL to the Atlas server's final address and start muse again.` };
      }
      session = res.headers.get("x-atlas-session") ?? session;
      let text: string;
      try {
        text = await readCapped(res, cap, ctrl.signal);
      } catch (e) {
        if (e instanceof TooBig) return { ok: false, status: res.status, kind: "too-big", reason: `the server at ${config.url} sent an answer over ${Math.round(cap / 1024 / 1024)} MB, far more than Atlas sends, so the plugin stopped reading it. Check ATLAS_URL.` };
        return { ok: false, status: res.status, kind: "unreachable", reason: `the Atlas server at ${config.url} started answering but did not finish (${ctrl.signal.aborted ? late() : "the connection broke"}). Try again; if it keeps happening, check the server.` };
      }
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
      if (res.status >= 200 && res.status < 300) {
        if (typeof json !== "object" || json === null) return { ok: false, status: res.status, kind: "not-json", reason: `the server at ${config.url} answered with something that is not an Atlas answer` };
        return { ok: true, status: res.status, json: json as T };
      }
      if (BUDGET_WORDS.test(serverSays)) return { ok: false, status: res.status, kind: "budget", reason: `your invite's budget is used up, so Atlas did not spend more: ${serverSays}`, json };
      if (res.status === 429) return { ok: false, status: 429, kind: "limit", reason: `Atlas's rate limit: ${serverSays || "too many requests"}. Wait a little and try again.`, json };
      if (res.status >= 500) return { ok: false, status: res.status, kind: "server-error", reason: serverSays || `the Atlas server answered HTTP ${res.status}`, json };
      return { ok: false, status: res.status, kind: "refused", reason: serverSays || `the Atlas server refused the request (HTTP ${res.status})`, json };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get: (path, o) => request("GET", path, undefined, o?.timeoutMs ?? defaultTimeout),
    post: (path, body, o) => request("POST", path, body, o?.timeoutMs ?? defaultTimeout),
    session: () => session,
  };
}
