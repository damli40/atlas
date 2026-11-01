// X2 review round 1: one test (or more) per finding. Every model mocked.
import { describeSpec, explorerSpec } from "../../renderer/authors/code-chart";
import { checkDrawing } from "../../renderer/check";
import { drawSpec } from "../../renderer/live/draw";
import { jsdomWindow } from "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Api, type PasteAnswer } from "../../web/api";
import { ExplorerMachine } from "../../web/machines/explorer/ExplorerMachine";
import { DATA_WORDS, arrowOf, explorerModel, joinWords, lineWord } from "../../web/machines/explorer/model";
import type { OutlineView } from "../../web/machines/explorer/outline-data";
import { ErrorNotice, INVITE_PAGE } from "../../web/screens/ErrorNotice";
import { EXPIRED_NOTE, ExplorerFlow } from "../../web/screens/Explorer";
import { PasteFlow } from "../../web/screens/Paste";
import { NEEDS_INVITE } from "../../server/access/gate";
import { big, dataSameLink, duplicated, spanFolders } from "../tools/x2-views";

const ROOT = join(import.meta.dirname, "..", "..");
const saved = (): OutlineView => JSON.parse(readFileSync(join(ROOT, "tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json"), "utf8")) as OutlineView;
const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
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

describe("B1: the live screen never changes the picked part on its own", () => {
  it("with motion allowed and the figure on screen, 30 s with no input leave the card unchanged", async () => {
    const mm = window.matchMedia;
    const io = (globalThis as Record<string, unknown>).IntersectionObserver;
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    (globalThis as Record<string, unknown>).IntersectionObserver = class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
    };
    try {
      vi.useFakeTimers();
      mount(<ExplorerMachine model={explorerModel(saved())} initialPick="secret-redaction" theme="light" />);
      const name = () => host!.querySelector('[data-testid="part-card"] h3')?.textContent ?? null;
      expect(name()).toBe("Secret redaction");
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(name()).toBe("Secret redaction");
    } finally {
      window.matchMedia = mm;
      (globalThis as Record<string, unknown>).IntersectionObserver = io;
    }
  }, 120_000);
  it("the live component has no timer that picks", () => {
    const src = readFileSync(join(ROOT, "web/machines/explorer/ExplorerMachine.tsx"), "utf8");
    expect(src).not.toMatch(/setInterval\([^)]*setPicked/s);
  });
});

describe("B2 / minor 2: one line per code link; a data join says it is linked either way", () => {
  it("a data join over the same code link as an imports line shares that line, with ↔ and the either-way words", () => {
    const m = explorerModel(dataSameLink());
    expect(m.lines.map((l) => l.kind)).toEqual(["imports"]);
    const store = m.boxes.find((b) => b.id === "store")!;
    const data = store.joins.find((j) => j.kind === "data")!;
    expect(data.drawn).toBe(false);
    expect(data.sharesLine).toEqual({ id: "wonder:0", kind: "imports" });
    expect(arrowOf(data.dir)).toBe("↔");
    expect(joinWords(data)).toContain(DATA_WORDS);
    expect(DATA_WORDS).toBe("plain code found a use between these parts (it did not check the direction)");
    expect(lineWord(data)).toBe("same line as the imports join");
    expect(explorerSpec(m).edges.filter((e) => e.kind === "thread").map((e) => e.id)).toEqual(["wonder:0"]);
  }, 120_000);
  it("the same join twice is one line", () => {
    const m = explorerModel(duplicated());
    expect(m.lines).toHaveLength(3);
    const c1 = m.boxes.find((b) => b.id === "c1")!;
    expect(c1.joins.filter((j) => j.other === "c2" && j.drawn)).toHaveLength(1);
  });
});

describe("B3: decks are the real folders, whatever a part spans", () => {
  it("6 folders, 12 files: 6 decks; on the chart every part is one ticket, in a real folder, naming all its places; the words for a screen reader count them", () => {
    const v = spanFolders();
    const m = explorerModel(v);
    expect(m.decks.map((d) => d.folder).sort()).toEqual([...new Set(v.files.map((f) => folderOf(f.path)))].sort());
    for (const d of m.decks) for (const s of d.slots) if (s.kind === "box") for (const sl of s.slices) expect(folderOf(sl.path)).toBe(d.folder);
    const spec = explorerSpec(m);
    expect(spec.nodes).toHaveLength(13);
    const folders = new Set(v.files.map((f) => folderOf(f.path).replace(/\/$/, "")));
    for (const r of spec.regions) expect(folders.has(r.words.replace(/\/$/, ""))).toBe(true);
    for (const b of m.boxes) expect(spec.nodes.find((n) => n.id === b.id)!.sourceLines).toHaveLength(b.spans.length);
    expect(describeSpec(spec)).toMatch(/^13 parts\./);
  }, 120_000);
});

