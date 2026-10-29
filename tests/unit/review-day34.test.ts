// Regression tests for the days 3–4 adversarial review (tests/evidence/D04-review/README.md).
// Each block names the finding it pins. Offline: no RPC, no anvil, no Meta call.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { falseAlarmFromRun, falseAlarmTable, type Level2Record } from "../../runners/evm/level2.ts";
import { buildAtlasFile, CBETH_PICKED_BY_PERSON, chosenLineCaptions, level1Caption, verifyAtlasFile } from "../../src/atlasfile";
import { judge } from "../../src/judge";
import { checkFinding, matchesWholeLines } from "../../server/meta/roles/investigator";
import type { AtlasFile, Run } from "../../src/types";

const ROOT = join(import.meta.dirname, "..", "..");
const EVIDENCE = join(ROOT, "tests", "evidence", "D04-04", "superseded", "moonwell-level2-fKqHGIIi2_.json");
/** The live D04-04 Level 2 file (control passed). */
export const liveLevel2 = (): AtlasFile => JSON.parse(readFileSync(EVIDENCE, "utf8"));

/** The live Level 2 run with its control turned into a failure, everywhere the run records it. */
export function failedControlRun(): Run {
  const run = structuredClone(liveLevel2().runs[0]!);
  run.controlPassed = false;
  run.result.notMeasured.control = "WETH control did not match";
  const ev = run.trace.find((t) => t.event === "control_matched");
  if (ev) ev.event = "control_did_not_match";
  return run;
}

/** Rebuild a live file around a (possibly changed) run, re-judging every bet. */
export function rebuild(run: Run, base = liveLevel2()): AtlasFile {
  return buildAtlasFile({
    target: base.target,
    experiment: base.experiments[0]!,
    bets: base.bets,
    run,
    verdicts: base.bets.map((b) => judge(b, run)),
    ...(base.findings ? { findings: base.findings } : {}),
    agentLog: base.agentLog,
    // M7: the chosen-line caption is recomputed from the findings (the old D04-04 file records no
    // Investigator findings, so its "pointed elsewhere" half is no longer earned as stored).
    extraCaptions: chosenLineCaptions(base.findings),
    createdAt: base.createdAt,
  });
}

