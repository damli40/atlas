// D02-06 through the real React screens and the real server (in-process), with chat() mocked:
// before the run the page shows "Muse Spark … has sealed 3 bets" and their hashes but none of
// Spark's answers; after the run the verdict table has a column per bettor and every seal (both
// bettors) is checked by the page.

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { App } from "../../web/App";
import { createApi } from "../../web/api";

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const usage = { promptTokens: 1500, completionTokens: 300, usd: 0.012 };
const OPTIONS = ["returns", "throws", "pending"];

function wire(replies: string[]) {
  let n = 0;
  const chat = async (_args: ChatArgs): Promise<ChatResult> => ({ ok: true, content: replies[n++] ?? "", finishReason: "stop", usage });
  const app = createApp({ modelBets: { chat } });
  const api = createApi((url, init) => Promise.resolve(app.request(url.replace(/^\/api/, ""), init)));
  return { api };
}

const $ = (sel: string) => host!.querySelector(sel) as HTMLElement | null;
const byText = (tag: string, text: string) => [...host!.querySelectorAll(tag)].find((e) => e.textContent?.trim() === text) as HTMLElement | undefined;
async function until(check: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 10));
    });
  }
}
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  const PageEvent = el.ownerDocument.defaultView!.Event;
  el.dispatchEvent(new PageEvent(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function round(replies: string[]) {
  const { api } = wire(replies);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<App api={api} start="fixture" />));
  await until(() => $('[data-testid="pre-existing"]') !== null, "the target card");
  await act(async () => byText("button", "Show the questions")!.click());
  await until(() => $('[data-testid="bet-calls"]') !== null, "the questions");
  act(() => setValue($('[data-testid="bet-calls"]') as HTMLInputElement, "5"));
  act(() => setValue($('[data-testid="bet-totalWaitMs"]') as HTMLInputElement, "12000"));
  act(() => setValue($('[data-testid="bet-outcome"]') as HTMLSelectElement, "throws"));
  await act(async () => byText("button", "Seal my bets")!.click());
  await until(() => $('[data-testid="hash-outcome"]') !== null, "the sealed hashes");
  await until(() => $('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", "the model slot");
}

describe("D02-06 model bets on screen", () => {
  it("before the run: hashes for both, Spark's values hidden; after: a column per bettor, every seal ✓", async () => {
    const spark = {
      bets: [
        { measures: "calls", answer: { kind: "integer", value: 6 }, rationale: "Rationale-otter: six tries." },
        { measures: "totalWaitMs", answer: { kind: "integer", value: 15017 }, rationale: "Rationale-otter: waits." },
        { measures: "outcome", answer: { kind: "enum", value: "throws", options: OPTIONS }, rationale: "Rationale-otter: rethrows." },
      ],
    };
    await round([JSON.stringify(spark)]);
    const note = $('[data-testid="model-sealed-note"]')!.textContent!;
    expect(note).toContain("Muse Spark 1.3 (muse-spark-1.3) has sealed 3 bets");
    for (const m of ["calls", "totalWaitMs", "outcome"]) expect($(`[data-testid="model-hash-${m}"]`)!.getAttribute("data-hash")).toMatch(/^[0-9a-f]{64}$/);
    // None of Spark's values or words are anywhere on the page before the run.
    expect(host!.textContent).not.toMatch(/15017|Rationale-otter/);
    expect(host!.innerHTML).not.toMatch(/15017|Rationale-otter/);

    await act(async () => byText("button", "Break it")!.click());
    await until(() => $('[data-testid="seal-check-model-outcome"]') !== null, "the verdicts", 15000);
    const headers = [...host!.querySelectorAll(".verdicts th")].map((t) => t.textContent);
    expect(headers).toEqual(["question", "You", "Muse Spark 1.3 (muse-spark-1.3)", "observed"]);
    expect($('[data-testid="verdict-you-calls"]')!.textContent).toContain("matched");
    expect($('[data-testid="verdict-model-calls"]')!.textContent).toMatch(/^6 · didn't match/);
    expect($('[data-testid="verdict-model-totalWaitMs"]')!.textContent).toMatch(/^15017 · didn't match/);
    expect($('[data-testid="verdict-model-outcome"]')!.textContent).toMatch(/^throws · matched/);
    for (const m of ["calls", "totalWaitMs", "outcome"]) {
      for (const id of [`seal-check-${m}`, `seal-check-model-${m}`]) {
        expect($(`[data-testid="${id}"]`)!.getAttribute("data-match")).toBe("yes");
        expect($(`[data-testid="${id}"]`)!.textContent).toContain("sealed before the run started");
      }
    }
    // The rationale shows only in the model panel, never in the verdict table.
    expect($('[data-testid="model-panel"]')!.textContent).toContain("Rationale-otter: six tries.");
    expect(host!.querySelector(".verdicts")!.textContent).not.toContain("Rationale-otter");
  }, 30000);

  it("no usable answer: the slot says why, the table says so in Spark's column, your bets are judged", async () => {
    await round(["nope", "still nope"]);
    expect($('[data-testid="model-no-answer"]')!.textContent).toBe(
      "Muse Spark 1.3 (muse-spark-1.3): no usable answer (the answer is not valid JSON). Your bets are still judged.",
    );
    await act(async () => byText("button", "Break it")!.click());
    await until(() => $('[data-testid="seal-check-outcome"]') !== null, "the verdicts", 15000);
    expect($('[data-testid="verdict-you-calls"]')!.textContent).toContain("matched");
    expect($('[data-testid="verdict-model-calls"]')!.textContent).toBe("no usable answer (the answer is not valid JSON)");
  }, 30000);
});
