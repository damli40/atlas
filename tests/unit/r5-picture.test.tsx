// D66: the shared picture carries the machine only when it is true and clear, and never the person's record.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawMachine, machineParts, MACHINE_PART_LIMIT } from "../../renderer/authors/machine";
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
