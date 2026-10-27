// The intermittent RPC-suite failure (tests/evidence/flaky/README.md), made deterministic.
//
// Plain words: when a run attempt does not finish (anvil failed), the server records the attempt with the
// time it stopped. The person presses "run" again and the real run starts. The .atlas.json check
// (src/atlasfile.ts) requires the attempt to have stopped STRICTLY BEFORE the run started. In-process,
// the 503 and the next POST /runs can land in the same millisecond; then the run's startedAt equals the
// attempt's stoppedAt, the file does not verify, no .atlas.json is kept, and GET /proofs/:runId is 404.
// That is what review-final-server.test.ts's "S2 on a real Base fork" hit about once in 5–7 RPC runs.
//
// The server already waited for the clock to move past the last SEAL before starting a run. It did not
// wait past the last failed ATTEMPT. This test freezes the clock so the two land in the same
// millisecond every time, then lets it move only while the server waits.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createProofStore } from "../../server/evm-round";
import { verifyAtlasFile } from "../../src/atlasfile";
import type { AtlasFile, Experiment, Run } from "../../src/types";
import { liveRunFor, PR } from "../tools/review-fixtures";

afterEach(() => {
  vi.useRealTimers();
});

describe("a re-run after an attempt that did not finish starts strictly after that attempt stopped", () => {
  it("same-millisecond retry: the .atlas.json is still kept and verifies", async () => {
    const T = Date.parse("2026-10-27T12:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] }); // only Date: real timers keep running
    vi.setSystemTime(T);

    let n = 0;
    const evmRun = async (exp: Experiment): Promise<Run> => {
      if (n++ === 0) throw new Error("anvil exited before it was ready (code 1, forced for this test)");
      return liveRunFor(exp); // stamps startedAt with the (frozen) clock at call time
    };
    const app = createApp({ agentLog: createAgentLog(), proofs: createProofStore({ publish: false }), fetchPr: async () => PR, evmRun });
    const h = { "content-type": "application/json", "x-atlas-session": "attempt-order" };
    const ask = async (path: string, body?: unknown) => {
      const res = await app.request(path, body === undefined ? { headers: h } : { method: "POST", headers: h, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    const t = (await ask("/targets", { kind: "github-pr", ref: PR.target.ref })).body;
    const f = (await ask("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).body.finding;
    const e = (await ask("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id })).body;
    await ask("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });

    vi.setSystemTime(T + 5); // past the seal, so the first run is not held by the seal wait
    const failed = await ask("/runs", { experimentId: e.experiment.id });
    expect(failed.status).toBe(503);
    const stoppedAt = failed.body.didNotFinish.attempts[0].stoppedAt as string;
    expect(stoppedAt).toBe(new Date(T + 5).toISOString());

    // The retry lands in the same millisecond. The clock moves 1 ms only after 30 ms of real time, so a
    // server that does not wait starts the run at exactly stoppedAt.
    const tick = setTimeout(() => vi.setSystemTime(T + 6), 30);
    const ok = await ask("/runs", { experimentId: e.experiment.id });
    clearTimeout(tick);
    expect(ok.status).toBe(200);
    expect(ok.body.proof).toMatchObject({ ok: true });
    expect(Date.parse(ok.body.run.startedAt)).toBeGreaterThan(Date.parse(stoppedAt));
    const file = (await ask(`/proofs/${ok.body.run.id}`)).body as AtlasFile;
    expect(file.attempts).toHaveLength(1);
    expect(verifyAtlasFile(file).ok).toBe(true);
  });
});
