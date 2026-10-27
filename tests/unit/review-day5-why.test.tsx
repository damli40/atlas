// Day-5 review, S1 + S2 + m4 ("Ask why").
// S1: every evidence reference in a sentence is parsed (all "#N" forms, lists, "or", ranges, line ranges in
//     any dash or "to", file names anywhere); the sentence is shown only if ALL of them resolve.
// S2: a model's words are never linked evidence, whatever they reference.
// m4: the hand-written fixture finding is labelled as written by hand and its claim is not offered as a
//     model's words.
// The reviewer's own inputs (probes5/p2) are used verbatim. No network, no model.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AtlasFile, Finding, Run } from "../../src/types";
import { linkSentences, referencesOf, templatedSentences, type WhySentence } from "../../src/why";
import { modelTextsOf } from "../../web/screens/Why";

const FILE = "proposals/ChainlinkOracleConfigs.sol";
const finding = (o: Partial<Finding>): Finding =>
  ({ id: "w1", file: FILE, lineStart: 40, lineEnd: 45, kind: "other", claim: "", verified: true, quotedSnippet: "x", proposedBy: { role: "investigator", model: "muse-wonder-1.0" }, ...o }) as Finding;
const W1 = finding({});
const run = { runner: "ts", trace: ["start", "call", "reject", "sleep", "throws"].map((event) => ({ t: 0, event, data: { n: 1, ms: 3000 } })) } as unknown as Run;
const plain = (text: string): WhySentence => ({ text, by: { kind: "plain-code" } });
const spark = (text: string): WhySentence => ({ text, by: { kind: "model", model: "muse-spark-1.3", role: "claimant" } });
const shown = (text: string, findings: Finding[] = [W1]) => linkSentences([plain(text)], run, findings).shown.length === 1;

describe("S1: every reference must resolve", () => {
  // Before the fix every one of these was SHOWN (probes5/p2 before-output).
  it.each([
    "The oracle is wrong, see traces #999 and trace #1.",
    "It failed at trace #1 or #999.",
    "Proven by trace #2; #77.",
    "Look at line 42 of mip-x43.sol.",
    "Look at mip-x43.sol, lines 42-43.",
    "Lines 42—99 show the bug.",
    "lines 42 to 99 prove it.",
    "Event #999 and trace #3.",
  ])("dropped: %s", (text) => {
    expect(shown(text)).toBe(false);
    expect(referencesOf(text, run, [W1]).bad.length).toBeGreaterThan(0);
  });

  it("more forms: trace lists, ranges, 'or', word form, backwards ranges, bare ranges", () => {
    expect(shown("trace #1, #2 or #3 show it")).toBe(true);
    expect(shown("trace #1, #2 or #5 show it")).toBe(false); // #5 is past the end (5 events: #0–#4)
    expect(shown("trace #1–#4 show it")).toBe(true);
    expect(shown("traces #1 to #9 show it")).toBe(false);
    expect(shown("traces #3 to #1 show it")).toBe(false); // backwards: unreadable
    expect(shown("trace 4 shows it")).toBe(true);
    expect(shown("event 7 shows it")).toBe(false);
    expect(shown("trace#4 is it")).toBe(true);
    expect(shown("the feed is in 41–44 (trace #1)")).toBe(true); // bare range inside the finding
    expect(shown("the feed is in 41–48 (trace #1)")).toBe(false); // bare range past the finding
    expect(shown("lines 41, 43 and 47 (trace #1)")).toBe(false); // 47 is outside
    expect(shown("lines 41, 43 and 44 (trace #1)")).toBe(true);
    expect(shown("lines 44 to 41")).toBe(false); // backwards
  });

  it("file names anywhere in the sentence: lines are checked in THAT file; an unknown, or two files, is dropped", () => {
    expect(shown("ChainlinkOracleConfigs.sol lines 41 to 44")).toBe(true);
    expect(shown("lines 41 to 44 of proposals/ChainlinkOracleConfigs.sol")).toBe(true);
    expect(linkSentences([plain("lines 41 to 44 of ChainlinkOracleConfigs.sol")], run, [W1]).shown[0]!.links).toEqual([{ kind: "lines", file: FILE, lineStart: 41, lineEnd: 44, findingId: "w1" }]);
    expect(shown("lines 41 to 44 of Other.sol")).toBe(false);
    expect(shown("trace #1 in Other.sol")).toBe(false); // an unknown file is an unresolvable reference
    const mip = finding({ id: "w2", file: "proposals/mips/mip-x43/mip-x43.sol", lineStart: 40, lineEnd: 45 });
    expect(shown("ChainlinkOracleConfigs.sol and mip-x43.sol, lines 41-42", [W1, mip])).toBe(false); // two files: which one?
    expect(shown("lines 41-42", [W1, mip])).toBe(false); // fits findings in two files: ambiguous
    expect(shown("mip-x43.sol lines 41-42", [W1, mip])).toBe(true);
  });

  it("the templated sentences of the two real rounds still all resolve", () => {
    for (const name of ["fixture-eRopGsrp2a", "moonwell-level2-mwTaxvHFzB"]) {
      const f = JSON.parse(readFileSync(join(import.meta.dirname, "..", "evidence", "D04-04", `${name}.atlas.json`), "utf8")) as AtlasFile;
      const r = linkSentences(templatedSentences(f.runs[0]!, f.findings?.[0]), f.runs[0]!, f.findings ?? []);
      expect(r.dropped).toEqual([]);
      expect(r.shown.length).toBeGreaterThan(1);
    }
  });
});

