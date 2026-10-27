// D05-03: the price pipe, a Figure drawn from { run, bets, verdicts } only.
// - model.ts imports nothing but the input types, src/units.ts's USD formatter, the pure src/trust.ts
//   rule and the two fork block numbers in src/moonwell-blocks.ts (both of those import nothing at run time).
// - The parts manifest lists every drawn part (40–80); no part is named after a judgement of the code.
// - Level 2 real run (D04-04, mwTaxvHFzB): 1 price source → no gear, the slot is a dashed outline.
// - The pre-apply phase of the same run (a fixture built from it): 2 price sources → the gear is there.
// - Control failed, or the sandbox measured nothing (src/trust.ts) → the card is not drawn: no needle, no
//   readout numbers, no gear or slot claim, the reason sentence only.
// - The Level caption comes from the run's fork block only (42194662 → Level 2, 42194663 → Level 1, else none).
// - Level 1 real run (D03-03): the count was not measured → plain slot, "not measured".
// - Ghost bet marks come from Bet[] only; a declined bet has no mark; reduced motion paints the end state.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LEVEL2_CAPTION, level1Caption } from "../../src/atlasfile";
import { judge } from "../../src/judge";
import { MOONWELL_LEVEL1_BLOCK, MOONWELL_LEVEL2_BLOCK } from "../../src/moonwell-blocks";
import { notShownAsFact } from "../../src/trust";
import type { Run } from "../../src/types";
import { FORK_BLOCK } from "../../runners/evm/moonwell-base";
import { formatUsd1e18 } from "../../src/units";
import { PARTS, PRICE_NEEDLE_LEN, REF_NEEDLE_LEN, needleAt } from "../../web/machines/pricepipe/geometry";
import { dialAt, levelOf, pipeModel, poseAt } from "../../web/machines/pricepipe/model";
import { PricePipe } from "../../web/machines/pricepipe/PricePipe";
import { pipeCases, type PipeCase } from "../tools/pipe-cases";

const ROOT = join(__dirname, "../..");
/** Words no part may be named with: the machine shows what the run did, never a judgement of the code.
 *  Kept here, not in web/, because the wording lint forbids these words anywhere in the product code. */
const FORBIDDEN_PART_WORDS = ["bug", "missing", "broken", "wrong", "error", "fault", "fix", "correct"] as const;
const cases = new Map(pipeCases().map((c) => [c.id, c]));
const get = (id: string) => cases.get(id)!;

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  document.body.innerHTML = "";
});

const render = (c: PipeCase, theme: "light" | "dark" = "light") =>
  renderToStaticMarkup(<PricePipe run={c.run} bets={c.bets} verdicts={c.verdicts} still theme={theme} {...(c.captionOverride ? { captionOverride: c.captionOverride } : {})} />);
const partsIn = (html: string) => new Set([...html.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]!));
const svgOf = (html: string) => html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
const readoutOf = (html: string) => /data-readout="">([^<]*)</.exec(html)![1]!;

