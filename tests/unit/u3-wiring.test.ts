// U3 item 1: the drawing never shows a cable the code doesn't have.
//
// For every file in a corpus (the walkthrough-style code reconstructed for U3, the U1 example, the U2 walkthrough files
// and the 100+ failure-label snippets), and for tests that put a stand-in on EVERY parameter of every function and a
// fake network on every file that uses one, each cable the bench model draws is checked against the file's text by a
// separate, deliberately simple reading in this test (not src/call-sites.ts): the cable's `from` box's own lines must
// contain the call. Plus the specific walkthrough facts: fetch is wired to fetchPage (whose own line 4 calls it), never
// to fetchAllOrders; fetchPage's card says it calls itself; a stand-in handed on to a helper is wired to the helper.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileOutline, type FileOutline } from "../../src/file-outline";
import { benchModel, deviceId, type CallTest } from "../../web/machines/bench/model";
import { networkUse } from "../../src/network-fake";
import { callPath, playScript, waitPath, type Wiring } from "../../web/machines/bench/play";
import { U1_EXAMPLE } from "../../web/u1-example";
import { SNIPPETS } from "../fixtures/failure-labels/snippets";
import { SET3 } from "../fixtures/failure-labels/snippets-set3";
import { REVIEW2 } from "../fixtures/failure-labels/snippets-review2";
import type { NetworkLibrary, Run } from "../../src/types";

type Lang = "js" | "ts" | "py";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ORDERS = read("../evidence/U3/inputs/orders.ts");
const PLAN = read("../evidence/U3/inputs/plan_cache.py");

const CORPUS: { id: string; lang: Lang; code: string }[] = [
  { id: "u3-orders", lang: "ts", code: ORDERS },
  { id: "u3-plan-cache", lang: "py", code: PLAN },
  { id: "u1-example", lang: "ts", code: U1_EXAMPLE },
  { id: "u2-code1", lang: "ts", code: read("../evidence/U2/inputs/code1.ts") },
  { id: "u2-code2", lang: "py", code: read("../evidence/U2/inputs/code2.py") },
  ...SNIPPETS.map((s) => ({ id: `snip-${s.id}`, lang: s.lang as Lang, code: s.code })),
  ...SET3.map((s) => ({ id: `set3-${s.id}`, lang: s.lang as Lang, code: s.code })),
  ...REVIEW2.map((s) => ({ id: `rev2-${s.id}`, lang: s.lang as Lang, code: s.code })),
];

// ---------- the test's own reading of the text (independent of src/call-sites.ts) ----------

