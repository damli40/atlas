// U1 (D47) through the real React screen and the real server (in-process; models mocked, sandbox real).
// Proves the before-bet rule on the DOM and the SVG: before the bets are sealed the drawing shows structure only
// (no lit lamp, the dial needle at 0, no chip, no mark, no run value anywhere on the stage); after sealing the run
// starts by itself, plays, and every quiz question is marked with each bettor's pick. Also counts the clicks.

import "../tools/jsdom-globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import { App } from "../../web/App";
import { createApi } from "../../web/api";
import { answersToSend, claimProposal, defaultFunction } from "../../web/screens/Studio";
import { U1_EXAMPLE } from "../../web/u1-example";
import { fileOutline } from "../../src/file-outline";
import { quizQuestionsFor } from "../../src/quiz";
import { mockChat, U1_TEST } from "../evidence/U1/mock-server";

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
const $ = (sel: string) => host!.querySelector(sel) as HTMLElement | null;
async function until(check: () => boolean, what: string, ms = 20000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 20));
    });
  }
}
function setValue(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new (el.ownerDocument.defaultView!.Event)("input", { bubbles: true }));
}
let clicks = 0;
const click = (el: HTMLElement | null) => {
  if (!el) throw new Error("nothing to click");
  clicks++;
  act(() => el.click());
};

/** Everything on the stage that could carry a run result. */
function runTraces(stage: HTMLElement) {
  return {
    runEls: stage.querySelectorAll("[data-testid='bench-path']").length,
    litLamps: stage.querySelectorAll(".rr-lit").length,
    marks: stage.querySelectorAll(".rr-mark, [data-testid='mark-list']").length,
    /** Words of plain code's failure labels: facts about the code's text, shown before betting to every bettor alike (D50). */
    labelMarks: [...stage.querySelectorAll("[data-tag-of]")].map((e) => [...e.querySelectorAll("text")].map((t) => t.textContent).join(" ")),
  };
}

