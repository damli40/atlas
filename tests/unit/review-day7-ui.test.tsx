// Day-7 review, screen findings: S1 (the Change screen names each model bettor on its own), and the
// minors that live on screens (M3 "not asked" for the person in an autonomous round, M4 the toggle
// locked during a round, M6 a failed "What else?" can be asked again, M7 a model slot that failed
// still gets its column on the proof card). Each test failed on the code before its fix
// (tests/evidence/D07-review/*-tests-on-old-code.txt).

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProofCard } from "../../web/screens/ProofCard";
import { AdversaryPanel } from "../../web/screens/Adversary";
import { App } from "../../web/App";
import { createApi, type Api, type AdversaryAnswer } from "../../web/api";
import { createApp } from "../../server/app";
import { ChangeResult } from "../../web/screens/Change";
import type { ChangeAnswer } from "../../server/changes";
import type { AtlasFile, Run } from "../../src/types";

const D7 = join(__dirname, "..", "evidence", "D07-01");
const round = (n: number) => JSON.parse(readFileSync(join(D7, `round-${n}.atlas.json`), "utf8")) as AtlasFile;

function changeAnswer(file: AtlasFile): ChangeAnswer {
  const replay = { ...file.runs[0]!, id: "r", trace: [] } as Run;
  return {
    ok: true,
    runId: "x",
    change: { id: "c", runId: "x", diff: "", proposedBy: { role: "fixer", model: "muse-spark-1.3" }, toward: "t" },
    fixer: { path: "muse-exec", model: "muse-spark-1.3", attempts: [], usage: null },
    diff: "",
    caption: "c",
    replay,
    bets: file.bets,
    before: { run: { id: "a", codeSha256: "x" }, verdicts: file.verdicts },
    after: { run: { id: "r", codeSha256: "y" }, verdicts: file.verdicts },
  } as unknown as ChangeAnswer;
}

const bettorCells = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll('[data-testid="change-table"] tbody tr')].map((tr) => tr.children[1]!.textContent);
};

describe("S1: the Change screen labels each model bettor by its own name", () => {
  it("'both' mode (D07-01 round 1): Spark's rows say Spark, Spark Open's rows say Spark Open via Baseten", () => {
    const file = round(1);
    const cells = bettorCells(renderToStaticMarkup(<ChangeResult answer={changeAnswer(file)} />));
    const want = file.bets.map((b) =>
      b.who === "human" ? "You" : b.who === "model:muse-spark-1.3" ? "Muse Spark 1.3 (muse-spark-1.3)" : "Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten",
    );
    expect(cells).toEqual(want);
    expect(cells.filter((c) => c?.startsWith("Muse Spark Open"))).toHaveLength(3);
  });
  it("only Spark Open sealed (round 4): its rows are Spark Open's, never Spark's", () => {
    const cells = bettorCells(renderToStaticMarkup(<ChangeResult answer={changeAnswer(round(4))} />));
    expect(cells).toContain("Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten");
    expect(cells.some((c) => c?.startsWith("Muse Spark 1.3"))).toBe(false);
  });
});

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("M7: a model slot that failed still gets its column on the proof card", () => {
  it("D07-01 round 4: Muse Spark shows 'no usable answer (network error)', read from the file's own agent log", () => {
    const d = doc(renderToStaticMarkup(<ProofCard file={round(4)} />));
    const lines = [...d.querySelectorAll('[data-testid="pc-bettors"] li')].map((li) => li.textContent);
    expect(lines).toContain("Muse Spark 1.3 (muse-spark-1.3) · no usable answer (network error)");
    expect(d.querySelector('[data-testid="count-total-model:muse-spark-1.3"]')?.textContent).toBe("no usable answer");
  });
});

describe("M3: an autonomous round's proof card says the person was 'not asked', never '0 bets'", () => {
  it("a file whose experiment the Adversary proposed and only models bet on", () => {
    const f = round(5);
    const human = new Set(f.bets.filter((b) => b.who === "human").map((b) => b.id));
    const auto: AtlasFile = {
      ...f,
      experiments: [{ ...f.experiments[0]!, proposedBy: { role: "adversary", model: "muse-spark-1.3" } }],
      bets: f.bets.filter((b) => !human.has(b.id)),
      verdicts: f.verdicts.filter((v) => !human.has(v.betId)),
    };
    const d = doc(renderToStaticMarkup(<ProofCard file={auto} />));
    const lines = [...d.querySelectorAll('[data-testid="pc-bettors"] li')].map((li) => li.textContent);
    expect(lines[0]).toBe("You · not asked (autonomous round: the Adversary proposed it, Atlas ran it with no click)");
    expect(d.querySelector('[data-testid="count-total-human"]')?.textContent).toBe("not asked");
  });
});

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

describe("M4: the claimant toggle is locked while a round is open", () => {
  it("after the questions are shown (the experiment exists), the toggle cannot change who bets", async () => {
    const app = createApp({});
    const api = createApi((url, init) => Promise.resolve(app.request(url.replace(/^\/api/, ""), init)));
    mount(<App api={api} start="fixture" />);
    await until(() => $('[data-testid="pre-existing"]') !== null, "the target card");
    expect(($('[data-testid="claimant-toggle"]') as HTMLFieldSetElement).disabled).toBe(false);
    await act(async () => byText("button", "Show the questions")!.click());
    await until(() => $('[data-testid="bet-calls"]') !== null, "the questions");
    expect(($('[data-testid="claimant-toggle"]') as HTMLFieldSetElement).disabled).toBe(true);
  }, 20000);
});

describe("M6 (page): a failed 'What else?' can be asked again", () => {
  it("shows 'Ask again' after an answer with no run, and asks again", async () => {
    const answers: AdversaryAnswer[] = [
      { ok: false, fromRunId: "r1", reason: "Muse Spark 1.3 (muse-spark-1.3): no usable answer (the answer is not valid JSON)", adversary: null },
      { ok: false, fromRunId: "r1", reason: "second answer", adversary: null },
    ];
    let asked = 0;
    const api = { adversary: async () => answers[asked++]!, session: () => "s" } as unknown as Api;
    mount(<AdversaryPanel api={api} runId="r1" />);
    await act(async () => $('[data-testid="adversary-ask"]')!.click());
    await until(() => $('[data-testid="adversary-reason"]') !== null, "the first answer");
    const again = $('[data-testid="adversary-ask-again"]');
    expect(again?.textContent).toBe("Ask again");
    await act(async () => again!.click());
    await until(() => $('[data-testid="adversary-reason"]')?.textContent === "second answer", "the second answer");
    expect(asked).toBe(2);
  });
});
