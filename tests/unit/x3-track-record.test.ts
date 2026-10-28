// X3 (D27): the track record, as pure plain code, and its on-disk store (G1's pattern: survives a restart).

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sealBet } from "../../src/seal";
import { diskTrackStore, memoryTrackStore, personKey, TRACK_DIR_NAME } from "../../server/track-store";
import { entriesFromRound, questionTypeOf, recordBefore, recordWords, trackRecordOf, TRACK_WORDS, typeLineWords, weakSpotSummary, type TrackEntry } from "../../src/track-record";
import type { Bet, BetAnswer, Verdict } from "../../src/types";
import { panelWords } from "../../web/screens/TrackRecord";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "atlas-x3-track-"));
  dirs.push(d);
  return d;
};

const bet = (measures: string, answer: BetAnswer, who: Bet["who"] = "human", repeat = false): Bet =>
  sealBet({ experimentId: "exp1", who, question: `q about ${measures}`, measures, answer, ...(repeat ? { repeat: true as const } : {}) });
const verdict = (b: Bet, outcome: Verdict["outcome"], observed?: number | string): Verdict => ({ betId: b.id, runId: "run1", outcome, ...(observed !== undefined ? { observed } : {}), judgedBy: "src/judge.ts" });
const run = { id: "run1", finishedAt: "2026-10-28T10:00:00.000Z" };
const entry = (type: TrackEntry["type"], outcome: TrackEntry["outcome"], runId = "r1", extra: Partial<TrackEntry> = {}): TrackEntry => ({
  runId,
  betId: `b${Math.random().toString(36).slice(2, 10)}`,
  sealedHash: "a".repeat(64),
  type,
  outcome,
  repeat: false,
  at: "2026-10-28T10:00:00.000Z",
  ...extra,
});

const BANNED = /\b(learn\w*|teach\w*|score\w*|skill\w*|right|wrong)\b/i;

describe("X3 track record: plain code over sealed bets and verdicts", () => {
  it("groups every measured field into the five question types (and nothing else)", () => {
    expect(questionTypeOf("outcome")).toBe("outcome");
    expect(questionTypeOf("returnedJson")).toBe("returned value");
    expect(questionTypeOf("virtualMs")).toBe("timing");
    expect(questionTypeOf("totalWaitMs")).toBe("timing");
    expect(questionTypeOf("settledAtMs")).toBe("timing");
    expect(questionTypeOf("calls")).toBe("call counts");
    expect(questionTypeOf("calls:fetchIt")).toBe("call counts");
    expect(questionTypeOf("priceUsd1e18:cbETH")).toBe("Moonwell price");
    expect(questionTypeOf("thrownName")).toBeNull();
  });

  it("keeps only the person's bets whose seal verifies, with the verdict's outcome; repeats are kept but marked; numbers say lower or higher", () => {
    const a = bet("outcome", { kind: "enum", value: "returned", options: ["returned", "threw"] });
    const b = bet("virtualMs", { kind: "number", value: 100, tolerancePct: 10, unit: "ms" });
    const c = bet("calls:fetchIt", { kind: "integer", value: 5 });
    const m = bet("outcome", { kind: "enum", value: "threw", options: ["returned", "threw"] }, "model:muse-spark-1.3");
    const r = bet("returnedJson", { kind: "json", value: 1 }, "human", true);
    const tampered = { ...bet("outcome", { kind: "enum", value: "threw", options: ["returned", "threw"] }), measures: "virtualMs" };
    const vs = [verdict(a, "matched"), verdict(b, "not_matched", 700), verdict(c, "not_matched", 3), verdict(m, "matched"), verdict(r, "cant_check"), verdict(tampered, "matched")];
    const es = entriesFromRound([a, b, c, m, r, tampered], vs, run);
    expect(es.map((e) => [e.type, e.outcome, e.repeat, e.side ?? null])).toEqual([
      ["outcome", "matched", false, null],
      ["timing", "not_matched", false, "under"],
      ["call counts", "not_matched", false, "over"],
      ["returned value", "cant_check", true, null],
    ]);
    // Nothing about the code, the question or the answer is in an entry.
    for (const e of es) expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(["at", "betId", "outcome", "repeat", "runId", "sealedHash", "type"]));
    expect(JSON.stringify(es)).not.toMatch(/q about|"value"|fetchIt/);
  });

  it("counts matched / didn't match / can't check with n, leaves repeats out and says how many", () => {
    const rec = trackRecordOf([entry("timing", "matched"), entry("timing", "not_matched", "r2", { side: "under" }), entry("timing", "not_matched", "r2", { side: "under" }), entry("outcome", "cant_check", "r3"), entry("outcome", "matched", "r4", { repeat: true })]);
    expect(rec.excludedRepeats).toBe(1);
    expect(rec.counted).toBe(4);
    expect(rec.rounds).toBe(3);
    expect(rec.lines.map((l) => [l.type, l.n, l.matched, l.notMatched, l.cantCheck])).toEqual([
      ["outcome", 1, 0, 0, 1],
      ["timing", 3, 1, 2, 0],
    ]);
    expect(typeLineWords(rec.lines[1]!)).toBe("Timing: matched 1 of 3 · didn't match 2 · can't check 0 (n = 3). Of the 2 that didn't match, your guess was lower than the run 2 times.");
  });

  it("never a percentage with n < 5; at n ≥ 5 the percentage always comes with n", () => {
    const four = trackRecordOf([1, 2, 3, 4].map((i) => entry("outcome", i === 1 ? "matched" : "not_matched", `r${i}`)));
    expect(typeLineWords(four.lines[0]!)).not.toMatch(/%/);
    expect(typeLineWords(four.lines[0]!)).toMatch(/\(n = 4\)/);
    const five = trackRecordOf([1, 2, 3, 4, 5].map((i) => entry("outcome", i <= 2 ? "matched" : "not_matched", `r${i}`)));
    expect(typeLineWords(five.lines[0]!)).toMatch(/\(40% of n = 5\)/);
  });

  it("the record before a round is the entries before that round's first entry (null when the round is not in it)", () => {
    const es = [entry("timing", "matched", "r1"), entry("timing", "not_matched", "r2"), entry("outcome", "matched", "r3")];
    expect(recordBefore(es, "r1")!.counted).toBe(0);
    expect(recordBefore(es, "r3")!.counted).toBe(2);
    expect(recordBefore(es, "nope")).toBeNull();
  });

  it("the weak-spot summary is question types and counts only; null when nothing didn't match", () => {
    expect(weakSpotSummary(trackRecordOf([entry("timing", "matched")]))).toBeNull();
    const s = weakSpotSummary(trackRecordOf([entry("timing", "not_matched", "r1", { side: "under" }), entry("timing", "not_matched", "r2", { side: "under" }), entry("timing", "matched", "r3"), entry("call counts", "not_matched", "r4", { side: "over" }), entry("outcome", "matched", "r5")]))!;
    expect(s).toContain("timing (2 of 3 didn't match; guessed lower than the run 2, higher 0)");
    expect(s).toContain("call counts (1 of 1 didn't match; guessed lower than the run 0, higher 1)");
    expect(s).not.toContain("outcome (");
    expect(s.indexOf("call counts")).toBeLessThan(s.indexOf("timing")); // 1 of 1 is a larger share than 2 of 3
  });

  it("wording (D27): never learn, teach, score, skill, right or wrong, in any sentence the record or panel can show", () => {
    const rec = trackRecordOf([entry("timing", "not_matched", "r1", { side: "under" }), entry("Moonwell price", "matched", "r2"), entry("outcome", "cant_check", "r3", { repeat: true }), ...[1, 2, 3, 4, 5].map((i) => entry("call counts", "matched", `c${i}`))]);
    const all = [...Object.values(TRACK_WORDS).map((w) => (typeof w === "function" ? (w as (a: number, b?: number) => string)(2, 3) : w)), ...recordWords(rec), ...panelWords(rec), weakSpotSummary(rec)!];
    for (const s of all) expect(s, s).not.toMatch(BANNED);
    expect(TRACK_WORDS.subheading).toBe("Where your guesses matched what the code did");
  });
});

