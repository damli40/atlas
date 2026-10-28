// B1 (D35): the bench T classifier (bench/truth/classify.ts) names each result by the rules of
// bench/truth/PASS-RULE.md. Pure: hand-made RunResults, no run.

import { describe, expect, it } from "vitest";
import { classify, type TruthExpect } from "../../bench/truth/classify.ts";
import { scrubPaths } from "../../bench/truth/run.ts";

const ret = (json: string, ms: number, extra: Record<string, string | number> = {}) => ({ measured: { outcome: "returned", returnedJson: json, returnedType: "string", virtualMs: ms, ...extra }, notMeasured: {} });
const fact: TruthExpect = { outcome: "returned", returnedJson: "ok", returnedType: "string", virtualMs: 300, calls: { op: 3 } };

describe("bench T classification", () => {
  it("every field as written: correct fact", () => {
    expect(classify(fact, ret('"ok"', 300, { "calls:op": 3 }), true).classification).toBe("correct fact");
  });

  it("one field different: FALSE FACT, and the field says which", () => {
    const c = classify(fact, ret('"ok"', 301, { "calls:op": 3 }), true);
    expect(c.classification).toBe("FALSE FACT");
    expect(c.fields.find((f) => f.verdict === "FALSE")?.field).toBe("virtualMs");
  });

  it("a value Atlas must not claim (null) but did claim: FALSE FACT", () => {
    const e: TruthExpect = { outcome: "never_settled", virtualMs: null, calls: { load: 1 } };
    expect(classify(e, { measured: { outcome: "never_settled", virtualMs: 0, "calls:load": 1 }, notMeasured: {} }, true).classification).toBe("FALSE FACT");
    expect(classify(e, { measured: { outcome: "never_settled", "calls:load": 1 }, notMeasured: { virtualMs: "never settled" } }, true).classification).toBe("correct fact");
  });

  it("an expected field left unmeasured: over-refusal, with Atlas's reason kept", () => {
    const c = classify(fact, { measured: { outcome: "returned", returnedJson: '"ok"', returnedType: "string", virtualMs: 300 }, notMeasured: { "calls:op": "timers left" } }, true);
    expect(c.classification).toBe("wrong can't-check (over-refusal)");
    expect(c.fields.find((f) => f.field === "calls:op")?.notMeasured).toBe("timers left");
  });

  it("FALSE FACT outranks over-refusal", () => {
    const c = classify(fact, { measured: { outcome: "returned", returnedJson: '"no"', returnedType: "string", virtualMs: 300 }, notMeasured: { "calls:op": "x" } }, true);
    expect(c.classification).toBe("FALSE FACT");
  });

  it("whole-run can't check on a fact test: over-refusal; on a trap: correct can't-check", () => {
    const whole = { measured: {}, notMeasured: { wholeRun: "the code needs lodash" } };
    expect(classify(fact, whole, true).classification).toBe("wrong can't-check (over-refusal)");
    expect(classify({ cantCheck: true, because: "package" }, whole, true)).toMatchObject({ classification: "correct can't-check", cantCheckReason: "the code needs lodash" });
  });

  it("a trap that Atlas measured anyway: missed can't-check", () => {
    expect(classify({ cantCheck: true, because: "network" }, ret('"offline"', 0), true).classification).toBe("missed can't-check");
  });

  it("every outcome field not measured (Atlas's real-time limit) counts as can't-check", () => {
    const r = { measured: {}, notMeasured: { outcome: "Atlas's real-time limit, so how the call ends was not seen" } };
    expect(classify({ cantCheck: true, because: "loop" }, r, true).classification).toBe("correct can't-check");
  });

  it("not JSON: returnedJson must be absent and the type must match; a reason without the words is only a note", () => {
    const e: TruthExpect = { outcome: "returned", returnedNotJson: { type: "number (NaN)", reasonMentions: "NaN" }, virtualMs: 0 };
    const ok = classify(e, { measured: { outcome: "returned", returnedType: "number (NaN)", virtualMs: 0 }, notMeasured: { returnedJson: "it is NaN" } }, true);
    expect(ok).toMatchObject({ classification: "correct fact", notes: [] });
    const noted = classify(e, { measured: { outcome: "returned", returnedType: "number (NaN)", virtualMs: 0 }, notMeasured: { returnedJson: "odd" } }, true);
    expect(noted.classification).toBe("correct fact");
    expect(noted.notes.length).toBe(1);
    expect(classify(e, { measured: { outcome: "returned", returnedType: "number (NaN)", returnedJson: "null", virtualMs: 0 }, notMeasured: {} }, true).classification).toBe("FALSE FACT");
  });

  it("returnedJson is compared as canonical JSON text (key order does not matter, -0 is 0)", () => {
    const e: TruthExpect = { outcome: "returned", returnedJson: { b: 1, a: [0] }, virtualMs: 0 };
    expect(classify(e, { measured: { outcome: "returned", returnedJson: '{"a":[0],"b":1}', virtualMs: 0 }, notMeasured: {} }, true).classification).toBe("correct fact");
  });

  it("a failed control: not scored as any of the five", () => {
    expect(classify(fact, ret('"ok"', 300, { "calls:op": 3 }), false).classification).toBe("control failed");
  });
});

