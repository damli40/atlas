// D20 (decided Oct 27): Moonwell change-and-replay "in theory", labelled.
// Offline: the committed live file tests/evidence/D20/d20.atlas.json (made by tests/evidence/D20/live-replay.ts
// on a real Base fork) verifies, and editing its mode, its directly wired feed or its captions does not.
// The log strip line and the screens carry the "In theory" caption. No model, no RPC.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { verifyAtlasFile } from "../../src/atlasfile";
import { theoryCaption, theoryCaptions } from "../../src/change";
import type { AtlasFile, Run } from "../../src/types";
import { changeAndReplay } from "../../server/changes";
import type { Round } from "../../server/bets";
import type { MuseExec } from "../../server/meta/roles/fixer";
import { ProofCard } from "../../web/screens/ProofCard";
import { PricePipe } from "../../web/machines/pricepipe/PricePipe";

const file = JSON.parse(readFileSync(new URL("../evidence/D20/d20.atlas.json", import.meta.url), "utf8")) as AtlasFile;
const CAPTION = "In theory: Atlas wired cbETH_ORACLE directly; the real proposal would first need a new cbETH_ORACLE_OEV_WRAPPER contract deployed.";
const BANNED = /\b(wrong|correct|bug|right answer|fixed|broken)\b/i;
const edited = (f: (x: AtlasFile) => void) => {
  const c = JSON.parse(JSON.stringify(file)) as AtlasFile;
  f(c);
  const v = verifyAtlasFile(c);
  return v.ok ? "" : v.problems.join(" | ");
};

describe("D20: the theoretical-direct-wire replay", () => {
  it("the caption, word for word, and no banned word", () => {
    expect(theoryCaption("cbETH_ORACLE")).toBe(CAPTION);
    expect(CAPTION).not.toMatch(BANNED);
  });
  it("the live file verifies: mode, directly wired feed, captions, replay lines all recomputed", () => {
    expect(verifyAtlasFile(file)).toMatchObject({ ok: true });
    expect(file.change?.mode).toBe("theoretical-direct-wire");
    expect(file.change?.directWired).toEqual([{ oracleName: "cbETH_ORACLE", market: "MOONWELL_cbETH", address: "0xB0Ba0C5D7DA4ec400C1C3E5ef2485134F89918C5" }]);
    expect(file.captions).toContain(CAPTION);
    const checks = file.replay!.run.trace.find((t) => t.event === "replay_checks")!.data!;
    expect(checks.mode).toBe("theoretical-direct-wire");
    expect(checks.theory).toEqual([CAPTION]);
  });
  it("dropping the mode (claiming the proposal's own rule wires it) does not verify", () => {
    expect(edited((x) => { delete x.change!.mode; delete x.change!.directWired; })).toMatch(/plain code wires the changed config only in theoretical-direct-wire mode/);
  });
  it("an invented address for the direct wire does not verify", () => {
    expect(edited((x) => (x.change!.directWired![0]!.address = "0x000000000000000000000000000000000000dEaD"))).toMatch(/directly wired feeds are not the ones plain code derives/);
  });
  it("removing the 'In theory' caption does not verify", () => {
    expect(edited((x) => (x.captions = x.captions.filter((c) => c !== CAPTION)))).toMatch(/does not carry the caption "In theory/);
  });
  it("the proof card and the price pipe carry the caption; the pass-rule lines are labelled theoretical", () => {
    const card = renderToStaticMarkup(<ProofCard file={file} />);
    expect(card).toContain('data-testid="pc-change-theory"');
    expect(card).toContain('data-testid="pc-change-pass-rule-theory"');
    const pipe = renderToStaticMarkup(<PricePipe run={file.replay!.run} bets={file.bets} verdicts={file.replay!.verdicts} still theory={theoryCaptions(file.change)} />);
    expect(pipe).toContain(CAPTION);
    expect(pipe).toContain('data-part="multiply-gear"');
  });
  it("POST /changes' work: the change carries the mode and the log strip gets the caption line", async () => {
    const replay = JSON.parse(readFileSync(new URL("../evidence/D20/replay-run.json", import.meta.url), "utf8")) as Run;
    const round = { experiment: file.experiments[0]!, questions: [], extraQuestions: [], bets: file.bets, status: "done", run: file.runs[0]!, verdicts: file.verdicts, finding: file.findings![0]! } as unknown as Round;
    const museExec: MuseExec = async () => ({ ok: true, text: file.change!.diff, model: "muse-spark-1.3", models: ["muse-spark-1.3"], usage: { promptTokens: 1, completionTokens: 1, usd: 0 } });
    const lines: string[] = [];
    const log = { emit: (e: { action: string }) => (lines.push(e.action), e), model: (e: { action: string }) => (lines.push(e.action), e), progress: () => {} } as never;
    const a = await changeAndReplay(round, {
      fixer: { museExec, musePreflight: null, chat: async () => ({ ok: false as const, reason: "x" }), usagePath: "/dev/null" },
      tsReplay: async () => { throw new Error("not used"); },
      evmReplay: async (_r, ch) => ({ ...replay, replayOf: { runId: file.runs[0]!.id, changeId: ch.id } }),
      log,
    });
    expect(a.ok, a.ok ? "" : a.reason).toBe(true);
    expect(a.ok && a.change.mode).toBe("theoretical-direct-wire");
    expect(lines).toContain(CAPTION);
  });
});
