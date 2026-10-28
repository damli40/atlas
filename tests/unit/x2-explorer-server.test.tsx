// X2: the explorer against the real server, with Muse Wonder (and every other model) mocked.
// - A server round-trip: upload the server/meta files → outline job (real intake, code map in its own process, real
//   verification) → GET /outline → the explorer model and figure draw exactly the confirmed and code-only joins.
// - "Bet on this part": the file text comes from the job's own /atlas file and goes through POST /paste (the same
//   route, the same export scan); the React paste flow sends it once and picks the export.
// - A 3,000-call run handed off from the explorer still renders honestly (trace cut at the cap, timeline not drawn).

import "../tools/jsdom-globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import type { Run } from "../../src/types";
import { CallTimeline } from "../../web/machines/calltimeline/CallTimeline";
import { explorerModel } from "../../web/machines/explorer/model";
import type { OutlineView } from "../../web/machines/explorer/outline-data";
import { buildFigure } from "../../web/machines/explorer/figure.mjs";
import { ExplorerMachine } from "../../web/machines/explorer/ExplorerMachine";
import { PasteFlow } from "../../web/screens/Paste";
import { ExplorerFlow, type BetHandoff } from "../../web/screens/Explorer";
import type { Api, PasteAnswer } from "../../web/api";
import { client, makeApp } from "../tools/paste-fixtures";

