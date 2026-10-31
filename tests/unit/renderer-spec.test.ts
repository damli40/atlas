// R3: the contract's refusals. A spec that breaks an honesty rule is not drawn.
import { describe, expect, it } from "vitest";
import { assertSpec, specProblems, SpecRefused, type RenderSpec } from "../../renderer/spec";
import { drawSpec } from "../../renderer/live/draw";

const base = (o: Partial<RenderSpec> = {}): RenderSpec => ({ version: 1, stage: "after-run", seed: "s", nodes: [{ id: "a", kind: "ticket", words: "a", provenance: "plain-code" }, { id: "b", kind: "ticket", words: "b", provenance: "plain-code" }], edges: [], regions: [], marks: [], captions: [], steps: [], ...o });

describe("R3 spec validation", () => {
  it("accepts a plain spec", () => expect(specProblems(base())).toEqual([]));
  it("refuses an edge to a missing node, either end", () => {
    expect(specProblems(base({ edges: [{ id: "e", from: "a", to: "ghost", kind: "thread", provenance: "plain-code" }] })).join()).toMatch(/ends at a node that does not exist/);
    expect(specProblems(base({ edges: [{ id: "e", from: "ghost", to: "a", kind: "thread", provenance: "plain-code" }] })).join()).toMatch(/starts at a node that does not exist/);
  });
  it("refuses a Wonder-only join drawn as a thread, and allows it as a dashed note", () => {
    expect(specProblems(base({ edges: [{ id: "e", from: "a", to: "b", kind: "thread", provenance: "wonder-words" }] })).join()).toMatch(/only Muse Wonder's words/);
    expect(specProblems(base({ edges: [{ id: "e", from: "a", to: "b", kind: "dashed-note", provenance: "wonder-words" }] }))).toEqual([]);
  });
  it("refuses every kind of run data in a pre-bet spec", () => {
    const edge = { id: "e", from: "a", to: "b", kind: "thread" as const, provenance: "plain-code" as const };
    const bad: Partial<RenderSpec>[] = [
      { nodes: [{ id: "a", kind: "ticket", words: "x", provenance: "run" }, { id: "b", kind: "ticket", words: "b", provenance: "plain-code" }] },
      { edges: [{ ...edge, provenance: "run" }] },
      { edges: [edge], path: { edges: ["e"], provenance: "run" } },
      { edges: [edge], path: { edges: ["e"], provenance: "plain-code", partsWaysAt: "b" } },
      { captions: [{ words: "x", provenance: "run" }] },
      { steps: [{ id: "s", nodes: ["a"], edges: [], provenance: "run" }] },
      { marks: [{ on: "a", kind: "matched", who: "you" }] },
    ];
    for (const b of bad) expect(specProblems(base({ stage: "pre-bet", ...b })).join()).toMatch(/pre-bet but holds run data/);
    for (const b of bad) expect(specProblems(base({ stage: "after-run", ...b })).join()).not.toMatch(/pre-bet/);
  });
  it("refuses dangling paths, marks, steps, regions, duplicate ids and a broken path", () => {
    const e1 = { id: "e1", from: "a", to: "b", kind: "thread" as const, provenance: "run" as const };
    const e2 = { id: "e2", from: "a", to: "b", kind: "thread" as const, provenance: "run" as const };
    expect(specProblems(base({ path: { edges: ["nope"], provenance: "run" } })).join()).toMatch(/does not exist/);
    expect(specProblems(base({ edges: [e1, e2], path: { edges: ["e1", "e2"], provenance: "run" } })).join()).toMatch(/breaks at/);
    expect(specProblems(base({ edges: [{ ...e1, kind: "dashed-note" }], path: { edges: ["e1"], provenance: "run" } })).join()).toMatch(/not a thread/);
    expect(specProblems(base({ marks: [{ on: "nope", kind: "matched", who: "you" }] })).join()).toMatch(/does not exist/);
    expect(specProblems(base({ steps: [{ id: "s", nodes: ["nope"], edges: ["nope"], provenance: "run" }] })).length).toBe(2);
    expect(specProblems(base({ nodes: [{ id: "a", kind: "ticket", words: "x", provenance: "run", region: "nope" }] })).join()).toMatch(/region that does not exist/);
    expect(specProblems(base({ regions: [{ id: "r", words: "x", kind: "folder", parent: "q" }, { id: "q", words: "x", kind: "folder", parent: "r" }] })).join()).toMatch(/its own parent/);
    expect(specProblems(base({ nodes: [{ id: "a", kind: "ticket", words: "x", provenance: "run" }, { id: "a", kind: "ticket", words: "x", provenance: "run" }] })).join()).toMatch(/share the id/);
  });
  it("assertSpec and drawSpec refuse, with the reason", () => {
    const bad = base({ edges: [{ id: "e", from: "a", to: "b", kind: "thread", provenance: "wonder-words" }] });
    expect(() => assertSpec(bad)).toThrow(SpecRefused);
    expect(() => drawSpec(bad)).toThrow(/may not be drawn/);
  });
});
