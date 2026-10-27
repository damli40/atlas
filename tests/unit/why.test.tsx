// D05-05 "Ask why": a plain-code sentence is shown only when it points at run evidence (a trace event
// index or a finding's line range); every other sentence is dropped and counted in the log strip as
// "dropped: no run evidence". Since the day-5 review (S2) a model's words are never linked: they are shown
// apart, whole, as the model's words. Uses the two rounds recorded live on Oct 27 (tests/evidence/D04-04, the
// regenerated files): no network, no model.

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { linkSentences, modelSentences, referencesOf, templatedSentences, type WhySentence } from "../../src/why";
import type { AtlasFile } from "../../src/types";
import { LogStrip } from "../../web/logstrip/LogStrip";
import { modelTextsOf, WhyDroppedContext, WhyScreen } from "../../web/screens/Why";

const EVIDENCE = join(import.meta.dirname, "..", "evidence", "D04-04");
const load = (name: string): AtlasFile => JSON.parse(readFileSync(join(EVIDENCE, name), "utf8"));
const FIXTURE = load("fixture-eRopGsrp2a.atlas.json");
const MOONWELL = load("moonwell-level2-mwTaxvHFzB.atlas.json");
const plain = (text: string): WhySentence => ({ text, by: { kind: "plain-code" } });
const spark = (text: string): WhySentence => ({ text, by: { kind: "model", model: "muse-spark-1.3", role: "claimant" } });

describe("the linker (src/why.ts)", () => {
  it("3 sentences, 1 with no run evidence → 2 shown, 1 dropped", () => {
    const run = FIXTURE.runs[0]!;
    const r = linkSentences([plain("call 5 threw; no more attempts (trace #23)"), spark("Defaults apply: attempts=5, so 5 failures exhaust the loop."), plain("it waited 4 times, 3000 ms each (trace #4, #9, #14, #19)")], run, FIXTURE.findings ?? []);
    expect(r.shown.map((s) => s.text)).toEqual(["call 5 threw; no more attempts (trace #23)", "it waited 4 times, 3000 ms each (trace #4, #9, #14, #19)"]);
    expect(r.shown[0]!.links).toEqual([{ kind: "trace", index: 23, event: "throws" }]);
    expect(r.dropped.map((s) => s.text)).toEqual(["Defaults apply: attempts=5, so 5 failures exhaust the loop."]);
  });

  it("a reference to evidence that does not exist drops the sentence, even beside a good one", () => {
    const run = MOONWELL.runs[0]!;
    const f = MOONWELL.findings!;
    expect(run.trace).toHaveLength(49);
    expect(linkSentences([plain("cbETH broke (trace #49)")], run, f).dropped).toHaveLength(1); // one past the end
    expect(linkSentences([plain("see trace #48 and trace #400")], run, f).dropped).toHaveLength(1);
    expect(linkSentences([plain("the feed is set on lines 40–42")], run, f).dropped).toHaveLength(1); // 40–41 sit outside every finding
    expect(linkSentences([plain("proposals/mips/mip-x43/mip-x43.sol lines 44–53 changes it")], run, f).dropped).toHaveLength(1); // those lines are a finding in ANOTHER file
    const ok = linkSentences([plain("proposals/ChainlinkOracleConfigs.sol line 42 sets the cbETH feed")], run, f);
    expect(ok.shown[0]!.links).toEqual([{ kind: "lines", file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42, findingId: f[0]!.id }]);
  });

  it("lines of a finding plain code did not verify are not evidence", () => {
    const f = MOONWELL.findings!.map((x) => ({ ...x, verified: false }));
    expect(referencesOf("lines 44–53", MOONWELL.runs[0]!, f).bad).toHaveLength(1);
  });

  it("templated sentences for the fixture round, each pointing at the trace event that says it", () => {
    const run = FIXTURE.runs[0]!;
    const t = templatedSentences(run).map((s) => s.text);
    expect(t).toEqual(["it waited 4 times, 3000 ms each (trace #4, #9, #14, #19)", "call 5 threw; no more attempts (trace #23)"]);
    expect(run.trace[23]!.event).toBe("throws");
    expect(run.trace.slice(24).some((e) => e.event === "call")).toBe(false);
    expect(linkSentences(templatedSentences(run), run, []).dropped).toHaveLength(0);
  });

  it("templated sentences for the Moonwell round: the person's lines, the control, the feed, the read, the price sources", () => {
    const run = MOONWELL.runs[0]!;
    const t = templatedSentences(run, MOONWELL.findings![0]).map((s) => s.text);
    expect(t).toEqual([
      "a person chose proposals/ChainlinkOracleConfigs.sol lines 42–42 for this round",
      "the known-case control matched before anything was judged (trace #2)",
      "Atlas set cbETH's oracle feed as the governor, as the proposal does (trace #21)",
      "cbETH's price read after the change was $1.12 (trace #35)",
      "before the change, cbETH's price read touched 2 price sources (trace #47)",
      "after the change, cbETH's price read touched 1 price source (trace #48)",
    ]);
    expect(run.trace[48]).toMatchObject({ event: "call_trace", data: { phase: "post-apply", count: 1 } });
    const r = linkSentences(templatedSentences(run, MOONWELL.findings![0]), run, MOONWELL.findings!);
    expect(r.dropped).toHaveLength(0);
    expect(r.shown).toHaveLength(6);
  });

  it("Spark's real rationale names no run evidence, so it is dropped (and never reworded)", () => {
    const words = modelTextsOf(MOONWELL.bets, MOONWELL.findings![0]);
    expect(words).toEqual([{ model: "muse-spark-1.3", role: "claimant", text: "Price requires on-chain oracle reading at a future block beyond cutoff, cannot be known in advance." }]);
    const mw = linkSentences(modelSentences(words[0]!.text, { kind: "model", model: "muse-spark-1.3", role: "claimant" }), MOONWELL.runs[0]!, MOONWELL.findings!);
    expect(mw.shown).toHaveLength(0);
    expect(mw.dropped).toHaveLength(1); // the one counted in strip-1080p.png
    const fx = modelTextsOf(FIXTURE.bets, null);
    expect(fx).toHaveLength(3);
    const sentences = fx.flatMap((m) => modelSentences(m.text, { kind: "model", model: m.model, role: m.role }));
    const r = linkSentences(sentences, FIXTURE.runs[0]!, []);
    expect(r.shown).toHaveLength(0);
    expect(r.dropped.map((s) => s.text)).toEqual(sentences.map((s) => s.text));
  });
});