describe("result files carry no local paths", () => {
  it("scrubs temp folders and home folders, and counts them", () => {
    const s = scrubPaths('at /private/var/folders/ab/cd/T/atlas-x/target.mjs:3 and "/Users/someone/x" and /tmp/y'); // path-check: allow
    expect(s.text).toBe('at <local-path>:3 and "<local-path>" and <local-path>');
    expect(s.removed).toBe(3);
  });
});

describe("after the B1 review: reason categories and values that depend on something outside the code", () => {
  const cats = { "network-or-files": ["tried to use the network/files"], clock: ["clock"], randomness: ["random", "seed"] };
  const trap: TruthExpect = { cantCheck: true, because: "fetch", reasonCategory: "network-or-files" };

  it("a trap refused for the registered reason is a correct can't-check; for another reason it is a wrong-reason can't-check", () => {
    expect(classify(trap, { measured: {}, notMeasured: { wholeRun: "the code tried to use the network/files (fetch), which Atlas does not allow" } }, true, { categories: cats }).classification).toBe("correct can't-check");
    expect(classify(trap, { measured: {}, notMeasured: { wholeRun: "the code needs lodash" } }, true, { categories: cats }).classification).toBe("can't-check, wrong reason");
  });

  it("a category can come from outside the expectation (bench T's amendment)", () => {
    const old: TruthExpect = { cantCheck: true, because: "fetch" };
    expect(classify(old, { measured: {}, notMeasured: { wholeRun: "the code needs lodash" } }, true, { categories: cats, reasonCategory: "network-or-files" }).classification).toBe("can't-check, wrong reason");
    expect(classify(old, { measured: {}, notMeasured: { wholeRun: "the code needs lodash" } }, true).classification).toBe("correct can't-check");
  });

  it("a value that depends on Atlas's clock, reported as a plain value, is a FALSE FACT; not measured for that reason, correct", () => {
    const e: TruthExpect = { outcome: "returned", returnedJson: { dependsOn: "clock" }, virtualMs: 0 };
    expect(classify(e, { measured: { outcome: "returned", returnedJson: "false", virtualMs: 0 }, notMeasured: {} }, true, { categories: cats }).classification).toBe("FALSE FACT");
    expect(classify(e, { measured: { outcome: "returned", virtualMs: 0 }, notMeasured: { returnedJson: "the value read Atlas's clock during CPU work" } }, true, { categories: cats }).classification).toBe("correct fact");
    expect(classify(e, { measured: { outcome: "returned", virtualMs: 0 }, notMeasured: { returnedJson: "too big" } }, true, { categories: cats }).classification).toBe("can't-check, wrong reason");
  });

  it("a whole-run refusal is honest only when the test allows it and the reason is in that category", () => {
    const e: TruthExpect = { outcome: "returned", returnedJson: { dependsOn: "randomness" }, virtualMs: 0, wholeRunCantCheckOk: "randomness" };
    expect(classify(e, { measured: {}, notMeasured: { wholeRun: "the code uses Math.random" } }, true, { categories: cats }).classification).toBe("correct can't-check");
    expect(classify(e, { measured: {}, notMeasured: { wholeRun: "the code needs lodash" } }, true, { categories: cats }).classification).toBe("wrong can't-check (over-refusal)");
  });
});

