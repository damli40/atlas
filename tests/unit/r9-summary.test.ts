// R9: the file summary. Meta's AI writes it from the code alone in its own call; plain code checks every line; the screen and every AI bettor
// get the same words (D19), with the R6 late-arrival rule; the shared proof picture never has it; the example's summary is kept and its AI
// answers were recorded again from the text that holds it. Also the one-click sample files. Every model mocked, $0.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { drawMachine, machineParts } from "../../renderer/authors/machine";
import { partPanel } from "../../renderer/authors/part-panel";
import { buildSummarizerMessages, SUMMARY_TASK } from "../../server/meta/roles/summarizer";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { checkSummary, checkSummaryLine, summaryForBettors, SUMMARY_PART_MAX_WORDS, SUMMARY_WORDS } from "../../src/file-summary";
import { EXAMPLE_SUMMARY } from "../../src/example-summary";
import { EXAMPLE_NAMES } from "../../src/example-names";
import { fileOutline } from "../../src/file-outline";
import { benchModel } from "../../web/machines/bench/model";
import { U1_EXAMPLE } from "../../web/u1-example";
import { SAMPLE_FILES } from "../../web/sample-files";
import RECORDED from "../../server/example-round.json";
import { client, makeApp, RETRY_SRC, mockModels, CLAIM } from "../tools/paste-fixtures";

const LINE = { words: 35, chars: 220 };
const PART = { words: SUMMARY_PART_MAX_WORDS, chars: 110 };

describe("checkSummary: plain code decides which lines stand", () => {
  it("keeps plain sentences of purpose", () => {
    expect(checkSummaryLine("  Fetches a  price, waiting longer between tries. ", LINE)).toEqual({ ok: true, text: "Fetches a price, waiting longer between tries." });
    expect(checkSummaryLine("It's a helper (for prices); it keeps a cache.", LINE).ok).toBe(true);
  });
  it("refuses digits, signs, too many words or characters, and empty text", () => {
    for (const bad of ["Waits 100 ms between tries.", "Returns a `Promise`.", "Calls fetch(url) again.", "A \"retry\" helper.", "Fetches a price — then stops.", "", 42, null]) expect(checkSummaryLine(bad, LINE).ok, String(bad)).toBe(false);
    expect(checkSummaryLine(Array.from({ length: 36 }, () => "word").join(" "), LINE).ok).toBe(false);
    expect(checkSummaryLine("a".repeat(221), LINE).ok).toBe(false);
    expect(checkSummaryLine(Array.from({ length: SUMMARY_PART_MAX_WORDS + 1 }, () => "word").join(" "), PART).ok).toBe(false);
  });
  it("refuses the names' trust and flaw words, by their beginnings and after un, in or non, and the Moonwell phrases", () => {
    const attacks = [
      "A safe retry helper.", "Fetches prices correctly.", "This has a bug in the loop.", "A fixed version of the fetcher.", "Secure price lookup.", // wording-lint: allow
      "Throws the last error.", "Retries forever.", "Never gives up.", "It always returns.", "Handles failed calls.", "An unsafe parser.", "Uses invalid input.",
      "A verified total.", "Robust fetching.", "Works fine.", "Catches every exception.", "Race prone counter.", "Off by one total.",
      "The first helper.", "Caught before shipping.", "Research shows it helps.", "Claude wrote this file.", "Was re-proven.", "AI caused this.", // wording-lint: allow
    ];
    for (const s of attacks) expect(checkSummaryLine(s, LINE).ok, s).toBe(false);
  });
  it("drops refused lines and lines for parts that were not drawn; no usable purpose means no summary", () => {
    const r = checkSummary({ purpose: "Fetches a price.", io: "Takes a fetcher; gives back a value.", parts: { a: "Waits a while.", b: "A safe step.", ghost: "Not here.", ["__proto__"]: "x" } }, ["a", "b", "c"]);
    // Review M1: an "in and out" sentence is never kept, whatever it says.
    expect(r.summary).toEqual({ purpose: "Fetches a price.", parts: { a: "Waits a while." } });
    expect(r.refused).toBe(3); // b, ghost, __proto__
    expect(checkSummary({ purpose: "A safe fetcher.", parts: { a: "Waits a while." } }, ["a"]).summary).toBeNull();
    expect(checkSummary("not json", ["a"]).summary).toBeNull();
    expect(checkSummary({ parts: { a: "Waits." } }, ["a"]).summary).toBeNull();
    expect(checkSummary({ purpose: "Fetches.", parts: ["a"] }, ["a"]).summary).toEqual({ purpose: "Fetches.", parts: {} });
  });
  it("review M1: refuses every line that answers the bet: how a call ends, what it gives back, numbers as words, time units", () => {
    const probes = [
      "If every try misses, it returns nothing and stops after three tries.",
      "Gives up and raises the last problem it hit after three attempts.",
      "Returns undefined when no request goes through.",
      "It rejects with the last reason once the attempts run out.",
      "nineteen ninety nine becomes one thousand nine hundred ninety nine",
      "Waits a quarter second, then half a second",
      "Then gives up.", "Comes back empty.", "Hands back null.", "Times out when the source is slow.", "Tries twice.", "Throws the last error.",
      "Never finishes when the source stalls.", "Hangs when the source stalls.", "Fails when the list is empty.", "Gives back the parsed data or nothing.",
    ];
    for (const s of probes) expect(checkSummaryLine(s, LINE).ok, s).toBe(false);
  });
  it("review M1: role lines still pass, \"failure\" included (it says when a part acts, not how a run ends)", () => {
    const roles = [
      "Tries the request again after each failure.", "Calculates the growing wait before another try.", "Pauses for the given amount of time.",
      "Fetches a price using the retry helper with preset settings.", "Turns each row of the table into a price in cents.", "Keeps recent answers so the slow source is asked less often.",
      "Reads the header row and skips it.", "Adds up every price in the table.", "Waits a little longer before each new try.",
    ];
    for (const s of roles) expect(checkSummaryLine(s, PART), s).toMatchObject({ ok: true });
    for (const s of ["It failed.", "A failing fetch."]) expect(checkSummaryLine(s, PART).ok, s).toBe(false);
  });
  it("review minor 1: refuses praise words, names included", async () => {
    const { checkName } = await import("../../src/natural-names");
    for (const s of ["An accurate parser.", "A sound cache.", "A solid helper.", "A dependable fetch.", "A reliable loop.", "A robust parser.", "A proper total.", "A flawless sum.", "A trustworthy lookup.", "An inaccurate count."]) expect(checkSummaryLine(s, LINE).ok, s).toBe(false);
    for (const n of ["accurate sum", "solid cache", "dependable fetch", "trustworthy lookup", "proper total"]) expect(checkName(n).ok, n).toBe(false);
    expect(checkName("property reader").ok).toBe(true);
  });
  it("the example's kept summary passes the checker unchanged", () => {
    const parts = fileOutline(U1_EXAMPLE, "ts").parts.map((p) => p.name);
    expect(checkSummary(EXAMPLE_SUMMARY, parts)).toEqual({ summary: EXAMPLE_SUMMARY, refused: 0 });
  });
});

