// X3 (D28) after review round 1: precision over coverage. A label says "found in this code" or "reproduced" only
// when that is very likely true; everything else stays "common pattern".

import { describe, expect, it } from "vitest";
import { CURATED, labelFailures, maskSource, scanSpan, STORM_CALLS, type FunctionInfo, type LabelInput, type LabelledFailure, type RunEvidence } from "../../src/failure-labels";
import { RETRY_SRC } from "../tools/paste-fixtures";
import { SNIPPETS } from "../fixtures/failure-labels/snippets";
import { PASTE_EXAMPLE } from "../../web/paste-example";

const count = (text: string) => text.split("\n").length;
const label = (text: string, language: LabelInput["language"] = "ts", extra: Partial<LabelInput> = {}) => labelFailures({ language, spans: [{ path: "a", text, lineStart: 1, lineEnd: count(text) }], ...extra });
const of = (labels: LabelledFailure[], failure: string) => labels.find((l) => l.failure === failure);
const found = (text: string, lang: LabelInput["language"] = "ts") => label(text, lang).labels.filter((l) => l.label === "found in this code").map((l) => l.failure).sort();

/** RETRY_SRC's function: retryWithBackoff(fetchIt, attempts, baseMs), lines 2–13. */
const RETRY_FN: FunctionInfo = { path: "a", name: "retryWithBackoff", lineStart: 2, lineEnd: 13, params: ["fetchIt", "attempts", "baseMs"] };
type StandIn = Extract<RunEvidence["params"]["args"][number], { kind: "stand-in" }>;
const stand = (name: string, calls: StandIn["calls"]): StandIn => ({ kind: "stand-in", name, async: true, calls, then: "repeat_last" });
const params = (args: RunEvidence["params"]["args"], exportName = "retryWithBackoff"): RunEvidence["params"] => ({ shape: "call-function", exportName, args });
const NEVER = params([stand("fetchIt", [{ do: "never_settle" }]), { kind: "json", value: 3 }, { kind: "json", value: 100 }]);
const ev = (runId: string, p: RunEvidence["params"], measured: Record<string, string | number>, controlPassed = true, notMeasured: Record<string, string> = {}): RunEvidence => ({ runId, params: p, run: { id: runId, controlPassed, result: { measured, notMeasured } } });
const withRuns = (text: string, fn: FunctionInfo, runs: RunEvidence[], lang: LabelInput["language"] = "ts") => label(text, lang, { functions: [fn], runs });

describe("X3 review M1: 50 realistic snippets, precision of 'found in this code'", () => {
  it("every snippet gives exactly its expected 'found' labels, and none outside its truth (precision ≥ 90%; it is 100%)", () => {
    let t = 0;
    let f = 0;
    for (const s of SNIPPETS) {
      const got = found(s.code, s.lang);
      expect(got, `${s.id} ${s.desc}`).toEqual(s.expected);
      for (const x of got) (s.truth.includes(x) ? t++ : f++);
    }
    expect(SNIPPETS).toHaveLength(50);
    expect(t / (t + f)).toBeGreaterThanOrEqual(0.9);
    expect(f).toBe(0);
  });

  it("the paste screen's default example: 'no overall timeout' only; no rate limit, no retry storm (it waits)", () => {
    expect(found(PASTE_EXAMPLE)).toEqual(["no-overall-timeout"]);
    // fetchIt is a stand-in name, not a known network client: the network kind is not even listed.
    expect(of(label(PASTE_EXAMPLE).labels, "rate-limit")).toBeUndefined();
  });

  it("markers that could not be made precise are gone: rate limit, duplicate side effect and provider outage have none", () => {
    const rpc = CURATED.find((k) => k.id === "rpc-call")!;
    expect(rpc.failures.find((x) => x.id === "rate-limit")!.marker).toBeNull();
    for (const k of CURATED) for (const x of k.failures) expect(x.marker === null).toBe(x.find === undefined);
  });
});

