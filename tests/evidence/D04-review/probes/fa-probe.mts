import { readFileSync } from "node:fs";
import { falseAlarmFromRun } from "../../../../runners/evm/level2.ts";
import { checkFinding, normaliseQuote } from "../../../../server/meta/roles/investigator.ts";
const run = JSON.parse(readFileSync(new URL("../../../../tests/evidence/D04-04/moonwell-level2-fKqHGIIi2_.atlas.json", import.meta.url), "utf8")).runs[0];
const bad = structuredClone(run); bad.controlPassed = false; bad.result.notMeasured.control = "WETH control did not match";
const rows = falseAlarmFromRun(bad);
console.log("control failed -> cbETH flagged:", rows.find((r) => r.market === "cbETH")!.flagged, "| rows flagged true:", rows.filter((r) => r.flagged).length);
const moved = structuredClone(run); const k = "priceUsd1e18:AERO"; const pre = BigInt(moved.result.measured["preApplyPriceUsd1e18:AERO"]);
moved.result.measured[k] = (pre * 140n / 100n).toString();
const r2 = falseAlarmFromRun(moved).find((r) => r.market === "AERO")!;
console.log("AERO +40% -> flagged:", r2.flagged, "diff", r2.diffVsFlagReferencePct, "(web counts flagged===false as 'unchanged')");
const noTrace = structuredClone(run); noTrace.trace = noTrace.trace.filter((t: any) => t.event !== "proposal_derived");
console.log("no proposal_derived event -> rows:", falseAlarmFromRun(noTrace).length);
// investigator snippet looseness
const file = "contract A {\n  function f() public {\n    x = 1;\n  }\n}\n}\n}\n}\n}\n}\n";
const files = new Map([["a.sol", file]]);
for (const q of ["} } } } }", "}\n}\n}\n}\n}\n}", "    }\n    }\n}  }  }", "1| contract A {"]) {
  const r = checkFinding({ file: "a.sol", lineStart: 1, lineEnd: 10, kind: "other", claim: "People expect X; the code does Y.", quotedSnippet: q }, files);
  console.log(JSON.stringify(q), "->", r.ok ? "VERIFIED" : r.reason, "| normalised:", JSON.stringify(normaliseQuote(q)));
}
// mid-token substring
const r3 = checkFinding({ file: "a.sol", lineStart: 2, lineEnd: 2, kind: "other", claim: "c", quotedSnippet: "ction f() pu" }, files);
console.log("mid-token fragment 'ction f() pu' ->", r3.ok ? "VERIFIED" : r3.reason);