describe("U1 drawing-first screen", () => {
  it("defaults: the busiest exported function is under test; untapped answers are sealed as can't tell", () => {
    const o = fileOutline(U1_EXAMPLE, "ts");
    expect(defaultFunction(o, [{ name: "fetchWithRetry" }, { name: "getPrice" }])).toBe("fetchWithRetry");
    const qs = quizQuestionsFor(U1_TEST);
    // U3: a claim round on code that keeps state opens on a two-call test; otherwise on Wonder's first allowed test.
    const one = { gate: { allowed: true }, params: { args: [] } };
    const two = { gate: { allowed: true }, params: { args: [], calls: [{}, {}] } };
    expect(claimProposal([one, two], { source: "cache = {}\n", language: "py" })).toBe(two);
    expect(claimProposal([one, two], { source: "x = 1\n", language: "py" })).toBe(one);
    const sent = answersToSend(qs, { outcome: "a", virtualMs: "can't tell" });
    expect(sent.ok && sent.answers.map((a) => a.answer.kind)).toEqual(["declined", "quiz", "declined", "declined"]);
    // U3: a typed returned value is a json answer; one that does not read is refused before sealing.
    const typed = answersToSend(qs, { returnedJson: "a" }, { returnedJson: '{"ok": true}' });
    expect(typed.ok && typed.answers.find((a) => a.measures === "returnedJson")!.answer).toEqual({ kind: "json", value: { ok: true } });
    // D64: text that isn't a value seals as that text.
    expect(answersToSend(qs, {}, { returnedJson: "$100.00" }).answers.find((a) => a.measures === "returnedJson")!.answer).toEqual({ kind: "json", value: "$100.00" });
  });

  it("before sealing the stage draws structure only; after sealing the run plays and the quiz is marked", async () => {
    const app = createApp({ modelBets: { chat: mockChat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: true } }, paste: { proposer: { chat: mockChat } } });
    const api = createApi(async (url, init) => app.request(url.replace(/^\/api/, ""), init));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<App api={api} />));
    await until(() => $('[data-testid="u1-code"]') !== null, "the entry");
    act(() => setValue($('[data-testid="u1-code"]') as HTMLTextAreaElement, U1_EXAMPLE));
    clicks = 0;
    click($('[data-testid="u1-draw"]'));
    await until(() => $(".u1-svg svg") !== null, "the drawing", 60000);
    const stage = $('[data-testid="bench-stage"]')!;
    expect(stage.getAttribute("data-phase")).toBe("rest");
    expect([...stage.querySelectorAll("[data-node]")].map((e) => decodeURIComponent(e.getAttribute("data-node")!))).toEqual(expect.arrayContaining(["backoffMs", "sleep", "fetchWithRetry", "getPrice"]));
    let t = runTraces(stage);
    expect(t).toMatchObject({ runEls: 0, litLamps: 0, marks: 0 });
    // D50: the failure label is drawn before any bet, and it carries no run result.
    expect(t.labelMarks).toEqual(["could fail: no overall timeout, lines 12–19 (read, not run)"]);

    // open the bet: Wonder's first allowed test is preselected, the stand-in deck appears, still no result
    click($('[data-testid="u1-bet-toggle"]'));
    await until(() => $('[data-testid="u1-seal"]') !== null && $('.rr-lamp') !== null, "the quiz and the stand-in devices", 60000);
    expect($('[data-testid="u1-test"]')!.textContent).toContain("fetchWithRetry");
    t = runTraces($('[data-testid="bench-stage"]')!);
    expect(t).toMatchObject({ runEls: 0, litLamps: 0, marks: 0 });
    // the drawing's words before betting: names and plates only, no counts, times or endings
    // (the captions say what the test's script will do: that is the test, not a run)
    const svgClone = $(".u1-svg svg")!.cloneNode(true) as SVGElement;
    // Captions and tooltips are checked apart: before sealing they hold only plain code's words about the code and the test's own
    // script, and the step line is empty. A leak would be drawn in those places (M4).
    const shownBefore = [...$('[data-testid="bench-stage"]')!.querySelectorAll(".rr-captions, title")].map((e) => e.textContent ?? "").join(" ");
    expect(shownBefore).not.toMatch(/\b(threw|returned \S|waited \d|called \w+ \d|matched|parts ways|run [A-Za-z0-9_-]{8,}'s trace)\b/);
    expect($('[data-testid="run-step"]')?.textContent ?? "").toBe("");
    svgClone.querySelectorAll(".rr-captions, title").forEach((x) => x.remove());
    const svgText = svgClone.textContent ?? "";
    expect(svgText).not.toMatch(/\d+\s*(ms|calls?)\b|returned|threw|matched/i);

    click($('[data-testid="opt-outcome-a"]'));
    click($('[data-testid="opt-calls:fetchIt-c"]'));
    click($('[data-testid="opt-virtualMs-d"]'));
    click($('[data-testid="u1-seal"]'));
    await until(() => $('[data-testid="bench-stage"]')?.getAttribute("data-phase") === "marked", "the marked drawing", 60000);
    expect(clicks).toBeLessThanOrEqual(6); // "Draw it" + toggle + 3 taps + seal (a real paste needs no "Draw it": 5)
    const after = runTraces($('[data-testid="bench-stage"]')!);
    expect(after.runEls).toBeGreaterThan(0);
    expect(after.marks).toBeGreaterThan(0);
    const list = $('[data-testid="mark-list"]')!;
    for (const m of ["outcome", "returnedJson", "calls:fetchIt", "virtualMs"]) expect(list.querySelector(`[data-testid="mark-${m}"]`)).not.toBeNull();
    // your pick and both models' picks, each with plain code's word
    expect(list.querySelector('[data-testid="mark-outcome"]')!.textContent).toMatch(/You.*returns a value.*matched/);
    expect(list.textContent).toContain("Muse Spark Open");
    expect(list.querySelector('[data-testid="mark-returnedJson"]')!.textContent).toMatch(/You.*can't tell.*can't check/);
    // the path is drawn from the trace: each call of the stand-in has its ticket
    const path = [...$('[data-testid="bench-path"]')!.querySelectorAll("text")].map((x) => x.textContent).join(" | ");
    expect(path.match(/called fetchIt/g)?.length).toBe(3);
    // U2 (D53): the proof card opens in place (a panel), with a link to its own page.
    expect($('[data-testid="u1-proof"]')!.tagName).toBe("BUTTON");
  }, 120_000);
});