describe("bench T2 amendment 1: labelled values and the double run", () => {
  const cats = { randomness: ["random", "seed"], host: ["host"] };
  const e: TruthExpect = { outcome: "returned", returnedJson: { dependsOn: "randomness" }, virtualMs: 0, wholeRunCantCheckOk: "randomness" };
  const r = { measured: { outcome: "returned", returnedJson: '"tails"', virtualMs: 0 }, notMeasured: {} };
  const run = { language: "js", conditions: [{ kind: "randomness", says: "This code used randomness ..." }], seed: "20260101", twinMeasured: { outcome: "returned", returnedJson: '"tails"', virtualMs: 0 } };

  it("measured + labelled + seed recorded + twin agrees: correct (labelled), only with the amendment in force", () => {
    expect(classify(e, r, true, { categories: cats, labels: true, run }).classification).toBe("correct (labelled)");
    expect(classify(e, r, true, { categories: cats, run }).classification).toBe("FALSE FACT");
  });

  it("no label, a bad seed, or a twin that differs: still a FALSE FACT", () => {
    expect(classify(e, r, true, { categories: cats, labels: true, run: { ...run, conditions: [] } }).classification).toBe("FALSE FACT");
    expect(classify(e, r, true, { categories: cats, labels: true, run: { ...run, seed: "none" } }).classification).toBe("FALSE FACT");
    expect(classify(e, r, true, { categories: cats, labels: true, run: { ...run, twinMeasured: { returnedJson: '"heads"' } } }).classification).toBe("FALSE FACT");
  });

  it("host: the pinned zone and locale for the language, or a host note that names a read", () => {
    const h: TruthExpect = { outcome: "returned", returnedJson: { dependsOn: "host" }, virtualMs: 0 };
    const tz = { language: "py", conditions: [{ kind: "time-zone-or-locale", says: "x" }], timeZone: "UTC", locale: "C", twinMeasured: r.measured };
    expect(classify(h, r, true, { categories: cats, labels: true, run: tz }).classification).toBe("correct (labelled)");
    expect(classify(h, r, true, { categories: cats, labels: true, run: { ...tz, locale: "en-US" } }).classification).toBe("FALSE FACT");
    const host = { language: "js", conditions: [{ kind: "host", says: "This code read details of the machine it runs on (process.env.PORT). ..." }], twinMeasured: r.measured };
    expect(classify(h, r, true, { categories: cats, labels: true, run: host }).classification).toBe("correct (labelled)");
    expect(classify(h, r, true, { categories: cats, labels: true, run: { ...host, conditions: [{ kind: "host", says: "This code read details of the machine it runs on (). ..." }] } }).classification).toBe("FALSE FACT");
  });

  it("process-lifetime is not covered: a measured value stays a FALSE FACT whatever the conditions", () => {
    const p: TruthExpect = { outcome: { dependsOn: "process-lifetime" }, wholeRunCantCheckOk: "process-lifetime" };
    expect(classify(p, { measured: { outcome: "returned" }, notMeasured: {} }, true, { categories: cats, labels: true, run: { ...run, conditions: [{ kind: "unref-timer", says: "x" }] } }).classification).toBe("FALSE FACT");
  });

  it("a double-run refusal: correct on a dependsOn field, over-refusal on a plain fact", () => {
    const twinReason = "this value changed between two identical runs (same code, same test, same seed and pins), so it depends on something Atlas does not control, such as memory addresses, process ids or paths";
    const nm = { measured: { outcome: "returned", virtualMs: 0 }, notMeasured: { returnedJson: twinReason } };
    expect(classify(e, nm, true, { categories: cats, labels: true }).classification).toBe("correct fact");
    expect(classify({ outcome: "returned", returnedJson: 1, virtualMs: 0 }, nm, true, { categories: cats, labels: true }).classification).toBe("wrong can't-check (over-refusal)");
  });
});
