// D05-04 / D11: the agent log strip (web/logstrip/LogStrip.tsx).
// - A snapshot of the strip with the events of a real Moonwell round (recorded Oct 27 in
//   tests/evidence/D05-04/moonwell-session-events.json: Wonder and Spark live, Base fork live).
// - One row per event, newest at the bottom, time + role on every row, the Meta model id on every model row.
// - It never shows a bet value before the run: through the real server (in-process) with a mocked Spark
//   whose answer is a number, and with the recorded real events cut at the run's start.
// Font size and lines visible at 1920×1080 are measured in a real browser (tests/evidence/D05-04).

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { createAgentLog } from "../../server/log/agentlog";
import type { AgentEvent } from "../../src/types";
import { LogStrip, stripLines } from "../../web/logstrip/LogStrip";
import { level2Round, liveRunFor } from "../tools/review-fixtures";

const REC = JSON.parse(readFileSync(join(import.meta.dirname, "..", "evidence", "D05-04", "moonwell-session-events.json"), "utf8")) as { runId: string; runStartedAt: string; agentLog: AgentEvent[] };

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
function render(events: AgentEvent[], open = true): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<LogStrip events={events} open={open} onToggle={() => {}} />));
  return host;
}
const rows = (h: HTMLElement) => [...h.querySelectorAll('[data-testid="logstrip-line"]')];

describe("the log strip with a real Moonwell round's events", () => {
  it("snapshot: one row per event, time · who · model id · action", () => {
    expect(REC.agentLog).toHaveLength(20);
    const lines = stripLines(REC.agentLog).map((l) => `${l.time} | ${l.who}${l.model ? ` (${l.model})` : l.plainCode ? " [plain code]" : ""} | ${l.action}`);
    expect(lines).toMatchSnapshot();
    const h = render(REC.agentLog);
    expect(rows(h)).toHaveLength(20);
  });

  it("every model row names its Meta model (D10); no plain-code or person row names one", () => {
    const h = render(REC.agentLog);
    const modelRows = rows(h).filter((r) => r.classList.contains("model"));
    expect(modelRows.map((r) => r.querySelector(".mid")?.textContent?.trim())).toEqual(["muse-wonder-1.0", "muse-spark-1.3"]);
    for (const r of rows(h).filter((x) => !x.classList.contains("model"))) expect(r.querySelector(".mid")).toBeNull();
    const ev = REC.agentLog.filter((e) => e.model);
    expect(modelRows).toHaveLength(ev.length);
  });

  it("newest at the bottom, in the order the server wrote them", () => {
    const h = render(REC.agentLog);
    const acts = rows(h).map((r) => r.querySelector(".act")!.textContent);
    expect(acts).toEqual(REC.agentLog.map((e) => e.action));
    expect(acts.at(-1)).toBe("judges 2 bets: 1 didn't match, 1 can't check");
  });

  it("shows no token count, cost, id or other field of the event: only time, role, model id and action", () => {
    const h = render(REC.agentLog);
    const text = h.querySelector('[data-testid="logstrip-lines"]')!.textContent!;
    for (const e of REC.agentLog) {
      if (!e.usage) continue;
      expect(text).not.toContain(String(e.usage.usd));
      expect(text).not.toContain(String(e.usage.promptTokens));
    }
    // Each row is exactly: time, who, the model id (or "plain code"), the action. Nothing else.
    const want = stripLines(REC.agentLog).map((l) => `${l.time}${l.who}${l.model ? ` ${l.model}` : l.plainCode ? " plain code" : ""}${l.action}`);
    expect(rows(h).map((r) => r.textContent)).toEqual(want);
  });

  it("toggled off: no rows, one button to show it again", () => {
    const h = render(REC.agentLog, false);
    expect(rows(h)).toHaveLength(0);
    expect(h.querySelector('[data-testid="logstrip-toggle"]')!.textContent).toBe("Show the agent log");
  });
});

describe("no bet value on the strip before the run", () => {
  it("recorded real round: the events before the run carry neither the person's 2200 nor a model value", () => {
    const pre = REC.agentLog.filter((e) => e.t < REC.runStartedAt);
    expect(pre.length).toBeGreaterThan(5);
    const text = render(pre).textContent!;
    expect(text).toContain("seals a bet on priceUsd1e18:cbETH");
    expect(text).not.toContain("2200");
    expect(text).not.toMatch(/declined|unknown:/);
  });

  it("through the real server: Spark's numeric answer and rationale never reach the strip before the run, and the run reveals them elsewhere", async () => {
    const usage = { promptTokens: 100, completionTokens: 10, usd: 0.001 };
    const chat = async (_a: ChatArgs): Promise<ChatResult> => ({
      ok: true,
      content: JSON.stringify({ bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 1987.65, tolerancePct: 10, unit: "USD" }, rationale: "Zebra-rationale 1987.65" }] }),
      finishReason: "stop",
      usage,
    });
    let preRun: AgentEvent[] = [];
    const log = createAgentLog();
    const { r } = await level2Round(
      async (exp) => {
        preRun = log.history("strip-pre").map((x) => x.event); // what the strip had streamed when the fork started
        return liveRunFor(exp);
      },
      { modelBets: { chat }, agentLog: log },
      "strip-pre",
    );
    expect(r.status).toBe(200);
    expect(r.body.bets.some((b: { answer: { value?: number } }) => b.answer.value === 1987.65)).toBe(true); // revealed by the run answer
    const text = render(preRun).textContent!;
    expect(text).toContain("muse-spark-1.3");
    expect(text).not.toContain("1987");
    expect(text).not.toContain("Zebra");
    expect(text).not.toContain("2200");
  });
});
