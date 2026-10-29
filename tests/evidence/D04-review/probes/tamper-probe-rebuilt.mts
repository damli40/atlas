// The tamper probe on a file built by today's code (the committed D04-04 file predates the
// false-alarm field, so it is rebuilt from its own run first).
import { readFileSync } from "node:fs";
import { buildAtlasFile, verifyAtlasFile, level1Caption } from "../../../../src/atlasfile.ts";
import { judge } from "../../../../src/judge.ts";
const orig = JSON.parse(readFileSync(new URL("../../../../tests/evidence/D04-04/superseded/moonwell-level2-fKqHGIIi2_.json", import.meta.url), "utf8"));
const base = buildAtlasFile({ target: orig.target, experiment: orig.experiments[0], bets: orig.bets, run: orig.runs[0], verdicts: orig.bets.map((b: any) => judge(b, orig.runs[0])), findings: orig.findings, agentLog: orig.agentLog, extraCaptions: orig.captions, createdAt: orig.createdAt });
const v = (f: any) => { const r = verifyAtlasFile(JSON.parse(JSON.stringify(f))); return r.ok ? "verifies" : `refused: ${(r as any).problems[0]}`; };
console.log("committed file as-is:", v(orig));
console.log("rebuilt file:", v(base));
const t1 = structuredClone(base); const hb = t1.bets.find((b: any) => b.who === "human")!; t1.runs[0].result.measured["priceUsd1e18:cbETH"] = (BigInt(Math.round((hb.answer as any).value)) * 10n ** 18n).toString(); t1.verdicts = t1.bets.map((b: any) => judge(b, t1.runs[0]));
console.log("T1 edited price + rejudged:", v(t1));
const t2 = structuredClone(base); t2.captions.push(level1Caption(42194663)); console.log("T2 Level 1 caption on Level 2:", v(t2));
const t3 = structuredClone(base); t3.runs[0].trace.find((e: any) => e.event === "control_matched")!.event = "control_did_not_match"; console.log("T3 trace says control failed:", v(t3));
const t4 = structuredClone(base); t4.forkBlock = 42194663; t4.runs[0].forkBlock = 42194663; console.log("T4 Level 2 at 42194663:", v(t4));
const t5 = structuredClone(base); const e2 = structuredClone(t5.experiments[0]); e2.id = "other"; (e2 as any).params = { shape: "price-read", markets: ["cbETH"] }; t5.experiments.unshift(e2); console.log("T5 experiments[0] != runs[0]:", v(t5));
