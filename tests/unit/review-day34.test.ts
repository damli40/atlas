// Regression tests for the days 3–4 adversarial review (tests/evidence/D04-review/README.md).
// Each block names the finding it pins. Offline: no RPC, no anvil, no Meta call.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { falseAlarmFromRun, falseAlarmTable, type Level2Record } from "../../runners/evm/level2.ts";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile";
import { judge } from "../../src/judge";
import type { AtlasFile, Run } from "../../src/types";

const ROOT = join(import.meta.dirname, "..", "..");
const EVIDENCE = join(ROOT, "tests", "evidence", "D04-04", "moonwell-level2-fKqHGIIi2_.atlas.json");
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
    extraCaptions: base.captions,
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