describe("the summary prompt", () => {
  it("holds only the code and the parts: no sentence, no tests, no question", () => {
    const parts = fileOutline(U1_EXAMPLE, "ts").parts;
    const text = buildSummarizerMessages({ source: U1_EXAMPLE, language: "ts", parts }).map((m) => m.content).join("\n");
    expect(text).toContain(SUMMARY_TASK);
    for (const p of parts) expect(text).toContain(`- ${p.name} (`);
    expect(text).not.toMatch(/People expect|experiment|claim|measures|What does/i);
  });
});

/** A chat that summarises files, and otherwise answers like the usual mock. */
function summarisingModels(answer: (all: string) => unknown, hold?: Promise<void>) {
  const base = mockModels();
  const calls: ChatArgs[] = base.calls;
  const chat = async (a: ChatArgs): Promise<ChatResult> => {
    const all = a.messages.map((m) => m.content).join("\n");
    if (all.includes(SUMMARY_TASK)) {
      calls.push(JSON.parse(JSON.stringify(a)));
      if (hold) await hold;
      return { ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.001 }, content: JSON.stringify(answer(all)) };
    }
    return base.chat(a);
  };
  return { chat, calls };
}
const GOOD = { purpose: "Calls a fetcher again after short waits.", parts: { retryWithBackoff: "Tries the fetcher, waiting longer each time." } };
const NEVER = { shape: "call-function", exportName: "retryWithBackoff", args: [{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "never_settle" }], then: "repeat_last" }, { kind: "json", value: 3 }, { kind: "json", value: 100 }] };
const isSummaryCall = (x: ChatArgs) => x.messages.some((y) => y.content.includes(SUMMARY_TASK));
const budget = async () => (await import("../../server/meta/budget")).createModelBudget({ spendCeilingUsd: 5 });