/** Comments and strings blanked crudely, line count kept. */
function blank(code: string, lang: Lang): string[] {
  return code.split("\n").map((l) => {
    let x = l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (m) => m[0] + " ".repeat(Math.max(0, m.length - 2)) + m[0]);
    x = lang === "py" ? x.replace(/#.*$/, "") : x.replace(/\/\/.*$/, "");
    return x;
  });
}
function ownText(code: string, lang: Lang, o: FileOutline, part: string): string {
  const p = o.parts.find((x) => x.name === part)!;
  return blank(code, lang).slice(p.lineStart - 1, p.lineEnd).join("\n");
}
/** The parameter names of a part, read crudely from the first bracket after its name. */
function crudeParams(code: string, lang: Lang, o: FileOutline, part: string): string[] {
  const t = ownText(code, lang, o, part);
  const i = t.indexOf(part);
  const open = t.indexOf("(", i);
  if (open < 0) return [];
  let d = 0;
  let j = open;
  for (; j < t.length; j++) {
    if (t[j] === "(") d++;
    if (t[j] === ")" && --d === 0) break;
  }
  return t
    .slice(open + 1, j)
    .split(",")
    .map((x) => x.trim().replace(/^[*.]+/, "").match(/^[A-Za-z_$][\w$]*/)?.[0] ?? "")
    .filter(Boolean);
}
const LIB_RE: Record<NetworkLibrary, RegExp> = {
  fetch: /(?<![.\w$])fetch\s*\(|\b(?:globalThis|window|self)\s*\.\s*fetch\b/,
  requests: /\brequests\s*\.|\b(?:get|post|put|delete|Session|request)\s*\(/,
  httpx: /\bhttpx\s*\.|\b(?:Client|AsyncClient|get|post)\s*\(/,
  urllib: /\burlopen\s*\(|\brequest\s*\.\s*urlopen|\burllib\s*\.\s*request/,
};

/** Every cable must be backed by the from-box's own text. Returns the problems found. */
function falseCables(id: string, code: string, lang: Lang, o: FileOutline, model: ReturnType<typeof benchModel>): string[] {
  const out: string[] = [];
  for (const l of model.lines) {
    const from = model.parts[l.from];
    if (!from || from.kind !== "code") {
      out.push(`${id}: a cable starts at ${l.from}, which is not a code box`);
      continue;
    }
    const text = ownText(code, lang, o, l.from);
    const to = model.parts[l.to];
    if (to?.kind === "code") {
      const join = o.joins.find((j) => j.from === l.from && j.to === l.to);
      const n = l.to.replace(/[$]/g, "\\$");
      const ok = join?.kind === "wraps" ? new RegExp(`^\\s*@${n}\\b`, "m").test(text) : join?.kind === "calls" ? new RegExp(`(?<![.\\w$])${n}\\s*(?:<[^()]*>)?\\(|\\bnew\\s+${n}\\b|@${n}\\b`).test(text) : new RegExp(`(?<![.\\w$])${n}\\b`).test(text);
      if (!ok) out.push(`${id}: cable ${l.from} -> ${l.to} (${join?.kind}) but ${l.from}'s own lines do not show it`);
    } else if (to?.kind === "device") {
      if (to.network) {
        if (!LIB_RE[to.name as NetworkLibrary].test(text)) out.push(`${id}: cable ${l.from} -> fake ${to.name} but ${l.from}'s own lines do not call it`);
      } else {
        const params = crudeParams(code, lang, o, l.from);
        if (!params.some((p) => new RegExp(`(?<![.\\w$])${p.replace(/[$]/g, "\\$")}\\s*(?:\\?\\.)?\\s*(?:\\(|\\.(?:call|apply)\\()`).test(text))) out.push(`${id}: cable ${l.from} -> stand-in ${to.name} but none of ${l.from}'s parameters is called in its own lines`);
      }
    } else out.push(`${id}: a cable ends at ${l.to}, which is not drawn`);
  }
  return out;
}

/** Tests that exercise every wire: a stand-in on every parameter of the function, and the file's network fake. */
function testsFor(code: string, lang: Lang, o: FileOutline): CallTest[] {
  const lib = networkUse(code, lang)[0]?.library;
  const network = lib ? { replaces: lib, then: "repeat_last" as const, calls: [{ do: "respond" as const, status: 200, body: {} }] } : undefined;
  return o.parts
    .filter((p) => p.kind === "function")
    .map((p) => {
      const n = Math.max(1, crudeParams(code, lang, o, p.name).length);
      return {
        shape: "call-function",
        exportName: p.name,
        args: Array.from({ length: Math.min(8, n) }, (_, i) => ({ kind: "stand-in" as const, name: `s${i}`, async: true, then: "repeat_last" as const, calls: [{ do: "return" as const, value: 1 }] })),
        ...(network ? { network } : {}),
      };
    });
}

describe("U3 item 1: no cable the code doesn't have", () => {
  it("over the corpus, every drawn cable is backed by its box's own lines", () => {
    const problems: string[] = [];
    let cables = 0;
    let devicesWired = 0;
    for (const f of CORPUS) {
      const o = fileOutline(f.code, f.lang);
      // At rest (no test) and with a test on every function.
      const rest = benchModel({ fileName: "f", outline: o, test: null, source: f.code, language: f.lang });
      problems.push(...falseCables(f.id, f.code, f.lang, o, rest));
      cables += rest.lines.length;
      for (const t of testsFor(f.code, f.lang, o)) {
        const m = benchModel({ fileName: "f", outline: o, test: t, source: f.code, language: f.lang });
        problems.push(...falseCables(`${f.id}/${t.exportName}`, f.code, f.lang, o, m));
        cables += m.lines.length;
        devicesWired += m.lines.filter((l) => l.to.startsWith("stand-in ")).length;
      }
    }
    expect(problems).toEqual([]);
    // The corpus is not trivially empty.
    expect(CORPUS.length).toBeGreaterThan(100);
    console.log(`u3-wiring corpus: ${CORPUS.length} files, ${cables} cables checked, ${devicesWired} stand-in cables`);
    expect(cables).toBeGreaterThan(90);
    expect(devicesWired).toBeGreaterThan(20);
  });

  it("the check itself catches the walkthrough's false cable (fetch drawn into fetchAllOrders, as before U3)", () => {
    const o = fileOutline(ORDERS, "ts");
    const t: CallTest = { shape: "call-function", exportName: "fetchAllOrders", args: [{ kind: "json", value: "u" }], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: {} }] } };
    const m = benchModel({ fileName: "f", outline: o, test: t, source: ORDERS, language: "ts" });
    const before = { ...m, lines: [...m.lines, { ...m.lines[0]!, id: "fetchAllOrders=>stand-in fetch", from: "fetchAllOrders", to: deviceId("fetch") }] };
    expect(falseCables("orders", ORDERS, "ts", o, before)).toEqual(["orders: cable fetchAllOrders -> fake fetch but fetchAllOrders's own lines do not call it"]);
  });

  it("without the file's text, no device gets a cable (never a guess)", () => {
    const o = fileOutline(ORDERS, "ts");
    const m = benchModel({ fileName: "f", outline: o, test: { shape: "call-function", exportName: "fetchAllOrders", args: [{ kind: "json", value: "u" }], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: {} }] } } });
    expect(m.lines.filter((l) => l.to.startsWith("stand-in "))).toEqual([]);
    const d = m.parts[deviceId("fetch")]!;
    expect(d.kind === "device" && d.noCable).toMatch(/no cable/);
  });

  it("the walkthrough's code: fetch is wired to fetchPage, never to fetchAllOrders; fetchPage calls itself", () => {
    const o = fileOutline(ORDERS, "ts");
    const t: CallTest = { shape: "call-function", exportName: "fetchAllOrders", args: [{ kind: "json", value: "https://example.com/orders" }], network: { replaces: "fetch", then: "throw_exhausted", calls: [{ do: "respond", status: 429, body: {} }, { do: "respond", status: 200, body: { items: [], nextCursor: null } }] } };
    const m = benchModel({ fileName: "pasted.ts", outline: o, test: t, source: ORDERS, language: "ts" });
    const toFetch = m.lines.filter((l) => l.to === deviceId("fetch"));
    expect(toFetch.map((l) => l.from)).toEqual(["fetchPage"]);
    const page = m.parts.fetchPage!;
    expect(page.kind === "code" && page.selfCalls).toEqual([7]);
    expect(page.kind === "code" && page.devices).toEqual([{ name: "fetch", network: true, lines: [4] }]);
    const all = m.parts.fetchAllOrders!;
    expect(all.kind === "code" && (all.devices ?? [])).toEqual([]);
    const dev = m.parts[deviceId("fetch")]!;
    expect(dev.kind === "device" && dev.calledBy).toEqual([{ part: "fetchPage", lines: [4] }]);
    // The label on the drawing (screen readers) says where it is wired, in plain words.
    expect(m.extraLabel).toContain("fetch (a fake network), wired to fetchPage");
    expect(m.extraLabel).not.toMatch(/skid|collar/);
  });

  it("a stand-in handed on to a helper is wired to the helper whose own lines call it", () => {
    const o = fileOutline(U1_EXAMPLE, "ts");
    const t: CallTest = { shape: "call-function", exportName: "getPrice", args: [{ kind: "stand-in", name: "fetchQuote", async: true, then: "repeat_last", calls: [{ do: "return", value: 1 }] }] };
    const m = benchModel({ fileName: "pasted.ts", outline: o, test: t, source: U1_EXAMPLE, language: "ts" });
    expect(m.lines.filter((l) => l.to === deviceId("fetchQuote")).map((l) => l.from)).toEqual(["fetchWithRetry"]);
  });

  it("a Python decorator is a wrap, not a call made by the decorated function's own lines", () => {
    const o = fileOutline(PLAN, "py");
    expect(o.joins).toEqual([{ id: "get_user_plan->cached", from: "get_user_plan", to: "cached", kind: "wraps", lines: [20] }]);
    const m = benchModel({ fileName: "pasted.py", outline: o, test: null, source: PLAN, language: "py" });
    const g = m.parts.get_user_plan!;
    expect(g.kind === "code" && g.wrappedBy).toEqual(["cached"]);
    expect(g.kind === "code" && g.callsTo).toEqual([]);
    // Drawn, but as a "data" line (a reference), not as a call cable.
    expect(m.lines.find((l) => l.from === "get_user_plan")?.kind).toBe("data");
  });
});