describe("X3 track store: one file per person, on disk, survives a restart, never code", () => {
  it("a new store on the same folder reads the same record (a restart); files 600, folder 700; the file name and body hold no raw id", () => {
    const dir = tmp();
    const p = { kind: "browser" as const, id: "bROWSERid-abcdefghijklmnop" };
    const s1 = diskTrackStore(dir);
    s1.add(p, [entry("timing", "not_matched", "r1"), entry("outcome", "matched", "r1")]);
    const s2 = diskTrackStore(dir);
    expect(trackRecordOf(s2.entries(p)).counted).toBe(2);
    const folder = join(dir, TRACK_DIR_NAME);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    const files = readdirSync(folder);
    expect(files).toEqual([`${personKey(p)}.json`]);
    expect(statSync(join(folder, files[0]!)).mode & 0o777).toBe(0o600);
    const text = readFileSync(join(folder, files[0]!), "utf8");
    expect(text).not.toContain(p.id);
    expect(files[0]).not.toContain(p.id);
    // The same bet is never added twice.
    s2.add(p, s2.entries(p));
    expect(s2.entries(p)).toHaveLength(2);
  });

  it("a hand-edited file cannot slip code in: only entries of exactly the server's shape are read", () => {
    const dir = tmp();
    const p = { kind: "invite" as const, id: "inv_1" };
    const s = diskTrackStore(dir);
    s.add(p, [entry("timing", "matched")]);
    const path = join(dir, TRACK_DIR_NAME, `${personKey(p)}.json`);
    const f = JSON.parse(readFileSync(path, "utf8"));
    f.entries.push({ ...f.entries[0], betId: "x2", type: "export function evil() {}" }, { ...f.entries[0], betId: "x3", code: "secret();" }, "junk");
    writeFileSync(path, JSON.stringify(f));
    const got = s.entries(p);
    expect(got).toHaveLength(2);
    expect(JSON.stringify(got)).not.toMatch(/evil|secret/);
  });

  it("caps: people beyond the limit drop the one written longest ago; entries per person keep the newest", () => {
    const dir = tmp();
    const s = diskTrackStore(dir, { maxPeople: 2 });
    for (const id of ["aaaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaaa2", "aaaaaaaaaaaaaaaa3"]) s.add({ kind: "browser", id }, [entry("outcome", "matched")]);
    expect(readdirSync(join(dir, TRACK_DIR_NAME))).toHaveLength(2);
    expect(s.entries({ kind: "browser", id: "aaaaaaaaaaaaaaaa1" })).toHaveLength(0);
    const m = memoryTrackStore();
    const p = { kind: "session" as const, id: "s1" };
    m.add(p, Array.from({ length: 1005 }, (_, i) => entry("outcome", "matched", `r${i}`)));
    expect(m.entries(p)).toHaveLength(1000);
    expect(m.entries(p)[0]!.runId).toBe("r5");
  });
});
