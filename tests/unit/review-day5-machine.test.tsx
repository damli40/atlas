// Day-5 review, S4: the retry machine has a part for every call, pull and wait the gate allows.
// The gate allows attempts up to src/gate.ts BOUNDS.attempts.max (10). Before the fix the rack had 8 slots,
// so calls 8, 9 and 10 sat on top of each other, and the pull and turn counters lit 8 of 9 (probes5/p1).
// The test reads the gate's max from src/gate.ts, so the machine and the gate cannot drift apart.
// Real runs through the real server (TS runner, no model, no network).

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { BOUNDS } from "../../src/gate";
import { COUNTER, RACK, RULER, SLOTS, TURN_COUNTER, capsuleWorld, counterHole, move, slotX, turnHole } from "../../web/machines/retry/geometry";
import { poseAt, retryModel, RULER_SLOTS } from "../../web/machines/retry/model";
import { RetryMachine } from "../../web/machines/retry/RetryMachine";
import { playRound, type Round } from "../tools/machine-pages";

const MAX = BOUNDS.attempts.max;
const lit = (html: string, cls: string) => {
  const g = html.slice(html.indexOf(cls), html.indexOf("</g>", html.indexOf(cls)));
  return { on: (g.match(/data-on/g) ?? []).length, holes: (g.match(/<circle/g) ?? []).length };
};

let at10: Round;
let atMax: Round;
beforeAll(async () => {
  const app = createApp();
  at10 = await playRound(app, "attempts10", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 10 }, { calls: { kind: "integer", value: 10 } });
  atMax = await playRound(app, "attemptsMax", { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: MAX }, { calls: { kind: "integer", value: MAX } });
}, 60_000);

describe("S4: capacity ≥ the gate's most attempts", () => {
  it("slots, ruler and both counters are sized to the gate's max (read from src/gate.ts)", () => {
    expect(SLOTS).toBeGreaterThanOrEqual(MAX);
    expect(RULER_SLOTS).toBe(SLOTS);
    // Everything fits its part: the last slot's ring inside the rack's end posts, the ruler under it,
    // the pull holes inside the counter plate, the turn holes inside the turn counter.
    expect(slotX(SLOTS) + 4.4 + 1.2).toBeLessThan(RACK.x + RACK.w - 7);
    expect(RULER.x + RULER.w).toBeGreaterThanOrEqual(slotX(SLOTS));
    expect(counterHole(SLOTS - 1)[0] + 1.25).toBeLessThan(COUNTER.x + COUNTER.w);
    for (let k = 0; k < SLOTS; k++) {
      const [x, y] = turnHole(k);
      expect(x - 1.2).toBeGreaterThan(TURN_COUNTER.x);
      expect(x + 1.2).toBeLessThan(TURN_COUNTER.x + TURN_COUNTER.w);
      expect(y + 1.2).toBeLessThan(TURN_COUNTER.y + TURN_COUNTER.d);
    }
  });

  for (const [name, get, n] of [["attempts 10", () => at10, 10], ["attempts = the gate's max", () => atMax, MAX]] as const) {
    it(`${name}: ${n} calls in ${n} distinct slots, ${n - 1} pulls lit, ${n - 1} turns lit, the drum turns ${n - 1} times`, () => {
      const r = get();
      expect(r.run.trace.filter((e) => e.event === "call")).toHaveLength(n);
      const m = retryModel(r);
      const end = poseAt(m, Infinity);
      expect(new Set(end.capsules.map((c) => move(capsuleWorld(c.where, c.n)))).size).toBe(n);
      expect(end.drumTurns).toBe(n - 1);
      const html = renderToStaticMarkup(<RetryMachine run={r.run} bets={r.bets} verdicts={r.verdicts} still theme="light" />);
      expect(lit(html, "rm-pull-marks")).toEqual({ on: n - 1, holes: SLOTS });
      expect(lit(html, "rm-turn-marks")).toEqual({ on: n - 1, holes: SLOTS });
      expect(html).toContain(`calls ${n} · waits ${n - 1} × 3,000 ms · threw the ${n}th error`);
      // The bet of n calls sits on slot n, on the ruler (not pinned to its end).
      expect(m.ghosts[0]).toMatchObject({ value: n, slot: n, offScale: false });
    });
  }

  it("a run with more calls than slots (not reachable through the gate) is not drawn, and the card says why", () => {
    const r = at10;
    const call = r.run.trace.find((e) => e.event === "call")!;
    const more = { ...r.run, trace: [...r.run.trace, { ...call, data: { n: 11 } }] };
    const html = renderToStaticMarkup(<RetryMachine run={more} bets={[]} verdicts={[]} still theme="light" />);
    expect(html).not.toContain("<svg");
    expect(html).toContain(`the machine has ${SLOTS} slots, so it is not drawn`);
  });
});
