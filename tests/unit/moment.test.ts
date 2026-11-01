// D60: the moment's choice of question and its words, from measured facts.
import { describe, expect, it } from "vitest";
import { momentOf, runEnding, type MomentMark } from "../../src/moment";

const run = (measured: Record<string, unknown>, extra = {}) => ({ controlPassed: true, trace: [{ t: 0, event: "start" }], result: { measured, notMeasured: {} }, ...extra }) as never;
const threw = run({ outcome: "threw", thrownName: "Error", thrownMessage: "HTTP 429", virtualMs: 1400, "calls:fetch": 4 });
const mark = (measures: string, you: "matched" | "not_matched" | "cant_check", pick = "throws"): MomentMark => ({
  measures,
  question: measures,
  measured: "m",
  picks: [
    { who: "model:meta-models/muse-spark-open", name: "Muse Spark Open", pick: "c", outcome: "matched" },
    { who: "human", name: "You", pick, outcome: you },
    { who: "model:muse-spark-1.3", name: "Muse Spark 1.3", pick: "b", outcome: "matched" },
  ],
});

describe("the moment", () => {
  it("says the verdict's sentence from measured facts", () => {
    expect(runEnding(threw)).toBe("threw Error: HTTP 429 at 1,400 ms, after 4 calls to fetch");
  });
  it("D64: a missed ending leads, over a matched count", () => {
    const m = momentOf([mark("calls:fetch", "matched", "4 times"), mark("outcome", "not_matched", "returns a value")], threw)!;
    expect(m.kind).toBe("not_matched");
    expect(m.you).toBe("returns a value");
    expect(m.run).toMatch(/^threw Error: HTTP 429/);
  });
  it("a match has the same shape", () => {
    expect(momentOf([mark("outcome", "matched"), mark("virtualMs", "cant_check")], threw)).toMatchObject({ kind: "matched", you: "throws" });
  });
  it("with nothing to compare, it is the run's ending alone", () => {
    expect(momentOf([mark("outcome", "cant_check")], threw)).toMatchObject({ kind: "ending", you: null, run: expect.stringContaining("threw") });
  });
  it("bettors keep one order whoever matched: you, Muse Spark, Muse Spark Open", () => {
    expect(momentOf([mark("outcome", "not_matched")], threw)!.bettors.map((b) => b.name)).toEqual(["You", "Muse Spark 1.3", "Muse Spark Open"]);
  });
  it("a run that may not be shown as fact has no moment", () => {
    expect(momentOf([mark("outcome", "not_matched")], run({ outcome: "threw" }, { controlPassed: false }))).toBeNull();
  });
  it("a two-call test says the time is its last call's", () => {
    const r = run({ outcome: "returned", returnedJson: "1", virtualMs: 700 }, { trace: [{ t: 0, event: "call_start", data: { n: 1 } }, { t: 900, event: "call_start", data: { n: 2 } }] });
    expect(runEnding(r)).toBe("returned 1 700 ms into its last call");
  });
});
