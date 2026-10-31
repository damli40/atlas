// R3: drawing: the checks on real specs, hostile names, empty and huge charts, cycles, self-loops, the time budget.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDeterministic, checkDrawing, checkSvgSafety } from "../../renderer/check";
import { handLine, rng } from "../../renderer/hand";
import { layOut, LAYOUT_LIMITS } from "../../renderer/layout";
import { drawSpec } from "../../renderer/live/draw";
import type { RenderSpec, SpecEdge, SpecNode } from "../../renderer/spec";
import { cleanWords, textWidth, wrapWords } from "../../renderer/words";

const data = JSON.parse(readFileSync(new URL("../fixtures/r3/specs.json", import.meta.url), "utf8"));
const shell = (o: Partial<RenderSpec>): RenderSpec => ({ version: 1, stage: "pre-bet", seed: "t", nodes: [], edges: [], regions: [], marks: [], captions: [], steps: [], ...o });
const ticket = (id: string, words = id, extra: Partial<SpecNode> = {}): SpecNode => ({ id, kind: "ticket", words, provenance: "plain-code", ...extra });
const thread = (id: string, from: string, to: string, words?: string): SpecEdge => ({ id, from, to, ...(words ? { words } : {}), kind: "thread", provenance: "plain-code" });

function drawOk(spec: RenderSpec) {
  const d = drawSpec(spec);
  if (d.kind !== "drawing") throw new Error(`not a drawing: ${d.kind}`);
  expect(checkDrawing(spec, d.scene, d.svg)).toEqual([]);
  expect(checkDeterministic(spec)).toEqual([]);
  return d;
}

/** A chart like a real codebase's: n parts in layers, m joins, from a seeded generator. */
function randomChart(n: number, m: number, seed: string, wordsOn = 0.4): RenderSpec {
  const R = rng(seed);
  const nodes = Array.from({ length: n }, (_, i) => ticket(`n${i}`, `part${i}${R() < 0.2 ? "WithALongerNameHere" : ""}`));
  const edges: SpecEdge[] = [];
  for (let i = 0; i < m; i++) {
    const a = Math.floor(R() * n);
    const b = Math.min(n - 1, a + 1 + Math.floor(R() * 6));
    edges.push(thread(`e${i}`, `n${a}`, `n${b}`, R() < wordsOn ? "calls" : undefined));
  }
  return shell({ seed, nodes, edges });
}

describe("R3 the saved specs pass every check", () => {
  for (const name of Object.keys(data.specs)) it(name, () => void drawOk(data.specs[name]));
  it("the hero's specs", () => {
    drawOk(data.hero.bet);
    for (const o of Object.values(data.hero.byOption) as { spec: RenderSpec }[]) drawOk(o.spec);
  });
});

