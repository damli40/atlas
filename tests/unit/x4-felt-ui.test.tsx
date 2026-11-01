// X4 (D56) in the browser's components: the optional tap beside the seal, the verdict's line, the record, and the
// boundary that lets a new drawing replace the stage without touching them.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sealBet } from "../../src/seal";
import { trackRecordOf, type TrackEntry } from "../../src/track-record";
import type { Bet, Confidence, Verdict } from "../../src/types";
import { FeltRecord, FeltRoundLine, HowSurePicker } from "../../web/screens/FeltPanel";
import { RecordView } from "../../web/screens/TrackRecord";
import { useState } from "react";

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(node);
  });
  return host;
}
const bet = (confidence?: Confidence): Bet => sealBet({ experimentId: "e", who: "human", question: "q", measures: "outcome", answer: { kind: "enum", value: "a", options: ["a"] }, ...(confidence ? { confidence } : {}) });
const v = (b: Bet, outcome: Verdict["outcome"]) => ({ betId: b.id, outcome }) as Verdict;
let k = 0;
const entry = (outcome: TrackEntry["outcome"], extra: Partial<TrackEntry> = {}): TrackEntry => ({ runId: "r1", betId: `b${k++}`, sealedHash: "a".repeat(64), type: "outcome", outcome, repeat: false, at: "2026-10-31T10:00:00.000Z", ...extra });

describe("X4 the tap", () => {
  it("nothing is preselected; one tap selects, a second takes it back, so it stays optional", async () => {
    function Host({ spy }: { spy: (v: Confidence | null) => void }) {
      const [c, setC] = useState<Confidence | null>(null);
      return <HowSurePicker value={c} onChange={(x) => { setC(x); spy(x); }} />;
    }
    const spy = vi.fn();
    const host = await render(<Host spy={spy} />);
    const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios().map((r) => r.textContent)).toEqual(["sure", "think so", "guess"]);
    expect(radios().every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(host.textContent).toContain("How sure are you overall?");
    const pick = async (i: number) => act(async () => radios()[i]!.click());
    await pick(1);
    expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    await pick(2);
    expect(spy).toHaveBeenLastCalledWith("guess");
    await pick(2);
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(radios().every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });
  it("disabled: no change", async () => {
    const spy = vi.fn();
    const host = await render(<HowSurePicker value="sure" onChange={spy} disabled />);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="radio"]')!.click());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("X4 the verdict's line", () => {
  it("says the brief's sentence, names answers that couldn't be checked, and says nothing with no tap", () => {
    const bs = [bet("sure"), bet("sure"), bet("sure"), bet("sure")];
    const html = renderToStaticMarkup(<FeltRoundLine bets={bs} verdicts={[v(bs[0]!, "matched"), v(bs[1]!, "not_matched"), v(bs[2]!, "not_matched"), v(bs[3]!, "not_matched")]} />);
    expect(html).toContain("You said &#x27;sure&#x27; and matched 1 of 4.");
    const two = [bet("guess"), bet("guess")];
    expect(renderToStaticMarkup(<FeltRoundLine bets={two} verdicts={[v(two[0]!, "matched"), v(two[1]!, "cant_check")]} />)).toContain("matched 1 of 1. 1 answer couldn&#x27;t be checked.");
    const none = [bet("think so")];
    expect(renderToStaticMarkup(<FeltRoundLine bets={none} verdicts={[v(none[0]!, "cant_check")]} />)).toContain("None of your answers could be checked.");
    const no = [bet()];
    expect(renderToStaticMarkup(<FeltRoundLine bets={no} verdicts={[v(no[0]!, "matched")]} />)).toBe("");
  });
});

describe("X4 the record", () => {
  it("hides the comparison under 3 answers a side, with the note; shows it after; also inside the existing record view", () => {
    const few = trackRecordOf([entry("matched", { path: "nothing failed", confidence: "sure" })]);
    const a = renderToStaticMarkup(<FeltRecord record={few} />);
    expect(a).not.toContain('data-testid="felt-paths"');
    expect(a).toContain("So far: 1 when nothing failed, 0 when something failed.");
    expect(a).toContain("You said &#x27;sure&#x27; on 1 round and matched 1 of 1.");
    const enough = trackRecordOf([...Array.from({ length: 3 }, () => entry("matched", { path: "nothing failed" })), ...Array.from({ length: 3 }, () => entry("not_matched", { path: "something failed" }))]);
    const b = renderToStaticMarkup(<RecordView record={enough} />);
    expect(b).toContain("On tests with no scripted failure you matched 3 of 3. With a scripted failure, 0 of 3.");
    expect(b).toContain("data-testid=\"felt-record\"");
  });
});

describe("X4 the component boundary", () => {
  it("the panel imports nothing from the drawing, so a new drawing can replace the stage", () => {
    const src = readFileSync(join(__dirname, "../../web/screens/FeltPanel.tsx"), "utf8");
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) {
      expect(i, i).not.toMatch(/machines|bench|Studio|anatomy/i);
    }
  });
});
