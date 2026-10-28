// X2: the code explorer machine draws exactly what plain code confirmed, and nothing Wonder alone says.
// - model.ts imports types only.
// - Boxes are exactly the confirmed parts; steel lines exactly the confirmed and code-only joins; a model-only join is
//   never a line (a chalk tag: "Wonder says this; plain code could not check it", or, when proved, "Atlas found no
//   import or call for this").
// - wholeFile, typeOnly, cantCheck and cantMap are rendered as X1 says; "lines confirmed", never "purpose confirmed".
// - The drawn figure carries a data-line for exactly the drawn joins, and the Anatomy audit passes on the saved
//   outline and on outlines with joins taken away.
// - "Bet on this part" offers exported functions of JS, TS and Python files, and says why when it cannot.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHALK_WORDS, LINES_CONFIRMED, NO_LINK_WORDS, explorerModel, joinWords, spanText } from "../../web/machines/explorer/model";
import type { OutlineView } from "../../web/machines/explorer/outline-data";
import { auditFigure, buildFigure } from "../../web/machines/explorer/figure.mjs";
import { outlineAnswerOf } from "../../server/outline/routes";
import type { OutlineSection } from "../../src/outline/types";

const ROOT = join(import.meta.dirname, "..", "..");
const FIXTURE = join(ROOT, "tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json");
const saved = (): OutlineView => JSON.parse(readFileSync(FIXTURE, "utf8")) as OutlineView;
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attrValues = (html: string, attr: string) => new Set([...html.matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))].map((m) => unescape(m[1]!)));
const drawable = (v: OutlineView) => v.verified!.joins.filter((j) => j.status !== "model-only").map((j) => j.id).sort();

