// HTTP side of the agent log (D02-05): the session header and GET /events/:sessionId.
//
// Session id, in plain words: every request may send `x-atlas-session: <id>`. If it is absent the
// server makes one up and sends it back in the same response header, so the client can keep it and
// open GET /events/<id> to watch that round. A malformed id is refused with 400 (never silently replaced).
//
// GET /events/:sessionId is SSE (server-sent events: one long HTTP response the server keeps
// writing `id:`/`event:`/`data:` blocks to). It first replays the kept history, then sends each new
// event as it happens. When the client disconnects, its subscription is removed. A client that
// reconnects with the standard `Last-Event-ID` header gets only the events after that id.

import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { nanoid } from "nanoid";
import { SESSION_ID, type AgentLog, type LoggedEvent } from "./agentlog";

export const SESSION_HEADER = "x-atlas-session";

/** Reads (or makes) the session id and echoes it in the response header. Returns null when the header is malformed. */
export function sessionIdOf(c: Context): string | null {
  const sent = c.req.header(SESSION_HEADER);
  if (sent !== undefined && !SESSION_ID.test(sent)) return null;
  const id = sent ?? nanoid(12);
  c.header(SESSION_HEADER, id);
  return id;
}

export const BAD_SESSION = `the ${SESSION_HEADER} header must be 1–64 letters, digits, _ or -`;

export function registerEventRoutes(app: Hono, log: AgentLog): void {
  app.get("/events/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    if (!SESSION_ID.test(sessionId)) return c.json({ error: "the session id must be 1–64 letters, digits, _ or -" }, 400);
    const lastSeen = Number(c.req.header("last-event-id") ?? 0);
    const after = Number.isFinite(lastSeen) ? lastSeen : 0;

    return streamSSE(c, async (stream) => {
      // Subscribe BEFORE reading history, so nothing emitted in between is lost; the seq check
      // below drops anything sent twice.
      const queue: LoggedEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const unsubscribe = log.subscribe(sessionId, (e) => {
        queue.push(e);
        wake?.();
      });
      const close = () => {
        closed = true;
        unsubscribe();
        wake?.();
      };
      stream.onAbort(close);
      c.req.raw.signal?.addEventListener("abort", close);

      let sent = after;
      const send = async (e: LoggedEvent) => {
        if (e.seq <= sent) return;
        sent = e.seq;
        await stream.writeSSE({ id: String(e.seq), event: "agent-event", data: JSON.stringify(e.event) });
      };

      try {
        for (const e of log.history(sessionId)) await send(e);
        while (!closed) {
          const next = queue.shift();
          if (next) {
            await send(next);
            continue;
          }
          await new Promise<void>((ok) => {
            wake = ok;
          });
          wake = null;
        }
      } finally {
        close();
      }
    });
  });
}