describe("POST /paste/summary on the real server", () => {
  it("D19: the summary the page gets is the summary in every bettor's text, labelled as the model's words", async () => {
    const m = summarisingModels(() => GOOD);
    const { app } = makeApp({ modelBets: { chat: m.chat, budget: await budget(), sparkOpen: { available: true } }, paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const s = await c.post("/paste/summary", { target: t });
    expect(s.json).toMatchObject({ ok: true, model: "muse-wonder-1.0", summary: GOOD });
    const e = await c.post("/experiments", { target: t, params: NEVER }, { "x-atlas-claimant": "both" });
    const seen = e.json.seenContext as string;
    for (const line of summaryForBettors(s.json.summary, s.json.model)) expect(seen).toContain(line);
    await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    const bettors = m.calls.filter((x) => x.role === "claimant");
    expect(new Set(bettors.map((b) => b.model)).size).toBe(2);
    for (const b of bettors) for (const line of summaryForBettors(s.json.summary, s.json.model)) expect(b.messages.map((x) => x.content).join("\n")).toContain(line);
    // One summary call for the file, however often it is asked; and it is its own call, made as Muse Wonder.
    await c.post("/paste/summary", { target: t });
    const asked = m.calls.filter(isSummaryCall);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ role: "investigator", model: "muse-wonder-1.0" });
  });

  it("never sees the test or Wonder's sentence, even when the tests were written first", async () => {
    const m = summarisingModels(() => GOOD);
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    await c.post("/paste/proposals", { target: t, exportName: "retryWithBackoff" });
    await c.post("/paste/summary", { target: t });
    const text = m.calls.filter(isSummaryCall).flatMap((x) => x.messages.map((y) => y.content)).join("\n");
    expect(text).not.toContain("zebra-claim-7731");
    expect(text).not.toContain(CLAIM.slice(0, 30));
    expect(text).not.toMatch(/stand-in|never_settle|experiments/);
  });

  it("a refused summary shows nothing, and is in no bettor's text", async () => {
    const m = summarisingModels(() => ({ purpose: "A safe retry that always works.", parts: { retryWithBackoff: "Retries." } }));
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const s = await c.post("/paste/summary", { target: t });
    expect(s.json).toMatchObject({ ok: false, summary: null, reason: "plain code refused the summary" });
    const e = await c.post("/experiments", { target: t, params: NEVER });
    expect(e.json.seenContext).not.toContain("A summary");
  });

  it("a summary that arrives after a round's text was written is never shown (the R6 late rule)", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const m = summarisingModels(() => GOOD, hold);
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const asked = c.post("/paste/summary", { target: t });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const made = c.post("/experiments", { target: t, params: NEVER });
    await vi.advanceTimersByTimeAsync(21_000);
    vi.useRealTimers();
    const e = await made;
    expect(e.json.seenContext).not.toContain("A summary");
    release();
    const s = await asked;
    expect(s.json.ok).toBe(false);
    expect(s.json.summary).toBeNull();
    expect(s.json.reason).toMatch(/after the bettors' text/);
    // And it stays closed for that file in this session: asking again shows nothing.
    expect((await c.post("/paste/summary", { target: t })).json.ok).toBe(false);
  });

  it("a summary still on its way, but within the short wait, is in the text and on the page (pending → shown)", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const m = summarisingModels(() => GOOD, hold);
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const asked = c.post("/paste/summary", { target: t });
    const made = c.post("/experiments", { target: t, params: NEVER });
    setTimeout(release, 50);
    const e = await made;
    expect(e.json.seenContext).toContain(`- What the file is for: ${GOOD.purpose}`);
    expect((await asked).json).toMatchObject({ ok: true, summary: GOOD });
  });

  it("a round made before the summary was asked closes it for that file: no call, nothing shown", async () => {
    const m = summarisingModels(() => GOOD);
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    await c.post("/experiments", { target: t, params: NEVER });
    const s = await c.post("/paste/summary", { target: t });
    expect(s.json.ok).toBe(false);
    expect(s.json.reason).toMatch(/after the bettors' text/);
    expect(m.calls.some(isSummaryCall)).toBe(false);
  });

  it("review minor 2: a copy that differs only in comments is asked again: one person's comments never reach another's summary", async () => {
    const m = summarisingModels(() => GOOD);
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    for (const code of [RETRY_SRC, `// a comment only this person wrote\n${RETRY_SRC}`]) {
      const p = await c.post("/paste", { code });
      expect((await c.post("/paste/summary", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 } })).json.ok).toBe(true);
    }
    const asked = m.calls.filter(isSummaryCall);
    expect(asked).toHaveLength(2);
    expect(asked[1]!.messages.map((x) => x.content).join("\n")).toContain("a comment only this person wrote");
    expect(asked[0]!.messages.map((x) => x.content).join("\n")).not.toContain("a comment only this person wrote");
  });

  it("has its own per-client hourly limit", async () => {
    const before = process.env.ATLAS_SUMMARY_PER_CLIENT_PER_HOUR;
    process.env.ATLAS_SUMMARY_PER_CLIENT_PER_HOUR = "1";
    try {
      const m = summarisingModels(() => GOOD);
      const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
      const c = client(app);
      const first = await c.post("/paste", { code: RETRY_SRC });
      expect((await c.post("/paste/summary", { target: { ref: first.json.target.ref, codeSha256: first.json.target.codeSha256 } })).json.ok).toBe(true);
      const other = await c.post("/paste", { code: RETRY_SRC.replace("attempts: number = 3", "attempts: number = 4") });
      const s = await c.post("/paste/summary", { target: { ref: other.json.target.ref, codeSha256: other.json.target.codeSha256 } });
      expect(s.json.ok).toBe(false);
      expect(s.json.reason).toMatch(/file summaries/);
      expect(m.calls.filter(isSummaryCall)).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.ATLAS_SUMMARY_PER_CLIENT_PER_HOUR;
      else process.env.ATLAS_SUMMARY_PER_CLIENT_PER_HOUR = before;
    }
  });

  it("no model on this server: a plain reason, and no summary", async () => {
    const { app } = makeApp({ paste: {} });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const s = await c.post("/paste/summary", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 } });
    expect(s.json).toMatchObject({ ok: false, summary: null, reason: "this server asks no Meta model" });
  });
});

