// R12 (D73): the new-user review's page findings, through the real React screen and the real server (in-process; models
// mocked, $0).
// - Finding 1 (blocker): a judge enters the invite code with no file pasted. The server then answers from the invited copy
//   of the app, which never saw the example's session or tests. Before: the page re-read the example and offered the
//   example copy's kept test, and the invited copy answered "this session has no proposal …". Now: the page lands on the
//   paste box with the sample files, in a fresh session; "Back to the example" works there too.
// - Findings 4 + 5: a syntax error or prose asks no model; a class-only file says so in plain words and asks no model.
// - Finding 8: an upload with no code waits in the box (no second invite line, no language picker).

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { createApi } from "../../web/api";
import { Studio } from "../../web/screens/Studio";
import { mockChat } from "../evidence/U1/mock-server";

const ROOT = resolve(import.meta.dirname, "..", "..");
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
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}; page says: ${(host?.textContent ?? "").slice(0, 600)}`);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 20));
    });
  }
}
const wait = (ms: number) =>
  act(async () => {
    await new Promise((ok) => setTimeout(ok, ms));
  });
function setValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new (el.ownerDocument.defaultView!.Event)("input", { bubbles: true }));
}
const click = (el: HTMLElement | null) => {
  if (!el) throw new Error("nothing to click");
  act(() => el.click());
};
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
const mount = (api: ReturnType<typeof createApi>) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<div className="u1-fill"><Studio api={api} onExplore={() => {}} claimant="spark" onClaimant={() => {}} /></div>));
};

describe("R12 finding 1: entering a code with no file pasted", () => {
  it("lands on the paste box with the samples, in a fresh session of the invited copy; the example then plays there with no 'no proposal' error", async () => {
    // Two copies of the app, as on the hosted server: the open example's and the invited one (server/access/gate.ts).
    const exampleCopy = createApp({ modelBets: { chat: mockChat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat: mockChat } } });
    const invitedCopy = createApp({ modelBets: { chat: mockChat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat: mockChat } } });
    let signedIn = false;
    const seen: { path: string; session: string | null; copy: "example" | "invited"; status?: number; body?: string }[] = [];
    const api = createApi(async (url, init) => {
      const path = url.replace(/^\/api/, "");
      if (path === "/invite/status") return json({ required: true, signedIn, waitlist: null });
      if (path === "/invite") {
        signedIn = true;
        return json({ ok: true });
      }
      const copy = signedIn ? invitedCopy : exampleCopy;
      const res = await copy.request(path, init);
      const body = res.status >= 400 ? await res.clone().text() : undefined;
      seen.push({ path, session: new Headers(init.headers as HeadersInit).get("x-atlas-session"), copy: signedIn ? "invited" : "example", status: res.status, ...(body ? { body } : {}) });
      return res;
    });
    mount(api);
    // The first screen: the example, drawn, its question ready (an early test written in the example's copy).
    await until(() => $('[data-testid^="opt-"]') !== null || $('[data-testid="u1-bet-toggle"]') !== null, "the example", 60000);
    await until(() => seen.some((s) => s.path === "/paste/proposals" && s.copy === "example"), "the example's early test");
    const exampleSession = seen.find((s) => s.copy === "example" && s.session)?.session;
    // "Try your own code", then the code, with nothing pasted.
    click($('[data-testid="u1-own"]'));
    await until(() => $('[data-testid="e-invite-code"]') !== null, "the invite form");
    act(() => setValue($('[data-testid="e-invite-code"]') as HTMLInputElement, "atlas_throwaway-test-code"));
    const form = $('[data-testid="e-invite"]') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new (form.ownerDocument.defaultView!.Event)("submit", { bubbles: true, cancelable: true }));
    });
    // Lands on the paste box with the samples, enabled, and no error.
    await until(() => $('[data-testid="e-own"]') !== null && $('[data-testid="e-invite"]') === null, "the paste box");
    expect($('[data-testid="u1-code"]')).not.toBeNull();
    expect($('[data-testid="e-samples"]')).not.toBeNull();
    for (const b of host!.querySelectorAll<HTMLButtonElement>('[data-testid^="e-sample-"]')) expect(b.disabled).toBe(false);
    expect($('[role="alert"]')).toBeNull();
    await wait(200);
    // Nothing about code was sent on the way (only free reads such as the person's record): no paid call, no stale test.
    expect(seen.filter((s) => s.copy === "invited" && /^\/(paste|experiments|runs)/.test(s.path))).toEqual([]);
    // "Back to the example" in the invited copy: the old bug's path (a kept test from the example's copy). Now a fresh one.
    click($('[data-testid="u1-example"]'));
    await until(() => $('[data-testid^="opt-"]') !== null || $('[data-testid="u1-bet-toggle"]') !== null, "the example in the invited copy", 60000);
    if (!$('[data-testid^="opt-"]')) click($('[data-testid="u1-bet-toggle"]'));
    await until(() => $('[data-testid^="opt-"]') !== null, "the example's question", 60000);
    const invited = seen.filter((s) => s.copy === "invited");
    expect(invited.length).toBeGreaterThan(0);
    expect(invited.filter((s) => (s.status ?? 200) >= 400)).toEqual([]);
    expect(host!.textContent).not.toMatch(/has no proposal/);
    // A fresh session: the invited copy never got the example copy's session id.
    expect(exampleSession).toBeTruthy();
    // (A free read of the person's record may race the sign-in with the old id, as a cookie set mid-request would; it holds no code.)
    expect(invited.filter((s) => s.session === exampleSession && s.path !== "/remember").map((s) => s.path)).toEqual([]);
    expect(invited.some((s) => s.path === "/paste/proposals")).toBe(true);
  }, 120_000);
});

describe("R12 findings 4 + 5 + 8: files Atlas can't read, and uploads with no code", () => {
  const read = (f: string) => readFileSync(join(ROOT, "tests/fixtures/r12", f), "utf8");
  function counted() {
    let calls = 0;
    const chat = async (a: ChatArgs): Promise<ChatResult> => {
      calls++;
      return mockChat(a);
    };
    const app = createApp({ modelBets: { chat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat } } });
    const paths: string[] = [];
    const api = createApi(async (url, init) => {
      const path = url.replace(/^\/api/, "");
      if (path === "/invite/status") return json({ required: false, signedIn: false });
      paths.push(path);
      return app.request(path, init);
    });
    return { api, paths, calls: () => calls };
  }
  const drawOwn = async (code: string) => {
    await until(() => $('[data-testid="u1-own"]') !== null, "the first screen");
    click($('[data-testid="u1-own"]'));
    await until(() => $('[data-testid="u1-code"]') !== null, "the paste box");
    act(() => setValue($('[data-testid="u1-code"]') as HTMLTextAreaElement, code));
    click($('[data-testid="u1-draw"]'));
  };

  it("a syntax error, then prose: the parser's line and column (or 'plain text'), the file back in the box, and 0 model calls", async () => {
    const c = counted();
    mount(c.api);
    await until(() => $('[data-testid="u1-own"]') !== null, "the first screen", 60000);
    await wait(300);
    const before = c.calls();
    const askedBefore = c.paths.filter((p) => /^\/paste\/(names|summary|proposals)$/.test(p)).length;
    await drawOwn(read("syntax.js"));
    await until(() => $('[data-testid="e-precheck"]') !== null, "the parser's words");
    expect($('[data-testid="e-precheck"]')!.textContent).toMatch(/line 3, column 26: '\)' expected\./);
    expect(($('[data-testid="u1-code"]') as HTMLTextAreaElement).value).toBe(read("syntax.js"));
    // R12 review: the language picker is offered, so a person can say what the file is.
    expect($('[data-testid="u1-lang"]')).not.toBeNull();
    // Saying "this is Python" reads it as Python on the next draw.
    click($('[data-testid="u1-lang-py"]'));
    click($('[data-testid="u1-draw"]'));
    await until(() => /this Python file/.test($('[data-testid="e-precheck"]')?.textContent ?? ""), "the file read as Python");
    click($('[data-testid="u1-lang-auto"]'));
    act(() => setValue($('[data-testid="u1-code"]') as HTMLTextAreaElement, read("prose.txt")));
    click($('[data-testid="u1-draw"]'));
    await until(() => /plain text, not code/.test($('[data-testid="e-precheck"]')?.textContent ?? ""), "the prose words");
    await wait(500);
    expect(c.calls() - before).toBe(0);
    expect(c.paths.filter((p) => /^\/paste\/(names|summary|proposals)$/.test(p)).length - askedBefore).toBe(0);
  }, 120_000);

  it("Markdown with a fenced function: 'Use the code inside the fence' draws just the code", async () => {
    const c = counted();
    mount(c.api);
    await drawOwn(read("readme.md"));
    await until(() => $('[data-testid="e-precheck-fence"]') !== null, "the fence button", 60000);
    click($('[data-testid="e-precheck-fence"]'));
    await until(() => $('[data-testid="u1-bet-toggle"]') !== null, "the drawing of the fenced code", 60000);
    expect(c.paths.filter((p) => p === "/paste").length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("a file that exports only a class: the plain sentence, and no summary, names or test is asked for", async () => {
    const c = counted();
    mount(c.api);
    await until(() => $('[data-testid="u1-own"]') !== null, "the first screen", 60000);
    await wait(300);
    const before = c.calls();
    await drawOwn(read("onlyclass.ts"));
    await until(() => $('[data-testid="u1-nothing-why"]') !== null, "the dead end");
    expect($('[data-testid="u1-nothing-why"]')!.textContent).toBe("Atlas calls exported functions; this file exports a class (Counter). Export a function that uses it.");
    await wait(500);
    expect(c.calls() - before).toBe(0);
  }, 120_000);

  it("an upload with no invite code waits in the box: one invite line, no language picker, nothing read", async () => {
    const app = createApp({ modelBets: { chat: mockChat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat: mockChat } } });
    let pastes = 0;
    const api = createApi(async (url, init) => {
      const path = url.replace(/^\/api/, "");
      if (path === "/invite/status") return json({ required: true, signedIn: false, waitlist: null });
      if (path === "/paste") pastes++;
      return app.request(path, init);
    });
    mount(api);
    await until(() => $('[data-testid="u1-own"]') !== null, "the first screen", 60000);
    await wait(300);
    const before = pastes;
    click($('[data-testid="u1-own"]'));
    await until(() => $('[data-testid="u1-upload"]') !== null, "the upload input");
    const input = $('[data-testid="u1-upload"]') as HTMLInputElement;
    const win = input.ownerDocument.defaultView!;
    const file = { name: "f.js", text: async () => "export function f() { return 1; }\n" };
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
      await new Promise((ok) => setTimeout(ok, 100));
    });
    await until(() => ($('[data-testid="u1-code"]') as HTMLTextAreaElement).value.includes("export function f"), "the file in the box");
    expect(pastes).toBe(before);
    expect(host!.querySelectorAll('[data-testid="e-needs-code"]').length).toBe(1);
    expect(host!.textContent!.split("needs an invite code").length - 1).toBe(1);
    expect($('[data-testid="u1-lang"]')).toBeNull();
  }, 120_000);
});

describe("R12 finding 7: 'Share proof card' puts the public-link question up at once", () => {
  const fixture = JSON.parse(readFileSync(join(ROOT, "tests/evidence/D04-04/fixture-eRopGsrp2a.atlas.json"), "utf8"));
  const render = async (props: Record<string, unknown>) => {
    const { ProofCard } = await import("../../web/screens/ProofCard");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const api = createApi(async () => json({ kept: true, until: "2026-12-03T00:00:00.000Z" }));
    await act(async () => root!.render(<ProofCard file={fixture} api={api} {...props} />));
    return api;
  };
  it("with askLink the consent shows without a click; it makes the kept (30-day) link only when pressed", async () => {
    await render({ askLink: true });
    expect($('[data-testid="pc-link-ask"]')).not.toBeNull();
    expect($('[data-testid="pc-link-ask"]')!.textContent).toMatch(/public link: anyone with it can read this card for 30 days/);
  });
  it("without askLink (a card opened from a link), or on a server that keeps no cards, it waits for 'Copy link'", async () => {
    await render({});
    expect($('[data-testid="pc-link-ask"]')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    await render({ askLink: true, keepsCards: false });
    expect($('[data-testid="pc-link-ask"]')).toBeNull();
  });
});
