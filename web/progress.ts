// D04-04: the run progress line. A Moonwell run forks Base and takes 30–90 s, so the page listens
// to the session's agent log (GET /events/:sessionId, server-sent events) and shows the latest
// runner line ("forks Base @ 42194662", "applies 14 oracle-feed actions as the governor", …).
// Plain code writes those lines; no model is involved. Where the browser has no EventSource (tests),
// nothing is shown and the page still waits for the run's answer.

import { useEffect, useState } from "react";
import type { AgentEvent } from "../src/types";

export function useRunnerProgress(session: string | null, experimentId: string | null, active: boolean, base = "/api"): string[] {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!active || !session || !experimentId || typeof EventSource === "undefined") return;
    setLines([]);
    const es = new EventSource(`${base}/events/${encodeURIComponent(session)}`);
    es.addEventListener("agent-event", (m) => {
      try {
        const e = JSON.parse((m as MessageEvent).data) as AgentEvent;
        // Only this experiment's run steps (the server tags each with the experiment id).
        if (e.role === "runner" && e.ref?.kind === "experiment" && e.ref.id === experimentId) setLines((l) => [...l, e.action]);
      } catch {
        // a line the page cannot read is skipped
      }
    });
    return () => es.close();
  }, [session, experimentId, active, base]);
  return lines;
}
