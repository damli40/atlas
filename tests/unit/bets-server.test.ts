// D02-04 server side: bets are sealed by the SERVER (its clock, its nonce), frozen at run start,
// and revealed in full only after the run. Every bet's sealedAt is earlier than run.startedAt.

import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createBetStore, sealedAfter } from "../../server/bets";
import { localExecutor } from "../../runners/executor/local";
import type { Executor } from "../../runners/runner";
import { computeSealHash, canonicalJson, sealBet, sha256Hex } from "../../src/seal";
import { QUESTION_TEXT } from "../../src/gate";
import type { Bet, Run, Target, Verdict } from "../../src/types";

const S3 = { shape: "retry-scenario", failTimes: 5, failure: "error" };

function setup(opts: { executor?: Executor; session?: string } = {}) {
  const betStore = createBetStore();
  const app = createApp({ betStore, ...(opts.executor ? { executor: opts.executor } : {}) });
  const session = opts.session ?? "bets-test";
  const post = (path: string, body: unknown, s = session) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": s }, body: JSON.stringify(body) });
  const start = async (id = "e1", params: unknown = S3) => {
    const target = (await (await post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json()) as Target;
    const res = await post("/experiments", { id, target: { ref: target.ref, codeSha256: target.codeSha256 }, params });
    return { target, res, body: (await res.json()) as { experiment: { id: string }; questions: { measures: string; text: string }[] } };
  };
  return { app, betStore, post, start, session };
}

describe("POST /experiments", () => {
  it("returns the gate decision and the plain-code questions; the id is made by the server when absent", async () => {
    const { post, start } = setup();
    const { res, body, target } = await start();
    expect(res.status).toBe(200);
    expect(body.questions.map((q) => [q.measures, q.text])).toEqual([
      ["calls", QUESTION_TEXT.calls],
      ["totalWaitMs", QUESTION_TEXT.totalWaitMs],
      ["outcome", QUESTION_TEXT.outcome],
    ]);
    const made = (await (await post("/experiments", { target, params: S3 })).json()) as { experiment: { id: string; gate: { allowed: boolean } } };
    expect(made.experiment.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(made.experiment.gate.allowed).toBe(true);
    expect((await post("/experiments", { id: "e1", target, params: S3 })).status).toBe(409); // same id twice
  });
});

describe("POST /bets", () => {
  it("seals with server time and a server nonce; returns the hash but not the nonce", async () => {
    const { post, start, betStore, session } = setup();
    await start();
    const before = Date.now();
    // The browser tries to send its own time and nonce: refused (strict body).
    expect((await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 5 }, sealedAt: "2000-01-01T00:00:00.000Z" })).status).toBe(400);
    const res = await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 5 } });
    expect(res.status).toBe(200);
    const { bet } = (await res.json()) as { bet: Record<string, unknown> };
    expect(bet).not.toHaveProperty("nonce");
    expect(bet.sealedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bet.question).toBe(QUESTION_TEXT.calls);
    expect(Date.parse(bet.sealedAt as string)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(bet.sealedAt as string)).toBeLessThanOrEqual(Date.now());
    const stored = betStore.peek(session)!.get("e1")!.bets[0]!;
    expect(stored.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(computeSealHash(stored)).toBe(bet.sealedHash);
  });

  it("checks the answer against the question: kind, options, whole numbers, known fields", async () => {
    const { post, start } = setup();
    await start();
    const bad: [unknown, number, RegExp][] = [
      [{ measures: "calls", answer: { kind: "enum", value: "throws" } }, 400, /takes a integer answer/],
      [{ measures: "calls", answer: { kind: "integer", value: 2.5 } }, 400, /whole number/],
      [{ measures: "calls", answer: { kind: "integer", value: -1 } }, 400, /below 0/],
      [{ measures: "outcome", answer: { kind: "enum", value: "explodes" } }, 400, /must be one of returns, throws, pending/],
      [{ measures: "outcome", answer: { kind: "enum", value: "throws", options: ["throws"] } }, 400, /options/],
      [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 1 } }, 400, /no question/],
      [{ measures: "calls", answer: { kind: "integer", value: 5 }, who: "model:muse-spark-1.3" }, 400, /who/],
    ];
    for (const [b, status, why] of bad) {
      const res = await post("/bets", { experimentId: "e1", who: "human", ...(b as object) });
      expect(res.status, JSON.stringify(b)).toBe(status);
      expect(((await res.json()) as { error: string }).error, JSON.stringify(b)).toMatch(why);
    }
    const ok = await post("/bets", { experimentId: "e1", who: "human", measures: "outcome", answer: { kind: "enum", value: "throws" } });
    expect(((await ok.json()) as { bet: Bet }).bet.answer).toEqual({ kind: "enum", value: "throws", options: ["returns", "throws", "pending"] });
  });

  it("an experiment belongs to its session: another session gets 404", async () => {
    const { post, start } = setup();
    await start();
    expect((await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 5 } }, "someone-else")).status).toBe(404);
    expect((await post("/runs", { experimentId: "e1" }, "someone-else")).status).toBe(404);
  });
});

