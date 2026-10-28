// X3 (D28): common-failure labels. Plain code decides each label; a known failure is never shown as present in this
// code without its plain-code marker (or a sealed run that showed it).

import { describe, expect, it } from "vitest";
import { CURATED, labelFailures, maskSource, STORM_CALLS, type LabelInput, type LabelledFailure, type RunEvidence } from "../../src/failure-labels";
import { RETRY_SRC } from "../tools/paste-fixtures";

const lines = (text: string) => text.split("\n").length;
const label = (text: string, language: LabelInput["language"] = "ts", extra: Partial<LabelInput> = {}) => labelFailures({ language, spans: [{ path: "a", text, lineStart: 1, lineEnd: lines(text) }], ...extra });
const of = (labels: LabelledFailure[], failure: string) => labels.find((l) => l.failure === failure);

const NO_WAIT_PY = `def get(fetch, n=3):
    for i in range(n):
        try:
            return fetch()
        except Exception:
            pass
    raise RuntimeError("gave up")
`;

const params = (args: RunEvidence["params"]["args"]): RunEvidence["params"] => ({ shape: "call-function", exportName: "retryWithBackoff", args });
const neverAnswers = params([{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "never_settle" }], then: "repeat_last" }]);
const alwaysFails = params([{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "throw", errorName: "Error", message: "down" }], then: "repeat_last" }]);
const ev = (runId: string, p: RunEvidence["params"], measured: Record<string, string | number>, controlPassed = true, notMeasured: Record<string, string> = {}): RunEvidence => ({ runId, params: p, run: { id: runId, controlPassed, result: { measured, notMeasured } } });

