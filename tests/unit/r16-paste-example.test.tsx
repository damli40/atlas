// R16 review Major 1: paste-anywhere on the example's first screen. It acts only while the consent line ("Your code goes to
// Meta's AI…") is visible, so that line stays on the example's bet panel. With a code a paste starts POST /paste with the
// pasted text; without one it opens the paste box with the text in it and the invite line, and sends nothing.
// Through the real React screen and the real server (in-process; models mocked, $0).

import "../tools/jsdom-globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import { createApi } from "../../web/api";
import { Studio } from "../../web/screens/Studio";
import { mockChat } from "../evidence/U1/mock-server";
import { RETRY_SRC } from "../tools/paste-fixtures";

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
// jsdom has no layout, so offsetParent is always null; here an element is "visible" when it is in the document and not hidden.
const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get(this: HTMLElement) { return this.isConnected && !this.closest("[hidden]") ? this.parentElement : null; } });
});
afterAll(() => {
  if (desc) Object.defineProperty(HTMLElement.prototype, "offsetParent", desc);
});
const $ = (sel: string) => host!.querySelector(sel) as HTMLElement | null;
async function until(check: () => boolean, what: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}; page says: ${(host?.textContent ?? "").slice(0, 400)}`);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 20));
    });
  }
}
function pasteOnPage(text: string) {
  const W = document.defaultView as unknown as { Event: typeof Event };
  const ev = new W.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { getData: () => text } });
  act(() => {
    document.body.dispatchEvent(ev);
  });
}

async function firstScreen(signedIn: boolean) {
  const app = createApp({ modelBets: { chat: mockChat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat: mockChat } } });
  const pastes: string[] = [];
  const api = createApi(async (url, init) => {
    const path = url.replace(/^\/api/, "");
    if (path === "/invite/status") return new Response(JSON.stringify(signedIn ? { required: true, signedIn: true, dailyUsd: 10 } : { required: true, signedIn: false, waitlist: "https://example.com/wait" }), { headers: { "content-type": "application/json" } });
    if (path === "/paste") pastes.push(String(init?.body ?? ""));
    return app.request(path, init);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<div className="u1-fill"><Studio api={api} onExplore={() => {}} claimant="spark" onClaimant={() => {}} /></div>));
  // The example is drawn and its question is ready: the first screen.
  await until(() => $('[data-testid="u1-seal"]') !== null, "the example's first screen", 60000);
  await until(() => pastes.length >= 1, "the example's own paste");
  return { pastes };
}

describe("R16 review Major 1: paste anywhere on the example's first screen", () => {
  it("the consent line is on the example's bet panel; with a code a paste starts POST /paste with the pasted text", async () => {
    const { pastes } = await firstScreen(true);
    const consent = [...host!.querySelectorAll('[data-testid="e-consent"]')].filter((e) => (e as HTMLElement).offsetParent !== null);
    expect(consent.length).toBeGreaterThan(0);
    expect(consent[0]!.textContent).toMatch(/Your code goes to Meta's AI/);
    const before = pastes.length;
    pasteOnPage(RETRY_SRC);
    await until(() => pastes.length > before, "a POST /paste for the pasted text");
    expect(pastes.at(-1)).toContain("retryWithBackoff");
  }, 90_000);

  it("without a code a paste opens the paste box with the text and sends nothing", async () => {
    const { pastes } = await firstScreen(false);
    const before = pastes.length;
    pasteOnPage(RETRY_SRC);
    await until(() => $('[data-testid="e-needs-code"]') !== null, "the paste box's invite line");
    expect(($('[data-testid="u1-code"]') as HTMLTextAreaElement | null)?.value).toContain("retryWithBackoff");
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 100));
    });
    expect(pastes.length).toBe(before);
  }, 90_000);
});
