// D02-05: the agent event stream. One full retry round over app.request writes events in the
// promised order; model events without a model name or usage are refused; SSE replays history.

import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { AgentEventError, createAgentLog, sessionEmitter } from "../../server/log/agentlog";
import { INVESTIGATOR_STUB_ACTION } from "../../server/log/round";
import { SESSION_HEADER } from "../../server/log/sse";
import { sealBet } from "../../src/seal";
import type { AgentEvent, Bet, Target } from "../../src/types";
import { runRound } from "../tools/agentlog-round";

const usage = { promptTokens: 1200, completionTokens: 300, usd: 0.0042 };

describe("agent log bus", () => {
  it("refuses a model-role event without model or usage, and accepts it with both", () => {
    const log = createAgentLog();
    expect(() => log.emit("s1", { role: "claimant", action: "proposes retry-scenario" })).toThrow(AgentEventError);
    expect(() => log.emit("s1", { role: "claimant", model: "muse-spark-1.3", action: "proposes retry-scenario" })).toThrow(/usage/);
    expect(() => log.emit("s1", { role: "investigator", action: "reads 1 file", usage })).toThrow(/model/);
    const ok = sessionEmitter(log, "s1").model({ role: "claimant", model: "muse-spark-1.3", action: "proposes retry-scenario", usage });
    expect(ok.model).toBe("muse-spark-1.3");
    expect(log.history("s1").map((e) => e.event.role)).toEqual(["claimant"]);
  });

  it("refuses a model name on a plain-code role, bad actions, unknown roles and extra fields", () => {
    const log = createAgentLog();
    expect(() => log.emit("s1", { role: "judge", model: "muse-spark-1.3", action: "judges 1 bet: 1 matched", usage })).toThrow(/must not name a model/);
    expect(() => log.emit("s1", { role: "runner", action: "" })).toThrow(AgentEventError);
    expect(() => log.emit("s1", { role: "runner", action: "line one\nline two" })).toThrow(/one line/);
    expect(() => log.emit("s1", { role: "runner", action: "x".repeat(161) })).toThrow(AgentEventError);
    expect(() => log.emit("s1", { role: "oracle" as AgentEvent["role"], action: "decides" })).toThrow(AgentEventError);
    expect(() => log.emit("s1", { role: "runner", action: "runs", extra: 1 } as never)).toThrow(AgentEventError);
    expect(() => log.emit("bad id!", { role: "runner", action: "runs" })).toThrow(/session id/);
    expect(log.history("s1")).toEqual([]);
  });

  it("keeps a bounded history and evicts idle sessions", () => {
    const log = createAgentLog({ maxHistory: 3, maxSessions: 2 });
    for (let i = 1; i <= 5; i++) log.emit("a", { role: "runner", action: `runs ${i}` });
    expect(log.history("a").map((e) => e.seq)).toEqual([3, 4, 5]);
    const stop = log.subscribe("watched", () => {});
    log.emit("b", { role: "runner", action: "runs" });
    log.emit("c", { role: "runner", action: "runs" });
    expect(log.history("a")).toEqual([]); // idle and oldest: dropped
    expect(log.subscriberCount("watched")).toBe(1); // watched: kept
    stop();
  });
});