describe("X3 review B4: a retry loop repeats the same call", () => {
  it("for…of, for…in, indexed loops over items and Python loops over items are not retries", () => {
    const forOf = "export async function f(send, ids) {\n  for (const id of ids) {\n    try { await send(id); } catch (e) { console.log(e); }\n  }\n}\n";
    const indexed = "export async function f(send, xs) {\n  for (let i = 0; i < xs.length; i++) {\n    try { await send(xs[i]); } catch { }\n  }\n}\n";
    const py = "def f(send, ids):\n    for i in ids:\n        try:\n            send(i)\n        except Exception:\n            pass\n";
    for (const [t, l] of [[forOf, "ts"], [indexed, "ts"], [py, "py"]] as const) {
      expect(scanSpan("a", t, l, 1, count(t)).retries, t).toEqual([]);
      expect(found(t, l)).toEqual([]);
    }
  });

  it("while, counting for and range() loops whose catch goes round are retries; a catch that throws, returns or breaks is not", () => {
    expect(scanSpan("a", RETRY_SRC, "ts", 1, count(RETRY_SRC)).retries[0]).toMatchObject({ callee: "fetchIt", calleeLine: 6, noWait: false, at: { lineStart: 4, lineEnd: 11 } });
    const rethrow = "export async function f(op) {\n  while (true) {\n    try { return await op(); } catch (e) { throw e; }\n  }\n}\n";
    expect(scanSpan("a", rethrow, "ts", 1, count(rethrow)).retries).toEqual([]);
    const py = "def f(op):\n    while True:\n        try:\n            return op()\n        except Exception:\n            continue\n";
    expect(scanSpan("a", py, "py", 1, count(py)).retries[0]).toMatchObject({ callee: "op", noWait: true });
  });

  it("a wait through any helper call in the catch path is not a retry storm (precision: an unknown call may wait)", () => {
    const t = "export async function f(op) {\n  for (let i = 0; i < 3; i++) {\n    try { return await op(); } catch (e) { await pause(100); }\n  }\n}\n";
    expect(of(label(t).labels, "retry-storm")!.label).toBe("common pattern");
  });
});

