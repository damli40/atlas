// Final review (Oct 27), screen findings. Each test failed on the code before its fix
// (tests/evidence/final-review/*-tests-on-old-code.txt).
// - S1: a model slot with no usable answer gets its plain status in the counts table, never "0".
// - S2 (page): a run that did not finish says so, and "Try the run again" re-runs the SAME sealed bets.
// - S5: the Level 2 header names what was applied: the proposal's 14 oracle-feed actions, nothing more.
// - S7: a cost at an unconfirmed price is shown as an upper bound.
// - M1, M2, M5, M6, M12: theory caption on a change that did not replay; no "block 0"; a warning row when
//   the fork's FeedSet events differ from the derived actions; the target's own name; plain strip words.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { VerdictScreen } from "../../web/screens/Verdict";
import { verdictColumns } from "../../web/screens/Claimant";
import { ProofCard } from "../../web/screens/ProofCard";
import { ChangeResult } from "../../web/screens/Change";
import { AdversaryResult } from "../../web/screens/Adversary";
import { RunScreen } from "../../web/screens/Run";
import { FindingsPanel } from "../../web/screens/Findings";
import { stripLines } from "../../web/logstrip/LogStrip";
import { App } from "../../web/App";
import { createApi, type Api, type AdversaryAnswer, type ModelSlotView, type RunAnswer } from "../../web/api";
import type { ChangeAnswer } from "../../server/changes";
import { createApp } from "../../server/app";
import { localExecutor } from "../../runners/executor/local";
import type { Executor } from "../../runners/runner";
import type { AtlasFile, Run } from "../../src/types";

const D7 = join(__dirname, "..", "evidence", "D07-01");
const round = (n: number) => JSON.parse(readFileSync(join(D7, `round-${n}.atlas.json`), "utf8")) as AtlasFile;
const SPARK = "model:muse-spark-1.3";
const OPEN = "model:meta-models/muse-spark-open-1026";
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("S1: the live verdict screen never prints a zero score for a model that gave no usable answer", () => {
  // Round 4 of D07-01: "both" mode, Muse Spark's call failed (network error), Muse Spark Open sealed.
  const file = round(4);
  const result = { run: file.runs[0]!, verdicts: file.verdicts, bets: file.bets } as unknown as RunAnswer;
  const sealedOf = (who: string) => file.bets.filter((b) => b.who === who).map((b) => ({ id: b.id, who: b.who, measures: b.measures, sealedHash: b.sealedHash, sealedAt: b.sealedAt, question: b.question, experimentId: b.experimentId }));
  const slots = (sparkReason: string): ModelSlotView[] => [
    { model: "muse-spark-1.3", who: SPARK, display: "Muse Spark 1.3 (muse-spark-1.3)", status: "no_usable_answer", reason: sparkReason, sealed: [] },
    { model: "meta-models/muse-spark-open-1026", who: OPEN, display: "Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten", status: "sealed", sealed: sealedOf(OPEN) as never },
  ];
  const counts = (reason: string) => {
    const d = doc(renderToStaticMarkup(<VerdictScreen shown={sealedOf("human")} modelShown={[]} modelName={null} models={verdictColumns(slots(reason))} result={result} />));
    const cell = (id: string) => d.querySelector(`[data-testid="${id}"]`)?.textContent;
    return { cell, text: d.querySelector('[data-testid="bettor-counts"]')?.textContent ?? "" };
  };

  it("no usable answer: 'no usable answer' under 'bets placed', '-' for each outcome; the sealed bettors keep their numbers", () => {
    const { cell } = counts("the model's answer was not valid JSON");
    expect(cell(`count-total-${SPARK}`)).toBe("no usable answer");
    for (const o of ["matched", "not_matched", "cant_check"]) expect(cell(`count-${o}-${SPARK}`)).toBe("-");
    expect(cell("count-total-human")).toBe("1");
    expect(cell(`count-total-${OPEN}`)).toBe("1");
  });

  it("a network error says 'network error', never a number", () => {
    const { cell } = counts("the page could not reach the server: fetch failed");
    expect(cell(`count-total-${SPARK}`)).toBe("network error");
    for (const o of ["matched", "not_matched", "cant_check"]) expect(cell(`count-${o}-${SPARK}`)).toBe("-");
  });

  it("a column that was named but sealed nothing and has no reason says 'not asked'", () => {
    const d = doc(
      renderToStaticMarkup(
        <VerdictScreen
          shown={sealedOf("human")}
          modelShown={[]}
          modelName={null}
          models={[
            { who: SPARK, name: "Muse Spark 1.3 (muse-spark-1.3)", shown: [] },
            { who: OPEN, name: "Muse Spark Open", shown: sealedOf(OPEN) as never },
          ]}
          result={result}
        />,
      ),
    );
    expect(d.querySelector(`[data-testid="count-total-${SPARK}"]`)?.textContent).toBe("not asked");
    expect(d.querySelector(`[data-testid="count-matched-${SPARK}"]`)?.textContent).toBe("-");
  });
});

