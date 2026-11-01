// R3 review B8, B9, M5: the pencil image runs apart from the server, within limits, and carries what the live drawing must.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { specOfFile } from "../../renderer/authors/from-file";
import { createPencil, PENCIL_WORDS } from "../../server/pencil";
import type { AtlasFile, Run } from "../../src/types";

const fixture = (name: string) => new URL(`../fixtures/r3/${name}`, import.meta.url).pathname;
const retryFile = JSON.parse(readFileSync(new URL("../evidence/D04-04/fixture-eRopGsrp2a.atlas.json", import.meta.url), "utf8")) as AtlasFile;
const small = retryFile;
const longRun: Run = {
  ...retryFile.runs[0]!,
  trace: [{ t: 0, event: "start" }, ...[...Array(40).keys()].flatMap((i) => [{ t: i * 7 * (i + 1), event: "call", data: { name: `n${i}`, n: 1 } }, { t: i * 7 * (i + 1), event: "resolve", data: { name: `n${i}`, n: 1 } }])],
};
const long = { ...retryFile, runs: [longRun] } as AtlasFile;

describe("R3 B8: the pencil's limits", () => {
  it("a worker that never ends is killed at the limit, and the server's thread stays free meanwhile", async () => {
    const p = createPencil({ worker: fixture("pencil-hang.mjs"), killAfterMs: 1500 });
    let longest = 0;
    let last = performance.now();
    const tick = setInterval(() => {
      longest = Math.max(longest, performance.now() - last);
      last = performance.now();
    }, 10);
    const a = await p.draw("r", small, "c");
    clearInterval(tick);
    expect(a).toEqual({ kind: "failed", words: PENCIL_WORDS.timedOut(2) });
    expect(longest).toBeLessThan(400);
  }, 20_000);
  it("the same run shares one drawing; another run is told to retry; nothing queues", async () => {
    const p = createPencil({ worker: fixture("pencil-hang.mjs"), killAfterMs: 800 });
    const a = p.draw("r", small, "c");
    const b = p.draw("r", small, "c");
    expect(await p.draw("other", small, "c")).toEqual({ kind: "busy", words: PENCIL_WORDS.busy });
    expect(b).toBe(a);
    await a;
  }, 20_000);
  it("the code's hourly limit counts only drawings that really start", async () => {
    let n = 0;
    const p = createPencil({ worker: fixture("pencil-crash.mjs"), take: () => (++n > 1 ? { ok: false, reason: "used up" } : { ok: true }) });
    await p.draw("too-long", long, "c");
    expect(n).toBe(0);
    expect((await p.draw("a", small, "c")).kind).toBe("failed");
    expect(await p.draw("b", small, "c")).toEqual({ kind: "busy", words: "used up" });
  }, 20_000);
  it("a long path is refused before anything starts", async () => {
    const p = createPencil({ worker: fixture("pencil-crash.mjs") });
    const a = await p.draw("r", long, "c");
    expect(a.kind).toBe("too-long");
    expect((a as { words: string }).words).toMatch(/pencil draws up to 30/);
  });
  it("each reason has its own answer: no engine, failure, and a run that may not be drawn", async () => {
    expect(await createPencil({ worker: fixture("pencil-no-engine.mjs") }).draw("r", small, "c")).toEqual({ kind: "no-engine" });
    expect(await createPencil({ worker: fixture("pencil-crash.mjs") }).draw("r", small, "c")).toEqual({ kind: "failed", words: PENCIL_WORDS.failed });
    const hidden = { ...retryFile, runs: [{ ...retryFile.runs[0]!, controlPassed: false }] } as AtlasFile;
    const a = await createPencil({ worker: fixture("pencil-crash.mjs") }).draw("r", hidden, "c");
    expect(a.kind).toBe("not-drawn");
    expect((a as { words: string }).words).toMatch(/known-case check/);
  }, 20_000);
  it("the real engine draws in its own process, and a second ask is the kept image", async () => {
    const p = createPencil({ killAfterMs: 60_000 });
    let longest = 0;
    let last = performance.now();
    const tick = setInterval(() => {
      longest = Math.max(longest, performance.now() - last);
      last = performance.now();
    }, 10);
    const a = await p.draw("r", small, "c");
    clearInterval(tick);
    if (a.kind === "no-engine") return; // no dev dependencies here
    expect(a.kind).toBe("ok");
    expect(longest).toBeLessThan(400);
    const again = await createPencilHit(p);
    expect(again).toBe((a as { png: Uint8Array }).png);
  }, 90_000);
});
const createPencilHit = async (p: ReturnType<typeof createPencil>) => ((await p.draw("r", small, "c")) as { png: Uint8Array }).png;

describe("R3 B9: the image carries what the live drawing must", () => {
  const words = (f: AtlasFile) => specOfFile(f, "s")!.captions.map((c) => c.words).join(" | ");
  it("withRpcRetry: labelled pre-existing, and read from a file", () => {
    expect(words(retryFile)).toMatch(/Pre-existing: withRpcRetry/);
    expect(words(retryFile)).toMatch(/saved proof file/);
  });
  it("a pending retry carries viem's 62 s line", () => {
    const pending = { ...retryFile, runs: [{ ...retryFile.runs[0]!, result: { measured: { ...retryFile.runs[0]!.result.measured, outcome: "pending" }, notMeasured: {} } }] } as AtlasFile;
    expect(words(pending)).toMatch(/about 62 s/);
  });
  it("a theoretical change carries D20's words", () => {
    const f = { ...retryFile, change: { mode: "theoretical-direct-wire", directWired: [{ oracleName: "cbETH" }] } } as unknown as AtlasFile;
    expect(words(f)).toMatch(/In theory: Atlas wired cbETH directly/);
  });
  it("the model's bets stay on the retry drawing (M3)", () => {
    const spec = specOfFile(retryFile, "s")!;
    const whoModels = retryFile.bets.filter((b) => b.who !== "human");
    if (whoModels.length) expect(spec.marks.map((m) => m.who + " " + m.words).join(" ")).toMatch(/[Mm]use|model/);
  });
});