describe("X3 review B1–B3: 'reproduced' needs the marker AND the stand-in passed at the marked call", () => {
  it("a never-answers stand-in at the marked call, function never settled → reproduced, naming the stand-in and the line", () => {
    const t = of(withRuns(RETRY_SRC, RETRY_FN, [ev("r1", NEVER, { outcome: "never_settled", "calls:fetchIt": 1 })]).labels, "no-overall-timeout")!;
    expect(t).toMatchObject({ label: "reproduced", runId: "r1", proofLink: "?proof=r1", lines: [{ lineStart: 4, lineEnd: 11 }] });
    expect(t.why).toContain("fetchIt, passed where line 6 calls fetchIt, never answered on its call 1");
  });

  it("B2: 'still running at the watch limit' is never proof → inconclusive, with the reason in the tooltip", () => {
    const t = of(withRuns(RETRY_SRC, RETRY_FN, [ev("r1", NEVER, { outcome: "still_running_at_watch_limit", "calls:fetchIt": 1 })]).labels, "no-overall-timeout")!;
    expect(t.label).toBe("inconclusive");
    expect(t.why).toMatch(/Atlas stopped watching/);
    expect(t.tooltip).toMatch(/never proof/);
  });

  it("B1: code with a deadline (abort signal, Promise.race, timeout) has no marker, so no run can make it 'reproduced'", () => {
    const abort = "export async function getJson(fetchFn, url) {\n  for (let i = 0; i < 3; i++) {\n    try {\n      const ctrl = new AbortController();\n      return await fetchFn(url, { signal: ctrl.signal });\n    } catch (e) { await new Promise((r) => setTimeout(r, 200)); }\n  }\n}\n";
    const fn: FunctionInfo = { path: "a", name: "getJson", lineStart: 1, lineEnd: 8, params: ["fetchFn", "url"] };
    const p = params([stand("fetchFn", [{ do: "never_settle" }]), { kind: "json", value: "u" }], "getJson");
    const a = withRuns(abort, fn, [ev("r1", p, { outcome: "never_settled", "calls:fetchFn": 1 })]);
    expect(a.labels.filter((l) => l.label === "reproduced" || l.label === "found in this code")).toEqual([]);
    const race = "export async function getJson(fetchFn) {\n  const deadline = new Promise((_, rej) => setTimeout(() => rej(new Error('d')), 60000));\n  const attempt = async () => {\n    for (let i = 0; i < 3; i++) {\n      try { return await fetchFn(); } catch (e) { await new Promise((r) => setTimeout(r, 200)); }\n    }\n  };\n  return Promise.race([attempt(), deadline]);\n}\n";
    expect(withRuns(race, { ...fn, lineEnd: 9, params: ["fetchFn"] }, [ev("r1", params([stand("fetchFn", [{ do: "never_settle" }])], "getJson"), { outcome: "never_settled", "calls:fetchFn": 1 })]).labels.filter((l) => l.label !== "common pattern")).toEqual([]);
  });

  it("B1: a signal handed to the marked call counts as a deadline, so neither timeout marker fires (the safe side)", () => {
    const t = "export async function g(fetchFn, signal) {\n  while (true) {\n    try { return await fetchFn({ signal }); } catch (e) { console.log(e); }\n  }\n}\n";
    // "signal" is a deadline word, so the timeout markers do not fire. (The loop has no wait, so "retry storm" does.)
    expect(found(t)).toEqual(["retry-storm"]);
  });

  it("B3: the never-answers stand-in must be the one passed at the marked call; another one that hangs is no evidence", () => {
    const t = "export async function sync(fetchJson, onProgress) {\n  for (let i = 0; i < 3; i++) {\n    try {\n      const data = await fetchJson('/items');\n      await onProgress(data);\n      return data;\n    } catch (e) { await new Promise((r) => setTimeout(r, 500)); }\n  }\n}\n";
    const fn: FunctionInfo = { path: "a", name: "sync", lineStart: 1, lineEnd: 9, params: ["fetchJson", "onProgress"] };
    const p = params([stand("fetchJson", [{ do: "return", value: 1 }]), stand("onProgress", [{ do: "never_settle" }])], "sync");
    const l = of(withRuns(t, fn, [ev("r1", p, { outcome: "never_settled", "calls:fetchJson": 1, "calls:onProgress": 1 })]).labels, "no-overall-timeout")!;
    expect(l.label).toBe("found in this code");
    expect(l.runId).toBeUndefined();
  });

  it("two stand-ins that never answer: the run cannot say which held the function → inconclusive", () => {
    const p = params([stand("fetchIt", [{ do: "never_settle" }]), stand("other", [{ do: "never_settle" }])]);
    expect(of(withRuns(RETRY_SRC, RETRY_FN, [ev("r1", p, { outcome: "never_settled", "calls:fetchIt": 1 })]).labels, "no-overall-timeout")!.label).toBe("inconclusive");
  });

  it("the stand-in's last call was not the never-answering step → inconclusive; untrusted runs → inconclusive; a run that ended → note, label from the code", () => {
    const p = params([stand("fetchIt", [{ do: "throw", errorName: "E", message: "x" }, { do: "never_settle" }])]);
    expect(of(withRuns(RETRY_SRC, RETRY_FN, [ev("r1", p, { outcome: "never_settled", "calls:fetchIt": 1 })]).labels, "no-overall-timeout")!.label).toBe("inconclusive");
    expect(of(withRuns(RETRY_SRC, RETRY_FN, [ev("r2", NEVER, {}, false)]).labels, "no-overall-timeout")!.label).toBe("inconclusive");
    expect(of(withRuns(RETRY_SRC, RETRY_FN, [ev("r3", NEVER, {}, true, { wholeRun: "needs axios" })]).labels, "no-overall-timeout")!.label).toBe("inconclusive");
    const ended = of(withRuns(RETRY_SRC, RETRY_FN, [ev("r4", NEVER, { outcome: "threw", "calls:fetchIt": 1 })]).labels, "no-overall-timeout")!;
    expect(ended.label).toBe("found in this code");
    expect(ended.triedNotShown!.runId).toBe("r4");
  });

  it("no function info (unknown parameters) → runs are never evidence", () => {
    expect(of(label(RETRY_SRC, "ts", { runs: [ev("r1", NEVER, { outcome: "never_settled", "calls:fetchIt": 1 })] }).labels, "no-overall-timeout")!.label).toBe("found in this code");
  });

  it(`B4: retry storm is reproduced only on a marked no-wait retry loop, through its stand-in, at ${STORM_CALLS}+ calls; a batch loop never`, () => {
    const storm = "export async function get(op) {\n  while (true) {\n    try { return await op(); } catch (e) { console.log(e); }\n  }\n}\n";
    const fn: FunctionInfo = { path: "a", name: "get", lineStart: 1, lineEnd: 5, params: ["op"] };
    const fails = params([stand("op", [{ do: "throw", errorName: "E", message: "down" }])], "get");
    expect(of(withRuns(storm, fn, [ev("s1", fails, { outcome: "still_running_at_watch_limit", "calls:op": 50 })]).labels, "retry-storm")).toMatchObject({ label: "reproduced", runId: "s1" });
    expect(of(withRuns(storm, fn, [ev("s2", fails, { outcome: "threw", "calls:op": 3 })]).labels, "retry-storm")!.label).toBe("found in this code");
    const batch = "export async function notifyAll(send, ids) {\n  const failed = [];\n  for (const id of ids) { try { await send(id); } catch (e) { failed.push(id); } }\n  return failed.length;\n}\n";
    const bfn: FunctionInfo = { path: "a", name: "notifyAll", lineStart: 1, lineEnd: 5, params: ["send", "ids"] };
    const bl = withRuns(batch, bfn, [ev("b1", params([stand("send", [{ do: "throw", errorName: "E", message: "x" }]), { kind: "json", value: [] }], "notifyAll"), { outcome: "returned", "calls:send": 25 })]);
    expect(bl.labels.filter((l) => l.label !== "common pattern")).toEqual([]);
  });
});

