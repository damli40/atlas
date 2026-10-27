// B1 (D35): static checks of the two benchmark corpora. Nothing here runs a case file or calls a model.
//
// Plain words: before any benchmark run, every test in bench/truth/expected.json and bench/models/corpus.json must
// be a test Atlas would accept: its file exists, the gate allows the call, the function it names is one plain code
// finds in the file. For bench/truth, every hand-written expectation must also be well formed (each stand-in has
// an expected call count, a can't-check expectation says why), so a typo cannot quietly turn into "not compared".
// The two corpora must not share a case file's text: bench/models is meant to be fresh code.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { experimentFor, loadCorpus, standInNames } from "../../bench/lib/corpus.ts";
import { functionTexts, normalizeFunction } from "../../bench/lib/normalize.ts";
import type { TruthExpect } from "../../bench/truth/classify.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const TRUTH = join(ROOT, "bench/truth/expected.json");
const MODELS = join(ROOT, "bench/models/corpus.json");

const OUTCOMES = ["returned", "threw", "never_settled", "still_running_at_watch_limit"];
const FACT_KEYS = new Set(["wholeRunCantCheckOk", "outcome", "returnedJson", "returnedType", "returnedNotJson", "thrownName", "thrownType", "thrownMessage", "virtualMs", "calls"]);

describe("bench/truth corpus (hand-written expected facts)", () => {
  const { functions } = loadCorpus<TruthExpect>(TRUTH);
  const tests = functions.flatMap((f) => f.tests.map((t) => ({ f, t })));

  it("has about 40 functions in JS/TS and Python, each with 1 to 3 tests per export, ids unique", () => {
    expect(functions.length).toBeGreaterThanOrEqual(38);
    expect(functions.some((f) => f.language === "py")).toBe(true);
    expect(functions.some((f) => f.language !== "py")).toBe(true);
    const ids = tests.map(({ t }) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of functions) {
      const perExport = new Map<string, number>();
      for (const t of f.tests) perExport.set(t.exportName, (perExport.get(t.exportName) ?? 0) + 1);
      for (const [name, n] of perExport) expect(n, `${f.id} ${name}`).toBeLessThanOrEqual(3);
    }
  });

  for (const { f, t } of tests) {
    it(`${t.id}: the gate allows it and the expectation is well formed`, () => {
      const e = experimentFor(f, t);
      expect(e.ok, e.ok ? "" : e.reason).toBe(true);
      const x = t.expect!;
      expect(x, "every truth test has an expectation").toBeDefined();
      expect(typeof t.why === "string" && t.why.length > 0).toBe(true);
      if (x.cantCheck) {
        expect(x.cantCheck).toBe(true);
        expect(x.because.length).toBeGreaterThan(0);
        return;
      }
      for (const k of Object.keys(x)) expect(FACT_KEYS.has(k), `unknown expectation key ${k}`).toBe(true);
      if (typeof x.outcome === "string") expect(OUTCOMES).toContain(x.outcome);
      else expect(typeof x.outcome.dependsOn).toBe("string");
      // Every stand-in has an expected count (a number, or null = must not be claimed).
      expect(Object.keys(x.calls ?? {}).sort()).toEqual(standInNames(t).sort());
      if (x.outcome === "returned") expect("returnedJson" in x || "returnedNotJson" in x).toBe(true);
      if (x.outcome === "threw") expect("thrownName" in x && "thrownType" in x).toBe(true);
      expect("virtualMs" in x).toBe(true);
    });
  }
});

const TRUTH2 = join(ROOT, "bench/truth-2/expected.json");
describe.skipIf(!existsSync(TRUTH2))("bench/truth-2 corpus (the found failures, expectations written before any run)", () => {
  const loaded = existsSync(TRUTH2) ? loadCorpus<TruthExpect>(TRUTH2) : { functions: [], corpus: { bench: "", functions: [] } };
  const cats = (loaded.corpus as unknown as { reasonCategories?: Record<string, string[]> }).reasonCategories ?? {};
  for (const f of loaded.functions) {
    for (const t of f.tests) {
      it(`${t.id}: the gate allows it; every category it names is registered`, () => {
        const e = experimentFor(f, t);
        expect(e.ok, e.ok ? "" : e.reason).toBe(true);
        const named = JSON.stringify(t.expect).match(/"(?:dependsOn|reasonCategory|wholeRunCantCheckOk)":(?:"([^"]+)"|\[([^\]]*)\])/g) ?? [];
        for (const m of named) for (const c of m.replace(/^[^:]+:/, "").replace(/[[\]"]/g, "").split(",")) expect(cats[c], `category ${c}`).toBeDefined();
        expect(standInNames(t).sort()).toEqual(t.expect!.cantCheck ? standInNames(t).sort() : Object.keys(t.expect!.calls ?? {}).sort());
      });
    }
  }
});

describe.skipIf(!existsSync(MODELS))("bench/models corpus (fresh functions for the model bets)", () => {
  const { functions } = existsSync(MODELS) ? loadCorpus(MODELS) : { functions: [] };
  const tests = functions.flatMap((f) => f.tests.map((t) => ({ f, t })));

  it("has about 30 functions, each with exactly 3 tests, in JS/TS and Python, ids unique", () => {
    expect(functions.length).toBeGreaterThanOrEqual(28);
    for (const f of functions) expect(f.tests.length, f.id).toBe(3);
    expect(functions.some((f) => f.language === "py")).toBe(true);
    expect(functions.some((f) => f.language !== "py")).toBe(true);
    const ids = tests.map(({ t }) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shares no function body with bench/truth or bench/truth-2, after comments, layout and names are normalised", () => {
    const bodies = (fs: { source: string; language: string; id: string }[]) =>
      fs.flatMap((f) => functionTexts(f.source, f.language === "py").map((t) => ({ id: f.id, norm: normalizeFunction(t, f.language === "py") })));
    const others = [loadCorpus(TRUTH).functions, ...(existsSync(TRUTH2) ? [loadCorpus(TRUTH2).functions] : [])].flat();
    const seen = new Map(bodies(others).map((b) => [b.norm, b.id]));
    const mine = bodies(functions);
    expect(mine.length).toBeGreaterThanOrEqual(30);
    for (const b of mine) expect(seen.get(b.norm), `${b.id} has a function body that bench T also has`).toBeUndefined();
  });

  it("the normaliser sees through renamed variables, comments and layout, and not through a changed constant", () => {
    const a = "function f(x) {\n  // add one\n  return x + 1;\n}";
    const b = "function   g(y){return y+1}";
    expect(normalizeFunction(functionTexts(a, false)[0]!, false)).toBe(normalizeFunction(functionTexts(b, false)[0]!, false));
    expect(normalizeFunction("function g(y){return y+2}", false)).not.toBe(normalizeFunction(functionTexts(a, false)[0]!, false));
    const p1 = "def f(a):\n    # c\n    return a * 2\n";
    const p2 = "def other(z):\n    return z*2\n";
    expect(normalizeFunction(functionTexts(p1, true)[0]!, true)).toBe(normalizeFunction(functionTexts(p2, true)[0]!, true));
  });

  it("shares no case file text with bench/truth", () => {
    const truth = new Set(loadCorpus(TRUTH).functions.map((f) => f.sourceSha256));
    for (const f of functions) expect(truth.has(f.sourceSha256), f.id).toBe(false);
  });

  for (const { f, t } of tests) {
    it(`${t.id}: the gate allows it`, () => {
      const e = experimentFor(f, t);
      expect(e.ok, e.ok ? "" : e.reason).toBe(true);
    });
  }
});
