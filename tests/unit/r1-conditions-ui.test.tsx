// R1 (D42): the "conditions" line on the proof card and the verdict screen, rendered from a real run's file.
import "../tools/jsdom-globals";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAtlasFile } from "../../src/atlasfile";
import { gate } from "../../src/gate";
import { judge } from "../../src/judge";
import { exportedFunctions, makePastedTarget } from "../../src/pasted-code";
import { CONDITION_WORDS } from "../../src/paste-words";
import { sealBet } from "../../src/seal";
import type { AtlasFile, Experiment, Run } from "../../src/types";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import { ProofCard } from "../../web/screens/ProofCard";
import { proofCardModel } from "../../web/screens/proofcard-model";
import { VerdictScreen } from "../../web/screens/Verdict";

let control: Run;
beforeAll(async () => {
  control = (await runCallControl()).run;
}, 30_000);

async function round(src: string): Promise<{ file: AtlasFile; run: Run; bet: ReturnType<typeof sealBet> }> {
  const target = makePastedTarget(src, "js");
  const g = gate({ shape: "call-function", exportName: "f", args: [] }, { exportNames: exportedFunctions(src).map((e) => e.name) });
  if (!g.allowed) throw new Error(g.reason);
  const exp: Experiment = { id: "e1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
  const bet = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "returnedJson", answer: { kind: "json", value: "heads" } });
  await new Promise((r) => setTimeout(r, 5));
  const run = await runCallExperiment(exp, control);
  const file = buildAtlasFile({ target, experiment: exp, bets: [bet], run, verdicts: [judge(bet, run)], agentLog: [], createdAt: new Date().toISOString() });
  return { file, run, bet };
}

describe("the conditions line", () => {
  it("the proof card shows the pins and each condition in Atlas's words", async () => {
    const { file } = await round("export const f = () => (Math.random() < 0.5 ? 'heads' : 'tails');");
    const card = proofCardModel(file);
    expect(card.where).toMatch(/^seed 20260101 · time zone UTC · locale en-US/);
    const html = renderToStaticMarkup(<ProofCard file={file} />);
    expect(html).toContain('data-testid="pc-conditions"');
    expect(html).toContain("seed 20260101 · time zone UTC · locale en-US");
    expect(html).toContain("Atlas pins it to seed 20260101");
    expect(html).not.toContain("does not seed");
  });
  it("a run with no conditions says None, so the absence is stated too", async () => {
    const { file } = await round("export const f = () => 'heads';");
    const html = renderToStaticMarkup(<ProofCard file={file} />);
    expect(html).toContain(CONDITION_WORDS.none);
  });
  it("the verdict screen shows the same line above the scoreboard", async () => {
    const { run, bet } = await round("export const f = () => new Date().getHours() + 'h';");
    const html = renderToStaticMarkup(
      <VerdictScreen shown={[]} modelShown={[]} modelName={null} result={{ run, verdicts: [judge(bet, run)], bets: [bet], betsFrozenAt: new Date().toISOString() }} />,
    );
    expect(html).toContain('data-testid="conditions"');
    expect(html).toContain("This code read the clock."); // the rest has apostrophes, which the markup escapes
    expect(html).toContain("Atlas runs every call in time zone UTC with locale en-US");
  });
  it("R1 review M6: a run that did not finish says 'not known', never 'None'", async () => {
    const { file } = await round("export function f(){ return fetch('http://x'); }");
    const html = renderToStaticMarkup(<ProofCard file={file} />);
    expect(html).toContain('data-testid="conditions-not-known"');
    expect(html).not.toContain('data-testid="conditions-none"');
  });
  it("an old file (seed none, no conditions) shows no conditions line and the old seed wording", async () => {
    const { file } = await round("export const f = () => 'heads';");
    const old = JSON.parse(JSON.stringify(file)) as AtlasFile;
    old.seed = "none";
    old.runs[0]!.seed = "none";
    delete old.runs[0]!.conditions;
    delete old.runs[0]!.timeZone;
    delete old.runs[0]!.locale;
    delete old.runs[0]!.twin;
    expect(proofCardModel(old).where).toMatch(/^no seed: this run is from before Atlas seeded randomness/);
    expect(renderToStaticMarkup(<ProofCard file={old} />)).not.toContain('data-testid="pc-conditions"');
  });
});
