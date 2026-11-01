// X4 (D56), plain code and the real server (every model mocked, $0; sandbox, gate, judge, seals and proof files real):
// - the person's "how sure" tap is sealed: changing, adding or removing it after the run breaks the seal and verify;
// - it is the person's only: models' prompts and text are byte-identical with and without it (D19);
// - old proof files still verify, under the rules marker;
// - plain code tags each test "nothing failed" / "something failed" from its own spec, before running;
// - the track record counts both, with n, no percentage under 10 rounds at a level, and a hidden line under 3 answers.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_RULES, verifyAtlasFile } from "../../src/atlasfile";
import { failurePathOf, roundConfidence } from "../../src/felt";
import { FELT_WORDS } from "../../src/paste-words";
import { computeSealHash, sealBet, verifySeal } from "../../src/seal";
import { entriesFromRound, levelWords, levelsWords, pathWords, recordWords, trackRecordOf, weakSpotSummary, type TrackEntry } from "../../src/track-record";
import type { ArgSpec, Bet, ExperimentShape, NetworkFake, Verdict } from "../../src/types";
import { memoryTrackStore, diskTrackStore } from "../../server/track-store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { allowedA, makeApp, RETRY_SRC } from "../tools/paste-fixtures";

// ---------- helpers ----------

type App = ReturnType<typeof makeApp>["app"];
function client(app: App, extra: Record<string, string> = {}) {
  let s: string | null = null;
  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const h: Record<string, string> = { "content-type": "application/json", "x-atlas-browser": "bX4TestBrowserId012345678", ...extra };
    if (s) h["x-atlas-session"] = s;
    const res = await app.request(path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    s ??= res.headers.get("x-atlas-session");
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return { post: (p: string, b: unknown) => call("POST", p, b), get: (p: string) => call("GET", p) };
}
const ANSWERS = [
  { measures: "outcome", answer: { kind: "enum", value: "returned" } }, // matched
  { measures: "virtualMs", answer: { kind: "number", value: 500 } }, // didn't match
  { measures: "calls:fetchIt", answer: { kind: "integer", value: 2 } }, // matched
];
async function start(c: ReturnType<typeof client>, params: unknown = allowedA) {
  const p = await c.post("/paste", { code: RETRY_SRC });
  expect(p.status).toBe(200);
  const e = await c.post("/experiments", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, params });
  expect(e.status).toBe(200);
  return e;
}
async function round(c: ReturnType<typeof client>, confidence?: string, params: unknown = allowedA, bets = ANSWERS) {
  const e = await start(c, params);
  const id = e.json.experiment.id as string;
  const b = await c.post("/bets", { experimentId: id, who: "human", bets, ...(confidence ? { confidence } : {}) });
  expect(b.status).toBe(200);
  const r = await c.post("/runs", { experimentId: id });
  expect(r.status).toBe(200);
  return { id, sealed: b.json.bets as Bet[], run: r.json };
}
const proofOf = async (c: ReturnType<typeof client>, runId: string) => {
  const res = await c.get(`/proofs/${runId}`);
  expect(res.status).toBe(200);
  return res.json as any;
};
const verifyProblems = (f: unknown) => {
  const v = verifyAtlasFile(f) as { ok: boolean; problems?: string[] };
  return v.ok ? [] : (v.problems ?? ["not ok"]);
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const bet = (extra: Partial<Bet> = {}): Bet =>
  sealBet({ experimentId: "e1", who: "human", question: "How does it end?", measures: "outcome", answer: { kind: "enum", value: "returned", options: ["returned"] }, ...extra });
const entry = (outcome: TrackEntry["outcome"], extra: Partial<TrackEntry> = {}, i = Math.random().toString(36).slice(2)): TrackEntry => ({ runId: "r1", betId: `b${i}`, sealedHash: "a".repeat(64), type: "outcome", outcome, repeat: false, at: "2026-10-31T10:00:00.000Z", ...extra });
const many = (k: number, outcome: TrackEntry["outcome"], extra: Partial<TrackEntry> = {}) => Array.from({ length: k }, () => entry(outcome, extra));

// ---------- sealing ----------

describe("X4 the tap is in the seal", () => {
  it("a bet with no tap hashes exactly as before X4 (old proof files keep their hashes)", () => {
    const b = bet();
    const { confidence: _none, ...same } = b;
    expect(computeSealHash(same)).toBe(b.sealedHash);
    expect(verifySeal(b)).toBe(true);
  });
  it("changing it, adding it or removing it after sealing breaks the seal", () => {
    const b = bet({ confidence: "sure" });
    expect(verifySeal(b)).toBe(true);
    expect(verifySeal({ ...b, confidence: "guess" })).toBe(false);
    const { confidence: _gone, ...removed } = b;
    expect(verifySeal(removed)).toBe(false);
    expect(verifySeal({ ...bet(), confidence: "sure" })).toBe(false);
  });
});

describe("X4 on the server: optional, person only, one per round", () => {
  it("every one of the person's bets carries the tap; nothing is preselected when it is left out", async () => {
    const { app } = makeApp();
    const c = client(app);
    const a = await round(c, "sure");
    expect(a.sealed.map((b) => b.confidence)).toEqual(["sure", "sure", "sure"]);
    const b = await round(c);
    expect(b.sealed.map((x) => x.confidence)).toEqual([undefined, undefined, undefined]);
  });
  it("a value that is not one of the three is refused and nothing is sealed", async () => {
    const { app } = makeApp();
    const c = client(app);
    const e = await start(c);
    const r = await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: ANSWERS, confidence: "very sure" });
    expect(r.status).toBe(400);
    const again = await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: ANSWERS });
    expect(again.status).toBe(200);
  });
  it("a second request cannot change the round's answer or add one; leaving it out keeps the round's", async () => {
    const { app } = makeApp();
    const c = client(app);
    const e = await start(c);
    const id = e.json.experiment.id;
    const one = (i: number, confidence?: string) => c.post("/bets", { experimentId: id, who: "human", ...ANSWERS[i], ...(confidence ? { confidence } : {}) });
    expect((await one(0, "sure")).status).toBe(200);
    const change = await one(1, "guess");
    expect(change.status).toBe(409);
    expect(change.json.error).toMatch(/already sealed with "sure"/);
    const keep = await one(1);
    expect(keep.status).toBe(200);
    expect(keep.json.bet.confidence).toBe("sure");

    const f = await start(c);
    const first = await c.post("/bets", { experimentId: f.json.experiment.id, who: "human", ...ANSWERS[0] });
    expect(first.status).toBe(200);
    const late = await c.post("/bets", { experimentId: f.json.experiment.id, who: "human", ...ANSWERS[1], confidence: "sure" });
    expect(late.status).toBe(409);
    expect(late.json.error).toMatch(/without saying how sure/);
  });
  it("no bet at all is taken once the run started, so the tap cannot change after the run", async () => {
    const { app } = makeApp();
    const c = client(app);
    const { id } = await round(c, "sure");
    const r = await c.post("/bets", { experimentId: id, who: "human", ...ANSWERS[0], confidence: "guess" });
    expect(r.status).toBe(409);
  });
});

