// fa-probe, with the words the table now shows for each case.
import { readFileSync } from "node:fs";
import { falseAlarmFromRun, rowWords, tableCounts } from "../../../../src/falsealarm.ts";
const run = JSON.parse(readFileSync(new URL("../../../../tests/evidence/D04-04/moonwell-level2-fKqHGIIi2_.atlas.json", import.meta.url), "utf8")).runs[0];
const bad = structuredClone(run); bad.controlPassed = false; bad.result.notMeasured.control = "WETH control did not match";
console.log("control failed -> words:", [...new Set(falseAlarmFromRun(bad).map(rowWords))]);
const moved = structuredClone(run); const pre = BigInt(moved.result.measured["preApplyPriceUsd1e18:AERO"]); moved.result.measured["priceUsd1e18:AERO"] = (pre * 140n / 100n).toString();
const rows = falseAlarmFromRun(moved);
console.log("AERO +40% -> words:", rowWords(rows.find((r) => r.market === "AERO")!), "| counts:", JSON.stringify(tableCounts(rows)));
console.log("live run -> counts:", JSON.stringify(tableCounts(falseAlarmFromRun(run))));