describe("R3 hostile names", () => {
  const RLO = String.fromCodePoint(0x202e);
  const PDF = String.fromCodePoint(0x202c);
  const ZW = String.fromCodePoint(0x200b);
  const hostile = ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "a\nb\r\nc\td", RLO + "evil" + PDF + " name", ZW + "hidden" + ZW + "zero", "x".repeat(5000), "]]></text><script>", "end", "subgraph", "--> n0", '["q"]', "|pipe|", "&amp;&lt;", "%%{init}%%", "`tick`", "日本語の名前", "🙂🙂🙂"];
  it("cleans hidden characters and newlines, and cuts very long text", () => {
    expect(cleanWords("a\nb")).toBe("a b");
    expect(cleanWords(`${RLO}x`)).toBe("·x");
    expect(Array.from(cleanWords("x".repeat(5000))).length).toBeLessThanOrEqual(400);
  });
  it("every one, as node, edge, region, title, caption and id, draws safely", () => {
    const nodes = hostile.map((w, i) => ticket(w, w, { small: w, sourceLines: [{ path: w, lineStart: 1, lineEnd: 2 }], ...(i % 3 === 0 ? { region: "r" } : {}) }));
    const edges = hostile.slice(1).map((w, i) => thread(`e:${w}`, hostile[i]!, w, w));
    const spec = shell({ title: hostile[0], kicker: hostile[1], subtitle: hostile[3], nodes, edges, regions: [{ id: "r", words: hostile[1]!, kind: "folder" }], captions: [{ words: hostile[0]!, provenance: "plain-code" }] });
    const d = drawOk(spec);
    expect(d.svg).not.toMatch(/<script/i);
    expect(d.svg).not.toMatch(/<img/i);
    expect(checkSvgSafety(d.svg)).toEqual([]);
    // No hidden character reached the drawing.
    expect(new RegExp("[\\u202a-\\u202e\\u2066-\\u2069\\u200b-\\u200f]").test(d.svg)).toBe(false);
  });
  it("no name can reach pele's Mermaid: an unbalanced quote still lays out", () => {
    expect(layOut(shell({ nodes: [ticket('"', '"'), ticket("]", "]")], edges: [thread("e", '"', "]", '"|')] })).nodes.length).toBe(2);
  });
  it("the safety check itself catches what it says", () => {
    expect(checkSvgSafety('<svg><script>x</script></svg>').length).toBe(1);
    expect(checkSvgSafety('<svg><g onclick="x"></g></svg>').length).toBe(1);
    expect(checkSvgSafety('<svg><a href="x"></a></svg>').length).toBeGreaterThan(0);
    expect(checkSvgSafety("<svg><text>&lt;script&gt; onerror= href=</text></svg>")).toEqual([]);
  });
});

describe("R3 shapes of chart", () => {
  it("0 nodes draws an empty sheet", () => {
    const d = drawOk(shell({ title: "Nothing here" }));
    expect(d.scene.nodes.length).toBe(0);
  });
  it("cycles and self-loops", () => {
    const d = drawOk(shell({ nodes: [ticket("a"), ticket("b"), ticket("c")], edges: [thread("ab", "a", "b", "calls"), thread("bc", "b", "c", "calls"), thread("ca", "c", "a", "calls"), thread("aa", "a", "a", "calls itself"), thread("ab2", "a", "b")] }));
    expect(d.scene.edges.length).toBe(5);
  });
  it("parallel edges each get their own line, nested regions draw, every kind draws", () => {
    drawOk(shell({
      nodes: [ticket("a", "a", { region: "inner" }), { id: "d", kind: "device", words: "fetch", provenance: "plain-code", region: "outer" }, { id: "c", kind: "clock", words: "clock", provenance: "plain-code" }, { id: "k", kind: "deck", words: "deck", provenance: "plain-code" }, { id: "n", kind: "note", words: "a note", provenance: "plain-code" }, { id: "m", kind: "note", words: "not there", provenance: "plain-code", missing: true }],
      edges: [thread("x", "a", "d", "one"), thread("y", "a", "d", "two"), thread("z", "d", "c", "waits"), { id: "dn", from: "k", to: "n", words: "Wonder says", kind: "dashed-note", provenance: "wonder-words" }],
      regions: [{ id: "outer", words: "src/", kind: "folder" }, { id: "inner", words: "src/deep/", kind: "folder", parent: "outer" }],
    }));
  });
  it("a Wonder-only join is drawn dotted, never with the thread class", () => {
    const d = drawOk(shell({ nodes: [ticket("a"), ticket("b")], edges: [{ id: "w", from: "a", to: "b", kind: "dashed-note", provenance: "wonder-words" }] }));
    expect(d.svg).toMatch(/rr-note-line/);
    expect(d.svg).not.toMatch(/rr-thread/);
  });
  it("200 nodes ends as the list, with every part in it, without freezing", () => {
    const spec = randomChart(200, 300, "big");
    const t = performance.now();
    const d = drawSpec(spec);
    expect(d.kind).toBe("list");
    expect(performance.now() - t).toBeLessThan(500);
    if (d.kind === "list") {
      expect(d.reason).toMatch(/limit/);
      expect(d.html).toContain("part199");
    }
  });
  it("past the line limit it is the list too", () => {
    expect(drawSpec(randomChart(50, LAYOUT_LIMITS.edges + 1, "many")).kind).toBe("list");
  });
  it("notShown draws nothing and says why", () => {
    const d = drawSpec(shell({ title: "x", notShown: "the control did not match", nodes: [ticket("a")] }));
    expect(d.kind).toBe("not-shown");
    if (d.kind === "not-shown") {
      expect(d.html).toContain("the control did not match");
      expect(d.html).not.toContain("<svg");
    }
  });
  for (const seed of ["r1", "r2", "r3", "r4", "r5"]) {
    it(`40 nodes + 90 edges (${seed}) passes every check and draws within budget`, () => {
      const spec = randomChart(40, 90, seed);
      const d = drawOk(spec);
      expect(d.ms).toBeLessThan(1000);
    }, 30_000);
  }
});