describe("S5: every Level 2 header says what was applied, and only that", () => {
  it("the proof card's Level 2 line: fork one block before the proposal ran; the proposal's 14 oracle-feed actions applied", () => {
    const d = doc(renderToStaticMarkup(<ProofCard file={round(4)} />));
    expect(d.querySelector('[data-testid="pc-level"]')?.textContent).toBe("Level 2: fork one block before the proposal ran; the proposal's 14 oracle-feed actions applied");
    expect(d.body.textContent).not.toMatch(/proposal applied/);
  });
});

describe("S7: a cost at a price Atlas has not confirmed is an upper bound", () => {
  const answer = (model: string, fellBack: boolean) => ({ ok: true, target: null, findings: [], dropped: [], model, fellBack, usage: { promptTokens: 1, completionTokens: 1, usd: 0.1234 } });
  const target = { kind: "ts-fixture" as const, ref: "tests/fixtures/with-rpc-retry.ts", codeSha256: "a".repeat(64) };
  async function shown(model: string, fellBack: boolean) {
    const api = { investigate: async () => answer(model, fellBack), session: () => "s" } as unknown as Api;
    mount(<FindingsPanel api={api} target={target} chosen={null} onChoose={() => {}} locked={false} />);
    await act(async () => byText("button", "Ask the Investigator (Muse Wonder 1.0 (muse-wonder-1.0))")!.click());
    await until(() => host!.textContent!.includes("Found by"), "the findings");
    return host!.textContent!;
  }
  it("Muse Spark (price not published): '≤ $0.1234 (upper bound: price not confirmed)'", async () => {
    const text = await shown("muse-spark-1.3", true);
    expect(text).toContain("≤ $0.1234 (upper bound: price not confirmed)");
  });
  it("Muse Wonder (published price): the dollar figure, plainly", async () => {
    const text = await shown("muse-wonder-1.0", false);
    expect(text).toContain("Cost $0.1234.");
    expect(text).not.toContain("upper bound");
  });
});

describe("M1: a change accepted in theory but not replayed still carries its theory caption", () => {
  it("the refused branch shows the D20 caption beside the accepted diff", () => {
    const stored = JSON.parse(readFileSync(join(__dirname, "..", "evidence", "D20", "change-answer.json"), "utf8")) as { change: ChangeAnswer extends infer A ? (A extends { change: infer C } ? C : never) : never; diff: string };
    const answer = { ok: false, runId: "r", reason: "the replay could not finish: anvil exited", fixer: null, toward: "t", change: stored.change, diff: stored.diff } as ChangeAnswer;
    const d = doc(renderToStaticMarkup(<ChangeResult answer={answer} />));
    const theory = [...d.querySelectorAll('[data-testid="change-theory"]')].map((e) => e.textContent);
    expect(theory.length).toBe(1);
    expect(theory[0]).toMatch(/^In theory: Atlas wired cbETH_ORACLE directly/);
  });
});

describe("M2: the Adversary panel never prints 'block 0' when the fork block is unknown", () => {
  it("a Level 1 run with no fork block: no block number, no 'undefined'", () => {
    const run = { ...round(4).runs[0]!, forkBlock: undefined } as unknown as Run;
    const answer = {
      ok: true,
      fromRunId: "r0",
      adversary: { model: "muse-spark-1.3", display: "Muse Spark 1.3 (muse-spark-1.3)", proposed: { experimentId: "e2", name: "price-read · markets cbETH", params: { shape: "price-read", markets: ["cbETH"] } }, why: "w", rejected: [], usd: null },
      person: { status: "not asked", reason: "autonomous round" },
      round: { experiment: { id: "e2" }, questions: [], run, verdicts: [], bets: [] },
    } as unknown as AdversaryAnswer;
    const text = doc(renderToStaticMarkup(<AdversaryResult answer={answer} />)).body.textContent!;
    expect(text).not.toMatch(/block 0\b/);
    expect(text).not.toMatch(/undefined/);
  });
});

describe("M5: a Level 2 run whose fork events differ from the derived actions shows a plain warning", () => {
  it("forkEventsEqualDerived false → a warning row on the proof card; true → none", () => {
    const ok = round(4);
    expect(doc(renderToStaticMarkup(<ProofCard file={ok} />)).querySelector('[data-testid="pc-fork-events-warning"]')).toBeNull();
    const bad = structuredClone(ok);
    bad.runs[0]!.result.measured.forkEventsEqualDerived = false;
    const row = doc(renderToStaticMarkup(<ProofCard file={bad} />)).querySelector('[data-testid="pc-fork-events-warning"]');
    expect(row?.textContent).toMatch(/the oracle-feed changes the fork recorded are not the ones Atlas derived from the proposal/);
  });
});

