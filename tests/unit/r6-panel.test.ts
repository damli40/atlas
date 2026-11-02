// R6: the part's panel and the lid's names. Every word comes from the parser's facts or the run's own measured words.
import { describe, expect, it } from "vitest";
import { drawMachine, lidLines, machineParts, type MachineParts } from "../../renderer/authors/machine";
import { nameWords, roleOf } from "../../renderer/authors/part-name";
import { partPanel } from "../../renderer/authors/part-panel";
import { fileOutline } from "../../src/file-outline";
import { benchModel } from "../../web/machines/bench/model";
import { U1_EXAMPLE } from "../../web/u1-example";

const partsOf = (source: string, language: "ts" | "js" | "py" = "ts", tested: string | null = null): MachineParts => {
  const outline = fileOutline(source, language);
  const model = benchModel({ fileName: "x", outline, test: null, source, language });
  return machineParts({ ...model, tested }, outline, source, language);
};

describe("nameWords: a name split by its own capitals, underscores and digits", () => {
  it("splits camelCase, PascalCase and snake_case into small words", () => {
    expect(nameWords("fetchWithRetry")).toBe("fetch with retry");
    expect(nameWords("PriceCache")).toBe("price cache");
    expect(nameWords("get_user_plan")).toBe("get user plan");
    expect(nameWords("_load_rows")).toBe("load rows");
  });
  it("keeps an acronym in capitals, and digits as their own word", () => {
    expect(nameWords("parseURLQuery")).toBe("parse URL query");
    expect(nameWords("toHTTP2Url")).toBe("to HTTP 2 url");
  });
  it("adds nothing for one word: null", () => {
    expect(nameWords("sleep")).toBeNull();
    expect(nameWords("__init__")).toBeNull();
    expect(nameWords("Parser")).toBeNull();
  });
  it("never loses a letter: a name with letters the split doesn't know keeps its exact form", () => {
    expect(nameWords("cafésRead")).toBeNull();
    expect(nameWords("readÜbersicht")).toBeNull();
  });
});

describe("roleOf: a word only for a part with no name", () => {
  it("is the default export in JavaScript and TypeScript, and nothing in Python", () => {
    expect(roleOf("default", "ts")).toBe("the default export");
    expect(roleOf("default", "js")).toBe("the default export");
    expect(roleOf("default", "py")).toBeNull();
    expect(roleOf("handler", "ts")).toBeNull();
  });
  it("is carried on the parser's own unnamed default export", () => {
    const p = partsOf("export default function () { return helper(1); }\nfunction helper(x: number) { return x; }\n");
    expect(p.housings.find((h) => h.name === "default")?.role).toBe("the default export");
    expect(p.housings.find((h) => h.name === "helper")?.role).toBeUndefined();
  });
});

describe("lidLines: two lines only when both are at reading size", () => {
  it("draws the plain words over the exact name, never under 13 on the sheet", () => {
    // Off the page widths are a careful guess, wider than the browser measures, so a short name is used here.
    const l = lidLines({ name: "getPrice" }, true)!;
    expect(l.big).toBe("get price");
    expect(l.small).toBe("getPrice");
    expect(l.bigSize * 0.72).toBeGreaterThanOrEqual(13);
    expect(l.smallSize! * 0.72).toBeGreaterThanOrEqual(13);
    expect(l.smallSize!).toBeLessThanOrEqual(l.bigSize);
  });
  it("falls back to the exact name alone when two lines don't fit", () => {
    const l = lidLines({ name: "computeTheAdjustedMonthlyRevenueTotal" }, true);
    expect(l?.small).toBeUndefined();
  });
  it("one word: the exact name alone", () => {
    expect(lidLines({ name: "sleep" }, true)?.small).toBeUndefined();
  });
  it("the shared picture's lids are as before: the option is off unless asked", () => {
    const p = partsOf(U1_EXAMPLE, "ts", "fetchWithRetry");
    const plain = drawMachine(p, { seed: "s" });
    expect(plain.svg).not.toContain("get price");
    expect(plain.svg).not.toContain("m-code");
    const two = drawMachine(p, { seed: "s", nameLines: true });
    expect(two.svg).toContain("get price");
    expect(two.problems).toEqual([]);
    expect(two.minWords).toBeGreaterThanOrEqual(plain.minWords);
  });
});

describe("partPanel: plain sentences from the machine's facts", () => {
  const p = partsOf(U1_EXAMPLE, "ts", "fetchWithRetry");
  it("says what the drawing shows about fetchWithRetry", () => {
    const panel = partPanel(p, "fetchWithRetry")!;
    expect(panel.title).toBe("fetch with retry");
    expect(panel.name).toBe("fetchWithRetry");
    expect(panel.says).toEqual(["A function that can be called from outside the file. Atlas calls this one.", "Runs a loop (line 12).", "Has a throw (line 20).", "Returns (line 14).", "Calls: backoffMs, sleep.", "Called by: getPrice.", "Lines 10–21."]);
    expect(panel.lines).toEqual([10, 21]);
    expect(panel.broke).toBeNull();
  });
  it("a part with no loops, waits or throws says only what it has", () => {
    const panel = partPanel(p, "backoffMs")!;
    expect(panel.says.join(" ")).not.toMatch(/loop|throw|Waits/);
    expect(panel.says).toContain("Called by: fetchWithRetry.");
  });
  it("a class is called a class", () => {
    const c = partsOf("export class PriceCache {\n  get(k: string) { return k; }\n}\n");
    const panel = partPanel(c, "PriceCache")!;
    expect(panel.title).toBe("price cache");
    expect(panel.says[0]).toBe("A class that can be called from outside the file.");
  });
  it("an unnamed default export gets the role word and no fake name", () => {
    const d = partsOf("export default function () { return 1; }\n");
    const panel = partPanel(d, "default")!;
    expect(panel.title).toBe("the default export");
    expect(panel.name).toBeNull();
  });
  it("the ringed part adds what broke, in the verdict's own words; any other part does not", () => {
    const ring = { part: "fetchWithRetry", on: "chute" as const, words: "you said returns a value" };
    const broke = { run: "threw Error: gave up at 700 ms", line: 20, input: "Atlas calls fetchWithRetry(fetchIt)." };
    expect(partPanel(p, "fetchWithRetry", { ring, broke })!.broke).toEqual(["The run threw Error: gave up at 700 ms.", "It threw from line 20.", "Atlas calls fetchWithRetry(fetchIt)."]);
    expect(partPanel(p, "sleep", { ring, broke })!.broke).toBeNull();
    // No ring on a part (the words only): nothing extra anywhere.
    expect(partPanel(p, "fetchWithRetry", { ring: { ...ring, on: "words" }, broke })!.broke).toBeNull();
  });
  it("an id that is no part gives no panel", () => {
    expect(partPanel(p, "fetchWithRetry->sleep")).toBeNull();
  });
});