describe("X4 (D19): the betting models' text and prompts are byte-identical with and without the tap", () => {
  const play = async (confidence?: string) => {
    const { app, m } = makeApp();
    const c = client(app, { "x-atlas-claimant": "both" });
    const e = await start(c);
    const id = e.json.experiment.id as string;
    const seal = await c.post("/bets", { experimentId: id, who: "human", bets: ANSWERS, ...(confidence ? { confidence } : {}) });
    expect(seal.status).toBe(200);
    await c.post(`/experiments/${id}/model-bets`, {});
    const r = await c.post("/runs", { experimentId: id });
    expect(r.status).toBe(200);
    // Every model call of the round, whatever its role, after the person sealed and after the run.
    return { seen: e.json.seenContext as string, prompts: m.calls.map((x: { messages: unknown }) => JSON.stringify(x.messages)), roles: m.calls.map((x: { role: string }) => x.role), run: r.json };
  };
  it("same prompts, and no model's bet or prompt carries it", async () => {
    const a = await play("sure");
    const b = await play();
    expect(a.roles.filter((r: string) => r === "claimant").length).toBe(2);
    expect(a.seen).toBe(b.seen);
    expect(a.prompts).toEqual(b.prompts);
    for (const p of a.prompts) expect(p).not.toMatch(/how sure|confidence|You said/i);
    for (const bt of a.run.bets as Bet[]) if (bt.who !== "human") expect(bt.confidence).toBeUndefined();
    expect((a.run.bets as Bet[]).filter((x) => x.who === "human").every((x) => x.confidence === "sure")).toBe(true);
  });
  it("what Muse Wonder is told about earlier rounds is unchanged by the tap and the failure tag", () => {
    const plain = [entry("not_matched", { type: "timing" }, "a"), entry("matched", { type: "outcome" }, "b")];
    const tagged = plain.map((e) => ({ ...e, confidence: "sure" as const, path: "something failed" as const }));
    expect(weakSpotSummary(trackRecordOf(tagged))).toBe(weakSpotSummary(trackRecordOf(plain)));
  });
  it("before the run, another bettor's view of the person's bets (sealed hashes only) has no tap in the model slots", async () => {
    const { app } = makeApp();
    const c = client(app, { "x-atlas-claimant": "both" });
    const e = await start(c);
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: ANSWERS, confidence: "sure" });
    const v = await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    expect(JSON.stringify(v.json)).not.toContain("confidence");
  });
});