describe("M6: the screens name the code under test from the target, never a hard-coded name", () => {
  it("proof card title and the Run screen's waiting line", () => {
    const file = structuredClone(round(1));
    file.target = { ...file.target, ref: "tests/fixtures/another-target.ts" };
    const title = doc(renderToStaticMarkup(<ProofCard file={file} />)).querySelector(".pc-title")?.textContent;
    expect(title).toBe("tests/fixtures/another-target.ts");
    const running = doc(renderToStaticMarkup(<RunScreen canRun running result={null} onBreak={() => {}} name="tests/fixtures/another-target.ts" />)).body.textContent;
    expect(running).toContain("Running tests/fixtures/another-target.ts in the sandbox…");
    expect(running).not.toContain("withRpcRetry");
  });
});

describe("M12: the strip uses plain words for the change role", () => {
  it("the fixer role is labelled by what it does, and no strip label says 'Fixer'", () => {
    const [line] = stripLines([{ t: "2026-10-27T08:00:00.000Z", role: "fixer", model: "muse-spark-1.3", action: "Muse Code (muse-spark-1.3) proposes a change" }]);
    expect(line!.who).toBe("Proposes a change");
    expect(line!.who).not.toMatch(/fix|repair/i);
  });
});

// ---------- S2 on the page: the run did not finish, try again with the same sealed bets ----------

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
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
function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  const PageEvent = el.ownerDocument.defaultView!.Event;
  el.dispatchEvent(new PageEvent(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("S2 (page): a run that did not finish can be tried again with the same sealed bets", () => {
  it("the sandbox fails once: 'the run did not finish: …', then 'Try the run again' runs the same bets and the seals still check", async () => {
    let failNext = false;
    const flaky: Executor = {
      kind: "local",
      exec: async (req) => {
        if (failNext && req.files["request.json"]?.includes('"id":"e-s2"')) {
          failNext = false;
          throw new Error("spawn node EAGAIN (forced for this test)");
        }
        return localExecutor.exec(req);
      },
    };
    const app = createApp({ executor: flaky });
    const runs: number[] = [];
    const api = createApi(async (url, init) => {
      const path = url.replace(/^\/api/, "");
      let body = init?.body;
      // The page names experiments by the server's id; give this one a known id so the executor can spot it.
      if (path === "/experiments" && typeof body === "string") body = JSON.stringify({ ...JSON.parse(body), id: "e-s2" });
      const res = await app.request(path, { ...init, ...(body !== undefined ? { body } : {}) });
      if (path === "/runs") runs.push(res.status);
      return res;
    });
    mount(<App api={api} start="fixture" />);
    await until(() => $('[data-testid="pre-existing"]') !== null, "the target card");
    await act(async () => byText("button", "Show the questions")!.click());
    await until(() => $('[data-testid="bet-calls"]') !== null, "the questions");
    act(() => setValue($('[data-testid="bet-calls"]') as HTMLInputElement, "5"));
    act(() => setValue($('[data-testid="bet-totalWaitMs"]') as HTMLInputElement, "12000"));
    act(() => setValue($('[data-testid="bet-outcome"]') as HTMLSelectElement, "throws"));
    await act(async () => byText("button", "Seal my bets")!.click());
    await until(() => $('[data-testid="hash-outcome"]') !== null, "the sealed hashes");
    const before = $('[data-testid="hash-outcome"]')!.getAttribute("data-hash");

    failNext = true;
    await act(async () => byText("button", "Break it")!.click());
    await until(() => $('[data-testid="run-failed"]') !== null, "the did-not-finish notice", 15000);
    expect($('[data-testid="run-failed"]')!.textContent).toMatch(/^the run did not finish: the sandbox could not start: spawn node EAGAIN/);
    expect($('[data-testid="seal-check-outcome"]')).toBeNull(); // no verdict
    expect(($('[data-testid="claimant-toggle"]') as HTMLFieldSetElement).disabled).toBe(true); // same round, still open

    const again = byText("button", "Try the run again");
    expect(again).toBeDefined();
    await act(async () => again!.click());
    await until(() => $('[data-testid="seal-check-outcome"]') !== null, "the verdicts", 15000);
    expect(runs).toEqual([503, 200]);
    expect($('[data-testid="hash-outcome"]')!.getAttribute("data-hash")).toBe(before);
    for (const m of ["calls", "totalWaitMs", "outcome"]) expect($(`[data-testid="seal-check-${m}"]`)!.getAttribute("data-match")).toBe("yes");
    expect($('[data-testid="seal-check-outcome"]')!.textContent).toContain("sealed before the run started");
    expect($('[data-testid="run-failed"]')).toBeNull();
  }, 30000);
});
