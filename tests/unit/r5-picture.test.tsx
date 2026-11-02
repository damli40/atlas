// D66: the shared picture carries the machine only when it is true and clear, and never the person's record.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawMachine, machineParts, MACHINE_PART_LIMIT, ringFor } from "../../renderer/authors/machine";
import { MARK_PRE_EXISTING_CAPTION } from "../../src/captions";
import { fileOutline } from "../../src/file-outline";
import type { AtlasFile } from "../../src/types";
import { benchModel } from "../../web/machines/bench/model";
import { ProofCard } from "../../web/screens/ProofCard";

const ORDERS = readFileSync(new URL("../evidence/U3/inputs/orders.ts", import.meta.url), "utf8");
const parts = (src: string, tested: string) => {
  const outline = fileOutline(src, "ts");
  return machineParts({ ...benchModel({ fileName: "p", outline, test: null, source: src, language: "ts" }), tested }, outline, src, "ts");
};
const moonwell = JSON.parse(readFileSync(new URL("../evidence/R3/moonwell-real/mcmqYUk3lI.atlas.json", import.meta.url), "utf8")) as AtlasFile;
const retry = JSON.parse(readFileSync(new URL("../evidence/D04-04/fixture-eRopGsrp2a.atlas.json", import.meta.url), "utf8")) as AtlasFile;

describe("where the ring lands", () => {
  const p = parts(ORDERS, "fetchAllOrders");
  const base = { you: "returns a value", parts: p, tested: "fetchAllOrders" };
  it("a matched bet: no ring", () => {
    expect(ringFor({ ...base, kind: "matched", outcome: "threw", steps: [] })).toBeNull();
  });
  it("a throw: on the chute of the function that has one, not on the caller it passed through", () => {
    expect(ringFor({ ...base, kind: "not_matched", outcome: "threw", steps: [{ name: "fetchPage", threw: true }, { name: "fetchAllOrders", threw: true }] })).toMatchObject({ part: "fetchPage", on: "chute" });
  });
  it("it returned: on the outlet", () => {
    expect(ringFor({ ...base, kind: "not_matched", outcome: "returned", steps: [] })).toMatchObject({ part: "fetchAllOrders", on: "outlet" });
  });
  it("a stranger's words", () => {
    expect(ringFor({ ...base, kind: "not_matched", outcome: "returned", steps: [], stranger: true })!.words).toBe("the bet said returns a value");
  });
  it("the ring is hidden until the run has ended", () => {
    const d = drawMachine(p, { seed: "x", ring: { part: "fetchPage", on: "chute", words: "you said x" } });
    expect(d.svg).toContain('class="m-end"');
    expect(d.svg).not.toContain("data-ended");
    expect(drawMachine(p, { seed: "x", ended: true }).svg).toContain("data-ended");
  });
  it("the same drawing with and without a ring: nothing else moves", () => {
    const strip = (s: string) => s.slice(s.indexOf(">") + 1).split('<g class="m-end"')[0];
    const a = drawMachine(p, { seed: "same" }).svg;
    const b = drawMachine(p, { seed: "same", ring: { part: "fetchPage", on: "chute", words: "you said x" } }).svg;
    expect(strip(b).startsWith(strip(a).slice(0, 4000))).toBe(true);
  });
});

describe("the picture", () => {
  it("Moonwell: the machine, its two numbers, the D21 caption", () => {
    const html = renderToStaticMarkup(<ProofCard file={moonwell} stranger />);
    expect(html).toContain("data-machine");
    expect(html).toContain("$1.12");
    expect(html).toContain("$2,206.68");
    expect(html).toContain(MARK_PRE_EXISTING_CAPTION.replace(/'/g, "&#x27;"));
    expect(html).toMatch(/aria-label="[^"]*the bet was/);
  });
  it("the retry demo keeps its chart picture and its pre-existing label: no machine to draw from the file", () => {
    const html = renderToStaticMarkup(<ProofCard file={retry} stranger />);
    expect(html).not.toContain("data-machine");
    expect(html).toContain("pre-existing");
    expect(html).toMatch(/Pre-existing/);
  });
  it("past the part limit the picture has no machine", () => {
    const many = Array.from({ length: MACHINE_PART_LIMIT + 1 }, (_, i) => `export function f${i}() { return ${i}; }`).join("\n");
    const d = drawMachine(parts(many, "f0"), { seed: "x" });
    expect(d.tooMany).toBeDefined();
  });
  it("nothing from the person's record is on a card", () => {
    const html = renderToStaticMarkup(<ProofCard file={moonwell} />);
    expect(html).not.toMatch(/Last time|weakest so far| → /);
  });
});
