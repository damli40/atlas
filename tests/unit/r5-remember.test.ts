// D66: the remember loop holds the truth rules: counts only, nothing under 3 answers, private, the same questions for every bettor, and it survives a restart.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { diskTrackStore, memoryTrackStore } from "../../server/track-store";
import { countChange, lastRoundOf, lastRoundWords, REMEMBER_MIN, rememberWords, weakestKind, weakestWords } from "../../src/remember";
import { trackRecordOf, type TrackEntry } from "../../src/track-record";
import { sha256Hex } from "../../src/seal";

let n = 0;
const entry = (type: TrackEntry["type"], outcome: TrackEntry["outcome"], more: Partial<TrackEntry> = {}): TrackEntry => ({ runId: `r${++n}`, betId: `b${n}`, sealedHash: "a".repeat(64), type, outcome, repeat: false, at: "2026-11-02T00:00:00.000Z", ...more });
const rec = (...e: TrackEntry[]) => trackRecordOf(e);

describe("the weakest kind", () => {
  it("says nothing under 3 answers", () => {
    expect(REMEMBER_MIN).toBe(3);
    expect(weakestKind(rec(entry("timing", "not_matched"), entry("timing", "not_matched")))).toBeNull();
  });
  it("counts only what could be compared: can't check is on neither side", () => {
    const w = weakestKind(rec(entry("timing", "matched"), entry("timing", "not_matched"), entry("timing", "not_matched"), entry("timing", "cant_check")))!;
    expect(w).toMatchObject({ type: "timing", matched: 1, of: 3 });
    expect(weakestWords(w)).toBe("Your weakest so far: how long it takes, 1 of 3.");
  });
  it("no miss, no weakest", () => {
    expect(weakestKind(rec(entry("outcome", "matched"), entry("outcome", "matched"), entry("outcome", "matched")))).toBeNull();
  });
  it("a repeat is not counted", () => {
    expect(weakestKind(rec(entry("timing", "not_matched", { repeat: true }), entry("timing", "not_matched", { repeat: true }), entry("timing", "not_matched", { repeat: true })))).toBeNull();
  });
});

describe("last time", () => {
  const fn = sha256Hex("fn:fetchPage").slice(0, 16);
  it("the last round whose ending can be told, with the function's name only when it is the same one", () => {
    const e = [entry("outcome", "not_matched", { said: "returned", ended: "threw", fn }), entry("timing", "matched", { fn })];
    expect(lastRoundWords(lastRoundOf(e, fn)!, "fetchPage")).toBe("Last time on fetchPage: you bet returns a value. It threw.");
    expect(lastRoundWords(lastRoundOf(e, sha256Hex("fn:other").slice(0, 16))!, "other")).toBe("Last time: you bet returns a value. It threw.");
    expect(lastRoundWords(lastRoundOf(e, null)!, null)).toBe("Last time: you bet returns a value. It threw.");
  });
  it("a first-time visitor gets nothing, and a repeat is skipped", () => {
    expect(lastRoundOf([], null)).toBeNull();
    expect(lastRoundOf([entry("outcome", "matched", { said: "threw", ended: "threw", repeat: true })], null)).toBeNull();
  });
});

describe("the count that moved", () => {
  const seven = [entry("timing", "matched"), entry("timing", "matched"), ...Array.from({ length: 5 }, () => entry("timing", "not_matched"))];
  it("2 of 7 → 3 of 8", () => {
    expect(countChange(rec(...seven), rec(...seven, entry("timing", "matched")), null)).toEqual({ words: "how long it takes", from: "2 of 7", to: "3 of 8" });
  });
  it("under 3 earlier answers says nothing", () => {
    const two = [entry("timing", "not_matched"), entry("timing", "matched")];
    expect(countChange(rec(...two), rec(...two, entry("timing", "matched")), "timing")).toBeNull();
  });
  it("a round that counted nothing new says nothing", () => {
    expect(countChange(rec(...seven), rec(...seven, entry("timing", "matched", { repeat: true })), "timing")).toBeNull();
  });
});

describe("the words", () => {
  it("never the banned ones", () => {
    const banned = /\b(race|showdown|vs|beat|winner|leaderboard|right|wrong|score|skill|teach|learn)\b/i;
    for (const w of rememberWords()) expect(w).not.toMatch(banned);
  });
});

