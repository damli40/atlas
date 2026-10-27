// Copied from the day-5 review's probes (probes5/), local paths made relative. Run: npx tsx tests/evidence/D05-review/probes/p2-m7-why.ts
import { chosenLineCaptions, verifyAtlasFile } from "../../../../src/atlasfile.ts";
import { linkSentences, modelSentences, templatedSentences } from "../../../../src/why.ts";
import { readFileSync } from "node:fs";
const ROOT = new URL("../../../../", import.meta.url).pathname;

const FILE = "proposals/ChainlinkOracleConfigs.sol";
const CBETH_LINE = '            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")';
const f = (o: any) => ({ id: "f1", file: FILE, lineStart: 42, lineEnd: 42, kind: "other", claim: "", verified: true, quotedSnippet: CBETH_LINE, proposedBy: { role: "human", model: "none: picked by a person" }, ...o });
const w = (id: string, a: number, b: number) => f({ id, lineStart: a, lineEnd: b, quotedSnippet: "x", proposedBy: { role: "investigator", model: "muse-wonder-1.0" } });

// M7: a wide person pick (lines 30-60, contains cbETH line 42) and a Wonder place at 55-58 (not cbETH).
const wide = f({ lineStart: 30, lineEnd: 60, quotedSnippet: `a\n${CBETH_LINE}\nb` });
console.log("M7 wide pick + Wonder 55-58:", chosenLineCaptions([wide, w("a", 55, 58)]));
console.log("M7 exact pick 42 + Wonder 55-58:", chosenLineCaptions([f({}), w("a", 55, 58)]));

// Real file: record Wonder places, then see which person ranges flip the caption.
const mw = JSON.parse(readFileSync(ROOT + "tests/evidence/D04-04/moonwell-level2-mwTaxvHFzB.atlas.json", "utf8"));
console.log("real findings:", mw.findings.map((x: any) => [x.proposedBy.role, x.file, x.lineStart, x.lineEnd, x.verified]));
console.log("real captions:", mw.captions);

// Forged file: keep the real one, add a fake verified Investigator finding covering line 42 -> does verify accept the flipped caption?
const forged = structuredClone(mw);
forged.findings.push({ ...mw.findings[1], id: "forged", file: mw.findings[0].file, lineStart: 41, lineEnd: 43 });
forged.captions = forged.captions.map((c: string) => c.replace("pointed elsewhere", "also pointed here"));
const vf = verifyAtlasFile(forged);
console.log("forged also-pointed-here verifies:", vf.ok, vf.ok ? "" : (vf as any).reasons ?? (vf as any).reason);

// Why linker
const run: any = { runner: "ts", trace: Array.from({ length: 5 }, (_, i) => ({ t: 0, event: ["start", "call", "reject", "sleep", "throws"][i], data: { n: 1, ms: 3000 } })) };
const finding = w("w1", 40, 45);
const by = { kind: "model", model: "muse-spark-1.3", role: "claimant" } as const;
const texts = [
  "The oracle is wrong, see traces #999 and trace #1.",
  "It failed at trace #1 or #999.",
  "Proven by trace #2; #77.",
  "Look at line 42 of mip-x43.sol.",
  "Look at mip-x43.sol, lines 42-43.",
  "Lines 42—99 show the bug.",
  "lines 42 to 99 prove it.",
  "Trace #0 proves the code is wrong and the oracle will misprice cbETH.",
  "Event #999 and trace #3.",
  "trace#4 is it", // no space
];
const res = linkSentences(texts.flatMap((t) => modelSentences(t, by)), run, [finding as any]);
for (const s of res.shown) console.log("SHOWN:", JSON.stringify(s.text), "->", JSON.stringify(s.links));
for (const s of res.dropped) console.log("dropped:", JSON.stringify(s.text));

// templated sentences on a cut-off run
const cut: any = { runner: "ts", trace: [{ t: 0, event: "start" }, { t: 0, event: "call", data: { n: 1 } }, { t: 0, event: "reject", data: { n: 1 } }, { t: 0, event: "sleep", data: { ms: 20000 } }, { t: 20000, event: "wake" }, { t: 20000, event: "call", data: { n: 2 } }, { t: 20000, event: "reject", data: { n: 2 } }, { t: 20000, event: "sleep", data: { ms: 20000 } }, { t: 20000, event: "stopped_watching", data: { reason: "watch limit" } }] };
console.log("cut-off templated:", templatedSentences(cut).map((s) => s.text));
const pend: any = { runner: "ts", trace: [{ t: 0, event: "call", data: { n: 1 } }, { t: 0, event: "no_answer", data: { n: 1 } }, { t: 0, event: "pending" }] };
console.log("pending templated:", templatedSentences(pend).map((s) => s.text));
// call n missing -> NaN?
const noN: any = { runner: "ts", trace: [{ t: 0, event: "call" }, { t: 0, event: "throws" }] };
console.log("no-n templated:", templatedSentences(noN).map((s) => s.text));
