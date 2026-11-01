// R3 review M1: the honesty checks that lived in the old figures' tests (the retry machine, the price pipe), moved onto
// the authors that replaced them. Same real runs as before: the D04-04 proof files, the D03-03 Level 1 run, and rounds
// played through the real server (no model). What a run may claim did not change when the picture did.
// Checks of the figures' geometry and part lists have no equivalent and did not move (see the M1 report).

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MOONWELL_ALLOWED_WORDS, moonwellFlow } from "../../renderer/authors/moonwell";
import { RETRY_PRE_EXISTING, RETRY_VIEM_CAP, retryDemo } from "../../renderer/authors/what-happened";
import { checkDrawing } from "../../renderer/check";
import { drawSpec } from "../../renderer/live/draw";
import { mountDrawing } from "../../renderer/live/mount";
import { specProblems, type RenderSpec } from "../../renderer/spec";
import { runScenario, type RetryFn } from "../../runners/ts/harness";
import { FORK_BLOCK } from "../../runners/evm/moonwell-base";
import { createApp } from "../../server/app";
import { LEVEL2_CAPTION, level1Caption } from "../../src/atlasfile";
import { BOUNDS } from "../../src/gate";
import { judge } from "../../src/judge";
import { MOONWELL_LEVEL1_BLOCK, MOONWELL_LEVEL2_BLOCK } from "../../src/moonwell-blocks";
import { notShownAsFact } from "../../src/trust";
import type { AtlasFile, Run } from "../../src/types";
import { formatUsd1e18 } from "../../src/units";
import { MoonwellDrawing } from "../../web/drawing/MoonwellDrawing";
import { RunPath } from "../../web/drawing/RunPath";
import { withRpcRetry } from "../fixtures/with-rpc-retry";
import { ROUNDS, d0404Round, playRound, type Round } from "../tools/machine-pages";
import { pipeCases, type PipeCase } from "../tools/pipe-cases";

const ROOT = join(__dirname, "../..");
const wordsOf = (s: RenderSpec) => JSON.stringify([s.title, s.subtitle, s.kicker, s.legend, s.nodes.map((n) => [n.words, n.small]), s.edges.map((e) => e.words), s.captions.map((c) => c.words), s.marks.map((m) => [m.who, m.words]), s.steps.map((x) => x.words), s.notShown]);
const captionsOf = (s: RenderSpec) => s.captions.map((c) => c.words);
/** The words the page really draws for each caption, line by line, as one string each. */
const drawnCaptions = (s: RenderSpec, narrow: boolean) => {
  const d = drawSpec(s, { narrow });
  if (d.kind !== "drawing") throw new Error(`expected a drawing, got ${d.kind}`);
  return d.scene.captions.map((b) => b.lines.map((l) => l.text).join(" "));
};
const expectDrawsClean = (s: RenderSpec) => {
  expect(specProblems(s)).toEqual([]);
  const d = drawSpec(s);
  if (d.kind !== "drawing") throw new Error(`expected a drawing, got ${d.kind}`);
  expect(checkDrawing(s, d.scene, d.svg)).toEqual([]);
};
/** Words that judge the code. The drawing shows what the run did. Kept here: the wording lint forbids them in product code. */
const JUDGEMENT = /\b(bug|broken|wrong|fault|fix|fixed|correct|incorrect)\b/i;
/** CLAUDE.md's never-claim list, for anything about withRpcRetry or Moonwell. */
const NEVER_CLAIM = /hangs? for ?ever|for ?ever|hammer|caught before shipping|AI caused|Claude wrote/i;

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
});

