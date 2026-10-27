// D05-04 / D11: the agent log strip, readable on camera at 1920×1080.
//
// Plain words: every step of a round (a Meta model reading the code, the gate, the seal check, the fork
// run, the judge) writes one short line to the session's agent log on the server. This strip shows those
// lines as they arrive, over the existing SSE route (GET /events/:sessionId: one long HTTP response the
// server keeps writing to). One row per event, newest at the bottom, with the time (UTC), who acted, and,
// whenever a Meta model acted, that model's id (D10). Plain-code roles are labelled as plain code.
//
// What it never shows: token counts, costs, ids or any other field of the event. Only the time, the role,
// the model id and the action text the server wrote. The server already keeps every model's bet values
// out of the log before the run (S2); the strip adds nothing that could carry one.
// "Ask why" (web/screens/Why.tsx) reports how many sentences it dropped; that count is the last line.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentEvent } from "../../src/types";
import { DROPPED_LABEL } from "../../src/why";

export const ROLE_LABEL: Record<AgentEvent["role"], string> = {
  investigator: "Investigator",
  claimant: "Claimant",
  adversary: "Adversary",
  fixer: "Fixer",
  gate: "Gate",
  seal: "Seal check",
  runner: "Runner",
  judge: "Judge",
  human: "Person",
};
const MODEL_ROLES = new Set<AgentEvent["role"]>(["investigator", "claimant", "adversary", "fixer"]);
const PLAIN_ROLES = new Set<AgentEvent["role"]>(["gate", "seal", "runner", "judge"]);

export interface StripLine {
  key: string;
  time: string;
  who: string;
  /** The Meta model id, on every line a model wrote (D10). */
  model?: string;
  plainCode: boolean;
  action: string;
}

/** "2026-10-27T08:21:03.120Z" → "08:21:03" (UTC; the strip's header says so). */
export const timeOf = (iso: string) => (/T(\d\d:\d\d:\d\d)/.exec(iso)?.[1] ?? "--:--:--");

/** The rows the strip shows, oldest first. `dropped` adds the "Ask why" line at the end. */
/** m8 (day-5 review): the page keeps the last 500 events, as the server does (server/log/agentlog.ts). */
export const MAX_STRIP_EVENTS = 500;

export function stripLines(events: readonly AgentEvent[], dropped?: { count: number; at: string } | null): StripLine[] {
  const rows: StripLine[] = events.map((e, i) => ({
    key: `${i}`,
    time: timeOf(e.t),
    who: ROLE_LABEL[e.role] ?? e.role,
    ...(MODEL_ROLES.has(e.role) ? { model: e.model ?? "model not named" } : {}),
    plainCode: PLAIN_ROLES.has(e.role),
    action: e.action,
  }));
  if (dropped && dropped.count > 0) {
    rows.push({ key: "dropped", time: timeOf(dropped.at), who: "Ask why", plainCode: true, action: `${DROPPED_LABEL} (${dropped.count} ${dropped.count === 1 ? "sentence" : "sentences"})` });
  }
  return rows;
}

export interface LogStripProps {
  events: readonly AgentEvent[];
  dropped?: { count: number; at: string } | null;
  open: boolean;
  onToggle: () => void;
}

export function LogStrip({ events, dropped, open, onToggle }: LogStripProps) {
  const rows = stripLines(events, dropped);
  const list = useRef<HTMLOListElement>(null);
  // Newest at the bottom, always in view: scroll to the end whenever a line arrives.
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, open]);
  return (
    <aside className={`logstrip${open ? " open" : ""}`} aria-label="agent log" data-testid="logstrip">
      <div className="logstrip-head">
        <h2>Agent log</h2>
        <span className="logstrip-note">times UTC · plain code decides, models propose</span>
        <button type="button" onClick={onToggle} aria-expanded={open} data-testid="logstrip-toggle">
          {open ? "Hide" : "Show the agent log"}
        </button>
      </div>
      {open && (
        <ol className="logstrip-lines" ref={list} data-testid="logstrip-lines">
          {rows.length === 0 && <li className="logstrip-empty">No steps yet. Each step of the round appears here as it happens.</li>}
          {rows.map((r) => (
            <li key={r.key} className={r.model ? "model" : r.plainCode ? "plain" : "person"} data-testid="logstrip-line" title={`${r.time} ${r.who}${r.model ? ` (${r.model})` : ""}: ${r.action}`}>
              <span className="t">{r.time}</span>
              <span className="who">
                {r.who}
                {r.model ? <span className="mid"> {r.model}</span> : r.plainCode ? <span className="pc"> plain code</span> : null}
              </span>
              <span className="act">{r.action}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/**
 * Every agent event of the session the page is using, live over SSE. `session` is read through a
 * function because the server hands the page its session id on the first answer: until then the hook
 * checks again every 300 ms. Where the browser has no EventSource (unit tests), it returns [].
 * One hook per session: give the component that uses it a React key per API client (App does).
 */
export function useAgentEvents(session: () => string | null, base = "/api"): AgentEvent[] {
  const sessionOf = useRef(session);
  sessionOf.current = session;
  const [id, setId] = useState<string | null>(() => session());
  const [events, setEvents] = useState<AgentEvent[]>([]);
  useEffect(() => {
    if (id !== null) return;
    const timer = setInterval(() => {
      const s = sessionOf.current();
      if (s !== null) setId(s);
    }, 300);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => {
    setEvents([]);
    if (!id || typeof EventSource === "undefined") return;
    const es = new EventSource(`${base}/events/${encodeURIComponent(id)}`);
    es.addEventListener("agent-event", (m) => {
      try {
        const e = JSON.parse((m as MessageEvent).data) as AgentEvent;
        if (typeof e.action === "string" && typeof e.role === "string") setEvents((l) => [...l, e].slice(-MAX_STRIP_EVENTS));
      } catch {
        // a line the page cannot read is skipped
      }
    });
    return () => es.close();
  }, [id, base]);
  return events;
}
