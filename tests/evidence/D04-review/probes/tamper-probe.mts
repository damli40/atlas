import { readFileSync } from "node:fs";
import { verifyAtlasFile, level1Caption, HUMAN_PICKED_CBETH_CAPTION } from "../../../../src/atlasfile.ts";
import { judge } from "../../../../src/judge.ts";
const orig = JSON.parse(readFileSync(new URL("../../../../tests/evidence/D04-04/moonwell-level2-fKqHGIIi2_.atlas.json", import.meta.url), "utf8"));
console.log("original verifies:", verifyAtlasFile(orig).ok, "captions:", orig.captions);
console.log("bets:", orig.bets.map((b: any) => [b.who, b.answer.value]), "verdicts:", orig.verdicts.map((v: any) => [v.outcome, v.observed]));
console.log("controlPassed", orig.runs[0].controlPassed, "notMeasured keys", Object.keys(orig.runs[0].result.notMeasured));
// T1: move observed cbETH price onto the human bet and re-judge -> verdict flips to matched
const t1 = structuredClone(orig);
const hb = t1.bets.find((b: any) => b.who === "human");
t1.runs[0].result.measured["priceUsd1e18:cbETH"] = (BigInt(Math.round(hb.answer.value)) * 10n ** 18n).toString();
t1.verdicts = t1.bets.map((b: any) => judge(b, t1.runs[0]));
console.log("T1 edited price + rejudged verifies:", verifyAtlasFile(t1).ok, t1.verdicts.map((v: any) => v.outcome));
// T2: Level 1 caption added to a Level 2 file; human-picked caption with no human finding
const t2 = structuredClone(orig);
t2.captions.push(level1Caption(42194663), HUMAN_PICKED_CBETH_CAPTION);
t2.findings = (t2.findings ?? []).map((f: any) => ({ ...f }));
console.log("T2 contradictory captions verify:", verifyAtlasFile(t2).ok, "finding role:", t2.findings?.[0]?.proposedBy?.role);
// T3: control trace event says did not match, but controlPassed true
const t3 = structuredClone(orig);
const ev = t3.runs[0].trace.find((e: any) => e.event === "control_matched"); if (ev) ev.event = "control_did_not_match";
console.log("T3 trace says control failed, flag says passed, verifies:", verifyAtlasFile(t3).ok);
// T4: forkBlock changed everywhere to 42194663 on a Level 2 shape
const t4 = structuredClone(orig); t4.forkBlock = 42194663; t4.runs[0].forkBlock = 42194663;
console.log("T4 Level2 shape at the Level1 block verifies:", verifyAtlasFile(t4).ok);
// T5: runs[0] for another experiment than experiments[0]
const t5 = structuredClone(orig); const e2 = structuredClone(t5.experiments[0]); e2.id = "other"; e2.params = { shape: "price-read", markets: ["cbETH"] }; t5.experiments.unshift(e2);
console.log("T5 experiments[0] != runs[0].experimentId verifies:", verifyAtlasFile(t5).ok, verifyAtlasFile(t5).ok ? "" : (verifyAtlasFile(t5) as any).problems);
