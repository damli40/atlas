// X2 prototype: the code explorer machine draws exactly what plain code confirmed, and nothing Wonder alone says.
// - model.ts imports types only.
// - Boxes are exactly the confirmed parts; steel lines are exactly the confirmed and code-only joins; a model-only
//   join is never a line (it is a chalk tag with "Wonder says this; plain code could not check it").
// - The built page carries a data-line for exactly the drawn joins and none for a model-only join.
// - Every name and purpose is kept as the model's words, with the model named.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHALK_WORDS, explorerModel, spanOf } from "../../web/machines/explorer/model";
import type { OutlineRecord } from "../../web/machines/explorer/outline-data";

const ROOT = join(import.meta.dirname, "..", "..");
const FIXTURE = join(ROOT, "tests/fixtures/outline/atlas-server-meta.r2.json");
const record = (): OutlineRecord => JSON.parse(readFileSync(FIXTURE, "utf8")) as OutlineRecord;

type Built = { html: string; stats: { lines: number } };
async function build(r: OutlineRecord): Promise<Built> {
  const path = join(ROOT, "web/machines/explorer/build.mjs");
  const mod = (await import(/* @vite-ignore */ path)) as { buildExplorer: (r: OutlineRecord, o: { theme: string }) => Built };
  return mod.buildExplorer(r, { theme: "light" });
}
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attrValues = (html: string, attr: string) => new Set([...html.matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))].map((m) => unescape(m[1]!)));