describe("R3 the hand", () => {
  it("is reproducible and keeps its ends where they were aimed", () => {
    const pts: [number, number][] = [[0, 0], [200, 0], [200, 300]];
    const a = handLine(pts, rng("x"));
    expect(handLine(pts, rng("x"))).toEqual(a);
    expect(handLine(pts, rng("y"))).not.toEqual(a);
    expect(Math.hypot(a[0]![0], a[0]![1])).toBeLessThan(1);
    const l = a[a.length - 1]!;
    expect(Math.hypot(l[0] - 200, l[1] - 300)).toBeLessThan(4);
  });
  it("changing one part does not re-wobble another", () => {
    const one = drawSpec(shell({ seed: "w", nodes: [ticket("a"), ticket("b")], edges: [thread("e", "a", "b")] }));
    const two = drawSpec(shell({ seed: "w", nodes: [ticket("a"), ticket("b", "b")], edges: [thread("e", "a", "b")], captions: [{ words: "x", provenance: "plain-code" }] }));
    if (one.kind !== "drawing" || two.kind !== "drawing") throw new Error("no drawing");
    const edge = (s: string) => /data-edge="e"[\s\S]*?class="rr-line" d="([^"]*)"/.exec(s)![1]!;
    expect(edge(one.svg).length).toBeGreaterThan(50);
    expect(edge(two.svg)).toBe(edge(one.svg));
  });
});

describe("R3 words", () => {
  it("measures from the font's own table and wraps to the width", () => {
    expect(textWidth("WWW", 20, "regular")).toBeGreaterThan(textWidth("iii", 20, "regular"));
    for (const l of wrapWords("a fairly long sentence that should wrap over several lines", 120, 18, "italic", 9)) expect(textWidth(l, 18, "italic")).toBeLessThanOrEqual(120);
    const cut = wrapWords("a fairly long sentence that should wrap over several lines", 120, 18, "italic", 2);
    expect(cut.length).toBe(2);
    expect(cut[1]).toMatch(/…$/);
    for (const l of wrapWords("x".repeat(300), 100, 18, "regular", 3)) expect(textWidth(l, 18, "regular")).toBeLessThanOrEqual(100);
  });
});

describe("R3 the pencil export (Node only, optional)", () => {
  it("draws a saved spec to a PNG, and refuses a spec that may not be drawn", async () => {
    const { drawPlate } = await import("../../renderer/export/plate");
    const { mkdtempSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const out = join(mkdtempSync(join(tmpdir(), "r3-")), "plate.png");
    await drawPlate(data.specs.chart, { out, ppm: 3 });
    expect(statSync(out).size).toBeGreaterThan(5000);
    await expect(drawPlate(shell({ notShown: "no" }), { out })).rejects.toThrow(/nothing may be drawn/);
    await expect(drawPlate(shell({ nodes: [ticket("a")], marks: [{ on: "a", kind: "matched", who: "you" }] }), { out })).rejects.toThrow(/may not be drawn/);
  }, 60_000);
});