// ---------- the proof file ----------

describe("X4 proof file: recorded, verified, tamper-evident", () => {
  const made = async () => {
    const { app } = makeApp();
    const c = client(app);
    const { run } = await round(c, "think so");
    return { file: await proofOf(c, run.run.id) };
  };
  it("the file holds the tap and the marker, and verifies", async () => {
    const { file } = await made();
    expect(file.rules.confidence).toBe("x4");
    expect(file.rules).toEqual({ ...CURRENT_RULES });
    expect(file.bets.filter((b: Bet) => b.who === "human").map((b: Bet) => b.confidence)).toEqual(["think so", "think so", "think so"]);
    expect(verifyProblems(file)).toEqual([]);
  });
  it("tampering after the run: changed on one bet, changed on all, removed: each refused", async () => {
    const { file } = await made();
    const one = clone(file);
    one.bets.find((b: Bet) => b.who === "human").confidence = "sure";
    expect(verifyProblems(one).join("; ")).toMatch(/do not hash to its sealedHash/);
    const all = clone(file);
    for (const b of all.bets) if (b.who === "human") b.confidence = "sure";
    expect(verifyProblems(all).join("; ")).toMatch(/do not hash to its sealedHash/);
    const gone = clone(file);
    for (const b of gone.bets) delete b.confidence;
    expect(verifyProblems(gone).join("; ")).toMatch(/do not hash to its sealedHash/);
  });
  it("a value outside the three is refused by the file's shape", async () => {
    const { file } = await made();
    const bad = clone(file);
    bad.bets[0].confidence = "certain";
    expect(verifyProblems(bad).length).toBeGreaterThan(0);
  });
  it("removing the marker while the bets carry it is refused", async () => {
    const { file } = await made();
    const f = clone(file);
    delete f.rules.confidence;
    expect(verifyProblems(f).join("; ")).toMatch(/does not say it was made under the rules that record one/);
  });
  it("a re-sealed tap on a model's bet is refused, even though its hash is good", async () => {
    const { app } = makeApp();
    const c = client(app, { "x-atlas-claimant": "both" });
    const e = await start(c);
    const id = e.json.experiment.id;
    await c.post("/bets", { experimentId: id, who: "human", bets: ANSWERS });
    await c.post(`/experiments/${id}/model-bets`, {});
    const r = await c.post("/runs", { experimentId: id });
    const f = clone(await proofOf(c, r.json.run.id));
    const m = f.bets.find((b: Bet) => b.who !== "human");
    expect(m).toBeDefined();
    m.confidence = "sure";
    m.sealedHash = computeSealHash(m);
    expect(verifyProblems(f).join("; ")).toMatch(/only a person gives/);
  });
  it("two different re-sealed taps in one round are refused", async () => {
    const { file } = await made();
    const f = clone(file);
    const mine = f.bets.filter((b: Bet) => b.who === "human");
    mine[0].confidence = "guess";
    mine[0].sealedHash = computeSealHash(mine[0]);
    expect(verifyProblems(f).join("; ")).toMatch(/differ on how sure/);
  });
  it("known limit: re-hashing every bet after an edit changes the hashes, which the file alone cannot catch", async () => {
    // The hash is shown on screen before the run, but the file does not hold an outside copy of it. So someone who edits
    // the tap on every bet AND recomputes every hash (the nonces are public after the run) gets past the file's own
    // check, exactly as with an edited answer: what catches it is comparing with the hash shown before the run.
    const { file } = await made();
    const f = clone(file);
    for (const b of f.bets) if (b.who === "human") { b.confidence = "sure"; b.sealedHash = computeSealHash(b); }
    expect(verifyProblems(f)).toEqual([]); // the known limit, written down so a later anchor shows up here
    const mine = f.bets.find((x: Bet) => x.who === "human");
    expect(mine.sealedHash).not.toBe(file.bets.find((b: Bet) => b.id === mine.id).sealedHash); // the hash shown before the run no longer agrees
  });
  it("a round with no tap verifies, with the marker present", async () => {
    const { app } = makeApp();
    const c = client(app);
    const { run } = await round(c);
    const file = await proofOf(c, run.run.id);
    expect(file.rules.confidence).toBe("x4");
    expect(verifyProblems(file)).toEqual([]);
  });
  it("every committed proof file from before X4 still verifies", () => {
    const root = join(__dirname, "../..");
    const names = (readdirSync(root, { recursive: true }) as string[]).filter((n) => n.endsWith(".atlas.json") && !n.includes("node_modules"));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const f = JSON.parse(readFileSync(join(root, n), "utf8"));
      expect(f.rules?.confidence, n).toBeUndefined();
      expect(verifyProblems(f), n).toEqual([]);
    }
  });
});

