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
import { answersToSend, defaultFunction } from "../../web/screens/Studio";
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
    runEls: stage.querySelectorAll("[data-run]").length,
    litLamps: stage.querySelectorAll("[data-lamp][data-on]").length,
    liveLines: stage.querySelectorAll(".u1-live").length,
    marks: stage.querySelectorAll(".u1-pin, [data-testid='mark-list']").length,
    /** Words laid over the drawing (everything on the figure but the SVG itself). */
    figureText: [...stage.querySelector(".u1-figure")!.children].filter((c) => !c.classList.contains("u1-svg")).map((c) => c.textContent).join(""),
  };
}

describe("U1 drawing-first screen", () => {
  it("defaults: the busiest exported function is under test; untapped answers are sealed as can't tell", () => {
    const o = fileOutline(U1_EXAMPLE, "ts");
    expect(defaultFunction(o, [{ name: "fetchWithRetry" }, { name: "getPrice" }])).toBe("fetchWithRetry");
    const qs = quizQuestionsFor(U1_TEST);
    expect(answersToSend(qs, { outcome: "a", virtualMs: "can't tell" }).map((a) => a.answer.kind)).toEqual(["quiz", "declined", "declined", "declined"]);
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
    expect([...stage.querySelectorAll("[data-hit]")].map((e) => e.getAttribute("data-hit"))).toEqual(expect.arrayContaining(["backoffMs", "sleep", "fetchWithRetry", "getPrice"]));
    let t = runTraces(stage);
    expect(t).toMatchObject({ runEls: 0, litLamps: 0, liveLines: 0, marks: 0, figureText: "" });

    // open the bet: Wonder's first allowed test is preselected, the stand-in deck appears, still no result
    click($('[data-testid="u1-bet-toggle"]'));
    await until(() => $('[data-testid="u1-seal"]') !== null && $('[data-lamp]') !== null, "the quiz and the stand-in devices", 60000);
    expect($('[data-testid="u1-test"]')!.textContent).toContain("fetchWithRetry");
    t = runTraces($('[data-testid="bench-stage"]')!);
    expect(t).toMatchObject({ runEls: 0, litLamps: 0, liveLines: 0, marks: 0, figureText: "" });
    const needleAtRest = $('[data-needle] path')!.getAttribute("d");
    // the drawing's words before betting: names and plates only, no counts, times or endings
    const svgText = $(".u1-svg svg")!.textContent ?? "";
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
    expect($('[data-needle] path')!.getAttribute("d")).not.toBe(needleAtRest);
    const list = $('[data-testid="mark-list"]')!;
    for (const m of ["outcome", "returnedJson", "calls:fetchIt", "virtualMs"]) expect(list.querySelector(`[data-testid="mark-${m}"]`)).not.toBeNull();
    // your pick and both models' picks, each with plain code's word
    expect(list.querySelector('[data-testid="mark-outcome"]')!.textContent).toMatch(/You.*returns a value.*matched/);
    expect(list.textContent).toContain("Muse Spark Open");
    expect(list.querySelector('[data-testid="mark-returnedJson"]')!.textContent).toMatch(/You.*can't tell.*can't check/);
    expect($('[data-testid="chip-stand-in fetchIt"]')!.textContent).toBe("3 calls");
    expect($('[data-testid="u1-proof"]')!.getAttribute("href")).toMatch(/^\?proof=/);
  }, 120_000);
});
