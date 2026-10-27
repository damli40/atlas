// D05-02: the retry machine, a Figure drawn from { run, bets, verdicts } only.
// - model.ts imports nothing but the input types.
// - The parts manifest lists every drawn part (40–80), and none is named timer/timeout/clock/abort/backoff.
// - S3 (real run through the real server): the readout prints calls 5, waits 4 × 3,000 ms, "threw the
//   5th error", and every number equals a count taken straight from the trace.
// - S6 (real run): the lever never moves, 0 retries, and the watch-limit/pending line is a caption.
// - Ghost markers come from Bet[] only; reduced motion paints the end state first.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { runScenario, type RetryFn } from "../../runners/ts/harness";
import { withRpcRetry } from "../fixtures/with-rpc-retry";
import { FORBIDDEN_PART_WORDS, PARTS, capsuleWorld, leverAt, move } from "../../web/machines/retry/geometry";
import { poseAt, retryModel } from "../../web/machines/retry/model";
import { RetryMachine } from "../../web/machines/retry/RetryMachine";
import { ROUNDS, d0404Round, playRound, type Round } from "../tools/machine-pages";

const ROOT = join(__dirname, "../..");
const rounds = new Map<string, Round>();

beforeAll(async () => {
  const app = createApp();
  for (const r of ROUNDS) rounds.set(r.id, await playRound(app, r.id, r.params, r.answers));
  rounds.set("D04-04", d0404Round());
}, 60_000);

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  document.body.innerHTML = "";
});

const partsIn = (html: string) => new Set([...html.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]!));
const traceCount = (r: Round, event: string) => r.run.trace.filter((e) => e.event === event).length;