describe("one full retry round over app.request", () => {
  it("emits human → investigator stand-in (human) → gate → seal → runner → judge, each well formed", async () => {
    const agentLog = createAgentLog();
    const app = createApp({ agentLog });
    const { sessionId, verdicts } = await runRound((p, init) => app.request(p, init));
    expect(verdicts.map((v) => v.outcome)).toEqual(["matched", "matched", "not_matched"]);

    const events = agentLog.history(sessionId).map((e) => e.event);
    expect(events.map((e) => e.role)).toEqual(["human", "human", "human", "human", "gate", "seal", "runner", "judge"]);
    expect(events.slice(0, 3).map((e) => e.action)).toEqual(["seals a bet on calls", "seals a bet on outcome", "seals a bet on calls"]);
    expect(events[3]!.action).toBe(INVESTIGATOR_STUB_ACTION);
    expect(events[4]!.action).toMatch(/^allowed \(stub/);
    expect(events[5]!.action).toBe("verifies 3 seals");
    expect(events[6]!.action).toBe("runs withRpcRetry in the sandbox (S3)");
    expect(events[7]!.action).toBe("judges 3 bets: 2 matched, 1 didn't match");
    for (const e of events) {
      expect(Number.isNaN(Date.parse(e.t))).toBe(false);
      expect(e.model).toBeUndefined(); // no model acted in today's round
      expect(e.usage).toBeUndefined();
    }
  });

  it("returns a generated session id, keeps a sent one, and refuses a malformed one", async () => {
    const app = createApp();
    const body = JSON.stringify({ kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" });
    const headers = { "content-type": "application/json" };
    const made = await app.request("/targets", { method: "POST", headers, body });
    expect(made.headers.get(SESSION_HEADER)).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const kept = await app.request("/targets", { method: "POST", headers: { ...headers, [SESSION_HEADER]: "mine-1" }, body });
    expect(kept.headers.get(SESSION_HEADER)).toBe("mine-1");
    const bad = await app.request("/targets", { method: "POST", headers: { ...headers, [SESSION_HEADER]: "no spaces" }, body });
    expect(bad.status).toBe(400);
  });

  it("logs a refused seal and runs nothing", async () => {
    const agentLog = createAgentLog();
    const app = createApp({ agentLog });
    const headers = { "content-type": "application/json", [SESSION_HEADER]: "tamper" };
    const target = (await (await app.request("/targets", { method: "POST", headers, body: JSON.stringify({ kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" }) })).json()) as Target;
    const bet: Bet = sealBet({ experimentId: "S1", who: "human", question: "How many calls?", measures: "calls", answer: { kind: "integer", value: 1 } });
    const tampered = { ...bet, answer: { kind: "integer", value: 2 } };
    const res = await app.request("/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({ experiment: { id: "S1", target, runner: "ts", params: { shape: "retry-scenario", failTimes: 0, failure: "error" }, proposedBy: { role: "human" } }, bets: [tampered] }),
    });
    expect(res.status).toBe(409);
    const roles = agentLog.history("tamper").map((e) => e.event.role);
    expect(roles).toEqual(["human", "human", "gate", "seal"]);
    expect(agentLog.history("tamper").at(-1)!.event.action).toMatch(/^refuses bet/);
  });
});

describe("GET /events/:sessionId (SSE)", () => {
  async function readEvents(res: Response, n: number): Promise<{ id: string; data: AgentEvent }[]> {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const out: { id: string; data: AgentEvent }[] = [];
    while (out.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const id = /^id: (.*)$/m.exec(block)?.[1] ?? "";
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) out.push({ id, data: JSON.parse(data) as AgentEvent });
      }
    }
    await reader.cancel();
    return out;
  }

  it("replays history, then streams live events, then cleans up on disconnect", async () => {
    const agentLog = createAgentLog();
    const app = createApp({ agentLog });
    const { sessionId } = await runRound((p, init) => app.request(p, init));
    const kept = agentLog.history(sessionId).map((e) => e.event);

    const res = await app.request(`/events/${sessionId}`);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reading = readEvents(res, kept.length + 1);
    await new Promise((ok) => setTimeout(ok, 20));
    expect(agentLog.subscriberCount(sessionId)).toBe(1);
    agentLog.emit(sessionId, { role: "claimant", model: "muse-spark-1.3", action: "proposes retry-scenario", usage });
    const got = await reading;

    expect(got.slice(0, kept.length).map((e) => e.data)).toEqual(kept);
    expect(got.map((e) => e.id)).toEqual(Array.from({ length: kept.length + 1 }, (_, i) => String(i + 1)));
    expect(got.at(-1)!.data.model).toBe("muse-spark-1.3");
    await new Promise((ok) => setTimeout(ok, 20));
    expect(agentLog.subscriberCount(sessionId)).toBe(0);
  });

  it("sends only events after Last-Event-ID, and refuses a malformed session id", async () => {
    const agentLog = createAgentLog();
    const app = createApp({ agentLog });
    for (const a of ["one", "two", "three"]) agentLog.emit("s", { role: "runner", action: `runs ${a}` });
    const got = await readEvents(await app.request("/events/s", { headers: { "last-event-id": "2" } }), 1);
    expect(got.map((e) => [e.id, e.data.action])).toEqual([["3", "runs three"]]);
    expect((await app.request("/events/bad%20id")).status).toBe(400);
  });
});
