// R11: "Bet on <function>" from the repo outline left the bet panel blank for good (a tester's report, reproduced in
// tests/evidence/R11). Cause: the example opens its bet by itself (R7), and reading a new file reset the round but not
// the open bet, so the hand-off landed in an open panel with nothing in it and the "Bet on what it does" button hidden.
// Through the real React screen and the real server (in-process; models mocked, $0).

import "../tools/jsdom-globals";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import { createApi, type Api } from "../../web/api";
import type { BetHandoff } from "../../web/screens/Explorer";
import { Studio } from "../../web/screens/Studio";
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

// The tester's file (github.com/damli40/oft-sentinel backend/src/services/score.ts): a type-only import of a sibling.
const SCORE_TS = `import type { Finding } from "../types.js";

const DEDUCTIONS: Record<string, number> = {
  CRITICAL: 40,
  HIGH: 20,
  MEDIUM: 10,
  LOW: 5,
  PASS: 0,
  UNKNOWN: 0,
};

export function computeScore(findings: Finding[]): number {
  const total = findings.reduce((acc, f) => acc - (DEDUCTIONS[f.severity] ?? 0), 100);
  return Math.max(0, total);
}
`;
// The same file needing its sibling at run time: Atlas runs one file on its own, so it can't check this one.
const SCORE_RUNTIME_IMPORT = SCORE_TS.replace('import type { Finding } from "../types.js";', 'import { SEVERITIES, type Finding } from "../types.js";');

let give: ((h: BetHandoff) => void) | null = null;
function Harness({ api }: { api: Api }) {
  const [handoff, setHandoff] = useState<BetHandoff | null>(null);
  give = setHandoff;
  return (
    <div className="u1-fill">
      <Studio api={api} onExplore={() => {}} handoff={handoff} onHandoffUsed={() => setHandoff(null)} claimant="spark" onClaimant={() => {}} />
    </div>
  );
}

/** An open bet panel always says something: blank is the bug. */
const popIsBlank = () => {
  const pop = $('[data-testid="u1-pop"]');
  return pop !== null && (pop.textContent ?? "").trim() === "";
};

async function mountWithExampleBetOpen() {
  const app = createApp({ modelBets: { chat: mockChat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat: mockChat } } });
  const api = createApi(async (url, init) => app.request(url.replace(/^\/api/, ""), init));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Harness api={api} />));
  // R7: the first screen is the example with its bet already open.
  await until(() => $('[data-testid="u1-seal"]') !== null, "the example's bet, opened by itself", 60000);
}

describe("R11: a file handed over from the repo outline never lands in a blank bet panel", () => {
  it("regression: after the example's bet opened, 'Bet on computeScore' shows the bet button (not an empty open panel), and pressing it fills the panel", async () => {
    await mountWithExampleBetOpen();
    act(() => give!({ code: SCORE_TS, language: "ts", exportName: "computeScore", from: "services/score.ts (uploaded)", nonce: 1 }));
    await until(() => [...host!.querySelectorAll("[data-node]")].some((e) => decodeURIComponent(e.getAttribute("data-node")!) === "computeScore"), "computeScore drawn");
    // Before the fix: u1-pop was open and empty, and the toggle was gone.
    expect(popIsBlank()).toBe(false);
    expect($('[data-testid="u1-pop"]')).toBeNull();
    expect($('[data-testid="u1-cant-run"]')).toBeNull(); // a type-only import is erased: this file runs
    const toggle = $('[data-testid="u1-bet-toggle"]');
    expect(toggle).not.toBeNull();
    act(() => toggle!.click());
    // Whatever Wonder answers (the mock writes tests for another file, so the gate refuses them), the panel says something.
    expect(popIsBlank()).toBe(false);
    await until(() => $('[data-testid="u1-seal"]') !== null || $('[data-testid="u1-tests"]') !== null || $(".error-notice, [role='alert']") !== null, "a filled bet panel");
    expect(popIsBlank()).toBe(false);
  });

  it("a file that needs a sibling Atlas didn't load says so in one sentence: can't check, it needs ../types.js", async () => {
    await mountWithExampleBetOpen();
    act(() => give!({ code: SCORE_RUNTIME_IMPORT, language: "ts", exportName: "computeScore", from: "services/score.ts (uploaded)", nonce: 2 }));
    await until(() => $('[data-testid="u1-cant-run"]') !== null, "the can't-check sentence");
    expect($('[data-testid="u1-cant-run"]')!.textContent).toMatch(/needs \.\.\/types\.js; Atlas runs one pasted file on its own/);
    expect(popIsBlank()).toBe(false);
    expect($('[data-testid="u1-pop"]')).toBeNull();
  });
});
