// X3 in the browser's components: the track record panel's words, the proof card's "your record before this round",
// and the failure labels (each "found in this code" links to its lines, each "reproduced" to its proof card), on the
// paste screen and on an explorer part's card.

import "../tools/jsdom-globals";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelFailures, type RunEvidence } from "../../src/failure-labels";
import { trackRecordOf, type TrackEntry } from "../../src/track-record";
import { FailureLabels } from "../../web/screens/FailureLabels";
import { RecordBefore, RecordView, TrackRecordPanel } from "../../web/screens/TrackRecord";
import { ExplorerMachine } from "../../web/machines/explorer/ExplorerMachine";
import { explorerModel } from "../../web/machines/explorer/model";
import type { OutlineView } from "../../web/machines/explorer/outline-data";
import type { Api, TrackAnswer } from "../../web/api";
import saved from "../fixtures/outline/atlas-server-meta-058ab2a.outline.json";
import { RETRY_SRC } from "../tools/paste-fixtures";

const BANNED = /\b(learn\w*|teach\w*|score\w*|skill\w*|right|wrong)\b/i;
const e = (type: TrackEntry["type"], outcome: TrackEntry["outcome"], runId: string, extra: Partial<TrackEntry> = {}): TrackEntry => ({ runId, betId: `${runId}-${type}`, sealedHash: "d".repeat(64), type, outcome, repeat: false, at: "2026-10-28T10:00:00.000Z", ...extra });
const rec = trackRecordOf([e("timing", "not_matched", "r1", { side: "under" }), e("outcome", "matched", "r1"), e("call counts", "cant_check", "r2"), e("outcome", "matched", "r3", { repeat: true })]);

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return host;
}
const fakeApi = (answer: TrackAnswer) => ({ trackRecord: async () => answer }) as unknown as Api;

describe("X3 UI: the track record panel", () => {
  it("shows matched / didn't match / can't check with n by type, the repeats left out, and none of the banned words", async () => {
    const host = await render(<TrackRecordPanel api={fakeApi({ person: "browser", record: rec })} refreshKey={0} />);
    const text = host.textContent!;
    expect(text).toContain("Your track record");
    expect(text).toContain("Where your guesses matched what the code did");
    expect(text).toContain("Timing: matched 0 of 1 · didn't match 1 · can't check 0 (n = 1).");
    expect(text).toContain("1 bet left out: it was on a test you had already seen run (sealed as a repeat).");
    expect(text).toContain("Kept for this browser on this server");
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(BANNED);
  });

  it("the proof card's 'your record before this round' appears only when the server knows the round as this person's", async () => {
    const mine = await render(<RecordBefore api={fakeApi({ person: "browser", record: rec, before: rec })} runId="r9" />);
    expect(mine.querySelector('[data-testid="record-before"]')!.textContent).toContain("Your record before this round");
    const notMine = await render(<RecordBefore api={fakeApi({ person: "browser", record: rec, before: null })} runId="r9" />);
    expect(notMine.querySelector('[data-testid="record-before"]')).toBeNull();
    const first = await render(<RecordBefore api={fakeApi({ person: "browser", record: rec, before: trackRecordOf([]) })} runId="r9" />);
    expect(first.textContent).toContain("This was your first judged round on this server.");
  });

  it("an empty record says so in plain words", () => {
    expect(renderToStaticMarkup(<RecordView record={trackRecordOf([])} />)).toContain("No judged bets yet");
  });
});

const NEVER: RunEvidence = {
  runId: "runRepro1",
  params: { shape: "call-function", exportName: "retryWithBackoff", args: [{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "never_settle" }], then: "repeat_last" }] },
  run: { id: "runRepro1", controlPassed: true, result: { measured: { outcome: "never_settled" }, notMeasured: {} } },
};

describe("X3 UI: failure labels", () => {
  it("'found in this code' links to its lines shown right there; 'reproduced' links to the proof card; 'common pattern' names no lines", () => {
    const n = RETRY_SRC.split("\n").length;
    const found = labelFailures({ language: "ts", spans: [{ path: "pasted", text: RETRY_SRC, lineStart: 1, lineEnd: n }] });
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<FailureLabels answer={found} idPrefix="paste" />);
    const item = host.querySelector('[data-failure="no-overall-timeout"]')!;
    expect(item.getAttribute("data-label")).toBe("found in this code");
    const link = item.querySelector('[data-testid="fl-lines-no-overall-timeout"]') as HTMLAnchorElement;
    const target = host.querySelector(link.getAttribute("href")!)!;
    expect(target.textContent).toContain("for (let i = 0; i < attempts; i++) {");
    const common = host.querySelector('[data-failure="retry-storm"]')!;
    expect(common.getAttribute("data-label")).toBe("common pattern");
    expect(common.textContent).toContain("Only Atlas's list says this kind of code often fails this way");
    expect(common.querySelector("a")).toBeNull();

    const repro = labelFailures({ language: "ts", spans: [{ path: "pasted", text: RETRY_SRC, lineStart: 1, lineEnd: n }], runs: [NEVER] });
    host.innerHTML = renderToStaticMarkup(<FailureLabels answer={repro} idPrefix="paste" />);
    const r = host.querySelector('[data-failure="no-overall-timeout"]')!;
    expect(r.getAttribute("data-label")).toBe("reproduced");
    expect((r.querySelector('[data-testid="fl-proof-no-overall-timeout"]') as HTMLAnchorElement).getAttribute("href")).toBe("?proof=runRepro1");
    // Reproduced items come first.
    expect(host.querySelector(".fl-item")!.getAttribute("data-label")).toBe("reproduced");
  });

  it("an explorer part's card shows its labels (Wonder's tag named as Wonder's)", () => {
    const model = explorerModel(saved as unknown as OutlineView);
    const box = model.boxes[0]!;
    const labels = { [box.id]: labelFailures({ language: "ts", spans: [{ path: "x.ts", text: "export const a = 1;\n", lineStart: 1, lineEnd: 1 }], wonderTags: [{ label: "retry" }], wonderModel: "muse-wonder-1.0" }) };
    const html = renderToStaticMarkup(<ExplorerMachine model={model} initialPick={box.id} labels={labels} theme="light" />);
    expect(html).toContain("Known ways this kind of code fails");
    expect(html).toContain("Muse Wonder (muse-wonder-1.0) tagged this part &quot;retry&quot;");
    expect(html).not.toContain('data-label="found in this code"');
  });
});