describe("X2 explorer model", () => {
  it("model.ts imports nothing but types", () => {
    const src = readFileSync(join(ROOT, "web/machines/explorer/model.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim());
    expect(imports).toEqual(['import type { JoinKind, OutlineRecord, OutlineRecordJoin } from "./outline-data";']);
    const types = readFileSync(join(ROOT, "web/machines/explorer/outline-data.ts"), "utf8");
    expect([...types.matchAll(/^\s*import\s/gm)]).toHaveLength(0);
  });

  it("draws a box for exactly the confirmed parts", () => {
    const r = record();
    const m = explorerModel(r);
    expect(m.notShown).toBeNull();
    expect(m.boxes.map((b) => b.id).sort()).toEqual(r.parts.filter((p) => p.status === "confirmed").map((p) => p.id).sort());
    expect(m.boxes).toHaveLength(12);
  });

  it("draws a line for exactly the confirmed and code-only joins, never a model-only one", () => {
    const r = record();
    const m = explorerModel(r);
    const drawable = r.joins.filter((j) => j.status === "confirmed" || j.status === "code-only").map((j) => j.id).sort();
    expect(m.lines.map((l) => l.id).sort()).toEqual(drawable);
    expect(m.lines.filter((l) => l.status === "confirmed")).toHaveLength(19);
    expect(m.lines.filter((l) => l.status === "code-only")).toHaveLength(2);
    const modelOnly = r.joins.filter((j) => j.status === "model-only").map((j) => j.id).sort();
    expect(modelOnly).toHaveLength(2);
    expect(m.chalk.map((c) => c.id).sort()).toEqual(modelOnly);
    for (const c of m.chalk) expect(c.words).toBe("Wonder says this; plain code could not check it");
    for (const id of modelOnly) expect(m.lines.some((l) => l.id === id)).toBe(false);
  });

  it("keeps every name and purpose as Muse Wonder's words, with the model named", () => {
    const m = explorerModel(record());
    for (const b of m.boxes) {
      expect(b.name.by).toBe("model:muse-wonder-1.0");
      expect(b.purpose.by).toBe("model:muse-wonder-1.0");
    }
  });

  it("reads real line ranges, including whole files and a part split over two files", () => {
    expect(spanOf("budget.ts:1-138 (whole file)")).toEqual({ path: "budget.ts", lineStart: 1, lineEnd: 138, wholeFile: true, lines: 138 });
    expect(spanOf("client.ts:223-363")).toEqual({ path: "client.ts", lineStart: 223, lineEnd: 363, wholeFile: false, lines: 141 });
    expect(spanOf("client.ts:9-3")).toBeNull();
    const shared = explorerModel(record()).boxes.find((b) => b.id === "claimant-shared")!;
    expect(shared.spans.map((s) => s.path)).toEqual(["roles/claimant.ts", "roles/fixture-finding.ts"]);
    expect(shared.lines).toBe(302 + 70);
  });

  it("an unconfirmed part gets no box, and no join to it is drawn even when plain code found one", () => {
    const r = record();
    const part = r.parts.find((p) => p.id === "redact-secret")!;
    part.status = "unconfirmed";
    part.reasons = ["test: span did not match"];
    const m = explorerModel(r);
    expect(m.boxes.some((b) => b.id === "redact-secret")).toBe(false);
    expect(m.unconfirmed.map((u) => u.id)).toContain("redact-secret");
    expect(m.lines.some((l) => l.from === "redact-secret" || l.to === "redact-secret")).toBe(false);
    expect(m.notDrawn.map((n) => n.id).sort()).toEqual(r.joins.filter((j) => j.status !== "model-only" && (j.from === "redact-secret" || j.to === "redact-secret")).map((j) => j.id).sort());
  });

  it("draws nothing when the outline could not be checked, or when no part is confirmed", () => {
    const r = record();
    r.cantCheck = "too large to check";
    const m = explorerModel(r);
    expect(m.notShown).toMatch(/could not check/);
    expect(m.boxes).toHaveLength(0);
    expect(m.lines).toHaveLength(0);
    const r2 = record();
    for (const p of r2.parts) p.status = "unconfirmed";
    const m2 = explorerModel(r2);
    expect(m2.notShown).not.toBeNull();
    expect(m2.lines).toHaveLength(0);
  });

  it("a join turned model-only stops being a line", () => {
    const r = record();
    const j = r.joins.find((x) => x.id === "wonder:2")!;
    j.status = "model-only";
    const m = explorerModel(r);
    expect(m.lines.some((l) => l.id === "wonder:2")).toBe(false);
    expect(m.chalk.some((c) => c.id === "wonder:2")).toBe(true);
  });

  it("places every box exactly once, and the split part right before its second file's tray", () => {
    const m = explorerModel(record());
    const boxes = m.slots.filter((s) => s.kind === "box").map((s) => (s.kind === "box" ? s.id : ""));
    expect(boxes.sort()).toEqual(m.boxes.map((b) => b.id).sort());
    const i = m.slots.findIndex((s) => s.kind === "box" && s.id === "claimant-shared");
    const slot = m.slots[i]!;
    expect(slot.kind === "box" && slot.slices.map((s) => s.path)).toEqual(["roles/claimant.ts", "roles/fixture-finding.ts"]);
  });
});

describe("X2 explorer page", () => {
  it("carries a drawn line for exactly the confirmed and code-only joins, and a box for each confirmed part", async () => {
    const r = record();
    const { html, stats } = await build(r);
    const drawn = r.joins.filter((j) => j.status !== "model-only").map((j) => j.id).sort();
    const lineAttrs = attrValues(html, "data-line");
    expect([...lineAttrs].sort()).toEqual(drawn);
    expect(stats.lines).toBe(21);
    for (const j of r.joins.filter((x) => x.status === "model-only")) {
      expect(lineAttrs.has(j.id)).toBe(false);
      expect(attrValues(html, "data-chalk").has(j.id)).toBe(true);
    }
    expect([...attrValues(html, "data-hit")].sort()).toEqual(r.parts.filter((p) => p.status === "confirmed").map((p) => p.id).sort());
    expect(html).toContain(CHALK_WORDS);
    expect(html).toContain("muse-wonder-1.0");
  }, 60_000);

  it("never draws a model-only join even when every join is model-only", async () => {
    const r = record();
    for (const j of r.joins) j.status = "model-only";
    const { html, stats } = await build(r);
    expect(stats.lines).toBe(0);
    expect(attrValues(html, "data-line").size).toBe(0);
    expect(attrValues(html, "data-chalk").size).toBe(r.joins.length);
  }, 60_000);

  it("writes a part name that looks like markup as text, not markup", async () => {
    const r = record();
    r.parts[0]!.name = '<img src=x onerror="alert(1)">';
    r.parts[0]!.purposeByModel = "</script><script>alert(2)</script>";
    const { html } = await build(r);
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("</script><script>alert(2)");
  }, 60_000);
});