describe("kept, and private", () => {
  it("survives a restart on disk, holding only fixed words and a hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "rem-"));
    const p = { kind: "invite", id: "inv1" } as const;
    const fn = sha256Hex("fn:secretName").slice(0, 16);
    diskTrackStore(dir).add(p, [entry("outcome", "not_matched", { said: "returned", ended: "threw", fn })]);
    const back = diskTrackStore(dir).entries(p);
    expect(lastRoundOf(back, fn)).toMatchObject({ said: "returned", ended: "threw", sameFunction: true });
    const file = readdirSync(join(dir, "track-record"))[0]!;
    expect(readFileSync(join(dir, "track-record", file), "utf8")).not.toContain("secretName");
  });
  it("a hand-edited file can't put words in", () => {
    const dir = mkdtempSync(join(tmpdir(), "rem-"));
    const p = { kind: "invite", id: "inv2" } as const;
    const s = diskTrackStore(dir);
    s.add(p, [entry("outcome", "matched", { said: "threw", ended: "threw" })]);
    const file = join(dir, "track-record", readdirSync(join(dir, "track-record"))[0]!);
    writeFileSync(file, readFileSync(file, "utf8").replace('"said":"threw"', '"said":"my api key"'));
    expect(diskTrackStore(dir).entries(p)).toEqual([]);
  });
  it("through the server: a real round is remembered for its person, not for anyone else, and never in the proof", async () => {
    const trackStore = memoryTrackStore();
    const app = createApp({ trackStore });
    const s = "ssrememberremember1";
    const h = { "content-type": "application/json", "x-atlas-session": s, "x-atlas-browser": "browser-aaaaaaaaaaaaaaaa" };
    const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) })).json() as Promise<Record<string, never>>;
    const p = await post("/paste", { code: 'export function f(a){\n  throw new Error("no");\n}\n', language: "js" });
    const target = { ref: (p.target as { ref: string }).ref, codeSha256: (p.target as { codeSha256: string }).codeSha256 };
    const e = await post("/experiments", { target, params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }, quiz: true });
    const qs = e.questions as { measures: string; quiz: { id: string; label: string }[] }[];
    const id = (e.experiment as { id: string }).id;
    await post("/bets", { experimentId: id, who: "human", bets: qs.map((q) => (q.measures === "outcome" ? { measures: q.measures, answer: { kind: "quiz", choice: q.quiz.find((o) => /returns/.test(o.label))!.id } } : { measures: q.measures, answer: { kind: "declined", reason: "can't tell" } })) });
    const run = await post("/runs", { experimentId: id });
    const rid = (run.run as { id: string }).id;
    const mine = (await (await app.request("/remember?fn=f", { headers: h })).json()) as { last: string };
    expect(mine.last).toBe("Last time on f: you bet returns a value. It threw.");
    const other = (await (await app.request("/remember", { headers: { "x-atlas-session": "ssotherotherother09", "x-atlas-browser": "browser-bbbbbbbbbbbbbbbb" } })).json()) as { last: unknown; weakest: unknown };
    expect(other).toEqual({ last: null, weakest: null });
    const card = await (await app.request(`/proofs/${rid}`, { headers: { "x-atlas-session": "ssotherotherother09" } })).text();
    expect(card).not.toMatch(/Last time|weakest/);
    expect(card).not.toMatch(/"said"/);
  }, 60_000);
  it("the questions every bettor reads carry nothing from a record", async () => {
    const trackStore = memoryTrackStore();
    const app = createApp({ trackStore });
    const make = async (session: string, browser: string) => {
      const h = { "content-type": "application/json", "x-atlas-session": session, "x-atlas-browser": browser };
      const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) })).json() as Promise<Record<string, never>>;
      const p = await post("/paste", { code: "export function f(a){\n  return a;\n}\n", language: "js" });
      const target = { ref: (p.target as { ref: string }).ref, codeSha256: (p.target as { codeSha256: string }).codeSha256 };
      return post("/experiments", { target, params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }, quiz: true });
    };
    const fresh = await make("ssquestionsfresh001", "browser-cccccccccccccccc");
    trackStore.add({ kind: "browser", id: "browser-dddddddddddddddd" }, Array.from({ length: 6 }, () => entry("timing", "not_matched")));
    const weak = await make("ssquestionsweak0001", "browser-dddddddddddddddd");
    expect(JSON.stringify(weak.questions)).toBe(JSON.stringify(fresh.questions));
  }, 60_000);
});
