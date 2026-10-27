// Day-5 review, S3 + m5 + m6 (the M7 "chosen line" caption and the findings in a .atlas.json).
// S3: Investigator places are compared against the cbETH line ITSELF (located by plain code in the chosen
//     snippet), never against the person's whole range. The reviewer's case: a person picks lines 30–60
//     (which hold line 42), Wonder's verified place is 55–58 → before: "also pointed here"; now: elsewhere.
// m5: no Investigator call in the file's agent log → "the Investigator was not asked".
// m6: verify rejects an Investigator finding the gate never checked, and (for MIP-X43) a quote that is not
//     in the committed copy's lines.
// Offline: GitHub and the fork are stand-ins (the live D04-04 run); no model is called.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createProofStore } from "../../server/evm-round";
import {
  chosenLineCaptions,
  cbEthLineIn,
  HUMAN_PICKED_CBETH_ALONE_CAPTION,
  HUMAN_PICKED_CBETH_ALSO_CAPTION,
  HUMAN_PICKED_CBETH_CAPTION,
  LEVEL2_CAPTION,
  verifyAtlasFile,
} from "../../src/atlasfile";
import type { AtlasFile, Finding } from "../../src/types";
import { liveRunFor, PR } from "../tools/review-fixtures";

const ROOT = join(import.meta.dirname, "..", "..");
const FILE = "proposals/ChainlinkOracleConfigs.sol";
const LINES = readFileSync(join(ROOT, "contracts/lib/moonwell", FILE), "utf8").split("\n");
const linesOf = (a: number, b: number) => LINES.slice(a - 1, b).join("\n");
const person = (a: number, b: number, quotedSnippet = linesOf(a, b)): Finding => ({
  id: "p1",
  file: FILE,
  lineStart: a,
  lineEnd: b,
  kind: "other",
  claim: "",
  verified: true,
  quotedSnippet,
  proposedBy: { role: "human", model: "none: picked by a person" },
});
const wonder = (id: string, a: number, b: number): Finding => ({ ...person(a, b), id, kind: "price", claim: "c", quotedSnippet: "x", proposedBy: { role: "investigator", model: "muse-wonder-1.0" } });

describe("S3: compared against the cbETH line, not the person's range", () => {
  it("the cbETH line is located by plain code inside a wide pick", () => {
    expect(LINES[41]).toContain('"MOONWELL_cbETH"');
    expect(cbEthLineIn(person(30, 60))).toEqual({ from: 42, to: 42 });
    expect(cbEthLineIn(person(42, 42))).toEqual({ from: 42, to: 42 });
    expect(cbEthLineIn(person(30, 60, LINES[41]!))).toBeNull(); // one line of text for 31 picked lines: cannot be placed
  });

  // Before the fix: "the cbETH line was picked by a person; the Investigator also pointed here".
  it("the reviewer's case: person 30–60, Wonder 55–58 → pointed elsewhere, and the first half names the range", () => {
    expect(chosenLineCaptions([person(30, 60), wonder("a", 55, 58)])).toEqual(["the person picked lines 30–60, which hold the cbETH line (line 42); the Investigator pointed elsewhere"]);
  });

  it("person 30–60, Wonder 41–43 (covers line 42) → also pointed here", () => {
    expect(chosenLineCaptions([person(30, 60), wonder("a", 41, 43)])).toEqual(["the person picked lines 30–60, which hold the cbETH line (line 42); the Investigator also pointed here"]);
  });

  it("a wide pick whose snippet cannot be placed line by line says only which lines the person picked", () => {
    expect(chosenLineCaptions([person(30, 60, `a\n${LINES[41]}\nb`), wonder("a", 41, 43)])).toEqual(["the person picked lines 30–60"]);
  });

  it("the earlier single-line cases are unchanged", () => {
    const p = person(42, 42);
    expect(chosenLineCaptions([p, wonder("a", 55, 58)])).toEqual([HUMAN_PICKED_CBETH_CAPTION]);
    expect(chosenLineCaptions([p, wonder("a", 44, 53), wonder("b", 41, 43)])).toEqual([HUMAN_PICKED_CBETH_ALSO_CAPTION]);
    expect(chosenLineCaptions([p])).toEqual([HUMAN_PICKED_CBETH_ALONE_CAPTION]);
  });
});

async function round(session: string, opts: { investigate: boolean }) {
  const app = createApp({ fetchPr: async () => PR, evmRun: async (exp) => liveRunFor(exp), proofs: createProofStore({ publish: false }) });
  const h = { "content-type": "application/json", "x-atlas-session": session };
  const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) })).json() as Promise<any>;
  const t = await post("/targets", { kind: "github-pr", ref: PR.target.ref });
  if (opts.investigate) throw new Error("not used");
  const f = (await post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: FILE, lineStart: 42, lineEnd: 42 })).finding;
  const e = await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id });
  await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
  const r = await post("/runs", { experimentId: e.experiment.id });
  const file = (await (await app.request(`/proofs/${r.run.id}`, { headers: h })).json()) as AtlasFile;
  return { r, file };
}

describe("m5: the Investigator was not asked", () => {
  it("rule: asked=false → 'the Investigator was not asked'", () => {
    expect(chosenLineCaptions([person(42, 42)], false)).toEqual(["the cbETH line was picked by a person; the Investigator was not asked"]);
  });

  // Before the fix: "the cbETH line was picked by a person; the Investigator had no checked place on this code".
  it("through the server: a round with no /investigate call says so, and the file verifies", async () => {
    const { r, file } = await round("m5", { investigate: false });
    expect(r.proof.captions).toEqual([LEVEL2_CAPTION, "the cbETH line was picked by a person; the Investigator was not asked"]);
    expect(verifyAtlasFile(file).ok).toBe(true);
    const old = { ...file, captions: [LEVEL2_CAPTION, HUMAN_PICKED_CBETH_ALONE_CAPTION] };
    expect(verifyAtlasFile(JSON.parse(JSON.stringify(old))).ok).toBe(false);
  });
});

describe("m6: verify rejects a forged Investigator finding where it can", () => {
  const mw = JSON.parse(readFileSync(join(ROOT, "tests/evidence/D04-04/moonwell-level2-mwTaxvHFzB.atlas.json"), "utf8")) as AtlasFile;

  it("the real file still verifies", () => {
    expect(verifyAtlasFile(mw).ok).toBe(true);
  });

  // Before the fix: verify accepted this file (probes5/p2: "forged also-pointed-here verifies: true").
  it("the reviewer's forgery: a copy of a real Investigator finding moved onto lines 41–43, caption flipped → rejected", () => {
    const forged = structuredClone(mw);
    forged.findings!.push({ ...mw.findings![1]!, id: "forged", file: mw.findings![0]!.file, lineStart: 41, lineEnd: 43 });
    forged.captions = forged.captions.map((c) => c.replace("pointed elsewhere", "also pointed here"));
    const v = verifyAtlasFile(forged);
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).toMatch(/finding forged says muse-wonder-1.0 proposed it, but the agent log shows no gate check/);
    expect(JSON.stringify(v)).toMatch(/finding forged: its quote is not inside lines 41–43/);
  });

  it("a person's quote that is not the file's lines is rejected", () => {
    const bad = structuredClone(mw);
    bad.findings![0]!.quotedSnippet = "OracleConfig(\"cbETHETH_ORACLE\", \"cbETH\", \"MOONWELL_cbETH\")";
    expect(JSON.stringify(verifyAtlasFile(bad))).toMatch(/its quote is not line 42 of/);
  });
});