// ---------- the screen and the strip together ----------

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

/** Why + LogStrip wired the way App wires them: the dropped count goes through WhyDroppedContext. */
function Harness({ modelTexts }: { modelTexts: { text: string; model: string; role: "claimant" | "investigator" }[] }) {
  const [dropped, setDropped] = useState<{ count: number; at: string } | null>(null);
  return (
    <WhyDroppedContext.Provider value={(count) => setDropped((d) => (d?.count === count ? d : { count, at: "2026-10-27T07:30:00.000Z" }))}>
      <WhyScreen run={FIXTURE.runs[0]!} finding={null} modelTexts={modelTexts} />
      <LogStrip events={[]} dropped={dropped} open onToggle={() => {}} />
    </WhyDroppedContext.Provider>
  );
}

describe("Ask why on screen", () => {
  it("S2: plain-code sentences are the only linked ones; Spark's words sit apart, whole, unlinked, and are not counted as dropped", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    // The fixture run gives 2 templated sentences (both linked); Spark's words go to the model panel.
    act(() => root!.render(<Harness modelTexts={[{ text: "Defaults apply: attempts=5, so the loop gives up.", model: "muse-spark-1.3", role: "claimant" }]} />));
    expect(host.querySelectorAll('[data-testid="why-sentence"]')).toHaveLength(0); // nothing until asked
    act(() => (host!.querySelector('[data-testid="why-ask"]') as HTMLButtonElement).click());
    const shown = [...host.querySelectorAll('[data-testid="why-sentence"]')].map((li) => li.textContent);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain("it waited 4 times, 3000 ms each (trace #4, #9, #14, #19)");
    expect(shown[1]).toContain("call 5 threw; no more attempts (trace #23)");
    expect(host.querySelector('[data-testid="why-plain"]')!.textContent).not.toContain("Defaults apply");
    expect(host.querySelector('[data-testid="why-model"]')!.textContent).toContain("muse-spark-1.3 (its bet's reasoning), the model's words: Defaults apply: attempts=5, so the loop gives up.");
    expect(host.querySelectorAll('[data-testid="logstrip-line"]')).toHaveLength(0); // no plain-code sentence dropped
  });

  it("S2: a model sentence that names a trace event is NOT linked; it stays in the model panel as the model's words", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Harness modelTexts={[{ text: "It stops after the fifth call (trace #21).", model: "muse-spark-1.3", role: "claimant" }]} />));
    act(() => (host!.querySelector('[data-testid="why-ask"]') as HTMLButtonElement).click());
    const panel = host.querySelector('[data-testid="why-model"]')!;
    expect(panel.textContent).toContain("It stops after the fifth call (trace #21).");
    expect(panel.textContent).toContain("not a verdict");
    expect(panel.textContent).not.toContain("evidence: trace #21");
    expect(panel.querySelectorAll('[data-testid="why-sentence"]')).toHaveLength(0);
    expect(host.querySelector('[data-testid="why-plain"]')!.textContent).not.toContain("fifth call");
  });
});