describe("X3 failure labels: the curated list and its markers", () => {
  it("the curated list: every kind has failures; every marker has its rule in words", () => {
    expect(CURATED.map((k) => k.id)).toEqual(["retry", "rpc-call", "concurrency", "queue", "db-write", "time"]);
    for (const k of CURATED) {
      expect(k.failures.length).toBeGreaterThan(0);
      for (const f of k.failures) expect(f.marker === null).toBe(f.find === undefined);
    }
  });

  it("comments and strings are blanked before any check (lengths and line breaks kept)", () => {
    const js = `const a = "while (true) { try {} catch {} }"; // deadline\nconst b = \`timeout \${x}\`; /* Date.now() */ f('it\\'s');`;
    const m = maskSource(js, "ts");
    expect(m.length).toBe(js.length);
    expect(m.split("\n")).toHaveLength(2);
    expect(m).not.toMatch(/while|deadline|timeout|Date|it/);
    expect(maskSource(js, "ts", true)).toMatch(/while \(true\)/);
    const py = `x = """while True:\n  deadline"""  # timeout\ny = r'Date.now()'\n`;
    const mp = maskSource(py, "py");
    expect(mp).not.toMatch(/while|deadline|timeout|Date/);
    expect(mp.split("\n")).toHaveLength(py.split("\n").length);
  });

  it("the paste screen's retry example: no deadline → 'no overall timeout' found in its loop lines; it waits, so 'retry storm' is only a common pattern", () => {
    const a = label(RETRY_SRC);
    const t = of(a.labels, "no-overall-timeout")!;
    expect(t.label).toBe("found in this code");
    expect(t.lines).toEqual([{ path: "a", lineStart: 4, lineEnd: 11 }]);
    expect(t.excerpt![0]).toEqual({ path: "a", line: 4, text: "  for (let i = 0; i < attempts; i++) {" });
    expect(of(a.labels, "retry-storm")!.label).toBe("common pattern");
    expect(of(a.labels, "duplicate-side-effect")!.label).toBe("common pattern");
    expect(of(a.labels, "timeout")!.label).toBe("found in this code");
    expect(of(a.labels, "provider-outage")!.label).toBe("common pattern");
    expect(a.labels.map((l) => l.kind)).not.toContain("queue");
  });

  it("a deadline in the code turns the marker off; a deadline only in a comment or a string does not", () => {
    const withDeadline = RETRY_SRC.replace("let last: unknown;", "let last: unknown; const deadline = Date.now() + 5000;");
    expect(of(label(withDeadline).labels, "no-overall-timeout")!.label).toBe("common pattern");
    const inComment = RETRY_SRC.replace("let last: unknown;", "let last: unknown; // TODO add a deadline / timeout");
    expect(of(label(inComment).labels, "no-overall-timeout")!.label).toBe("found in this code");
    const inString = RETRY_SRC.replace("let last: unknown;", 'let last: unknown; const msg = "timeout deadline Date.now";');
    expect(of(label(inString).labels, "no-overall-timeout")!.label).toBe("found in this code");
  });

  it("Python: a loop that catches and tries again with no wait → retry storm and no overall timeout found", () => {
    const a = label(NO_WAIT_PY, "py");
    expect(of(a.labels, "retry-storm")).toMatchObject({ label: "found in this code", lines: [{ path: "a", lineStart: 2, lineEnd: 6 }] });
    expect(of(a.labels, "no-overall-timeout")!.label).toBe("found in this code");
    const waits = NO_WAIT_PY.replace("            pass", "            time.sleep(1)");
    expect(of(label(waits, "py").labels, "retry-storm")!.label).toBe("common pattern");
  });

  it("concurrency: race and lost update markers", () => {
    const race = `export class Tally {\n  total = 0;\n  async add(f) {\n    this.total = this.total + await f();\n  }\n}\n`;
    expect(of(label(race, "js").labels, "race")).toMatchObject({ label: "found in this code", lines: [{ path: "a", lineStart: 4, lineEnd: 4 }] });
    const lost = `export class C {\n  async bump(save) {\n    const v = this.count;\n    await save();\n    this.count = v + 1;\n  }\n}\n`;
    const l = of(label(lost, "js").labels, "lost-update")!;
    expect(l.label).toBe("found in this code");
    expect(l.lines!.map((x) => x.lineStart)).toEqual([3, 4, 5]);
    const safe = `export async function all(fs) {\n  return Promise.all(fs.map((f) => f()));\n}\n`;
    const s = label(safe, "js");
    expect(s.labels.filter((x) => x.kind === "concurrency").map((x) => x.label)).toEqual(["common pattern", "common pattern"]);
  });

  it("queue: an ack after the work and no duplicate check → duplicate delivery found; with a messageId check, common", () => {
    const q = `export async function handle(queue, msg, charge) {\n  await charge(msg.body);\n  await queue.ack(msg);\n}\n`;
    expect(of(label(q, "js").labels, "duplicate-delivery")).toMatchObject({ label: "found in this code", lines: [{ path: "a", lineStart: 3, lineEnd: 3 }] });
    const deduped = q.replace("  await charge", "  if (seen.has(msg.messageId)) return;\n  await charge");
    expect(of(label(deduped, "js").labels, "duplicate-delivery")!.label).toBe("common pattern");
  });

  it("db writes: two writes and no transaction → partial commit found; inside a transaction, common", () => {
    const w = `export async function move(db, a, b) {\n  await db.update("accounts", a);\n  await db.insert("ledger", b);\n}\n`;
    expect(of(label(w, "js").labels, "partial-commit")).toMatchObject({ label: "found in this code" });
    const tx = `export async function move(db, a, b) {\n  await db.transaction(async (t) => {\n    await t.update("accounts", a);\n    await t.insert("ledger", b);\n  });\n}\n`;
    expect(of(label(tx, "js").labels, "partial-commit")!.label).toBe("common pattern");
    const sql = `def move(cur):\n    cur.execute("UPDATE accounts SET x = 1")\n    cur.execute("INSERT INTO ledger VALUES (1)")\n`;
    expect(of(label(sql, "py").labels, "partial-commit")!.label).toBe("found in this code");
  });

  it("time: wall-clock durations and local-time methods; a time-zone-aware Python call is not a marker", () => {
    const js = `export function age(start, d) {\n  const ms = Date.now() - start;\n  return [ms, d.getHours()];\n}\n`;
    const a = label(js, "js");
    expect(of(a.labels, "clock-skew")).toMatchObject({ label: "found in this code", lines: [{ path: "a", lineStart: 2, lineEnd: 2 }] });
    expect(of(a.labels, "time-zone")).toMatchObject({ label: "found in this code", lines: [{ path: "a", lineStart: 3, lineEnd: 3 }] });
    expect(of(label("from datetime import datetime\ndef now():\n    return datetime.now()\n", "py").labels, "time-zone")!.label).toBe("found in this code");
    expect(of(label("from datetime import datetime, timezone\ndef now():\n    return datetime.now(timezone.utc)\n", "py").labels, "time-zone")!.label).toBe("common pattern");
  });

  it("plain code with none of the kinds: no labels at all", () => {
    expect(label("export const add = (a: number, b: number) => a + b;\n").labels).toEqual([]);
  });

  it("Wonder's tag can list a kind, never decide a label: a tagged kind with no marker is only a common pattern", () => {
    const a = label("export const add = (a, b) => a + b;\n", "js", { wonderTags: [{ label: "queue" }, { label: "made-up" }], wonderModel: "muse-wonder-1.0" });
    expect(a.labels).toHaveLength(1);
    expect(a.labels[0]).toMatchObject({ kind: "queue", label: "common pattern", kindBy: { wonder: { tag: "queue", model: "muse-wonder-1.0" } } });
    expect(a.labels[0]!.kindBy.plainCode).toBeUndefined();
  });

  it("never 'found in this code' without its marker's lines, on every snippet above and more", () => {
    const snippets: [string, LabelInput["language"]][] = [
      [RETRY_SRC, "ts"],
      [NO_WAIT_PY, "py"],
      ["export async function f(rpc) { return rpc.call(1); }\n", "js"],
      ["export function g(q) { q.publish(1); }\n", "js"],
      ["def h(db):\n    db.save(1)\n", "py"],
      ["export function t() { return new Date(); }\n", "js"],
    ];
    for (const [text, lang] of snippets)
      for (const l of label(text, lang, { wonderTags: CURATED.map((k) => ({ label: k.wonderTags[0]! })) }).labels) {
        if (l.label === "found in this code") {
          expect(l.markerRule, `${l.failure}`).not.toBeNull();
          expect(l.lines!.length).toBeGreaterThan(0);
        }
        if (l.markerRule === null) expect(l.label).not.toBe("found in this code");
      }
  });
});