// ---------- the round's line ----------

describe("X4 the verdict's plain counts", () => {
  const v = (b: Bet, outcome: Verdict["outcome"]) => ({ betId: b.id, outcome }) as Verdict;
  it("matched of checkable; can't-check answers are named, not hidden in the denominator", () => {
    const bs = [bet({ confidence: "sure" }), bet({ confidence: "sure" }), bet({ confidence: "sure" }), bet({ confidence: "sure" }), bet({ confidence: "sure" })];
    const c = roundConfidence(bs, [v(bs[0]!, "matched"), v(bs[1]!, "not_matched"), v(bs[2]!, "not_matched"), v(bs[3]!, "not_matched"), v(bs[4]!, "cant_check")]);
    expect(c).toEqual({ level: "sure", matched: 1, checkable: 4, cantCheck: 1 });
    expect(FELT_WORDS.roundMatched(c!.level, c!.matched, c!.checkable)).toBe("You said 'sure' and matched 1 of 4.");
  });
  it("null when no tap; a model's bets never count", () => {
    const b = bet();
    expect(roundConfidence([b], [v(b, "matched")])).toBeNull();
    const h = bet({ confidence: "guess" });
    const m = sealBet({ experimentId: "e1", who: "model:muse-spark-1.3", question: "q", measures: "outcome", answer: { kind: "enum", value: "returned", options: ["returned"] } });
    expect(roundConfidence([h, m], [v(h, "not_matched"), v(m, "matched")])).toEqual({ level: "guess", matched: 0, checkable: 1, cantCheck: 0 });
  });
});

// ---------- the failure tag ----------