describe("X2 explorer model", () => {
  it("model.ts imports nothing but types and the pure wording helper (src/words.ts, which imports nothing)", () => {
    const src = readFileSync(join(ROOT, "web/machines/explorer/model.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim());
    expect(imports.filter((i) => !i.startsWith("import type "))).toEqual(['import { lineSpan } from "../../../src/words";']);
    expect(imports).toHaveLength(3);
    expect([...readFileSync(join(ROOT, "src/words.ts"), "utf8").matchAll(/^\s*import\s/gm)]).toHaveLength(0);
    const types = readFileSync(join(ROOT, "web/machines/explorer/outline-data.ts"), "utf8");
    expect([...types.matchAll(/^\s*import\s[^;]*;/gm)].every((m) => m[0].trim().startsWith("import type "))).toBe(true);
  }, 120_000);

  it("the route's answer is exactly the explorer's input (type-level), and the saved fixture is that answer at 058ab2a", () => {
    const fromRoute: (s: OutlineSection) => OutlineView = (s) => outlineAnswerOf("x", s);
    expect(typeof fromRoute).toBe("function");
    const v = saved();
    expect(v.source).toMatchObject({ kind: "github", repo: "damli40/atlas", commit: "058ab2a29634dc0b8c092fe7816a6fd57ce9b74c", subfolder: "server/meta" });
    expect(JSON.stringify(v)).not.toContain('"text":"//'); // no code text in the answer
  }, 120_000);

  it("draws a box for exactly the confirmed parts and a line for exactly the confirmed and code-only joins", () => {
    const v = saved();
    const m = explorerModel(v);
    expect(m.notShown).toBeNull();
    expect(m.boxes.map((b) => b.id).sort()).toEqual(v.verified!.parts.filter((p) => p.status === "confirmed").map((p) => p.id).sort());
    expect(m.lines.map((l) => l.id).sort()).toEqual(drawable(v));
    expect(m.lines.filter((l) => l.status === "confirmed")).toHaveLength(18);
    expect(m.lines.filter((l) => l.status === "code-only")).toHaveLength(6);
    expect(m.lines.filter((l) => l.typeOnly).map((l) => l.id).sort()).toEqual(v.verified!.joins.filter((j) => j.typeOnly).map((j) => j.id).sort());
    expect(m.commit).toBe("058ab2a29634dc0b8c092fe7816a6fd57ce9b74c");
  }, 120_000);

  it("a model-only join is never a line: a chalk tag with the right words (could not check vs proved no link)", () => {
    const v = saved();
    const j0 = v.verified!.joins[0]!;
    const j1 = v.verified!.joins[1]!;
    Object.assign(j0, { status: "model-only", codeEdges: [], reason: "Wonder says this; plain code could not check it: a test reason" });
    Object.assign(j1, { status: "model-only", codeEdges: [], noLinkFound: true, reason: "Atlas found no import or call for this: a test reason" });
    const m = explorerModel(v);
    expect(m.lines.some((l) => l.id === j0.id || l.id === j1.id)).toBe(false);
    expect(m.chalk.find((c) => c.id === j0.id)!.words).toBe(CHALK_WORDS);
    expect(m.chalk.find((c) => c.id === j1.id)!.words).toBe(NO_LINK_WORDS);
    expect(CHALK_WORDS).toBe("Wonder says this; plain code could not check it");
    expect(NO_LINK_WORDS).toBe("Atlas found no import or call for this");
    expect(joinWords({ status: "model-only", typeOnly: false, noLinkFound: true })).toBe(NO_LINK_WORDS);
    const fig = buildFigure(m);
    const lines = attrValues(fig.svg, "data-line");
    expect([...lines].sort()).toEqual(m.lines.map((l) => l.id).sort());
    expect(lines.has(j0.id) || lines.has(j1.id)).toBe(false);
  }, 120_000);

  it("whole-file spans say 'whole file'; type-only joins say 'type-only'; the card label is 'lines confirmed'", () => {
    const m = explorerModel(saved());
    const redact = m.boxes.find((b) => b.id === "secret-redaction")!;
    expect(spanText(redact.spans[0]!)).toBe("redact-secret.ts · whole file (lines 1–36)");
    expect(spanText({ path: "a.ts", lineStart: 3, lineEnd: 9, wholeFile: false, lines: 7 })).toBe("a.ts · lines 3–9");
    const typeOnly = m.boxes.flatMap((b) => b.joins).find((j) => j.typeOnly)!;
    expect(joinWords(typeOnly)).toMatch(/type-only: no link at run time/);
    expect(LINES_CONFIRMED).toBe("lines confirmed");
    const src = readFileSync(join(ROOT, "web/machines/explorer/ExplorerMachine.tsx"), "utf8");
    expect(src).toContain("Part · lines confirmed");
    expect(src).not.toMatch(/purpose (is )?confirmed/i);
  }, 120_000);

  it("can't map, can't check and no outline: nothing is drawn and the reason is shown", () => {
    const a = saved();
    a.codeMap.cantMap = "the codebase is too complex to map";
    expect(explorerModel(a).notShown).toMatch(/Can't check: plain code could not map this codebase \(the codebase is too complex to map\)/);
    expect(() => buildFigure(explorerModel(a))).toThrow(/could not map/);
    const b = saved();
    b.verified!.cantCheck = "the outline is too large to verify";
    for (const p of b.verified!.parts) p.status = "unconfirmed";
    const mb = explorerModel(b);
    expect(mb.notShown).toMatch(/Can't check: the outline is too large to verify/);
    expect(mb.boxes).toHaveLength(0);
    expect(mb.lines).toHaveLength(0);
    const c = saved();
    c.verified = null;
    c.wonder.failure = "muse-wonder-1.0 gave no usable outline after one repair try";
    expect(explorerModel(c).notShown).toMatch(/gave no usable outline/);
  }, 120_000);

  it("an unconfirmed part gets no box, and no line lands on it even when plain code found a join", () => {
    const v = saved();
    const p = v.verified!.parts.find((x) => x.id === "secret-redaction")!;
    p.status = "unconfirmed";
    p.reasons = ["test: the span is not on whole definitions"];
    const m = explorerModel(v);
    expect(m.boxes.some((b) => b.id === "secret-redaction")).toBe(false);
    expect(m.unconfirmed.map((u) => u.id)).toEqual(["secret-redaction"]);
    expect(m.lines.some((l) => l.from === "secret-redaction" || l.to === "secret-redaction")).toBe(false);
    expect(m.notDrawn.length).toBeGreaterThan(0);
  }, 120_000);

  it("keeps every name and purpose as Muse Wonder's words, with the model named", () => {
    for (const b of explorerModel(saved()).boxes) {
      expect(b.name.by).toBe("model:muse-wonder-1.0");
      expect(b.purpose.by).toBe("model:muse-wonder-1.0");
    }
  }, 120_000);

  it("groups trays by folder: one deck for the top folder, one for roles/", () => {
    const m = explorerModel(saved());
    expect(m.decks.map((d) => d.folder)).toEqual(["", "roles/"]);
    expect(m.rootFolder).toBe("server/meta/");
    const placed = m.decks.flatMap((d) => d.slots).filter((s) => s.kind === "box");
    expect(placed).toHaveLength(m.boxes.length);
  }, 120_000);

  it("offers exported functions to bet on, and says why when it cannot", () => {
    const v = saved();
    const m = explorerModel(v);
    const redact = m.boxes.find((b) => b.id === "secret-redaction")!;
    expect(redact.bets).toEqual([{ name: "redactSecret", path: "redact-secret.ts", line: 10, signature: expect.any(String), language: "ts", ok: true }]);
    const client = m.boxes.find((b) => b.id === "model-client")!;
    expect(client.bets.length).toBeGreaterThan(0);
    expect(client.bets[0]!.note).toMatch(/imports .*a run of it may only say "can't check"/);
    // A file over the paste flow's 64 KB, and one in a language Atlas does not run, are not offered.
    const big = saved();
    big.files.find((f) => f.path === "redact-secret.ts")!.bytes = 70 * 1024;
    expect(explorerModel(big).boxes.find((b) => b.id === "secret-redaction")!.bets[0]).toMatchObject({ ok: false, why: expect.stringMatching(/at most 64 KB/) });
    const other = saved();
    (other.files.find((f) => f.path === "redact-secret.ts") as { language: string }).language = "go";
    expect(explorerModel(other).boxes.find((b) => b.id === "secret-redaction")!.bets[0]).toMatchObject({ ok: false, why: "Atlas runs only JavaScript, TypeScript and Python files" });
  }, 120_000);
});

describe("X2 explorer figure", () => {
  it("draws exactly the drawable joins and a hit target per box; the Anatomy audit passes", () => {
    const v = saved();
    const m = explorerModel(v);
    const fig = buildFigure(m);
    expect([...attrValues(fig.svg, "data-line")].sort()).toEqual(drawable(v));
    expect([...attrValues(fig.svg, "data-hit")].sort()).toEqual(m.boxes.map((b) => b.id).sort());
    expect(fig.stats.lines).toBe(24);
    const a = auditFigure(fig);
    if (!a.passed) console.log(a.report);
    expect(a.passed).toBe(true);
  }, 120_000);

  it("the audit also passes with joins taken away (every second join, then only code-only joins)", () => {
    for (const keep of [(i: number) => i % 2 === 0, (_: number, s: string) => s === "code-only"]) {
      const v = saved();
      v.verified!.joins = v.verified!.joins.filter((j, i) => keep(i, j.status));
      const fig = buildFigure(explorerModel(v));
      const a = auditFigure(fig);
      if (!a.passed) console.log(a.report);
      expect(a.passed).toBe(true);
    }
  }, 240_000);

  it("writes a part name that looks like markup as text on its plate, not markup", () => {
    const v = saved();
    v.verified!.parts[0]!.name.text = '<img src=x onerror="alert(1)">';
    const fig = buildFigure(explorerModel(v));
    expect(fig.svg).not.toContain("<img");
    expect(fig.svg).toContain("&lt;img");
  }, 120_000);
});