/** Reduced motion on. `animate` exists and counts, so the player could animate: it must choose not to. */
const reducedMotionPage = () => {
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} });
  const animate = vi.fn();
  (SVGElement.prototype as unknown as { animate: unknown }).animate = animate;
  return animate;
};
const paint = async (el: React.ReactElement) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // Only promises settle here, no timer runs: what shows now is what shows on the first paint.
  await act(async () => createRoot(host).render(el));
  return host;
};
const expectFinished = (host: HTMLElement, s: RenderSpec) => {
  expect(host.querySelector("svg")).not.toBeNull();
  expect(host.querySelectorAll(".rr-pending")).toHaveLength(0);
  expect(host.querySelectorAll("[data-node]")).toHaveLength(s.nodes.length);
  expect(host.querySelectorAll("[data-mark]").length).toBeGreaterThanOrEqual(s.marks.length ? 1 : 0);
  expect(host.querySelector(".rr-captions")).not.toBeNull();
};

describe("the Moonwell price flow: the rules of the old price pipe", () => {
  const cases = new Map(pipeCases().map((c) => [c.id, c]));
  const get = (id: string) => cases.get(id)!;
  const flow = (c: Pick<PipeCase, "run" | "bets" | "verdicts">, fileCaptions?: string[]) => moonwellFlow({ run: c.run, bets: c.bets, verdicts: c.verdicts, ...(fileCaptions ? { fileCaptions } : {}) });

  it("the pure rules it reads import nothing at run time, and the runner's fork blocks are the same two numbers", () => {
    const importsOf = (rel: string) => [...readFileSync(join(ROOT, rel), "utf8").matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim());
    expect(importsOf("src/trust.ts")).toEqual(['import type { Run } from "./types";']);
    expect(importsOf("src/moonwell-blocks.ts")).toEqual([]);
    for (const rel of ["src/trust.ts", "src/moonwell-blocks.ts", "renderer/authors/moonwell.ts", "renderer/authors/what-happened.ts"]) expect(readFileSync(join(ROOT, rel), "utf8")).not.toMatch(/\brequire\(|\bimport\(|\bfetch\(|Date\.now|Math\.random/);
    expect([FORK_BLOCK.beforeProposal, FORK_BLOCK.proposalExecuted]).toEqual([MOONWELL_LEVEL2_BLOCK, MOONWELL_LEVEL1_BLOCK]);
  });

  it("Level 2 real run (count 1): the multiply step is shown as absent, the price is $1.12 beside the $2,206.68 reference, all from the run", () => {
    const c = get("level2-count1");
    // Counted from the run itself, separately from the author:
    const post = c.run.trace.find((e) => e.event === "call_trace" && e.data!.phase === "post-apply")!.data!;
    expect([post.count, c.run.result.measured["priceSources:cbETH"]]).toEqual([1, 1]);
    const s = flow(c);
    expectDrawsClean(s);
    const gear = s.nodes.find((n) => n.id === "gear")!;
    expect(gear).toMatchObject({ missing: true, kind: "note" });
    expect(gear.words).toMatch(/multiply step/);
    // The dashed note never joins the path: no thread runs through a step that is not there.
    expect(s.edges.find((e) => e.from === "gear")).toMatchObject({ kind: "dashed-note", to: "price" });
    expect(s.path!.edges).toEqual(["e-price"]);
    expect(s.nodes.find((n) => n.id === "feed")!.words).toBe("CBETH / ETH");
    expect(s.edges.find((e) => e.id === "e-price")!.words).toBe("1 price source");
    const price = formatUsd1e18(BigInt(c.run.result.measured["priceUsd1e18:cbETH"] as string));
    const reference = formatUsd1e18(BigInt(c.run.result.references!["refUsd1e18:cbETH"]!.value));
    expect([price, reference]).toEqual(["$1.12", "$2,206.68"]);
    expect(s.nodes.find((n) => n.id === "price")).toMatchObject({ words: `the oracle reported ${price}`, small: "at block 42194662" });
    expect(s.nodes.find((n) => n.id === "ref")).toMatchObject({ words: `reference ${reference}`, small: "plain code, same block" });
  });

  it("marks come from Bet[] only: the person's $2,200 is marked; Spark declined, so it says so, with no number, and the model is named (D10)", () => {
    const c = get("level2-count1");
    const s = flow(c);
    expect(s.marks.map((m) => [m.who, m.kind, m.words])).toEqual([
      ["you", "didnt-match", "said $2,200"],
      ["muse-spark-1.3", "cant-check", "declined to guess"],
    ]);
    expect(moonwellFlow({ run: c.run, bets: [], verdicts: c.verdicts }).marks).toEqual([]);
    // A verdict with no bet of its own marks nothing either.
    expect(moonwellFlow({ run: c.run, bets: [], verdicts: [{ betId: "nobody", outcome: "matched" }] }).marks).toEqual([]);
  });

  it("pre-apply phase of the same run (fixture, count 2): no step is shown as absent, and the numbers are the run's own", () => {
    const c = get("pre-apply-count2");
    const src = get("level2-count1").run.result.measured;
    expect(c.run.result.measured["priceUsd1e18:cbETH"]).toBe(src["preApplyPriceUsd1e18:cbETH"]);
    expect(c.run.result.measured["priceSources:cbETH"]).toBe(src["preApplyPriceSources:cbETH"]);
    expect(c.run.trace.filter((e) => e.event === "call_trace").map((e) => [e.data!.phase, e.data!.count])).toEqual([["pre-apply", 2]]);
    const s = flow(c);
    expectDrawsClean(s);
    expect(s.nodes.some((n) => n.missing)).toBe(false);
    expect(s.edges.find((e) => e.id === "e-price")!.words).toBe("2 price sources");
    expect(s.nodes.find((n) => n.id === "price")!.words).toBe("the oracle reported $2,206.68");
  });

  /** Nothing from a not-shown run reaches the page: no number, no slot claim, the reason only. */
  const expectNotShown = (c: Pick<PipeCase, "run" | "bets" | "verdicts">, reason: RegExp) => {
    const why = notShownAsFact(c.run);
    expect(why).toMatch(reason);
    const s = flow(c, ["a caption from the file"]);
    expect(s.notShown).toBe(why);
    expect([s.nodes, s.edges, s.marks, s.steps, s.captions]).toEqual([[], [], [], [], []]);
    expect(wordsOf(s)).not.toMatch(/\$\d|price source|multiply|a caption from the file|reference/);
    const d = drawSpec(s);
    if (d.kind !== "not-shown") throw new Error(`expected no drawing, got ${d.kind}`);
    expect(d.html).not.toContain("<svg");
    expect(d.html).not.toMatch(/\$\d/);
    expect(d.words).toBe(why);
    expect(c.verdicts.every((v) => v.outcome === "cant_check")).toBe(true);
  };

  it("control failed: nothing is drawn, the page shows src/trust.ts's reason; every verdict is can't check", () => {
    const c = get("control-failed");
    expect(c.run.controlPassed).toBe(false);
    expectNotShown(c, /^Atlas's known-case check did not match, so this run is not shown as fact: fixture: the D04-04 run/);
  });

  it("sandbox failed (control passed, nothing measured): nothing is drawn, even with the reference and the trace still in the file", () => {
    const base = get("level2-count1");
    const withReason: Run = { ...base.run, id: `${base.run.id}-sandbox-failed`, controlPassed: true, result: { ...base.run.result, measured: {}, notMeasured: { run: "fixture: the sandbox stopped before the read finished" } } };
    expect(withReason.result.references!["refUsd1e18:cbETH"]).toBeDefined();
    expectNotShown({ run: withReason, bets: base.bets, verdicts: base.bets.map((b) => judge(b, withReason)) }, /^The sandbox did not finish this run, so nothing from it is shown as fact: fixture: the sandbox stopped/);
    const noTrace: Run = { ...base.run, id: `${base.run.id}-no-trace`, controlPassed: true, trace: [], result: { measured: {}, notMeasured: {} } };
    expectNotShown({ run: noTrace, bets: base.bets, verdicts: base.bets.map((b) => judge(b, noTrace)) }, /the run recorded no trace$/);
  });

  it("the block on the price ticket comes from the run's fork block; the file's Level captions are carried word for word", () => {
    const base = get("level2-count1");
    const block = (run: Run) => moonwellFlow({ run }).nodes.find((n) => n.id === "price")!.small;
    expect(block({ ...base.run, forkBlock: MOONWELL_LEVEL2_BLOCK })).toBe(`at block ${MOONWELL_LEVEL2_BLOCK}`);
    expect(block({ ...base.run, forkBlock: MOONWELL_LEVEL1_BLOCK })).toBe(`at block ${MOONWELL_LEVEL1_BLOCK}`);
    expect(captionsOf(flow(base, [LEVEL2_CAPTION]))).toContain(LEVEL2_CAPTION);
    const l1 = level1Caption(MOONWELL_LEVEL1_BLOCK);
    expect(captionsOf(flow(get("level1-not-measured"), [l1]))).toContain(l1);
  });

  it("Level 1 real run: the source count was not measured, so the words say that and no step is claimed absent; never 'caught before shipping'", () => {
    const c = get("level1-not-measured");
    expect("priceSources:cbETH" in c.run.result.measured).toBe(false);
    const s = flow(c);
    expectDrawsClean(s);
    expect(s.edges.find((e) => e.id === "e-price")!.words).toMatch(/not measured/);
    expect(s.nodes.some((n) => n.missing || n.id === "gear")).toBe(false);
    expect(s.edges.some((e) => e.id === "e-gear")).toBe(false);
    expect(wordsOf(s)).not.toMatch(/multiply step/);
    expect(s.nodes.find((n) => n.id === "price")!.small).toBe("at block 42194663");
    for (const k of cases.values()) expect(wordsOf(flow(k))).not.toMatch(NEVER_CLAIM);
  });

  it("an explicit notMeasured count: no step claimed absent, the words say not measured", () => {
    const base = get("level2-count1");
    const measured = { ...base.run.result.measured };
    delete measured["priceSources:cbETH"];
    const run = { ...base.run, result: { ...base.run.result, measured, notMeasured: { "priceSources:cbETH": "the call trace read a price another way" } } };
    const s = moonwellFlow({ run, bets: base.bets, verdicts: base.verdicts });
    expect(s.nodes.some((n) => n.missing)).toBe(false);
    expect(s.edges.find((e) => e.id === "e-price")!.words).toMatch(/not measured/);
  });

  it("every case: the allowed wording, whole, on a wide page and a phone; no word judges the code; the parts are named for what they are", () => {
    for (const c of [get("level2-count1"), get("pre-apply-count2"), get("level1-not-measured")]) {
      const s = flow(c, [LEVEL2_CAPTION]);
      expect(s.captions[0]).toEqual({ words: MOONWELL_ALLOWED_WORDS, provenance: "plain-code" });
      // The caption wraps by line; the line cap must not cut the only allowed sentence.
      for (const narrow of [false, true]) expect(drawnCaptions(s, narrow)).toEqual(captionsOf(s));
      expect(s.nodes.map((n) => [n.id, n.words].join(" ")).join(" ")).not.toMatch(JUDGEMENT);
      expect(s.edges.map((e) => [e.id, e.words ?? ""].join(" ")).join(" ")).not.toMatch(JUDGEMENT);
      expect(wordsOf(s)).not.toMatch(JUDGEMENT);
    }
  });

  it("reduced motion: the first paint is the finished picture, no animation runs, the words and the marks are all there", async () => {
    for (const id of ["level2-count1", "pre-apply-count2"]) {
      const animate = reducedMotionPage();
      const c = get(id);
      const host = await paint(<MoonwellDrawing run={c.run} bets={c.bets} verdicts={c.verdicts} />);
      expect(animate).not.toHaveBeenCalled();
      expectFinished(host, flow(c));
      expect(host.textContent).toContain("the oracle reported");
      document.body.innerHTML = "";
    }
  });

  it("the check above can fail: with reduced motion off and `animate` present, the player would animate", () => {
    (SVGElement.prototype as unknown as { animate: unknown }).animate = vi.fn();
    const s = flow(get("level2-count1"));
    const host = document.createElement("div");
    expect(mountDrawing(host, drawSpec(s), s, { reducedMotion: false }).player!.reduced).toBe(false);
    expect(mountDrawing(host, drawSpec(s), s, { reducedMotion: true }).player!.reduced).toBe(true);
  });
});

describe("the retry demo: the rules of the old retry machine", () => {
  const rounds = new Map<string, Round>();
  const MAX = BOUNDS.attempts.max;
  beforeAll(async () => {
    const app = createApp();
    for (const r of ROUNDS) rounds.set(r.id, await playRound(app, r.id, r.params, r.answers));
    rounds.set("D04-04", d0404Round());
    rounds.set("attempts10", await playRound(app, "attempts10", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 10 }, { calls: { kind: "integer", value: 10 } }));
    rounds.set("attemptsMax", await playRound(app, "attemptsMax", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: MAX }, { calls: { kind: "integer", value: MAX } }));
  }, 120_000);
  const demo = (r: Pick<Round, "run" | "bets" | "verdicts">) => retryDemo({ run: r.run, bets: r.bets, verdicts: r.verdicts });
  const traceCount = (r: Round, event: string) => r.run.trace.filter((e) => e.event === event).length;
  const callTickets = (s: RenderSpec) => s.nodes.filter((n) => /^\d+(st|nd|rd|th) call$/.test(n.small ?? ""));
  const waits = (s: RenderSpec) => s.nodes.filter((n) => n.kind === "clock");

  it("S3 real run: 5 calls, 4 waits of 3,000 ms, and it threw the 5th call's error, the same as a count taken straight from the trace", () => {
    const r = rounds.get("S3")!;
    // Counted from the trace, independently of the author:
    const calls = traceCount(r, "call");
    const sleeps = r.run.trace.filter((e) => e.event === "sleep").map((e) => e.data!.ms);
    const thrown = r.run.trace.find((e) => e.event === "throws")!.data!.error as string;
    const from = r.run.trace.filter((e) => e.event === "reject").findIndex((e) => e.data!.error === thrown) + 1;
    expect([calls, sleeps, from]).toEqual([5, [3000, 3000, 3000, 3000], 5]);
    expect(r.run.result.measured).toMatchObject({ calls: 5, waitCount: 4, totalWaitMs: 12000, outcome: "throws", thrownFromCall: 5 });
    const s = demo(r);
    expectDrawsClean(s);
    expect(callTickets(s).map((n) => n.small)).toEqual(["1st call", "2nd call", "3rd call", "4th call", "5th call"]);
    expect(waits(s).map((n) => n.words)).toEqual(["waited 3,000 ms", "waited 3,000 ms", "waited 3,000 ms", "waited 3,000 ms"]);
    const name = thrown.split(":")[0]!;
    expect(s.nodes.at(-1)!.words).toBe(`threw ${name} at 12,000 ms`);
    // The error it threw is the one the 5th call got: the thread leaving the last call says so.
    expect(s.edges.find((e) => e.from === callTickets(s).at(-1)!.id)!.words).toBe(`threw ${name}`);
    expect(captionsOf(s)).toContain(RETRY_PRE_EXISTING);
    expect(wordsOf(s)).not.toContain(RETRY_VIEM_CAP.trim());
  });

  it("S6 real run: one call, no wait, no second try; it says nothing could wake it, and that production caps this", () => {
    const r = rounds.get("S6")!;
    expect(traceCount(r, "call")).toBe(1);
    expect(traceCount(r, "sleep")).toBe(0);
    expect(r.run.result.measured.outcome).toBe("pending");
    const s = demo(r);
    expectDrawsClean(s);
    expect(callTickets(s)).toHaveLength(1);
    expect(waits(s)).toEqual([]);
    expect(s.edges[0]!.words).toBe("never answered");
    expect(s.nodes.at(-1)!.words).toBe("still waiting when Atlas stopped: nothing was left to wake it");
    expect(captionsOf(s)).toContain(`${RETRY_PRE_EXISTING}${RETRY_VIEM_CAP}`);
    expect(wordsOf(s)).not.toMatch(NEVER_CLAIM);
  });

  it("a run stopped at Atlas's watch limit: it says the limit was Atlas's, makes no claim of how it ended, and adds no production cap line it does not need", async () => {
    const out = await runScenario(withRpcRetry as RetryFn, { failTimes: 0, failure: "error", resolveAfterMs: 40_000 }, { seed: "w", watchLimitMs: 30_000 });
    const run = { ...rounds.get("S6")!.run, trace: out.trace, result: out.result };
    const s = retryDemo({ run, bets: [], verdicts: [] });
    expect(specProblems(s)).toEqual([]);
    expect(wordsOf(s)).toMatch(/Atlas's watch limit \(30000 ms of virtual time, Atlas's limit, not the code's\)/);
    expect(callTickets(s)).toHaveLength(1);
    expect(s.nodes.some((n) => n.kind === "ticket" && /^(returned|threw)/.test(n.words))).toBe(false);
    expect(wordsOf(s)).not.toMatch(/Still pending|still pending/);
    expect(wordsOf(s)).not.toMatch(NEVER_CLAIM);
  });

  it("marks come from Bet[] only: none without bets; from the D04-04 bets, the person and Muse Spark, named (D10)", () => {
    const r = rounds.get("D04-04")!;
    expect(retryDemo({ run: r.run, bets: [], verdicts: r.verdicts }).marks).toEqual([]);
    const s = demo(r);
    expect(r.bets.filter((b) => b.measures === "calls").map((b) => b.who)).toEqual(["human", "model:muse-spark-1.3"]);
    expect(s.marks.map((m) => m.kind)).toContain("matched");
    const all = s.marks.map((m) => `${m.who} ${m.words}`).join(" ");
    expect(all).toContain("you said");
    expect(all).toContain("muse-spark-1.3 said");
    expect(all).not.toContain("model:");
  });

  for (const [name, id, n] of [["attempts 10", "attempts10", 10], ["attempts = the gate's max", "attemptsMax", MAX]] as const) {
    it(`${name} (gate's max read from src/gate.ts): ${n} calls and ${n - 1} waits on the path, exact, with the ${n}th call marked by its own number`, () => {
      const r = rounds.get(id)!;
      expect(traceCount(r, "call")).toBe(n);
      const s = demo(r);
      expectDrawsClean(s);
      // Folded or not, the path states the exact counts.
      const ticketed = callTickets(s).length;
      const folded = s.nodes.filter((x) => /^called the RPC \d+ times$/.test(x.words)).map((x) => Number(/\d+/.exec(x.words)![0]));
      expect(ticketed + folded.reduce((a, b) => a + b, 0)).toBe(n);
      if (folded.length === 0) {
        expect(callTickets(s).at(-1)!.small).toBe(`${n}th call`);
        expect(waits(s).filter((w) => w.words === "waited 3,000 ms")).toHaveLength(n - 1);
      }
      expect(s.nodes.at(-1)!.words).toMatch(new RegExp(`^threw \\S+ at ${((n - 1) * 3000).toLocaleString("en-US")} ms$`));
      expect(s.marks[0]).toMatchObject({ kind: "matched", who: "you" });
      expect(s.marks[0]!.words).toContain(`said ${n} calls`);
    });
  }

  it("no part is named after something the code does not have: no timer, timeout, abort or backoff on any part it drew", () => {
    for (const id of ["S3", "S6", "S2", "D04-04"]) {
      const s = demo(rounds.get(id)!);
      const parts = s.nodes.filter((n) => n.small !== "the end").map((n) => `${n.id} ${n.words}`).join(" ");
      expect(parts).not.toMatch(/timer|timeout|abort|backoff/i);
    }
  });

  it("every round: no word judges the code; no never-claim wording; the caption words are drawn whole on a phone", () => {
    for (const id of ["S3", "S6", "S2", "D04-04", "attempts10"]) {
      const s = demo(rounds.get(id)!);
      expect(wordsOf(s)).not.toMatch(JUDGEMENT);
      expect(wordsOf(s)).not.toMatch(NEVER_CLAIM);
      for (const narrow of [false, true]) expect(drawnCaptions(s, narrow)).toEqual(captionsOf(s));
    }
  });

  it("reduced motion: the first paint is the finished path (every step, the marks, the captions), no animation runs", async () => {
    const animate = reducedMotionPage();
    const r = rounds.get("S3")!;
    const host = await paint(<RunPath run={r.run} bets={r.bets} verdicts={r.verdicts} retry />);
    expect(animate).not.toHaveBeenCalled();
    expectFinished(host, demo(r));
    expect(host.textContent).toContain("waited 3,000 ms");
    expect(host.querySelector('[data-testid="retry-path"]') ?? host.querySelector('[data-testid="run-path"]')).not.toBeNull();
  });
});

// The agent's findings, fixed in the authors: these are the strict rules.
describe("R3 moved rules that first needed the author fixed", () => {
  const moonwell = (blockRun: Record<string, unknown>, bets: unknown[] = [], verdicts: unknown[] = []) => moonwellFlow({ run: { id: "r", runner: "evm", controlPassed: true, trace: [{ t: 0, event: "x" }], result: { measured: { "priceUsd1e18:cbETH": "1120000000000000000", ...((blockRun.measured as object) ?? {}) }, notMeasured: (blockRun.notMeasured as Record<string, string>) ?? {} }, ...blockRun } as never, bets: bets as never, verdicts: verdicts as never });
  const caps = (s: ReturnType<typeof moonwellFlow>) => s.captions.map((c) => c.words).join(" | ");
  it("the Level words come from the fork block: each block its own, any other block none", () => {
    expect(caps(moonwell({ forkBlock: 42194662 }))).toContain(LEVEL2_CAPTION);
    expect(caps(moonwell({ forkBlock: 42194663 }))).toContain(level1Caption(42194663));
    const other = caps(moonwell({ forkBlock: 5 }));
    expect(other).not.toContain(LEVEL2_CAPTION);
    expect(other).not.toContain(level1Caption(42194663));
  });
  it("no bets, no dashed outline: nobody expected the step", () => {
    const s = moonwell({ forkBlock: 42194662, measured: { "priceSources:cbETH": 1 } });
    expect(s.nodes.some((n) => n.missing)).toBe(false);
  });
  it("a bet that matched, or declined, does not claim the bettors expected a step", () => {
    const bet = { id: "b", who: "human", measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 1.12, tolerancePct: 1, unit: "usd" } };
    const s = moonwell({ forkBlock: 42194662, measured: { "priceSources:cbETH": 1 } }, [bet], [{ betId: "b", outcome: "matched" }]);
    expect(s.nodes.map((n) => n.words).join()).not.toMatch(/no multiply step here/);
    const miss = moonwell({ forkBlock: 42194662, measured: { "priceSources:cbETH": 1 } }, [bet], [{ betId: "b", outcome: "not_matched" }]);
    expect(miss.nodes.map((n) => n.words).join()).toMatch(/no multiply step here/);
  });
  it("the runner's reason for an unmeasured count is said", () => {
    const s = moonwell({ forkBlock: 42194662, notMeasured: { "priceSources:cbETH": "the call trace read a price another way" } });
    expect(s.edges.map((e) => e.words).join()).toMatch(/the call trace read a price another way/);
  });
});