describe("X4 'something failed' is read from the test's own spec", () => {
  const call = (args: ArgSpec[], network?: NetworkFake, calls?: { exportName: string; args: ArgSpec[] }[]): ExperimentShape => ({ shape: "call-function", exportName: "f", args, ...(network ? { network } : {}), ...(calls ? { calls } : {}) });
  const stand = (calls: Extract<ArgSpec, { kind: "stand-in" }>["calls"], then: "repeat_last" | "throw_exhausted" = "repeat_last"): ArgSpec => ({ kind: "stand-in", name: "dep", async: true, calls, then });
  const net = (calls: NetworkFake["calls"], then: NetworkFake["then"] = "repeat_last"): NetworkFake => ({ replaces: "fetch", calls, then });
  const ok = { do: "return", value: { ok: true } } as const;

  it.each<[string, ExperimentShape, string]>([
    ["no stand-in, no fake", call([{ kind: "json", value: 1 }]), "nothing failed"],
    ["a stand-in that only returns", call([stand([ok])]), "nothing failed"],
    ["a stand-in that throws on a later step", call([stand([ok, { do: "throw", errorName: "E", message: "m" }])]), "something failed"],
    ["a stand-in that never settles", call([stand([{ do: "never_settle" }])]), "something failed"],
    ["a stand-in returning status 503", call([stand([{ do: "return", value: { status: 503 } }])]), "something failed"],
    ["a stand-in returning statusCode 404", call([stand([{ do: "return", value: { statusCode: 404 } }])]), "something failed"],
    ["a stand-in returning status_code as text", call([stand([{ do: "return", value: { status_code: "500" } }])]), "something failed"],
    ["a stand-in returning response.status 500", call([stand([{ do: "return", value: { response: { status: 500 } } }])]), "something failed"],
    ["a stand-in returning status 'error'", call([stand([{ do: "return", value: { status: "error" } }])]), "something failed"],
    ["a stand-in returning status 200", call([stand([{ do: "return", value: { status: 200 } }])]), "nothing failed"],
    ["a stand-in returning status 'ok'", call([stand([{ do: "return", value: { status: "ok" } }])]), "nothing failed"],
    ["a failed job deep in a list is data, not a failed call", call([stand([{ do: "return", value: { items: [{ status: "failed" }] } }])]), "nothing failed"],
    ["a bare number 404 is a value", call([stand([{ do: "return", value: 404 }])]), "nothing failed"],
    ["running out of script alone does not count", call([stand([ok], "throw_exhausted")]), "nothing failed"],
    ["the fake network answering 200", call([], net([{ do: "respond", status: 200, body: {} }])), "nothing failed"],
    ["the fake network answering 301", call([], net([{ do: "respond", status: 301, body: {} }])), "nothing failed"],
    ["the fake network answering 429 then 200", call([], net([{ do: "respond", status: 429, body: {} }, { do: "respond", status: 200, body: {} }])), "something failed"],
    ["the fake network answering 200 with status 'error' in the body", call([], net([{ do: "respond", status: 200, body: { status: "error" } }])), "something failed"],
    ["the fake network throwing", call([], net([{ do: "throw", errorName: "TypeError", message: "m" }])), "something failed"],
    ["the fake network never answering", call([], net([{ do: "never_answer" }])), "something failed"],
    ["a failure on an EARLIER call of a sequence", call([{ kind: "json", value: 1 }], undefined, [{ exportName: "f", args: [stand([{ do: "throw", errorName: "E", message: "m" }])] }, { exportName: "f", args: [{ kind: "json", value: 1 }] }]), "something failed"],
    ["a sequence with no failure", call([{ kind: "json", value: 1 }], undefined, [{ exportName: "f", args: [stand([ok])] }, { exportName: "f", args: [{ kind: "json", value: 1 }] }]), "nothing failed"],
    ["retry-scenario failing twice", { shape: "retry-scenario", failTimes: 2, failure: "error" }, "something failed"],
    ["retry-scenario failing always", { shape: "retry-scenario", failTimes: "always", failure: "never_settles" }, "something failed"],
    ["retry-scenario with no failure", { shape: "retry-scenario", failTimes: 0, failure: "error" }, "nothing failed"],
    ["concurrency-sweep failing", { shape: "concurrency-sweep", callers: 5, failTimes: 1, failure: "error" }, "something failed"],
  ])("%s", (_name, params, want) => {
    expect(failurePathOf(params)).toBe(want);
  });
  it("a chain run scripts nothing, so it gets no tag; neither does an absent spec", () => {
    expect(failurePathOf({ shape: "price-read", markets: ["cbETH"] })).toBeNull();
    expect(failurePathOf({ shape: "apply-proposal-then-read", markets: "touched" })).toBeNull();
    expect(failurePathOf(undefined)).toBeNull();
  });
  it("the real round's entries carry the tag from the test's spec, and the tap", async () => {
    const { app } = makeApp();
    const c = client(app);
    const { run } = await round(c, "guess"); // allowedA: fetchIt throws once, then returns
    expect(run.track.after.felt.somethingFailed).toEqual({ n: 3, matched: 2, cantCheck: 0 });
    expect(run.track.after.felt.nothingFailed).toEqual({ n: 0, matched: 0, cantCheck: 0 });
    expect(run.track.after.felt.levels.find((l: { level: string }) => l.level === "guess")).toEqual({ level: "guess", rounds: 1, n: 3, matched: 2, cantCheck: 0 });
    const got = await c.get("/track-record");
    expect(got.json.record.felt).toEqual(run.track.after.felt);
  });
  it("from real rounds: the line stays hidden, then appears with the real counts; repeating a test adds nothing", async () => {
    const { app } = makeApp();
    const c = client(app);
    const fine = { shape: "call-function", exportName: "retryWithBackoff", args: [{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "return", value: { ok: true } }], then: "repeat_last" }, { kind: "json", value: 3 }, { kind: "json", value: 100 }] };
    const first = await round(c, undefined, fine, [
      { measures: "outcome", answer: { kind: "enum", value: "returned" } }, // matched
      { measures: "virtualMs", answer: { kind: "number", value: 500 } }, // didn't match
      { measures: "calls:fetchIt", answer: { kind: "integer", value: 1 } }, // matched
    ]);
    expect(first.run.track.after.felt.nothingFailed).toEqual({ n: 3, matched: 2, cantCheck: 0 });
    expect(pathWords(first.run.track.after.felt).line).toBeNull(); // nothing yet on the other side
    const second = await round(c); // allowedA: fetchIt throws once
    expect(pathWords(second.run.track.after.felt).line).toBe("On tests with no scripted failure you matched 2 of 3. With a scripted failure, 2 of 3.");
    const third = await round(c); // the same test again: sealed as a repeat, left out
    expect(third.sealed.every((b) => b.repeat === true)).toBe(true);
    expect(third.run.track.after.felt).toEqual(second.run.track.after.felt);
    expect(third.run.track.after.excludedRepeats).toBe(3);
  });
  it("a tampered bet is not kept in the record at all", () => {
    const b = bet({ confidence: "sure" });
    const v = { betId: b.id, runId: "r1", outcome: "matched" } as Verdict;
    expect(entriesFromRound([b], [v], { id: "r1", finishedAt: "2026-10-31T10:00:00.000Z" }, { shape: "retry-scenario", failTimes: 0, failure: "error" })[0]).toMatchObject({ confidence: "sure", path: "nothing failed" });
    expect(entriesFromRound([{ ...b, confidence: "guess" }], [v], { id: "r1", finishedAt: "2026-10-31T10:00:00.000Z" })).toEqual([]);
  });
});

