// Day-5 review, m8: the log strip's event list is bounded on the page as it is on the server (500).
// Before the fix the page kept every event it was ever sent. A stand-in EventSource sends 600 events.

import "../tools/jsdom-globals";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { MAX_STRIP_EVENTS, useAgentEvents } from "../../web/logstrip/LogStrip";

class FakeSource {
  static last: FakeSource | null = null;
  listeners: ((m: { data: string }) => void)[] = [];
  constructor(public url: string) {
    FakeSource.last = this;
  }
  addEventListener(_: string, f: (m: { data: string }) => void) {
    this.listeners.push(f);
  }
  close() {}
  send(data: object) {
    for (const f of this.listeners) f({ data: JSON.stringify(data) });
  }
}

describe("m8: the page keeps at most 500 log events", () => {
  it("600 events in, the last 500 kept", () => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeSource;
    let seen: { action: string }[] = [];
    function Probe() {
      seen = useAgentEvents(() => "s1");
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    act(() => {
      for (let i = 0; i < 600; i++) FakeSource.last!.send({ t: "2026-10-27T07:30:00.000Z", role: "gate", action: `line ${i}` });
    });
    expect(MAX_STRIP_EVENTS).toBe(500);
    expect(seen).toHaveLength(500);
    expect(seen[0]!.action).toBe("line 100");
    expect(seen.at(-1)!.action).toBe("line 599");
    act(() => root.unmount());
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });
});
