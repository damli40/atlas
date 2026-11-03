// R10 (D72) + R11: with no invite code, the bet panel's "Ask Muse Wonder for a new test" (and the R11 empty-panel button
// when it would go beyond the example) shows the one line with "Join the waitlist" and "I have a code", and asks nothing.
// Through the real React screen and the real server (in-process; models mocked, $0). The invite status is that of a
// hosted server the visitor has no code for.

import "../tools/jsdom-globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import { createApi } from "../../web/api";
import { Studio, askNeedsCode } from "../../web/screens/Studio";
import { mockChat } from "../evidence/U1/mock-server";

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
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

describe("R10: askNeedsCode (plain rule)", () => {
  it("with no code only the example's default question is open; with a code everything is", () => {
    expect(askNeedsCode(true, "default", true)).toBe(false);
    expect(askNeedsCode(true, "list", true)).toBe(true);
    expect(askNeedsCode(true, "first", true)).toBe(true);
    expect(askNeedsCode(true, "default", false)).toBe(true);
    expect(askNeedsCode(false, "list", false)).toBe(false);
  });
});

describe("R10 + R11: the empty bet panel's ask with no code", () => {
  it("'Ask Muse Wonder for a new test' shows the waitlist line and sends nothing", async () => {
    const app = createApp({ modelBets: { chat: mockChat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat: mockChat } } });
    const asked: string[] = [];
    const api = createApi(async (url, init) => {
      const path = url.replace(/^\/api/, "");
      if (path === "/invite/status") return new Response(JSON.stringify({ required: true, signedIn: false, waitlist: "https://example.com/wait" }), { headers: { "content-type": "application/json" } });
      if (path === "/paste/proposals") {
        asked.push(String(init.body));
        // Wonder had no usable test: the panel lands on the list with its "ask for a new test" button.
        return new Response(JSON.stringify({ ok: false, model: "muse-wonder-1.0", display: "Muse Wonder", reason: "not asked (test)", proposals: [] }), { headers: { "content-type": "application/json" } });
      }
      return app.request(path, init);
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<div className="u1-fill"><Studio api={api} onExplore={() => {}} claimant="spark" onClaimant={() => {}} /></div>));
    await until(() => $('[data-testid="u1-no-offer-ask"]') !== null, "the list with 'Ask Muse Wonder for a new test'", 60000);
    const before = asked.length;
    act(() => $('[data-testid="u1-no-offer-ask"]')!.click());
    await until(() => $('[data-testid="waitlist-link"]') !== null, "the waitlist line");
    const line = $('[data-testid="waitlist-link"]')!.closest('[role="alert"]')!.textContent ?? "";
    expect(line).toMatch(/needs an invite code/);
    expect(line).toMatch(/Join the waitlist/);
    expect(line).toMatch(/I have a code/);
    expect($('[data-testid="waitlist-link"]')!.getAttribute("href")).toBe("https://example.com/wait");
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 100));
    });
    expect(asked.length).toBe(before); // nothing was asked
  }, 90_000);
});