describe("D05-03 price pipe", () => {
  it("model.ts imports nothing but its input types, the USD formatter, the pure src/trust.ts rule and the fork block numbers", () => {
    const importsOf = (rel: string) => [...readFileSync(join(ROOT, rel), "utf8").matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim());
    const src = readFileSync(join(ROOT, "web/machines/pricepipe/model.ts"), "utf8");
    expect(importsOf("web/machines/pricepipe/model.ts")).toEqual([
      'import type { Bet, Run, Verdict } from "../../../src/types";',
      'import { MOONWELL_LEVEL1_BLOCK, MOONWELL_LEVEL2_BLOCK } from "../../../src/moonwell-blocks";',
      'import { notShownAsFact } from "../../../src/trust";',
      'import { formatUsd1e18 } from "../../../src/units";',
    ]);
    expect(src).not.toMatch(/\brequire\(|\bimport\(|\bfetch\(|Date\.now|Math\.random/);
    // src/trust.ts is pure: it imports types only. src/moonwell-blocks.ts imports nothing.
    expect(importsOf("src/trust.ts")).toEqual(['import type { Run } from "./types";']);
    expect(importsOf("src/moonwell-blocks.ts")).toEqual([]);
    for (const rel of ["src/trust.ts", "src/moonwell-blocks.ts"]) expect(readFileSync(join(ROOT, rel), "utf8")).not.toMatch(/\brequire\(|\bimport\(|\bfetch\(|Date\.now|Math\.random/);
    // The runner's fork blocks are the same two numbers.
    expect([FORK_BLOCK.beforeProposal, FORK_BLOCK.proposalExecuted]).toEqual([MOONWELL_LEVEL2_BLOCK, MOONWELL_LEVEL1_BLOCK]);
  });

  it("parts manifest: 40–80 parts, every drawn part is listed, every listed part is drawn in some case, none named after a judgement", () => {
    expect(PARTS.length).toBeGreaterThanOrEqual(40);
    expect(PARTS.length).toBeLessThanOrEqual(80);
    expect(new Set(PARTS).size).toBe(PARTS.length);
    for (const name of PARTS) for (const bad of FORBIDDEN_PART_WORDS) expect(name).not.toContain(bad);
    const union = new Set<string>();
    for (const c of cases.values()) {
      const html = render(c);
      const drawn = partsIn(html);
      for (const p of drawn) expect(PARTS as readonly string[]).toContain(p);
      drawn.forEach((p) => union.add(p));
      // Nothing in the drawing (part names, class names) is named after a judgement of the code.
      const names = [...svgOf(html).matchAll(/(?:data-part|class)="([^"]+)"/g)].map((m) => m[1]!.toLowerCase());
      for (const n of names) for (const bad of FORBIDDEN_PART_WORDS) expect(n).not.toContain(bad);
    }
    expect([...union].sort()).toEqual([...PARTS].sort());
  });

  it("Level 2 real run (count 1): no gear, the slot is a dashed outline drawn from the bets, the gauge reads $1.12 beside the $2,206.68 reference", () => {
    const c = get("level2-count1");
    // Counted from the run itself, separately from model.ts:
    const post = c.run.trace.find((e) => e.event === "call_trace" && e.data!.phase === "post-apply")!.data!;
    expect([post.count, c.run.result.measured["priceSources:cbETH"]]).toEqual([1, 1]);
    const m = pipeModel(c);
    expect(m.count).toBe(1);
    expect(m.slot).toEqual({ kind: "ghost", who: ["human", "model:muse-spark-1.3"] });
    expect(m.inlets).toEqual([
      { state: "read", label: "CBETH / ETH", labelFrom: "feedDescription" },
      { state: "blank", label: null, labelFrom: null },
    ]);
    expect(m.price!.text).toBe(formatUsd1e18(BigInt(c.run.result.measured["priceUsd1e18:cbETH"] as string)));
    expect(m.reference!.text).toBe(formatUsd1e18(BigInt(c.run.result.references!["refUsd1e18:cbETH"]!.value)));
    expect(m.readout).toBe("cbETH read $1.12 · reference $2,206.68 · 1 price source");
    const html = render(c);
    const parts = partsIn(html);
    expect(parts.has("multiply-gear")).toBe(false);
    expect(parts.has("gear-hub")).toBe(false);
    expect(parts.has("slot-ghost-outline")).toBe(true);
    expect(parts.has("inlet-2-blank-plate")).toBe(true);
    expect(parts.has("feed-2-canister")).toBe(false);
    expect(svgOf(html)).toMatch(/data-part="slot-ghost-outline"><path class="iso-line pp-ghost-outline"[^>]*data-dashed=""/);
    expect(readoutOf(html)).toBe("cbETH read $1.12 · reference $2,206.68 · 1 price source");
    // Both needles at their values; the reference is the shorter one.
    expect(svgOf(html)).toContain(`d="${needleAt(dialAt(1.1226627448748063).at, PRICE_NEEDLE_LEN)}"`);
    expect(svgOf(html)).toContain(`d="${needleAt(dialAt(2206.683650838065).at, REF_NEEDLE_LEN)}"`);
    // Ghost marks: the person's $2,200 is a solid dot; Spark declined, so no mark and the caption says "declined".
    expect(m.ghosts.map((g) => [g.who, g.usd, g.outcome])).toEqual([["human", 2200, "not_matched"]]);
    expect(m.declined).toEqual(["model:muse-spark-1.3"]);
    expect((html.match(/data-kind="person"/g) ?? []).length).toBe(1);
    expect((html.match(/data-kind="model"/g) ?? []).length).toBe(0);
    expect(html).toContain("muse-spark-1.3: declined (no mark)");
    // The Level caption from the run.
    expect(html).toContain(`data-testid="pipe-level-caption">${LEVEL2_CAPTION.replace(/'/g, "&#x27;")}.`);
  });

  it("pre-apply phase of the same run (fixture, count 2): the multiply gear is in the slot and both inlets are named", () => {
    const c = get("pre-apply-count2");
    const src = get("level2-count1").run.result.measured;
    // The fixture's numbers are the real run's own pre-apply values, not new ones.
    expect(c.run.result.measured["priceUsd1e18:cbETH"]).toBe(src["preApplyPriceUsd1e18:cbETH"]);
    expect(c.run.result.measured["priceSources:cbETH"]).toBe(src["preApplyPriceSources:cbETH"]);
    expect(c.run.trace.filter((e) => e.event === "call_trace").map((e) => [e.data!.phase, e.data!.count])).toEqual([["pre-apply", 2]]);
    const m = pipeModel(c);
    expect(m.slot).toEqual({ kind: "gear" });
    expect(m.inlets.map((i) => [i.state, i.label, i.labelFrom])).toEqual([
      ["read", "ETH / USD", "reference input"],
      ["read", "cbETH / ETH", "reference input"],
    ]);
    expect(m.readout).toBe("cbETH read $2,206.68 · reference $2,206.68 · 2 price sources");
    const parts = partsIn(render(c));
    expect(["multiply-gear", "gear-hub", "gear-spokes", "feed-1-canister", "feed-2-canister"].every((p) => parts.has(p))).toBe(true);
    expect(parts.has("slot-ghost-outline")).toBe(false);
    expect(parts.has("inlet-2-blank-plate")).toBe(false);
    // The gear turns during the story and rests a third of a turn on at the end.
    expect(poseAt(m, 0).gearTurn).toBe(0);
    expect(poseAt(m, Infinity).gearTurn).toBeCloseTo(1 / 3);
    expect(render(c)).toContain("fixture built from run mwTaxvHFzB");
  });

  /** Nothing from a not-shown run may reach the card: no needle, no number, no slot claim, the reason only. */
  const expectNotShown = (c: { run: Run; bets: PipeCase["bets"]; verdicts: PipeCase["verdicts"] }, reason: RegExp) => {
    const why = notShownAsFact(c.run);
    expect(why).toMatch(reason);
    const m = pipeModel(c);
    expect(m.notShown).toBe(why);
    expect([m.price, m.reference, m.count]).toEqual([null, null, null]);
    expect(m.slot).toEqual({ kind: "not_shown" });
    expect(m.inlets.every((i) => i.state === "unknown" && i.label === null)).toBe(true);
    expect([m.ghosts, m.declined, m.steps, m.readout]).toEqual([[], [], [], ""]);
    const html = renderToStaticMarkup(<PricePipe run={c.run} bets={c.bets} verdicts={c.verdicts} still theme="light" />);
    expect(html).toContain('data-testid="pipe-cant-check"');
    expect(html).toContain(why!.replace(/'/g, "&#x27;"));
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/data-part=|data-readout|pipe-level-caption|pipe-slot-caption|multiply gear|price source|\$\d/);
    for (const p of ["price-needle", "reference-needle", "multiply-gear", "slot-ghost-outline"]) expect(html).not.toContain(p);
    expect(c.verdicts.every((v) => v.outcome === "cant_check")).toBe(true);
  };

  it("control failed: the card is not drawn, it shows src/trust.ts's reason; every verdict is can't check", () => {
    const c = get("control-failed");
    expect(c.run.controlPassed).toBe(false);
    expectNotShown(c, /^Atlas's known-case check did not match, so this run is not shown as fact: fixture: the D04-04 run/);
    expect(pipeModel(c).controlReason).toBe("fixture: the D04-04 run with its control marked as not passed");
  });

  it("sandbox failed (control passed, nothing measured): the card is not drawn, it shows the sandbox reason", () => {
    const base = get("level2-count1");
    // Shaped like runners/ts/control.ts's sandbox failure: measured empty, the reason in notMeasured.run.
    // The reference and the trace are left in place: they must still not show.
    const withReason: Run = { ...base.run, id: `${base.run.id}-sandbox-failed`, controlPassed: true, result: { ...base.run.result, measured: {}, notMeasured: { run: "fixture: the sandbox stopped before the read finished" } } };
    expect(withReason.result.references!["refUsd1e18:cbETH"]).toBeDefined();
    expectNotShown({ run: withReason, bets: base.bets, verdicts: base.bets.map((b) => judge(b, withReason)) }, /^The sandbox did not finish this run, so nothing from it is shown as fact: fixture: the sandbox stopped/);
    // No reason given and no trace recorded: still not shown.
    const noTrace: Run = { ...base.run, id: `${base.run.id}-no-trace`, controlPassed: true, trace: [], result: { measured: {}, notMeasured: {} } };
    expectNotShown({ run: noTrace, bets: base.bets, verdicts: base.bets.map((b) => judge(b, noTrace)) }, /the run recorded no trace$/);
  });

  it("the Level caption comes from the run's fork block only, never from trace events", () => {
    expect([levelOf(42194662), levelOf(42194663), levelOf(42195500), levelOf(null), levelOf(undefined)]).toEqual(["level2", "level1", null, null, null]);
    const base = get("level2-count1");
    const caption = (run: Run) => /data-testid="pipe-level-caption">([^<]*)</.exec(renderToStaticMarkup(<PricePipe run={run} bets={base.bets} verdicts={base.verdicts} still theme="light" />))?.[1] ?? null;
    // A replay at the Level 2 block with no feed_set events (a "change it, then re-run" replay) is still Level 2.
    const replay: Run = { ...base.run, forkBlock: MOONWELL_LEVEL2_BLOCK, trace: base.run.trace.filter((e) => e.event !== "feed_set") };
    expect(replay.trace.some((e) => e.event === "feed_set")).toBe(false);
    expect(pipeModel({ ...base, run: replay }).level).toBe("level2");
    expect(caption(replay)).toBe(`${LEVEL2_CAPTION.replace(/'/g, "&#x27;")}. `);
    // feed_set events at the Level 1 block do not make it Level 2.
    const l1: Run = { ...base.run, forkBlock: MOONWELL_LEVEL1_BLOCK };
    expect(l1.trace.some((e) => e.event === "feed_set")).toBe(true);
    expect(pipeModel({ ...base, run: l1 }).level).toBe("level1");
    expect(caption(l1)).toBe(`${level1Caption(MOONWELL_LEVEL1_BLOCK)}. `);
    // An unknown block: no Level caption at all.
    const other: Run = { ...base.run, forkBlock: 42195500 };
    expect(pipeModel({ ...base, run: other }).level).toBeNull();
    expect(caption(other)).toBeNull();
  });

  it("Level 1 real run: the source count was not measured, so the slot is plain with 'not measured', no gear and no dashed claim", () => {
    const c = get("level1-not-measured");
    expect("priceSources:cbETH" in c.run.result.measured).toBe(false);
    const m = pipeModel(c);
    expect(m.count).toBeNull();
    expect(m.slot.kind).toBe("not_measured");
    expect(m.readout).toBe("cbETH read $1.12 · reference $2,206.68 · price sources not measured");
    const html = render(c);
    const parts = partsIn(html);
    expect(parts.has("multiply-gear")).toBe(false);
    expect(parts.has("slot-ghost-outline")).toBe(false);
    expect(parts.has("inlet-2-blank-plate")).toBe(false);
    expect(svgOf(html)).not.toContain("data-dashed");
    expect(html).toMatch(/data-testid="pipe-slot-caption">Gear slot: not measured/);
    // Level 1 caption from the run; never "caught before shipping".
    expect(html).toContain(`data-testid="pipe-level-caption">${level1Caption(42194663)}.`);
    for (const k of cases.values()) expect(render(k)).not.toMatch(/caught before shipping/i);
  });

  it("an explicit notMeasured count gives the runner's reason; a count with no bets leaves the slot empty, not dashed", () => {
    const base = get("level2-count1");
    const measured = { ...base.run.result.measured };
    delete measured["priceSources:cbETH"];
    const run = { ...base.run, result: { ...base.run.result, measured, notMeasured: { "priceSources:cbETH": "the call trace read a price another way" } } };
    expect(pipeModel({ run, bets: base.bets, verdicts: base.verdicts }).slot).toEqual({ kind: "not_measured", reason: "the call trace read a price another way" });
    const noBets = pipeModel({ run: base.run, bets: [], verdicts: [] });
    expect(noBets.slot).toEqual({ kind: "empty" });
    expect(noBets.ghosts).toEqual([]);
    expect(svgOf(renderToStaticMarkup(<PricePipe run={base.run} bets={[]} verdicts={[]} still theme="light" />))).not.toContain("data-dashed");
  });

  it("reduced motion: the first paint is the end state (needles at their values, final readout, gear at rest)", () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} });
    for (const id of ["level2-count1", "pre-apply-count2"]) {
      const c = get(id);
      const m = pipeModel(c);
      const host = document.createElement("div");
      document.body.appendChild(host);
      act(() => createRoot(host).render(<PricePipe run={c.run} bets={c.bets} verdicts={c.verdicts} theme="light" />));
      expect(host.querySelector("[data-readout]")!.textContent).toBe(m.readout);
      expect(host.querySelector(".pp-price-needle")!.getAttribute("d")).toBe(needleAt(m.price!.at, PRICE_NEEDLE_LEN));
      expect(host.querySelector(".pp-ref-needle")!.getAttribute("d")).toBe(needleAt(m.reference!.at, REF_NEEDLE_LEN));
      expect(host.querySelector(".pp-live")!.hasAttribute("data-still")).toBe(true);
      expect([...host.querySelectorAll<SVGCircleElement>(".pp-bead")].every((b) => b.style.display === "none")).toBe(true);
    }
  });
});
