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