// ---------- the record ----------

describe("X4 track record lines", () => {
  it("levels: counts only under 10 rounds; a percentage at 10 rounds or more; every level always said", () => {
    const nine = Array.from({ length: 9 }, (_, i) => entry(i % 2 ? "matched" : "not_matched", { confidence: "sure", runId: `r${i}` }));
    const r9 = trackRecordOf(nine);
    expect(levelsWords(r9.felt)).toEqual(["You said 'sure' on 9 rounds and matched 4 of 9.", "You said 'think so' on no rounds.", "You said 'guess' on no rounds."]);
    const ten = [...nine, entry("matched", { confidence: "sure", runId: "r9" })];
    expect(levelWords(trackRecordOf(ten).felt.levels[0]!)).toBe("You said 'sure' on 10 rounds and matched 5 of 10 (50%).");
  });
  it("many answers in few rounds never earn a percentage", () => {
    const r = trackRecordOf(many(40, "matched", { confidence: "think so", runId: "r1" }));
    expect(levelWords(r.felt.levels[1]!)).toBe("You said 'think so' on 1 round and matched 40 of 40.");
  });
  it("nobody tapped: one plain sentence; all can't check: says so, with no division by zero", () => {
    expect(levelsWords(trackRecordOf([entry("matched")]).felt)).toEqual([FELT_WORDS.levelsEmpty]);
    const unchecked = Array.from({ length: 10 }, (_, i) => entry("cant_check", { confidence: "guess", runId: `r${i}` }));
    expect(levelWords(trackRecordOf(unchecked).felt.levels[2]!)).toBe("You said 'guess' on 10 rounds. None of those answers could be checked.");
  });
  it("repeats are left out of both new lines, as before", () => {
    const r = trackRecordOf([...many(3, "matched", { repeat: true, confidence: "sure", path: "nothing failed" }), entry("matched", { confidence: "sure", path: "nothing failed" })]);
    expect(r.felt.levels[0]).toMatchObject({ rounds: 1, n: 1, matched: 1 });
    expect(r.felt.nothingFailed.n).toBe(1);
    expect(r.excludedRepeats).toBe(3);
  });
  it("the comparison uses the real counts, with the brief's wording", () => {
    const r = trackRecordOf([...many(6, "matched", { path: "nothing failed" }), ...many(1, "not_matched", { path: "nothing failed" }), ...many(2, "matched", { path: "something failed" }), ...many(5, "not_matched", { path: "something failed" })]);
    expect(pathWords(r.felt).line).toBe("On tests with no scripted failure you matched 6 of 7. With a scripted failure, 2 of 7.");
  });
  it("hidden until EACH side has 3 answers, with a plain note and the counts so far", () => {
    const short = trackRecordOf([...many(9, "matched", { path: "nothing failed" }), ...many(2, "matched", { path: "something failed" })]);
    const p = pathWords(short.felt);
    expect(p.line).toBeNull();
    expect(p.notes.join(" ")).toContain("at least 3 answers. So far: 9 when nothing failed, 2 when something failed.");
    const three = trackRecordOf([...many(3, "matched", { path: "nothing failed" }), ...many(3, "not_matched", { path: "something failed" })]);
    expect(pathWords(three.felt).line).toBe("On tests with no scripted failure you matched 3 of 3. With a scripted failure, 0 of 3.");
  });
  it("can't-check answers do not count towards the 3, and are named when the line shows", () => {
    const r = trackRecordOf([...many(3, "matched", { path: "nothing failed" }), ...many(2, "matched", { path: "something failed" }), ...many(5, "cant_check", { path: "something failed" })]);
    expect(pathWords(r.felt).line).toBeNull();
    const s = trackRecordOf([...many(3, "matched", { path: "nothing failed" }), ...many(3, "matched", { path: "something failed" }), ...many(2, "cant_check", { path: "something failed" })]);
    expect(pathWords(s.felt).notes.join(" ")).toContain("2 answers that couldn't be checked are not counted");
  });
  it("entries from before X4 and chain rounds are outside the line, and the record says so", () => {
    const r = trackRecordOf([entry("matched"), entry("not_matched", { type: "Moonwell price" })]);
    expect(r.felt.untagged).toBe(2);
    expect(pathWords(r.felt).notes.join(" ")).toContain("2 answers are not in that line");
  });
});