describe("POST /runs", () => {
  it("refuses to run with no bets (409)", async () => {
    const { post, start } = setup();
    await start();
    expect((await post("/runs", { experimentId: "e1" })).status).toBe(409);
  });

  it("reveals each bet in full; sha256(canonicalJson(revealed)) equals the hash shown before; sealedAt < run.startedAt", async () => {
    const { post, start } = setup();
    await start();
    const shown: string[] = [];
    for (const [measures, answer] of [["calls", { kind: "integer", value: 5 }], ["totalWaitMs", { kind: "integer", value: 12000 }], ["outcome", { kind: "enum", value: "throws" }]] as const) {
      shown.push(((await (await post("/bets", { experimentId: "e1", who: "human", measures, answer })).json()) as { bet: Bet }).bet.sealedHash);
    }
    const res = await post("/runs", { experimentId: "e1" });
    expect(res.status).toBe(200);
    const { run, verdicts, bets, betsFrozenAt } = (await res.json()) as { run: Run; verdicts: Verdict[]; bets: Bet[]; betsFrozenAt: string };
    expect(verdicts.map((v) => v.outcome)).toEqual(["matched", "matched", "matched"]);
    bets.forEach((b, i) => {
      const { who, experimentId, question, measures, answer, nonce, sealedAt } = b;
      expect(sha256Hex(canonicalJson({ who, experimentId, question, measures, answer, nonce, sealedAt }))).toBe(shown[i]);
      expect(Date.parse(b.sealedAt)).toBeLessThan(Date.parse(run.startedAt));
      expect(Date.parse(b.sealedAt)).toBeLessThan(Date.parse(betsFrozenAt));
    });
    // After the run: bets are frozen (409), and the experiment cannot run twice (409).
    const late = await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 4 } });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toMatch(/closed: its run started at/);
    expect((await post("/runs", { experimentId: "e1" })).status).toBe(409);
  });

  it("a bet posted WHILE the run is going is refused with 409 (bets freeze at run start)", async () => {
    let release!: () => void;
    const gateOpen = new Promise<void>((ok) => (release = ok));
    let execStarted!: () => void;
    const started = new Promise<void>((ok) => (execStarted = ok));
    const slow: Executor = {
      kind: "local",
      async exec(req) {
        execStarted();
        await gateOpen;
        return localExecutor.exec(req);
      },
    };
    const { post, start } = setup({ executor: slow });
    await start();
    await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 5 } });
    const running = post("/runs", { experimentId: "e1" });
    await started; // the sandbox has been asked to run: bets must already be frozen
    const during = await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 6 } });
    expect(during.status).toBe(409);
    release();
    const res = await running;
    expect(res.status).toBe(200);
    expect(((await res.json()) as { bets: Bet[] }).bets).toHaveLength(1);
  });

  it("asserts sealedAt < startedAt: a stored bet sealed in the future stops the run with 409; nothing runs", async () => {
    let execs = 0;
    const { post, start, betStore, session } = setup({ executor: { kind: "local", exec: async () => { execs++; throw new Error("must not run"); } } });
    await start();
    await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 5 } });
    // A correctly sealed bet whose time is one hour ahead (as if a clock or a client wrote it).
    const future = sealBet({ experimentId: "e1", who: "human", question: QUESTION_TEXT.calls, measures: "calls", answer: { kind: "integer", value: 5 } }, new Date(Date.now() + 3_600_000));
    betStore.peek(session)!.get("e1")!.bets.push(future);
    const res = await post("/runs", { experimentId: "e1" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; betIds: string[] };
    expect(body.betIds).toEqual([future.id]);
    expect(body.error).toMatch(/not sealed before the run started/);
    expect(execs).toBe(0);
  });

  it("sealedAfter compares as times, and treats an unreadable time as late", () => {
    const b = (sealedAt: string) => ({ id: sealedAt, sealedAt }) as Bet;
    expect(sealedAfter([b("2026-10-28T10:00:00.000Z")], "2026-10-28T10:00:00.001Z")).toEqual([]);
    expect(sealedAfter([b("2026-10-28T10:00:00.001Z")], "2026-10-28T10:00:00.001Z")).toEqual(["2026-10-28T10:00:00.001Z"]);
    expect(sealedAfter([b("not a time")], "2026-10-28T10:00:00.001Z")).toEqual(["not a time"]);
  });
});