const ROOT = join(import.meta.dirname, "..", "..");
const WONDER = readFileSync(join(ROOT, "tests/fixtures/outline/wonder-server-meta-058ab2a.json"), "utf8");
const usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
const outlinerAnswering = (content: string) => {
  const calls: ChatArgs[] = [];
  const chat = async (a: ChatArgs): Promise<ChatResult> => {
    calls.push(a);
    return { ok: true, finishReason: "stop", usage, content };
  };
  return { chat, calls };
};
function filesUnder(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(dir, p), text: readFileSync(p, "utf8") });
    }
  };
  walk(dir);
  return out;
}
async function waitDone(c: ReturnType<typeof client>, jobId: string) {
  for (let i = 0; i < 200; i++) {
    const j = await c.get(`/outline/jobs/${jobId}`);
    if (j.json.status === "done" || j.json.status === "failed") return j.json;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the outline job did not finish");
}

describe("X2: server round-trip with a mocked Muse Wonder", () => {
  it("upload server/meta → outline job → the figure draws exactly the confirmed and code-only joins → hand-off to /paste", async () => {
    const w = outlinerAnswering(WONDER);
    const { app } = makeApp({ outline: { outliner: { chat: w.chat } } });
    const c = client(app);
    const files = filesUnder(join(ROOT, "server/meta"));
    const start = await c.post("/outline/jobs", { files });
    expect(start.status).toBe(202);
    const job = await waitDone(c, start.json.jobId);
    expect(job.status).toBe("done");
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]!.role).toBe("outliner");
    const view = (await c.get(`/outline/jobs/${start.json.jobId}/outline`)).json as unknown as OutlineView;
    expect(JSON.stringify(view)).not.toContain(files.find((f) => f.path === "redact-secret.ts")!.text.slice(0, 60));
    const m = explorerModel(view);
    expect(m.notShown).toBeNull();
    const drawable = view.verified!.joins.filter((j) => j.status !== "model-only").map((j) => j.id).sort();
    expect(m.lines.map((l) => l.id).sort()).toEqual(drawable);
    const fig = buildFigure(m);
    const drawn = new Set([...fig.svg.matchAll(/data-line="([^"]*)"/g)].map((x) => x[1]!.replace(/&gt;/g, ">")));
    expect([...drawn].sort()).toEqual(drawable);
    for (const j of view.verified!.joins.filter((x) => x.status === "model-only")) expect(drawn.has(j.id)).toBe(false);

    // The hand-off: the file text from the job's own outline file, through the same POST /paste.
    const choice = m.boxes.flatMap((b) => b.bets).find((b) => b.name === "redactSecret")!;
    expect(choice).toMatchObject({ ok: true, path: "redact-secret.ts", language: "ts" });
    const atlas = (await c.get(`/outline/jobs/${start.json.jobId}/atlas`)).json;
    const text = (atlas.outline.files as { path: string; text: string }[]).find((f) => f.path === choice.path)!.text;
    const pasted = await c.post("/paste", { code: text, language: choice.language });
    expect(pasted.status).toBe(200);
    expect(pasted.json.exports.map((e: { name: string }) => e.name)).toContain("redactSecret");
    expect(pasted.json.cantCheck).toBeNull();
  }, 120_000);

  it("another session cannot read the job, and so cannot hand off its code", async () => {
    const w = outlinerAnswering(WONDER);
    const { app } = makeApp({ outline: { outliner: { chat: w.chat } } });
    const a = client(app);
    const start = await a.post("/outline/jobs", { files: filesUnder(join(ROOT, "server/meta")) });
    await waitDone(a, start.json.jobId);
    const b = client(app);
    expect((await b.get(`/outline/jobs/${start.json.jobId}/atlas`)).status).toBe(404);
  }, 120_000);

  it("a 3,000-call function handed off from the explorer: the trace is cut at the cap and the timeline says so instead of drawing", async () => {
    const src = "export function many(f, n){let s=0;for(let i=0;i<n;i++)s+=f();return s}\n";
    const outline = JSON.stringify({ parts: [{ id: "loop", name: "Loop runner (mock)", purpose: "Calls f n times and sums the results (mocked Wonder sentence).", files: [{ path: "many.js", lineStart: 1, lineEnd: 1, quotedSnippet: src.trim() }], patterns: [] }], joins: [] });
    const w = outlinerAnswering(outline);
    const { app } = makeApp({ outline: { outliner: { chat: w.chat } } });
    const c = client(app);
    const start = await c.post("/outline/jobs", { files: [{ path: "many.js", text: src }] });
    expect((await waitDone(c, start.json.jobId)).status).toBe("done");
    const view = (await c.get(`/outline/jobs/${start.json.jobId}/outline`)).json as unknown as OutlineView;
    const m = explorerModel(view);
    const choice = m.boxes[0]!.bets.find((b) => b.name === "many")!;
    expect(choice.ok).toBe(true);
    const atlas = (await c.get(`/outline/jobs/${start.json.jobId}/atlas`)).json;
    const text = (atlas.outline.files as { path: string; text: string }[])[0]!.text;
    const p = await c.post("/paste", { code: text, language: choice.language });
    const tgt = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const e = await c.post("/experiments", { target: tgt, params: { shape: "call-function", exportName: "many", args: [{ kind: "stand-in", name: "f", async: false, calls: [{ do: "return", value: 1 }], then: "repeat_last" }, { kind: "json", value: 3000 }] } });
    expect(e.status).toBe(200);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
    const r = await c.post("/runs", { experimentId: e.json.experiment.id });
    const run = r.json.run as Run;
    expect(run.result.measured).toMatchObject({ outcome: "returned", "calls:f": 3000 });
    expect(run.trace.some((t) => t.event === "trace_cut")).toBe(true);
    const h = renderToStaticMarkup(<CallTimeline run={run} still theme="light" />);
    expect(h).toContain("more events than Atlas keeps");
    expect(h).not.toContain("<svg");
  }, 120_000);
});

// ---------- the React side of the hand-off ----------

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
const mount = (el: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
};

