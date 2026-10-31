// U3 item 3: every sentence a bettor reads writes values in the code's own language (Python's True, not JSON's true),
// and the same sentence goes to every bettor (D19). Python's own parser checks that each literal is the value Atlas
// really passes (json.loads of the test's JSON).

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { literal, literalOfJsonText, literalProblem } from "../../src/literal";
import { describeCall, gate, questionsFor } from "../../src/gate";
import { quizQuestionsFor } from "../../src/quiz";
import { pastedBetContext } from "../../src/paste-context";
import { canonicalJson } from "../../src/seal";
import { literalsLanguageOf } from "../../src/atlasfile";
import type { Experiment, ExperimentShape, JsonValue } from "../../src/types";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const VALUES: JsonValue[] = [true, false, null, 0, -1.5, 1e21, "a \"quoted\" \\ line\nbreak", "é ✓ 😀", [], {}, [true, [null, { b: false, a: "x" }]], { "key with space": [1, 2, { z: null }] }];

describe("U3 literals", () => {
  it("Python: True / False / None; JavaScript keeps JSON", () => {
    expect(literal(true, "py")).toBe("True");
    expect(literal({ a: [true, null], b: false }, "py")).toBe('{"a": [True, None], "b": False}');
    expect(literal({ a: [true, null], b: false }, "ts")).toBe('{"a":[true,null],"b":false}');
    expect(literalOfJsonText('{"ok":true}', "py")).toBe('{"ok": True}');
  });

  it("Python's own parser reads every literal as exactly the value json.loads gives Atlas", () => {
    const cases = VALUES.map((v) => ({ lit: literal(v, "py"), json: canonicalJson(v) }));
    const script = "import ast, json, sys\ncases = json.loads(sys.stdin.read())\nprint(json.dumps([ast.literal_eval(c['lit']) == json.loads(c['json']) for c in cases]))";
    const out = execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(cases), encoding: "utf8" });
    expect(JSON.parse(out)).toEqual(VALUES.map(() => true));
  });

  it("the walkthrough's test reads get_user_plan(True), in the call sentence, the questions and the quiz options", () => {
    const t: Call = { shape: "call-function", exportName: "get_user_plan", args: [{ kind: "json", value: true }] };
    expect(describeCall(t, "py")).toBe("Atlas calls get_user_plan(True).");
    expect(describeCall(t, "ts")).toBe("Atlas calls get_user_plan(true).");
    const qs = quizQuestionsFor(t, ["get_user_plan"], "py");
    for (const q of qs) expect(q.text).toContain("get_user_plan(True)");
    const value = qs.find((q) => q.measures === "returnedJson")!;
    expect(value.quiz!.map((o) => o.label)).toContain("True (the same as argument 1)");
    // The shared bettor text (D19) carries the same sentences, for the page and every model.
    const exp = { target: { kind: "pasted", ref: "pasted:x", codeSha256: "a".repeat(64), language: "py", source: "def get_user_plan(user_id):\n    return 1\n" }, params: t, proposedBy: { role: "investigator", model: "muse-wonder-1.0" } } as unknown as Experiment;
    const text = pastedBetContext({ experiment: exp, questions: qs, exportLine: 1 });
    expect(text).toContain("What will run: Atlas calls get_user_plan(True).");
    expect(text).toContain("(the same as argument 1)");
    const sentences = text.split("\n").filter((l) => !l.startsWith("The test exactly, as JSON") && !/^[ >]\s*\d+\|/.test(l));
    expect(sentences.join("\n")).not.toMatch(/get_user_plan\(true\)|\(b\) true \(/);
  });

  it("stand-in and fake-network values read in Python too", () => {
    const t: Call = { shape: "call-function", exportName: "f", args: [{ kind: "stand-in", name: "load", async: false, then: "repeat_last", calls: [{ do: "return", value: { active: false, plan: null } }] }], network: { replaces: "requests", then: "repeat_last", calls: [{ do: "respond", status: 200, body: { ok: true } }] } };
    const d = describeCall(t, "py");
    expect(d).toContain('load returns {"active": False, "plan": None}');
    expect(d).toContain('answers 200 with {"ok": True}');
  });

  it("a value with no literal Atlas could pass unchanged is refused by the gate", () => {
    expect(literalProblem(Number.POSITIVE_INFINITY, "py")).toMatch(/no Python literal/);
    const d = gate({ shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }, { language: "py" });
    expect(d.allowed).toBe(true);
  });

  it("bench M keeps its frozen words; a proof file without the U3 marker is verified with JSON words", () => {
    const t: Call = { shape: "call-function", exportName: "f", args: [{ kind: "json", value: true }, { kind: "stand-in", name: "g", async: false, then: "throw_exhausted", calls: [{ do: "return", value: 1 }] }] };
    expect(questionsFor(t, { language: "py", wordsAsOf: "e3" })[0]!.text).toContain("Atlas calls f(true, g). g returns 1 on call 1; any later call throws AtlasStandInExhausted.");
    expect(literalsLanguageOf({ target: { language: "py" } })).toBeUndefined();
    expect(literalsLanguageOf({ rules: { literals: "u3" }, target: { language: "py" } })).toBe("py");
  });
});