describe("the built-in example", () => {
  const exampleRound = async (opts: { summary?: boolean } = {}) => {
    const { app, m } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: U1_EXAMPLE, language: "ts" });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    await c.post("/paste/names", { target: t });
    const s = opts.summary === false ? null : await c.post("/paste/summary", { target: t });
    const props = await c.post("/paste/proposals", { target: t, exportName: "fetchWithRetry" });
    const first = (props.json.proposals as { id: string; gate: { allowed: boolean } }[]).find((x) => x.gate.allowed)!;
    const e = await c.post("/experiments", { target: t, proposalId: first.id, quiz: true, one: true }, { "x-atlas-claimant": "both" });
    const slots = await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    return { c, t, m, s, e, slots: slots.json.models as { model: string; status: string; recorded?: string }[] };
  };
  it("its summary is kept: no model call, and the page's flow (names, then summary) replays the answers recorded from the text that holds it", async () => {
    const { m, s, e, slots } = await exampleRound();
    expect(s!.json).toMatchObject({ ok: true, summary: EXAMPLE_SUMMARY });
    expect(e.json.seenContext).toContain(`- What the file is for: ${EXAMPLE_SUMMARY.purpose}`);
    expect(m.calls).toHaveLength(0);
    expect(slots.map((x) => [x.status, x.recorded])).toEqual([
      ["sealed", RECORDED.recordedOn],
      ["sealed", RECORDED.recordedOn],
    ]);
  });
  it("the recordings with the summary are the R9 ones, made from that exact text", async () => {
    const { createHash } = await import("node:crypto");
    const { e } = await exampleRound();
    const r9 = RECORDED.bets.filter((b) => (b as { text?: string }).text?.startsWith("R9"));
    expect(r9.map((b) => b.model).sort()).toEqual(["meta-models/muse-spark-open-1026", "muse-spark-1.3"]);
    const recorded = JSON.parse((await import("node:fs")).readFileSync(new URL("../evidence/R9/example-recorded.json", import.meta.url), "utf8")) as { seenSha256: string };
    expect(createHash("sha256").update(e.json.seenContext).digest("hex")).toBe(recorded.seenSha256);
  });
  it("a round written before the summary was asked gets the R7 answers recorded from that text (still marked recorded), and the summary is then closed", async () => {
    const { c, t, m, slots } = await exampleRound({ summary: false });
    expect(m.calls).toHaveLength(0);
    expect(slots.every((x) => x.recorded === RECORDED.recordedOn)).toBe(true);
    expect((await c.post("/paste/summary", { target: t })).json.ok).toBe(false);
  });
  it("verify still refuses a proof of the example with the recorded label stripped", async () => {
    const { verifyAtlasFile } = await import("../../src/atlasfile");
    const { c, e } = await exampleRound();
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "quiz", choice: "a" } }] });
    const run = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(run.status).toBe(200);
    const file = (await c.get(`/proofs/${run.json.run.id}`)).json as { bettors: { who: string; recorded?: string }[] };
    expect(file.bettors.filter((x) => x.recorded).length).toBe(2);
    expect(verifyAtlasFile(file).ok).toBe(true);
    const stripped = JSON.parse(JSON.stringify(file));
    for (const x of stripped.bettors) delete x.recorded;
    expect(verifyAtlasFile(stripped).ok).toBe(false);
  }, 60_000);
});