describe("B4: a large outline never freezes the page", () => {
  it("X1's maximum (40 parts, 156 joins) now draws within budget (D55: the renderer), and every check holds; past the budget it is the list", () => {
    const m = explorerModel(big(40, 0.1));
    expect(m.lines.length).toBeGreaterThan(90); // the old figure gave up past 90 joins
    const spec = explorerSpec(m);
    const d = drawSpec(spec);
    if (d.kind !== "drawing") throw new Error(`expected a drawing, got ${d.kind}`);
    expect(d.ms).toBeLessThan(2000);
    expect(checkDrawing(spec, d.scene, d.svg)).toEqual([]);
  }, 120_000);
  it("40 parts with 47 joins draw in well under the page's 30 s limit (Node, no worker)", () => {
    const m = explorerModel(big(40, 0.03));
    expect(m.lines.length).toBeLessThanOrEqual(90);
    const t = Date.now();
    const spec = explorerSpec(m);
    expect(drawSpec(spec).kind).toBe("drawing");
    expect(Date.now() - t).toBeLessThan(30_000);
  }, 120_000);
});

describe("M2: the 'From the explorer' note goes when the code is no longer that file", () => {
  it("editing the box clears it", async () => {
    const PASTED = { target: { kind: "pasted", ref: "pasted:x", codeSha256: "a".repeat(64), language: "ts" }, language: { chosen: "ts", guessed: "ts", why: "x", chosenBy: "person" }, languages: [], runnable: true, exports: [{ name: "f", line: 1, declaredAs: "function" }], cantCheck: null, lines: 1 } as unknown as PasteAnswer;
    const api = { pasteLanguages: async () => ({ languages: [], maxBytes: 65536, executor: "local", privacy: "" }), paste: async () => PASTED, claimants: async () => ({ sparkOpen: { available: false } }), session: () => "s" } as unknown as Api;
    mount(<PasteFlow api={api} handoff={{ code: "export function f(){}\n", language: "ts", exportName: "f", from: "a.ts (uploaded)", nonce: 9 }} />);
    await flush();
    expect(host!.querySelector('[data-testid="paste-from-explorer"]')).not.toBeNull();
    const ta = host!.querySelector<HTMLTextAreaElement>('[data-testid="paste-code"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(ta, "export function add(a,b){return a+b}\n");
      ta.dispatchEvent(new jsdomWindow.Event("input", { bubbles: true }));
    });
    expect(host!.querySelector('[data-testid="paste-from-explorer"]')).toBeNull();
  }, 120_000);
});

describe("M4: an expired job says so and offers a re-run", () => {
  it("a 404 from the job's outline file shows the expiry sentence, a 'Run it again' button, and disables betting", async () => {
    const view = saved();
    view.jobId = "ol_gone";
    let started = 0;
    const api = {
      startOutline: async () => {
        started++;
        return { jobId: "ol_gone", status: "done", what: "x", createdAt: "" };
      },
      outline: async () => view,
      outlineJob: async () => ({ jobId: "ol_gone", status: "done", what: "x", createdAt: "" }),
      outlineAtlas: async () => {
        throw new ApiError("this session has no outline job with that id", 404);
      },
    } as unknown as Api;
    mount(<ExplorerFlow api={api} onBet={() => {}} />);
    await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="outline-start"]')!.click());
    await flush();
    const stage = host!.querySelector<HTMLElement>('[data-testid="explorer-stage"]')!;
    const steps = explorerModel(view).boxes.findIndex((b) => b.id === "secret-redaction") + 1;
    for (let i = 0; i < steps; i++) await act(async () => stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="bet-redactSecret"]')!.click());
    await flush();
    expect(host!.querySelector('[data-testid="outline-expired"]')!.textContent).toContain(EXPIRED_NOTE);
    expect(EXPIRED_NOTE).toBe("This outline expired (outlines are kept 30 minutes). Run it again.");
    expect(host!.querySelector<HTMLButtonElement>('[data-testid="bet-redactSecret"]')?.disabled ?? true).toBe(true);
    await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="outline-again"]')!.click());
    await flush();
    expect(started).toBe(2);
  }, 120_000);
});

describe("G1 for X2: a 401 from the invite gate links to the invite page", () => {
  it("the server's sentence is shown with a link to /invite", () => {
    const html = renderToStaticMarkup(<ErrorNotice message={`outline not started: ${NEEDS_INVITE}`} />);
    expect(html).toContain(`href="${INVITE_PAGE}"`);
    expect(renderToStaticMarkup(<ErrorNotice message="the run did not finish" />)).not.toContain("invite");
  }, 120_000);
});

describe("minors", () => {
  it("minor 3: the readout counts joins drawn, not 'lines'", () => {
    const html = renderToStaticMarkup(<ExplorerMachine model={explorerModel(saved())} initialPick="secret-redaction" theme="light" />);
    expect(html).toContain("Secret redaction · 2 joins drawn");
  }, 120_000);
  it("minor 4: the caption does not credit Wonder with the joins, nor say height is proportional", () => {
    const html = renderToStaticMarkup(<ExplorerMachine model={explorerModel(saved())} theme="light" />);
    expect(html).toContain("proposed the parts and wrote every name and purpose; plain code checked them against the files and found the joins");
    expect(html).not.toContain("as tall as the lines it covers");
  });
  it("minor 5: an unconfirmed part is named by Wonder's name, never by its raw id", () => {
    const v = saved();
    const p = v.verified!.parts.find((x) => x.id === "secret-redaction")!;
    p.status = "unconfirmed";
    const m = explorerModel(v);
    expect(m.partNames["secret-redaction"]).toBe("Secret redaction");
    const html = renderToStaticMarkup(<ExplorerMachine model={m} initialPick="model-client" theme="light" />);
    expect(html).toContain("Secret redaction (not confirmed)");
  }, 120_000);
});