describe("X3 failure labels from sealed runs", () => {
  it("a run where a stand-in never answers and the function never settles → reproduced, linked to that run", () => {
    const a = label(RETRY_SRC, "ts", { runs: [ev("runA", neverAnswers, { outcome: "never_settled", "calls:fetchIt": 1 })] });
    const t = of(a.labels, "no-overall-timeout")!;
    expect(t).toMatchObject({ label: "reproduced", runId: "runA" });
    expect(t.why).toMatch(/sealed Atlas run \(runA\) showed it: a stand-in never answered and the function never settled/);
    expect(of(a.labels, "timeout")!.label).toBe("reproduced");
    expect(of(a.labels, "retry-storm")!.label).toBe("common pattern"); // that run did not set up a storm
  });

  it("the run came back can't check → inconclusive (control failed, whole run can't check, or the fact not measured)", () => {
    for (const e of [ev("r1", neverAnswers, {}, false, { control: "the known case did not match" }), ev("r2", neverAnswers, {}, true, { wholeRun: "the code needs axios" }), ev("r3", neverAnswers, {}, true, { outcome: "not measured" })]) {
      const t = of(label(RETRY_SRC, "ts", { runs: [e] }).labels, "no-overall-timeout")!;
      expect(t.label).toBe("inconclusive");
      expect(t.runId).toBe(e.runId);
      expect(t.lines).toBeDefined(); // the marker's lines are still named
    }
  });

  it("a run that set it up and measured that it did not happen keeps the code's label, with a note", () => {
    const t = of(label(RETRY_SRC, "ts", { runs: [ev("r1", neverAnswers, { outcome: "threw" })] }).labels, "no-overall-timeout")!;
    expect(t.label).toBe("found in this code");
    expect(t.triedNotShown).toEqual({ runId: "r1", fact: "a stand-in never answered and the function still ended (outcome threw)" });
  });

  it("any run that showed it wins; otherwise the newest run that tried it decides", () => {
    const shownThenInconclusive = [ev("old", neverAnswers, { outcome: "still_running_at_watch_limit" }), ev("new", neverAnswers, {}, false)];
    expect(of(label(RETRY_SRC, "ts", { runs: shownThenInconclusive }).labels, "no-overall-timeout")).toMatchObject({ label: "reproduced", runId: "old" });
    const inconclusiveThenNotShown = [ev("old", neverAnswers, {}, false), ev("new", neverAnswers, { outcome: "returned" })];
    expect(of(label(RETRY_SRC, "ts", { runs: inconclusiveThenNotShown }).labels, "no-overall-timeout")!.label).toBe("found in this code");
    const notShownThenInconclusive = [ev("old", neverAnswers, { outcome: "returned" }), ev("new", neverAnswers, {}, false)];
    expect(of(label(RETRY_SRC, "ts", { runs: notShownThenInconclusive }).labels, "no-overall-timeout")!.label).toBe("inconclusive");
  });

  it(`retry storm: a stand-in that fails every time called ${STORM_CALLS}+ times → reproduced; fewer → not shown`, () => {
    const many = of(label(NO_WAIT_PY.replace("for i in range(n)", "while True"), "py", { runs: [ev("s1", alwaysFails, { outcome: "still_running_at_watch_limit", "calls:fetchIt": 50 })] }).labels, "retry-storm")!;
    expect(many).toMatchObject({ label: "reproduced", runId: "s1" });
    const few = of(label(RETRY_SRC, "ts", { runs: [ev("s2", alwaysFails, { outcome: "threw", "calls:fetchIt": 3 })] }).labels, "retry-storm")!;
    expect(few.label).toBe("common pattern");
    expect(few.triedNotShown!.fact).toMatch(/fewer than 20/);
  });

  it("a test that does not set the failure up is never evidence", () => {
    const plain = params([{ kind: "json", value: 1 }]);
    const t = of(label(RETRY_SRC, "ts", { runs: [ev("p", plain, { outcome: "never_settled" })] }).labels, "no-overall-timeout")!;
    expect(t.label).toBe("found in this code");
    expect(t.runId).toBeUndefined();
  });
});