describe("where the summary may appear", () => {
  const outline = fileOutline(U1_EXAMPLE, "ts");
  const model = benchModel({ fileName: "x", outline, test: null, source: U1_EXAMPLE, language: "ts" });
  const parts = machineParts({ ...model, tested: "fetchWithRetry" }, outline, U1_EXAMPLE, "ts");
  const words = [EXAMPLE_SUMMARY.purpose, ...Object.values(EXAMPLE_SUMMARY.parts)];
  it("the shared proof picture of a real example run has none of its words", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: U1_EXAMPLE, language: "ts" });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    await c.post("/paste/names", { target: t });
    await c.post("/paste/summary", { target: t });
    const props = await c.post("/paste/proposals", { target: t, exportName: "fetchWithRetry" });
    const first = (props.json.proposals as { id: string; gate: { allowed: boolean } }[]).find((x) => x.gate.allowed)!;
    const e = await c.post("/experiments", { target: t, proposalId: first.id, quiz: true, one: true });
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "quiz", choice: "b" } }] });
    const run = await c.post("/runs", { experimentId: e.json.experiment.id });
    const file = (await c.get(`/proofs/${run.json.run.id}`)).json;
    const { ProofCard } = await import("../../web/screens/ProofCard");
    const html = renderToStaticMarkup(createElement(ProofCard, { file: file as unknown as import("../../src/types").AtlasFile, machineParts: parts, stranger: true }));
    expect(html).toContain("data-machine");
    for (const w of words) expect(html).not.toContain(w);
    // The proof file itself holds no summary either: it is the page's and the bettors' text only.
    for (const w of words) expect(JSON.stringify(file)).not.toContain(w);
  }, 60_000);
  it("the machine drawing never carries it (the panel is where part lines go)", () => {
    const svg = drawMachine({ ...parts, housings: parts.housings.map((h) => ({ ...h, natural: EXAMPLE_NAMES[h.id]! })) }, { seed: "p", nameLines: true }).svg;
    for (const w of words) expect(svg).not.toContain(w);
  });
  it("the part panel shows the part's line, marked as Meta's AI's words", () => {
    const panel = partPanel(parts, "fetchWithRetry", { partLines: EXAMPLE_SUMMARY.parts })!;
    expect(panel.summary).toBe(SUMMARY_WORDS.panel(EXAMPLE_SUMMARY.parts.fetchWithRetry));
    expect(panel.summary).toMatch(/its words, not a check/);
    expect(partPanel(parts, "sleep")!.summary).toBeNull();
  });
});

describe("the sample files (Task 2)", () => {
  it("each pastes as a normal file Atlas can run: parts to draw, a function to test, nothing that makes it can't check", async () => {
    const { app } = makeApp();
    const c = client(app);
    for (const f of SAMPLE_FILES) {
      const p = await c.post("/paste", { code: f.code, language: f.language });
      expect(p.status, f.id).toBe(200);
      expect(p.json.runnable, f.id).toBe(true);
      expect(p.json.cantCheck ?? null, f.id).toBeNull();
      expect((p.json.exports as unknown[]).length, f.id).toBeGreaterThan(0);
      expect(fileOutline(f.code, f.language).parts.length, f.id).toBeGreaterThan(0);
    }
  });
});
