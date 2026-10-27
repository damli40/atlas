// D02-04 acceptance, through the real React screens AND the real server (createApp, in-process;
// the browser's fetch is routed to app.request, so the sandbox really runs withRpcRetry).
// Proves: the hash is in the DOM before the "Break it" click; inputs are disabled after sealing;
// after the run, sha256(canonicalJson(revealed bet)) equals the hash shown before; the server
// refuses (409) a bet posted after the run started; every bet's sealedAt < run.startedAt.

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis (see that file for why)
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { canonicalJson, sha256Hex } from "../../src/seal";
import type { Bet } from "../../src/types";
import { App } from "../../web/App";
import { createApi, type RunAnswer } from "../../web/api";

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

/** Everything the "browser" sends and gets, so the test can read the server's answers too. */
function wire() {
  const app = createApp();
  const log: { path: string; status: number; body: unknown }[] = [];
  const api = createApi(async (url, init) => {
    const path = url.replace(/^\/api/, "");
    const res = await app.request(path, init);
    const copy = res.clone();
    log.push({ path, status: res.status, body: await copy.json().catch(() => null) });
    return res;
  });
  return { app, api, log };
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
  const PageEvent = el.ownerDocument.defaultView!.Event; // the page's Event, not Node's
  el.dispatchEvent(new PageEvent(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("D02-04 bets UI: sealed hash before the run, checked by the browser after", () => {
  it("one S3 round end to end", async () => {
    const { api, log } = wire();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<App api={api} />));

    // The target, with the mandatory pre-existing label.
    await until(() => $('[data-testid="pre-existing"]') !== null, "the target card");
    expect($('[data-testid="pre-existing"]')!.textContent).toMatch(/^Pre-existing/);
    // S3 ("every call fails") is the default scenario.
    expect((host.querySelector('input[name="scenario"]:checked') as HTMLInputElement).value).toBe("S3");
    expect(byText("button", "Break it")!.hasAttribute("disabled")).toBe(true);

    await act(async () => byText("button", "Show the questions")!.click());
    await until(() => $('[data-testid="bet-calls"]') !== null, "the questions");
    act(() => setValue($('[data-testid="bet-calls"]') as HTMLInputElement, "5"));
    act(() => setValue($('[data-testid="bet-totalWaitMs"]') as HTMLInputElement, "12000"));
    act(() => setValue($('[data-testid="bet-outcome"]') as HTMLSelectElement, "returns")); // a bet that will not match

    await act(async () => byText("button", "Seal my bets")!.click());
    await until(() => $('[data-testid="hash-outcome"]') !== null, "the sealed hashes");

    // 1. Hashes are in the DOM BEFORE "Break it" is clicked, and no run has happened yet.
    const shown: Record<string, string> = {};
    for (const m of ["calls", "totalWaitMs", "outcome"]) {
      const el = $(`[data-testid="hash-${m}"]`)!;
      shown[m] = el.getAttribute("data-hash")!;
      expect(shown[m]).toMatch(/^[0-9a-f]{64}$/);
      expect(el.getAttribute("title")).toBe(shown[m]); // full hash on hover
      expect(el.textContent).toBe(`${shown[m]!.slice(0, 12)}…`); // short form on screen
    }
    expect(log.some((l) => l.path === "/runs")).toBe(false);
    // The server never sent the nonce before the run.
    for (const l of log.filter((x) => x.path === "/bets")) expect((l.body as { bet: Record<string, unknown> }).bet).not.toHaveProperty("nonce");

    // 2. Bet inputs are disabled after sealing.
    for (const m of ["calls", "totalWaitMs", "outcome"]) expect(($(`[data-testid="bet-${m}"]`) as HTMLInputElement).disabled).toBe(true);
    expect(byText("button", "Seal my bets")).toBeUndefined();

    // 3. Break it → the real run → verdicts.
    const breakBtn = byText("button", "Break it")!;
    expect(breakBtn.hasAttribute("disabled")).toBe(false);
    await act(async () => breakBtn.click());
    await until(() => $('[data-testid="seal-check-outcome"]') !== null, "the verdicts", 15000);

    const runEntry = log.find((l) => l.path === "/runs")!;
    expect(runEntry.status).toBe(200);
    const result = runEntry.body as RunAnswer;

    // 4. sha256(canonicalJson(revealed)) === the hash displayed before the run, for every bet.
    for (const b of result.bets as Bet[]) {
      const { who, experimentId, question, measures, answer, nonce, sealedAt } = b;
      expect(sha256Hex(canonicalJson({ who, experimentId, question, measures, answer, nonce, sealedAt }))).toBe(shown[measures]);
      // 5. Sealed strictly before the run started (server times).
      expect(Date.parse(sealedAt)).toBeLessThan(Date.parse(result.run.startedAt));
    }
    // ...and the browser's own check says so on screen.
    for (const m of ["calls", "totalWaitMs", "outcome"]) {
      const line = $(`[data-testid="seal-check-${m}"]`)!;
      expect(line.getAttribute("data-match")).toBe("yes");
      expect(line.textContent).toContain("✓ match");
      expect(line.textContent).toContain("sealed before the run started");
    }

    // Verdict rows: plain words, observed value, judged by src/judge.ts.
    const row = (m: string) => $(`[data-testid="verdict-${m}"]`)!.textContent!;
    expect(row("calls")).toContain("matched");
    expect(row("calls")).toContain("judged by src/judge.ts");
    expect(row("totalWaitMs")).toContain("12000");
    expect(row("outcome")).toContain("didn't match");
    expect(row("outcome")).toContain("throws"); // the observed value

    // 6. A bet posted after the run started is refused by the server with 409.
    const late = await api.bet(result.run.experimentId, "calls", { kind: "integer", value: 4 }).then(
      () => 200,
      (e: { status: number }) => e.status,
    );
    expect(late).toBe(409);
  }, 30000);

  it("a hash that was tampered with shows ✗ mismatch (the check can fail)", async () => {
    const { checkSeals } = await import("../../web/screens/Verdict");
    const { sealBet } = await import("../../src/seal");
    const bet = sealBet({ experimentId: "e1", who: "human", question: "q", measures: "calls", answer: { kind: "integer", value: 5 } }, new Date("2026-10-28T10:00:00.000Z"));
    const { nonce: _n, ...shown } = bet;
    const revealedEdited = { ...bet, answer: { kind: "integer" as const, value: 4 } };
    const run = { startedAt: "2026-10-28T10:00:01.000Z" } as RunAnswer["run"];
    expect(checkSeals([shown], { run, verdicts: [], bets: [bet], betsFrozenAt: "" })[0]!.match).toBe(true);
    expect(checkSeals([shown], { run, verdicts: [], bets: [revealedEdited], betsFrozenAt: "" })[0]!.match).toBe(false);
    expect(checkSeals([shown], { run, verdicts: [], bets: [], betsFrozenAt: "" })[0]!.match).toBe(false);
  });
});