describe("D05-02 retry machine", () => {
  it("model.ts imports nothing but the types of its input and the pure src/trust.ts rule (which imports only types)", () => {
    const src = readFileSync(join(ROOT, "web/machines/retry/model.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim());
    expect(imports).toEqual(['import type { Bet, Run, Verdict } from "../../../src/types";', 'import { notShownAsFact } from "../../../src/trust";']);
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);
    const trust = readFileSync(join(ROOT, "src/trust.ts"), "utf8");
    expect([...trust.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim())).toEqual(['import type { Run } from "./types";']);
    expect(trust).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("parts manifest: 40–80 parts, every drawn part is listed and every listed part is drawn, none forbidden", () => {
    expect(PARTS.length).toBeGreaterThanOrEqual(40);
    expect(PARTS.length).toBeLessThanOrEqual(80);
    expect(new Set(PARTS).size).toBe(PARTS.length);
    for (const name of PARTS) for (const bad of FORBIDDEN_PART_WORDS) expect(name.toLowerCase()).not.toContain(bad);
    const r = rounds.get("D04-04")!;
    const html = renderToStaticMarkup(<RetryMachine run={r.run} bets={r.bets} verdicts={r.verdicts} still theme="light" />);
    const drawn = partsIn(html);
    expect([...drawn].sort()).toEqual([...PARTS].sort());
    // Nothing in the drawing (part names and class names) is named after a timer, timeout, clock, abort or backoff.
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
    const names = [...svg.matchAll(/(?:data-part|class)="([^"]+)"/g)].map((m) => m[1]!.toLowerCase());
    for (const n of names) for (const bad of FORBIDDEN_PART_WORDS) expect(n).not.toContain(bad);
  });

  it("S3 real run: the readout prints calls 5, waits 4 × 3,000 ms, threw the 5th error, the same as the trace", () => {
    const r = rounds.get("S3")!;
    const m = retryModel(r);
    // Counted from the trace, independently of model.ts:
    const calls = traceCount(r, "call");
    const sleeps = r.run.trace.filter((e) => e.event === "sleep").map((e) => e.data!.ms);
    const thrown = r.run.trace.find((e) => e.event === "throws")!.data!.error as string;
    const from = r.run.trace.filter((e) => e.event === "reject").findIndex((e) => e.data!.error === thrown) + 1;
    expect([calls, sleeps, from]).toEqual([5, [3000, 3000, 3000, 3000], 5]);
    expect(r.run.result.measured).toMatchObject({ calls: 5, waitCount: 4, totalWaitMs: 12000, outcome: "throws", thrownFromCall: 5 });
    expect(m.readout).toBe("calls 5 · waits 4 × 3,000 ms · threw the 5th error");
    expect(m.pulls).toBe(calls - 1);
    expect(m.engraving).toBe("3 s (virtual)");
    // On the card: the readout corner, the five capsules in the rack, 4 pull marks, 4 drum-turn marks.
    const html = renderToStaticMarkup(<RetryMachine run={r.run} bets={r.bets} verdicts={r.verdicts} still theme="light" />);
    expect(html).toContain('data-readout="">calls 5 · waits 4 × 3,000 ms · threw the 5th error</span>');
    expect((html.match(/class="rm-capsule"/g) ?? []).length).toBe(5);
    expect((html.match(/data-shows="threw"/g) ?? []).length).toBe(5);
    const pullMarks = html.slice(html.indexOf("rm-pull-marks"), html.indexOf("</g>", html.indexOf("rm-pull-marks")));
    expect((pullMarks.match(/data-on/g) ?? []).length).toBe(4);
    const turnMarks = html.slice(html.indexOf("rm-turn-marks"), html.indexOf("</g>", html.indexOf("rm-turn-marks")));
    expect((turnMarks.match(/data-on/g) ?? []).length).toBe(4);
    // The lit capsule at the end is the 5th: the call whose error was thrown.
    expect(poseAt(m, Infinity).capsules.filter((c) => c.lit).map((c) => c.n)).toEqual([5]);
    // The lever is pulled exactly 4 times through the story.
    let pulls = 0;
    let out = false;
    for (let s = 0; s <= m.total; s += 0.02) {
      const now = poseAt(m, s).lever > 0.5;
      if (now && !out) pulls++;
      out = now;
    }
    expect(pulls).toBe(4);
  });

  it("S6 real run: the lever never moves, 0 retries, and how it ended is a caption under the card", () => {
    const r = rounds.get("S6")!;
    const m = retryModel(r);
    expect(traceCount(r, "call")).toBe(1);
    expect(traceCount(r, "sleep")).toBe(0);
    expect(r.run.result.measured.outcome).toBe("pending");
    expect(m.pulls).toBe(0);
    for (let s = 0; s <= m.total + 0.5; s += 0.05) expect(poseAt(m, s).lever).toBe(0);
    expect(m.readout).toBe("calls 1 · waits 0 · still pending");
    // The harness ended the watch because nothing could wake the function (not at the 30,000 ms limit),
    // and the caption says so in the trace's own words.
    expect(m.endCaption).toMatch(/^Still pending when Atlas stopped watching: nothing was left that could wake it/);
    expect(m.endCaption).toMatch(/0 retries\.$/);
    const html = renderToStaticMarkup(<RetryMachine run={r.run} bets={r.bets} verdicts={r.verdicts} still theme="light" />);
    const caption = html.slice(html.indexOf('class="iso-legend"'));
    expect(caption).toContain('data-testid="retry-end-caption"');
    expect(caption).toContain("0 retries");
    // Not a part: the SVG has no element named after the watch, and the chute holds no capsule.
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
    expect(svg).not.toMatch(/watch|limit/i);
    expect(poseAt(m, Infinity).capsules.map((c) => c.where.at)).toEqual(["gone"]);
  });

  it("a run stopped at Atlas's watch limit says so as a caption, with 0 retries so far", async () => {
    const out = await runScenario(withRpcRetry as RetryFn, { failTimes: 0, failure: "error", resolveAfterMs: 40_000 }, { seed: "w", watchLimitMs: 30_000 });
    const run = { ...rounds.get("S6")!.run, trace: out.trace, result: out.result };
    const m = retryModel({ run, bets: [], verdicts: [] });
    expect(m.endCaption).toMatch(/^Still pending at Atlas's watch limit: Atlas's watch limit \(30000 ms of virtual time/);
    expect(m.endCaption).toMatch(/0 retries so far\.$/);
    expect(m.readout).toBe("calls 1 · waits 0 · still waiting when Atlas stopped watching");
  });

  it("ghost markers are drawn from Bet[] only: none without bets; person solid and model ring from the D04-04 bets", () => {
    const r = rounds.get("D04-04")!;
    const none = renderToStaticMarkup(<RetryMachine run={r.run} bets={[]} verdicts={r.verdicts} still theme="light" />);
    expect(none).not.toMatch(/rm-ghost[" ]/);
    expect(none).toContain("rm-ghosts"); // the empty layer is there; it just holds no marker
    const m = retryModel(r);
    expect(m.ghosts.map((g) => [g.who, g.value, g.slot, g.outcome])).toEqual([
      ["human", 5, 5, "matched"],
      ["model:muse-spark-1.3", 5, 5, "matched"],
    ]);
    const html = renderToStaticMarkup(<RetryMachine run={r.run} bets={r.bets} verdicts={r.verdicts} still theme="light" />);
    expect((html.match(/data-kind="person"/g) ?? []).length).toBe(1);
    expect((html.match(/data-kind="model"/g) ?? []).length).toBe(1);
    // A bet off the ruler is kept at the ruler's end and the caption says so.
    const far = { ...r, bets: r.bets.map((b) => (b.who === "human" && b.measures === "calls" ? { ...b, answer: { kind: "integer" as const, value: 12 } } : b)) };
    expect(retryModel(far).ghosts[0]).toMatchObject({ value: 12, slot: 10, offScale: true }); // day-5 S4: the ruler has 10 slots (was 8)
  });

  it("reduced motion: the first paint is the end state (every capsule in its slot, final readout)", () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} });
    const r = rounds.get("S3")!;
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => createRoot(host).render(<RetryMachine run={r.run} bets={r.bets} verdicts={r.verdicts} theme="light" />));
    expect(host.querySelector("[data-readout]")!.textContent).toBe("calls 5 · waits 4 × 3,000 ms · threw the 5th error");
    const caps = [...host.querySelectorAll<SVGGElement>(".rm-capsule")];
    expect(caps.length).toBe(5);
    caps.forEach((g, i) => {
      expect(g.getAttribute("transform")).toBe(move(capsuleWorld({ at: "slot", p: 1 }, i + 1)));
      expect(g.style.display).not.toBe("none");
    });
    expect(host.querySelector(".rm-lever")!.getAttribute("transform")).toBe(leverAt(0));
    expect(host.querySelector(".rm-live")!.hasAttribute("data-still")).toBe(true);
  });
});
