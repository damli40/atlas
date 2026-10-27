// M7 (days 3–4 review): the "chosen line" caption is decided by plain code from the findings.
// - "picked by a person" only when the round's finding was picked by a person;
// - "the Investigator pointed elsewhere" only when NO verified Investigator finding's range includes
//   the chosen lines; when one does, "the Investigator also pointed here".
// Offline: GitHub and the fork are stand-ins (the live D04-04 run), the Investigator is a mocked chat.

import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createProofStore } from "../../server/evm-round";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import {
  chosenLineCaptions,
  HUMAN_PICKED_CBETH_ALONE_CAPTION,
  HUMAN_PICKED_CBETH_ALSO_CAPTION,
  HUMAN_PICKED_CBETH_CAPTION,
  LEVEL2_CAPTION,
  verifyAtlasFile,
} from "../../src/atlasfile";
import type { AtlasFile, Finding } from "../../src/types";
import { liveRunFor, PR } from "../tools/review-fixtures";

const FILE = "proposals/ChainlinkOracleConfigs.sol";
const CBETH_LINE = '            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")';

const finding = (over: Partial<Finding>): Finding => ({
  id: "f1",
  file: FILE,
  lineStart: 42,
  lineEnd: 42,
  kind: "other",
  claim: "",
  verified: true,
  quotedSnippet: CBETH_LINE,
  proposedBy: { role: "human", model: "none: picked by a person" },
  ...over,
});
const byWonder = (id: string, lineStart: number, lineEnd: number, verified = true): Finding =>
  finding({ id, lineStart, lineEnd, verified, kind: "price", claim: "a model sentence", quotedSnippet: "x", proposedBy: { role: "investigator", model: "muse-wonder-1.0" } });

describe("M7: chosenLineCaptions, the plain-code rule", () => {
  const person = finding({});

  it("a person's cbETH line, Investigator places elsewhere → 'pointed elsewhere'", () => {
    expect(chosenLineCaptions([person, byWonder("a", 44, 53), byWonder("b", 142, 144)])).toEqual([HUMAN_PICKED_CBETH_CAPTION]);
  });

  it("a person's cbETH line, a verified Investigator place includes it → 'also pointed here'", () => {
    expect(chosenLineCaptions([person, byWonder("a", 44, 53), byWonder("b", 41, 43)])).toEqual([HUMAN_PICKED_CBETH_ALSO_CAPTION]);
  });

  it("an Investigator place on the line that plain code did NOT verify does not count as pointing here", () => {
    expect(chosenLineCaptions([person, byWonder("a", 44, 53), byWonder("b", 41, 43, false)])).toEqual([HUMAN_PICKED_CBETH_CAPTION]);
  });

  it("a place on the same lines of ANOTHER file does not count", () => {
    expect(chosenLineCaptions([person, { ...byWonder("a", 41, 43), file: "proposals/mips/mip-x43/mip-x43.sol" }])).toEqual([HUMAN_PICKED_CBETH_CAPTION]);
  });

  it("no verified Investigator place at all → never 'elsewhere'", () => {
    expect(chosenLineCaptions([person])).toEqual([HUMAN_PICKED_CBETH_ALONE_CAPTION]);
    expect(chosenLineCaptions([person, byWonder("b", 41, 43, false)])).toEqual([HUMAN_PICKED_CBETH_ALONE_CAPTION]);
  });

  it("the chosen finding is the Investigator's own → no 'picked by a person' caption", () => {
    const own = byWonder("w", 41, 43);
    expect(chosenLineCaptions([{ ...own, quotedSnippet: CBETH_LINE }])).toEqual([]);
  });

  it("a person's pick that is not the cbETH line → no caption", () => {
    expect(chosenLineCaptions([finding({ lineStart: 44, lineEnd: 44, quotedSnippet: "        // Composite oracles don't support latestRound(), deferred to follow-up" }), byWonder("a", 44, 53)])).toEqual([]);
  });
});

// ---------- through the server: both cases end in a file that verifies ----------

function wonderAnswering(places: object[]) {
  const usage = { promptTokens: 100, completionTokens: 10, usd: 0.001 };
  return async (_args: ChatArgs): Promise<ChatResult> => ({ ok: true, content: JSON.stringify({ findings: places }), finishReason: "stop", usage });
}

const ELSEWHERE = { file: FILE, lineStart: 44, lineEnd: 46, kind: "price", claim: "commented lines", quotedSnippet: "// Composite oracles don't support latestRound(), deferred to follow-up" };
const HERE = { file: FILE, lineStart: 41, lineEnd: 43, kind: "price", claim: "the cbETH feed", quotedSnippet: 'OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")' };

async function roundWith(places: object[], session: string) {
  const app = createApp({ fetchPr: async () => PR, investigator: { chat: wonderAnswering(places), fallbackModel: null }, evmRun: async (exp) => liveRunFor(exp), proofs: createProofStore({ publish: false }) });
  const h = { "content-type": "application/json", "x-atlas-session": session };
  const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) })).json() as Promise<any>;
  const t = await post("/targets", { kind: "github-pr", ref: PR.target.ref });
  const inv = await post("/investigate", { target: { ref: t.ref, codeSha256: t.codeSha256 } });
  const f = (await post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: FILE, lineStart: 42, lineEnd: 42 })).finding;
  const e = await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id });
  await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
  const r = await post("/runs", { experimentId: e.experiment.id });
  const file = (await (await app.request(`/proofs/${r.run.id}`, { headers: h })).json()) as AtlasFile;
  return { inv, r, file };
}

describe("M7 through the server", () => {
  it("Investigator pointed elsewhere: the caption says so, the file records its places, and it verifies", async () => {
    const { inv, r, file } = await roundWith([ELSEWHERE], "m7a");
    expect(inv.findings).toHaveLength(1);
    expect(r.proof.captions).toEqual([LEVEL2_CAPTION, HUMAN_PICKED_CBETH_CAPTION]);
    expect(file.findings!.map((x) => x.proposedBy.role)).toEqual(["human", "investigator"]);
    expect(verifyAtlasFile(file).ok).toBe(true);
  });

  it("Investigator also pointed at the cbETH lines: the caption says 'also pointed here', never 'elsewhere'", async () => {
    const { inv, r, file } = await roundWith([ELSEWHERE, HERE], "m7b");
    expect(inv.findings).toHaveLength(2);
    expect(r.proof.captions).toEqual([LEVEL2_CAPTION, HUMAN_PICKED_CBETH_ALSO_CAPTION]);
    expect(r.proof.captions.join(" ")).not.toContain("pointed elsewhere");
    expect(verifyAtlasFile(file).ok).toBe(true);
    // The caption cannot be swapped back: verify recomputes it from the findings in the file.
    const forged = { ...file, captions: [LEVEL2_CAPTION, HUMAN_PICKED_CBETH_CAPTION] };
    const v = verifyAtlasFile(JSON.parse(JSON.stringify(forged)));
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).toMatch(/pointed elsewhere.*is not one this run earns/);
  });
});