describe("X2: Bet on this part lands in the paste flow with the right export", () => {
  const PASTED: PasteAnswer = {
    target: { kind: "pasted", ref: "pasted:abc", codeSha256: "a".repeat(64), language: "ts" },
    language: { chosen: "ts", guessed: "ts", why: "a type annotation", chosenBy: "person" },
    languages: [{ language: "ts", name: "TypeScript", runnable: true }],
    runnable: true,
    exports: [
      { name: "MIN_SECRET_PIECE", line: 8, declaredAs: "const" },
      { name: "redactSecret", line: 10, declaredAs: "function" },
    ],
    cantCheck: null,
    lines: 36,
  };
  const fakeApi = (pasteCalls: unknown[]) =>
    ({
      pasteLanguages: async () => ({ languages: PASTED.languages, maxBytes: 65536, executor: "local", privacy: "kept in memory" }),
      paste: async (code: string, language?: string) => {
        pasteCalls.push({ code, language });
        return PASTED;
      },
      claimants: async () => ({ sparkOpen: { available: false } }),
      session: () => "s1",
    }) as unknown as Api;

  it("the paste flow sends the file once, through POST /paste, and picks the export the person chose", async () => {
    const calls: { code: string; language?: string }[] = [];
    const handoff: BetHandoff = { code: "export function redactSecret() {}\n", language: "ts", exportName: "redactSecret", from: "server/meta/redact-secret.ts in damli40/atlas at 058ab2a", nonce: 1 };
    let used = 0;
    mount(<PasteFlow api={fakeApi(calls)} handoff={handoff} onHandoffUsed={() => used++} />);
    await flush();
    expect(calls).toEqual([{ code: handoff.code, language: "ts" }]);
    expect(used).toBe(1); // the app clears it, so coming back to the paste screen does not paste the file again
    expect(host!.querySelector('[data-testid="paste-from-explorer"]')!.textContent).toBe("From the explorer: server/meta/redact-secret.ts in damli40/atlas at 058ab2a, function redactSecret.");
    const checked = host!.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(checked?.value ?? checked?.closest("label")?.textContent).toMatch(/redactSecret/);
    expect((host!.querySelector('[data-testid="paste-code"]') as HTMLTextAreaElement).value).toBe(handoff.code);
  }, 120_000);

  it("an export the paste reader does not find is not picked, and the page says so", async () => {
    const calls: unknown[] = [];
    mount(<PasteFlow api={fakeApi(calls)} handoff={{ code: "x", language: "ts", exportName: "notThere", from: "a.ts (uploaded)", nonce: 2 }} />);
    await flush();
    expect(host!.querySelector('[data-testid="paste-from-explorer"]')!.textContent).toMatch(/found no export named notThere/);
    expect(host!.querySelector('input[type="radio"]:checked')).toBeNull();
  }, 120_000);

  it("the explorer reads the file from the job's outline file and hands over that text and that function", async () => {
    const view = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json"), "utf8")) as OutlineView;
    view.jobId = "ol_test";
    const handed: BetHandoff[] = [];
    const api = {
      startOutline: async () => ({ jobId: "ol_test", status: "done", what: "x", createdAt: "" }),
      outline: async () => view,
      outlineJob: async () => ({ jobId: "ol_test", status: "done", what: "x", createdAt: "" }),
      outlineAtlas: async () => ({ version: 1, kind: "outline", createdAt: "", outline: { files: [{ path: "redact-secret.ts", text: "THE FILE TEXT" }] } }),
    } as unknown as Api;
    mount(<ExplorerFlow api={api} onBet={(h) => handed.push(h)} />);
    await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="outline-start"]')!.click());
    await flush();
    expect(host!.querySelector('[data-testid="explorer-machine"]')).not.toBeNull();
    // Pick the box by keyboard, then bet on its one function.
    const stage = host!.querySelector<HTMLElement>('[data-testid="explorer-stage"]')!;
    const order = explorerModel(view).boxes.map((b) => b.id);
    const steps = order.indexOf("secret-redaction") + 1;
    for (let i = 0; i < steps; i++) await act(async () => stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(host!.querySelector('[data-testid="part-card"] h3')!.textContent).toBe("Secret redaction");
    await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="bet-redactSecret"]')!.click());
    await flush();
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatchObject({ code: "THE FILE TEXT", exportName: "redactSecret", language: "ts", from: "server/meta/redact-secret.ts in damli40/atlas at 058ab2a" });
  }, 120_000);

  it("the saved outline offers no bet (it has no code here) and says why", async () => {
    const view = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json"), "utf8")) as OutlineView;
    const html = renderToStaticMarkup(<ExplorerMachine model={explorerModel(view)} betUnavailable="no code here" initialPick="secret-redaction" theme="light" />);
    expect(html).toContain("no code here");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="bet-redactSecret"/);
  }, 120_000);
});
