// Day-5 review, B1: when the known-case control failed (or the sandbox never finished the run),
// nothing from that run is shown as fact. Not the retry machine's motion or readout, not an "Ask why"
// sentence, not the Run screen's measured line, and the scoreboard shows every bettor as "can't check".
// Inputs: the real D04-04 fixture round, with the control marked failed the way runners/ts/control.ts
// marks a tampered run, and a sandbox failure the way runExperiment records one. No network, no model.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { judge } from "../../src/judge";
import { notShownAsFact } from "../../src/trust";
import type { AtlasFile, Run } from "../../src/types";
import { templatedSentences } from "../../src/why";
import { retryModel } from "../../web/machines/retry/model";
import { RetryMachine } from "../../web/machines/retry/RetryMachine";
import { Scoreboard } from "../../web/machines/scoreboard/Scoreboard";
import { RunScreen } from "../../web/screens/Run";
import { WhyScreen } from "../../web/screens/Why";

const ROOT = join(import.meta.dirname, "..", "..");
const load = (name: string): AtlasFile => JSON.parse(readFileSync(join(ROOT, "tests/evidence/D04-04", name), "utf8"));
const FIXTURE = load("fixture-eRopGsrp2a.atlas.json");
const MOONWELL = load("moonwell-level2-mwTaxvHFzB.atlas.json");
const GOOD = FIXTURE.runs[0]!;

const controlFailed: Run = {
  ...GOOD,
  controlPassed: false,
  result: { ...GOOD.result, notMeasured: { ...GOOD.result.notMeasured, control: "tampered: result rewritten" } },
};
const sandboxFailed: Run = { ...GOOD, trace: [], result: { measured: {}, notMeasured: { run: "the sandbox returned no result for this experiment" } } };
const noControl = { ...GOOD, controlPassed: undefined } as unknown as Run;
const verdictsOn = (run: Run) => FIXTURE.bets.map((b) => judge(b, run));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("B1: an untrusted run is never shown as fact", () => {
  it("the rule (src/trust.ts): trusted run → null; control failed / missing / sandbox failed → the reason", () => {
    expect(notShownAsFact(GOOD)).toBeNull();
    expect(notShownAsFact(MOONWELL.runs[0]!)).toBeNull();
    expect(notShownAsFact(controlFailed)).toBe("Atlas's known-case check did not match, so this run is not shown as fact: tampered: result rewritten");
    expect(notShownAsFact({ ...GOOD, controlPassed: false })).toBe("Atlas's known-case check did not match, so this run is not shown as fact: the control run did not match the known case");
    expect(notShownAsFact(noControl)).toMatch(/not shown as fact: the run has no control result$/);
    expect(notShownAsFact(sandboxFailed)).toBe("The sandbox did not finish this run, so nothing from it is shown as fact: the sandbox returned no result for this experiment");
    expect(notShownAsFact({ ...GOOD, trace: [] })).toMatch(/the run recorded no trace$/);
  });

  // Before the fix: readout "calls 5 · waits 4 × 3,000 ms · threw the 5th error", 5 capsules, and the
  // caption "Drawn from run …'s trace only: 5 calls" (probes5/p5).
  it("retry machine, control failed: no drawing, no motion, no readout numbers; the reason card instead", () => {
    const m = retryModel({ run: controlFailed, bets: FIXTURE.bets, verdicts: verdictsOn(controlFailed) });
    expect([m.calls.length, m.waits.length, m.steps.length, m.pulls, m.readout, m.ghosts.length]).toEqual([0, 0, 0, 0, "", 0]);
    const html = renderToStaticMarkup(<RetryMachine run={controlFailed} bets={FIXTURE.bets} verdicts={verdictsOn(controlFailed)} still theme="light" />);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("data-readout");
    expect(html).not.toMatch(/calls \d|waits \d|threw the/);
    expect(html).toContain('data-testid="retry-cant-check"');
    expect(text(html)).toContain("Atlas's known-case check did not match, so this run is not shown as fact: tampered: result rewritten");
  });

  // Before the fix: "calls 0 · waits 0 · no ending in the trace" and "0 calls (one capsule each)".
  it("retry machine, sandbox failed: never 'calls 0' as if measured", () => {
    const html = renderToStaticMarkup(<RetryMachine run={sandboxFailed} bets={FIXTURE.bets} verdicts={[]} still theme="light" />);
    expect(html).not.toMatch(/calls 0|0 calls|waits 0/);
    expect(html).not.toContain("<svg");
    expect(text(html)).toContain("The sandbox did not finish this run, so nothing from it is shown as fact");
  });

  it("the trusted run still draws (no regression): readout and capsules as before", () => {
    const html = renderToStaticMarkup(<RetryMachine run={GOOD} bets={FIXTURE.bets} verdicts={FIXTURE.verdicts} still theme="light" />);
    expect(html).toContain("calls 5 · waits 4 × 3,000 ms · threw the 5th error");
    expect(html).not.toContain("retry-cant-check");
  });

  // Before the fix: "call 5 threw; no more attempts (trace #23)" in Atlas's voice from the untrusted run.
  it("Ask why, control failed: no plain-code sentence and no model sentence linked to the run; the reason instead", () => {
    expect(templatedSentences(controlFailed)).toEqual([]);
    expect(templatedSentences(sandboxFailed)).toEqual([]);
    expect(templatedSentences(GOOD).length).toBe(2);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => root.render(<WhyScreen run={controlFailed} finding={null} modelTexts={[{ text: "It stops after the fifth call (trace #23).", model: "muse-spark-1.3", role: "claimant" }]} />));
    act(() => (host.querySelector('[data-testid="why-ask"]') as HTMLButtonElement).click());
    expect(host.querySelectorAll('[data-testid="why-sentence"]')).toHaveLength(0);
    expect(host.textContent).not.toContain("call 5 threw");
    expect(host.querySelector('[data-testid="why-cant-check"]')!.textContent).toContain("Atlas's known-case check did not match");
    act(() => root.unmount());
    host.remove();
  });

  it("Run screen, control failed: the measured line prints the reason, never the numbers", () => {
    const html = renderToStaticMarkup(<RunScreen canRun={false} running={false} onBreak={() => {}} result={{ run: controlFailed, bets: FIXTURE.bets, verdicts: verdictsOn(controlFailed) } as never} />);
    expect(html).toContain('data-testid="run-not-shown"');
    expect(html).not.toMatch(/calls 5|total wait 12000/);
  });

  it("scoreboard, control failed (verified): every bettor can't check, no dot filled, no line reaches the bar", () => {
    const v = verdictsOn(controlFailed);
    expect(v.map((x) => x.outcome)).toEqual(FIXTURE.bets.map(() => "cant_check"));
    expect(v.every((x) => x.observed === undefined)).toBe(true);
    const html = renderToStaticMarkup(<Scoreboard verdicts={v} bets={FIXTURE.bets} still />);
    expect(html).not.toContain("data-filled");
    expect(html).not.toContain("data-reaches-bar");
    // Same on the Moonwell round's own bets.
    const mw: Run = { ...MOONWELL.runs[0]!, controlPassed: false };
    expect(MOONWELL.bets.map((b) => judge(b, mw).outcome).every((o) => o === "cant_check")).toBe(true);
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});