describe("X4 the stores keep and check the new fields", () => {
  it("memory and disk keep them; an old entry without them still reads; a made-up value is refused", () => {
    const d = mkdtempSync(join(tmpdir(), "atlas-x4-"));
    try {
      for (const store of [memoryTrackStore(), diskTrackStore(d)]) {
        const p = { kind: "browser" as const, id: "someone-x4" };
        const good = entry("matched", { confidence: "sure", path: "something failed" }, "good");
        const old = entry("matched", {}, "old");
        const bad1 = { ...entry("matched", {}, "bad1"), confidence: "certain" } as unknown as TrackEntry;
        const bad2 = { ...entry("matched", {}, "bad2"), path: "all fine" } as unknown as TrackEntry;
        store.add(p, [good, old, bad1, bad2]);
        expect(store.entries(p).map((e) => e.betId)).toEqual(["bgood", "bold"]);
        expect(store.entries(p)[0]).toMatchObject({ confidence: "sure", path: "something failed" });
        expect(store.entries(p)[1]!.confidence).toBeUndefined();
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ---------- wording ----------

describe("X4 wording", () => {
  const BANNED = /\b(right|wrong|correct|score\w*|skill\w*|learn\w*|teach\w*|understand\w*|research|study|grade\w*)\b/i;
  it("no sentence claims anything about understanding, and none uses a banned word", () => {
    const call = (w: unknown): string => {
      if (typeof w === "string") return w;
      const f = w as (...a: unknown[]) => string;
      return f("sure", 1, 2, 3, 40);
    };
    const all = Object.values(FELT_WORDS).map(call);
    const rec = trackRecordOf([...many(3, "matched", { path: "nothing failed", confidence: "sure" }), ...many(3, "cant_check", { path: "something failed" }), entry("matched")]);
    for (const s of [...all, ...recordWords(rec)]) expect(s, s).not.toMatch(BANNED);
  });
  it("the words are the brief's", () => {
    expect(FELT_WORDS.pickerLabel).toBe("How sure are you overall?");
    expect(FELT_WORDS.paths(6, 7, 2, 7)).toBe("On tests with no scripted failure you matched 6 of 7. With a scripted failure, 2 of 7.");
  });
});