describe("U3 item 1: the replay lights the certain call path only", () => {
  const o = fileOutline(ORDERS, "ts");
  const wiring: Wiring = { outline: o, callers: { [deviceId("fetch")]: ["fetchPage"] } };

  it("a fetch call lights fetchAllOrders and fetchPage and their cables", () => {
    const p = callPath(wiring, "fetchAllOrders", deviceId("fetch"));
    expect(p.parts).toEqual(["fetchAllOrders", "fetchPage"]);
    expect(p.lines).toEqual(["fetchAllOrders->fetchPage", "fetchPage=>stand-in fetch"]);
    expect(p.unsure).toBeNull();
  });

  it("two possible callers: only what is certain lights, and the step says so", () => {
    const two: Wiring = { outline: { joins: [{ id: "a->b", from: "a", to: "b", kind: "calls", lines: [1] }, { id: "a->c", from: "a", to: "c", kind: "calls", lines: [2] }] }, callers: { d: ["b", "c"] } };
    const p = callPath(two, "a", "d");
    expect(p.parts).toEqual(["a"]);
    expect(p.lines).toEqual([]);
    expect(p.unsure).toBe("plain code can't tell whether b or c made this call");
  });

  it("a wait lights the chain down to the part that waits", () => {
    expect(waitPath(wiring, "fetchAllOrders", ["fetchPage"])).toEqual(["fetchAllOrders", "fetchPage"]);
  });

  it("the play script lights the path for each fetch call", () => {
    const t: CallTest = { shape: "call-function", exportName: "fetchAllOrders", args: [{ kind: "json", value: "u" }], network: { replaces: "fetch", then: "repeat_last", calls: [{ do: "respond", status: 200, body: { items: [], nextCursor: null } }] } };
    const run = {
      id: "r",
      experimentId: "e",
      runner: "ts",
      executor: "local",
      codeSha256: "x",
      startedAt: "",
      finishedAt: "",
      controlPassed: true,
      trace: [
        { t: 0, event: "start" },
        { t: 0, event: "stand_in_call", data: { name: "fetch", n: 1 } },
        { t: 0, event: "stand_in_returns", data: { name: "fetch", n: 1 } },
        { t: 0, event: "returned", data: { type: "array" } },
      ],
      result: { measured: { outcome: "returned", virtualMs: 0, "calls:fetch": 1, returnedJson: "[]", returnedType: "array" }, notMeasured: {} },
    } as unknown as Run;
    const s = playScript(run, t, "fetchAllOrders", ["fetchPage"], wiring);
    const call = s.steps.find((x) => x.kind === "call");
    if (call) {
      expect(call.parts).toEqual(["fetchAllOrders", "fetchPage"]);
      expect(call.line).toBe("fetchAllOrders->fetchPage\nfetchPage=>stand-in fetch");
    }
  });
});