describe("X3 review M3: linear scan, capped", () => {
  it("the reviewer's 61 KB nested-loop paste takes under 50 ms; a nested retry flood too", () => {
    const N = 998;
    const dos = "export function g() {\n" + ("for(;;){" + " ".repeat(22) + "\n").repeat(N) + ("}" + " ".repeat(28) + "\n").repeat(N) + "}\n";
    const tries = "export async function g(f) {\n" + "for(;;){ try { await f(); } catch (e) {\n".repeat(N) + "} }\n".repeat(N) + "}\n";
    expect(dos.length).toBeGreaterThan(60_000);
    for (const t of [dos, tries]) {
      label(t); // warm the regex engine
      const t0 = performance.now();
      label(t);
      expect(performance.now() - t0).toBeLessThan(50);
    }
  });
});

describe("X3: the rest of the markers", () => {
  it("comments and strings are blanked before any check", () => {
    const js = `const a = "while (true) { try {} catch {} }"; // deadline\nconst b = \`timeout \${x}\`; /* Date.now() */ f('it\\'s');`;
    const m = maskSource(js, "ts");
    expect(m.length).toBe(js.length);
    expect(m).not.toMatch(/while|deadline|timeout|Date|it/);
  });

  it("Wonder's tag can list a kind, never decide a label", () => {
    const a = label("export const add = (a, b) => a + b;\n", "js", { wonderTags: [{ label: "queue" }], wonderModel: "muse-wonder-1.0" });
    expect(a.labels).toHaveLength(1);
    expect(a.labels[0]).toMatchObject({ kind: "queue", label: "common pattern", kindBy: { wonder: { tag: "queue", model: "muse-wonder-1.0" } } });
  });

  it("every 'found' label names its lines and its marker; a failure with no marker is never 'found'", () => {
    for (const s of SNIPPETS)
      for (const l of label(s.code, s.lang).labels) {
        if (l.label === "found in this code") {
          expect(l.markerRule).not.toBeNull();
          expect(l.lines!.length).toBeGreaterThan(0);
        }
        if (l.markerRule === null) expect(l.label).toBe("common pattern");
      }
  });
});