describe("B1: a run whose control failed never shows a flag", () => {
  it("falseAlarmFromRun: every row is can't check (flagged null) with the control's reason", () => {
    // Before the fix: cbETH came back flagged: true on this run.
    const rows = falseAlarmFromRun(failedControlRun());
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      expect(r.flagged).toBeNull();
      expect(r.controlPassed).toBe(false);
      expect(r.note).toMatch(/can't check: the control did not pass \(WETH control did not match\)/);
    }
  });

  it("the same run with its control passing still flags cbETH only", () => {
    const rows = falseAlarmFromRun(liveLevel2().runs[0]!);
    expect(rows.filter((r) => r.flagged === true).map((r) => r.market)).toEqual(["cbETH"]);
    expect(rows.every((r) => r.controlPassed)).toBe(true);
  });

  it("controlPassed missing (not true) counts as a failed control", () => {
    const run = structuredClone(liveLevel2().runs[0]!) as Partial<Run> & Run;
    delete (run as { controlPassed?: boolean }).controlPassed;
    expect(falseAlarmFromRun(run).every((r) => r.flagged === null)).toBe(true);
  });

  it("falseAlarmTable on a Level 2 record: a failed control (or a stablecoin out of band after apply) blanks every flag", () => {
    const rec = {
      actions: [{ symbol: "cbETH" }, { symbol: "DAI" }],
      pre: { cbETH: { ok: true, read: { priceUsd1e18: "2206000000000000000000", feedAddress: "0xa" } }, DAI: { ok: true, read: { priceUsd1e18: "1000000000000000000", feedAddress: "0xb" } } },
      post: { cbETH: { ok: true, read: { priceUsd1e18: "1122000000000000000", feedAddress: "0xc" } }, DAI: { ok: true, read: { priceUsd1e18: "1000000000000000000", feedAddress: "0xd" } } },
      referencePost: { ok: true, value: "2206000000000000000000" },
      control: { passed: false, reasons: ["WETH control did not match"] },
      postStablecoins: [],
    } as unknown as Level2Record;
    expect(falseAlarmTable(rec).map((r) => r.flagged)).toEqual([null, null]);
    const band = { ...rec, control: { passed: true, reasons: [] }, postStablecoins: [{ symbol: "USDC", priceUsd1e18: "2000000000000000000", inBand: false }] } as unknown as Level2Record;
    expect(falseAlarmTable(band).map((r) => r.flagged)).toEqual([null, null]);
    const ok = { ...rec, control: { passed: true, reasons: [] } } as unknown as Level2Record;
    expect(falseAlarmTable(ok).map((r) => r.flagged)).toEqual([true, false]);
  });

  it("the .atlas.json carries the table, all can't check when the control failed, and a forged flag does not verify", () => {
    const file = rebuild(failedControlRun());
    expect(file.falseAlarm).toHaveLength(14);
    expect(file.falseAlarm!.every((r) => r.flagged === null)).toBe(true);
    expect(verifyAtlasFile(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const forged = structuredClone(file);
    forged.falseAlarm!.find((r) => r.market === "cbETH")!.flagged = true;
    const v = verifyAtlasFile(forged);
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).toMatch(/false-alarm table is not what src\/falsealarm.ts rebuilds/);
  });
});

describe("S3: verify recomputes the file instead of trusting it", () => {
  const good = () => rebuild(liveLevel2().runs[0]!);
  const problems = (f: unknown) => {
    const v = verifyAtlasFile(JSON.parse(JSON.stringify(f)));
    return v.ok ? [] : v.problems;
  };

  it("the live Level 2 run, rebuilt, verifies", () => {
    expect(problems(good())).toEqual([]);
  });

  it("(a) the cbETH price edited to the person's bet and every verdict re-judged: refused", () => {
    // Before the fix: verified ok, with the human verdict flipped to matched.
    const f = good();
    const human = f.bets.find((b) => b.who === "human")!;
    f.runs[0]!.result.measured["priceUsd1e18:cbETH"] = (BigInt(Math.round((human.answer as { value: number }).value)) * 10n ** 18n).toString();
    f.verdicts = f.bets.map((b) => judge(b, f.runs[0]!));
    f.falseAlarm = falseAlarmFromRun(f.runs[0]!);
    expect(f.verdicts.find((v) => v.betId === human.id)!.outcome).toBe("matched");
    expect(problems(f).join("\n")).toMatch(/measured priceUsd1e18:cbETH is not the value its trace read/);
  });

  it("(a2) the reference edited: it no longer recomputes from its recorded Chainlink inputs", () => {
    const f = good();
    const r = f.runs[0]!;
    const v = "1000000000000000000000";
    r.result.references!["refUsd1e18:cbETH"]!.value = v;
    (r.trace.find((t) => t.event === "reference")!.data as { value: string }).value = v;
    f.verdicts = f.bets.map((b) => judge(b, r));
    f.falseAlarm = falseAlarmFromRun(r);
    expect(problems(f).join("\n")).toMatch(/its recorded inputs give 2206683650838065175827/);
  });

  it("(a3) the price-source count edited: refused", () => {
    const f = good();
    f.runs[0]!.result.measured["priceSources:cbETH"] = 2;
    expect(problems(f).join("\n")).toMatch(/priceSources:cbETH is not the count its trace recorded/);
  });

  it("(b) the Level 1 caption on a Level 2 file, and the person-picked caption without a person's cbETH finding: refused", () => {
    const f = good();
    f.captions.push(level1Caption(42194663));
    expect(problems(f).join("\n")).toMatch(/caption "re-run after the fact, on a fork of Base at block 42194663" is not one this run earns/);
    const g = good();
    g.findings = g.findings!.map((x) => ({ ...x, proposedBy: { role: "investigator" as const, model: "muse-wonder-1.0" } }));
    expect(g.captions.some((c) => c.startsWith(CBETH_PICKED_BY_PERSON))).toBe(true);
    expect(problems(g).join("\n")).toMatch(/the cbETH line was picked by a person.*is not one this run earns/);
  });

  it("(c) the trace says the control did not match while controlPassed is true: refused", () => {
    const f = good();
    f.runs[0]!.trace.find((t) => t.event === "control_matched")!.event = "control_did_not_match";
    expect(problems(f).join("\n")).toMatch(/its trace says control_did_not_match but controlPassed is true/);
  });

  it("(d) a Level 2 shape at the Level 1 block: refused", () => {
    const f = good();
    f.forkBlock = 42194663;
    f.runs[0]!.forkBlock = 42194663;
    (f.runs[0]!.trace.find((t) => t.event === "fork_started")!.data as { forkBlock: number }).forkBlock = 42194663;
    expect(problems(f).join("\n")).toMatch(/a Level 2 \(apply-proposal-then-read\) run must fork at 42194662/);
  });

  it("(e) experiments[0] is not the experiment of runs[0]: refused", () => {
    const f = good();
    const other = structuredClone(f.experiments[0]!);
    other.id = "other";
    other.params = { shape: "price-read", markets: ["cbETH"] } as never;
    f.experiments.unshift(other);
    const p = problems(f).join("\n");
    expect(p).toMatch(/runs\[0\] is the run of experiment .*, not of experiments\[0\] \(other\)/);
    expect(p).toMatch(/experiment other has no run/);
  });

  it("(f) a bet changed after sealing: refused (its seal no longer verifies)", () => {
    const f = good();
    (f.bets[0]!.answer as { value: number }).value += 1;
    expect(problems(f).join("\n")).toMatch(/do not hash to its sealedHash/);
  });
});

describe("S6: a quote must be whole lines and carry at least 12 letters or digits", () => {
  const file = "contract A {\n  function f() public {\n    x = 1;\n  }\n}\n}\n}\n}\n}\n}\n";
  const files = new Map([["a.sol", file]]);
  const check = (q: string, lineStart = 1, lineEnd = 10) => checkFinding({ file: "a.sol", lineStart, lineEnd, kind: "other", claim: "People expect X; the code does Y.", quotedSnippet: q }, files);

  it("a run of closing braces is dropped with its reason (before: VERIFIED)", () => {
    for (const q of ["}\n}\n}\n}\n}\n}", "} } } } }", "    }\n    }\n}  }  }"]) {
      const r = check(q);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/has 0 letters or digits; at least 12 are needed/);
    }
  });

  it("a fragment from the middle of a line is dropped with its reason (before: VERIFIED)", () => {
    const r = check("function f() pub", 2, 2); // 13 word characters, but stops mid-line
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("removed: lines did not match the file (the quote is not whole lines of 2–2)");
    expect(check("ction f() public {", 2, 2).ok).toBe(false); // starts mid-word
  });

  it("whole lines, indentation and line-number prefixes ignored, are kept", () => {
    expect(check("function f() public {\n x = 1;", 2, 3).ok).toBe(true);
    expect(check("2|   function f() public {\n3|     x = 1;", 2, 3).ok).toBe(true);
    expect(check("contract A { function f() public {", 1, 2).ok).toBe(true);
  });

  it("matchesWholeLines: blank lines are skipped, partial last lines are not", () => {
    expect(matchesWholeLines("a = 1; b = 2;", ["  a = 1;", "", "  b = 2;"])).toBe(true);
    expect(matchesWholeLines("a = 1; b =", ["  a = 1;", "  b = 2;"])).toBe(false);
  });
});