describe("S2: a model's words are never linked evidence", () => {
  // Before the fix: SHOWN, linked to trace #0 ("start"), although Spark wrote it before the run existed.
  it("'Trace #0 proves the code is wrong…' from Spark is dropped; the same text from plain code would link", () => {
    const text = "Trace #0 proves the code is wrong and the oracle will misprice cbETH.";
    expect(linkSentences([spark(text)], run, [W1]).shown).toEqual([]);
    expect(linkSentences([spark("lines 41-42 (trace #1)")], run, [W1]).shown).toEqual([]);
    expect(linkSentences([plain("lines 41-42 (trace #1)")], run, [W1]).shown).toHaveLength(1);
  });
});

describe("m4: the hand-written fixture finding", () => {
  const FIX = JSON.parse(readFileSync(join(import.meta.dirname, "..", "evidence", "D04-04", "fixture-eRopGsrp2a.atlas.json"), "utf8")) as AtlasFile;
  const hand = FIX.findings![0]!;
  it("is said to be written by hand, not by a model, and its claim is not offered as a model's words", () => {
    expect(hand.proposedBy.model).toBe("none: written by hand");
    // Before: "none: written by hand chose tests/fixtures/with-rpc-retry.ts lines 49–66 for this round".
    expect(templatedSentences(FIX.runs[0]!, hand)[0]!.text).toBe("tests/fixtures/with-rpc-retry.ts lines 49–66 were chosen for this round by hand (a fixture finding written by hand, not a model)");
    expect(linkSentences(templatedSentences(FIX.runs[0]!, hand), FIX.runs[0]!, [hand]).dropped).toEqual([]);
    // Before: the claim came back as { model: "none: written by hand", role: "investigator" }.
    expect(new Set(modelTextsOf(FIX.bets, hand).map((m) => m.model))).toEqual(new Set(["muse-spark-1.3"]));
    // A real Investigator finding still offers its claim (as the model's words, unlinked).
    expect(modelTextsOf([], { ...hand, claim: "c", proposedBy: { role: "investigator", model: "muse-wonder-1.0" } })).toEqual([{ text: "c", model: "muse-wonder-1.0", role: "investigator" }]);
  });
});
