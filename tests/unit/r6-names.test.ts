// R6: natural names. Meta's AI proposes a short name per part; plain code checks each one; the screen and every AI bettor get the same names (D19);
// the shared picture never has them. Every model mocked, $0.
import { describe, expect, it } from "vitest";
import { drawMachine, machineParts, MACHINE_PART_LIMIT } from "../../renderer/authors/machine";
import { partPanel } from "../../renderer/authors/part-panel";
import { buildNamerMessages, NAME_TASK } from "../../server/meta/roles/namer";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { checkName, checkNames, namesForBettors, NAMES_PART_LIMIT } from "../../src/natural-names";
import { EXAMPLE_NAMES } from "../../src/example-names";
import { fileOutline } from "../../src/file-outline";
import { benchModel } from "../../web/machines/bench/model";
import { U1_EXAMPLE } from "../../web/u1-example";
import { client, makeApp, RETRY_SRC, mockModels } from "../tools/paste-fixtures";

describe("checkName: plain code decides which names stand", () => {
  it("keeps 1 to 4 plain words, in small letters", () => {
    expect(checkName("Price Lookup")).toEqual({ ok: true, name: "price lookup" });
    expect(checkName("  retry   with waits ")).toEqual({ ok: true, name: "retry with waits" });
    expect(checkName("back-off timer")).toEqual({ ok: true, name: "back-off timer" });
  });
  it("refuses digits, signs, too many words and empty text", () => {
    expect(checkName("step 2").ok).toBe(false);
    expect(checkName("price_lookup").ok).toBe(false);
    expect(checkName("fetch(url)").ok).toBe(false);
    expect(checkName("one two three four five").ok).toBe(false);
    expect(checkName("").ok).toBe(false);
    expect(checkName(42).ok).toBe(false);
  });
  it("refuses words that judge the code, plurals and hyphenated pieces too", () => {
    for (const bad of ["bug loop", "safe fetch", "always retry", "error handler", "errors list", "crash-proof loop", "correct total", "fixed price", "broken cache", "never ending"]) expect(checkName(bad).ok, bad).toBe(false);
  });
  it("review B1: refuses trust, status and flaw words, by their beginnings, and after un, in or non", () => {
    const attacks = ["verified total", "secure retry", "trusted input check", "tested sum", "audited fetch", "approved payout", "no issues", "bugfree", "flawless parser", "safely retrying", "correctly sums", "robust fetch", "guaranteed sends", "harmless helper", "errorless", "crashing", "errored", "failing fetch", "works fine", "exploit", "backdoor", "atlas approved", "throws on empty", "retries forever", "infinite retry", "unbounded loop", "off by one sum", "race prone count", "leaks memory", "sometimes throws", "unsafe parse", "insecure store", "untrusted input", "unverified sum", "hangs on empty", "valid input", "perfect parser", "risky fetch", "danger zone", "proven sum"];
    for (const name of attacks) expect(checkName(name).ok, name).toBe(false);
  });
  it("still keeps names of purpose, retry included", () => {
    for (const name of ["retrying fetch", "retry wait time", "price lookup", "pause execution", "order pages", "cache reader", "input checker", "back-off timer"]) expect(checkName(name).ok, name).toBe(true);
  });
  it("review M1: refuses a name too long for a lid", () => {
    expect(checkName("growing wait calculation").ok).toBe(false);
    expect(checkName("timed pause help").ok).toBe(true);
  });
  it("review m4: two parts with one name both keep their own, and so does a name that reads as another part's identifier", () => {
    expect(checkNames({ names: { a: "mock helper step", b: "mock helper step", c: "price lookup" } }, ["a", "b", "c"]).names).toEqual({ c: "price lookup" });
    expect(checkNames({ names: { sleep: "get price", getPrice: "price lookup" } }, ["sleep", "getPrice"]).names).toEqual({ getPrice: "price lookup" });
    expect(checkNames({ names: { sleep: "getprice" } }, ["sleep", "getPrice"]).names).toEqual({});
  });
  it("names are asked only for files the machine can draw", () => {
    expect(NAMES_PART_LIMIT).toBe(MACHINE_PART_LIMIT);
  });
  it("checkNames keeps one name per known part and drops the rest", () => {
    const r = checkNames({ names: { a: "price lookup", b: "safe step", ghost: "not here", ["__proto__"]: "x" } }, ["a", "b", "c"]);
    expect(r.names).toEqual({ a: "price lookup" });
    expect(r.refused).toBe(1);
    expect(checkNames("not json", ["a"]).names).toEqual({});
    expect(checkNames({ names: ["a"] }, ["a"]).names).toEqual({});
  });
  it("the kept example names pass the same check", () => {
    expect(checkNames({ names: EXAMPLE_NAMES }, Object.keys(EXAMPLE_NAMES)).names).toEqual(EXAMPLE_NAMES);
  });
});

describe("the naming prompt", () => {
  it("holds only the code and the parts: no sentence, no tests", () => {
    const parts = fileOutline(U1_EXAMPLE, "ts").parts;
    const text = buildNamerMessages({ source: U1_EXAMPLE, language: "ts", parts }).map((m) => m.content).join("\n");
    expect(text).toContain(NAME_TASK);
    for (const p of parts) expect(text).toContain(`- ${p.name} (`);
    expect(text).not.toMatch(/People expect|experiment|claim/i);
  });
});

/** A chat that names parts, and otherwise answers like the usual mock. */
function namingModels(names: (all: string) => unknown, hold?: Promise<void>) {
  const base = mockModels();
  const calls: ChatArgs[] = base.calls;
  const chat = async (a: ChatArgs): Promise<ChatResult> => {
    const all = a.messages.map((m) => m.content).join("\n");
    if (all.includes(NAME_TASK)) {
      calls.push(JSON.parse(JSON.stringify(a)));
      if (hold) await hold;
      return { ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 }, content: JSON.stringify(names(all)) };
    }
    return base.chat(a);
  };
  return { chat, calls };
}
const NEVER = { shape: "call-function", exportName: "retryWithBackoff", args: [{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "never_settle" }], then: "repeat_last" }, { kind: "json", value: 3 }, { kind: "json", value: 100 }] };

describe("POST /paste/names on the real server", () => {
  it("D19: the names the page gets are the names in every bettor's text, labelled as the model's words", async () => {
    const m = namingModels(() => ({ names: { retryWithBackoff: "retry with waits" } }));
    const { app } = makeApp({ modelBets: { chat: m.chat, budget: (await import("../../server/meta/budget")).createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: true } }, paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const n = await c.post("/paste/names", { target: t });
    expect(n.json).toMatchObject({ ok: true, names: { retryWithBackoff: "retry with waits" } });
    const e = await c.post("/experiments", { target: t, params: NEVER }, { "x-atlas-claimant": "both" });
    const seen = e.json.seenContext as string;
    for (const line of namesForBettors(n.json.names, n.json.model)) expect(seen).toContain(line);
    expect(seen).toContain("The person's drawing may show some of them. Its words, not a check");
    expect(seen).not.toContain("shown on the person's screen");
    await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    const bettors = m.calls.filter((x) => x.role === "claimant");
    expect(bettors.length).toBeGreaterThan(0);
    for (const b of bettors) expect(b.messages.map((x) => x.content).join("\n")).toContain("- retryWithBackoff: retry with waits");
    // One naming call for the file, however often it is asked.
    await c.post("/paste/names", { target: t });
    expect(m.calls.filter((x) => x.messages.some((y) => y.content.includes(NAME_TASK)))).toHaveLength(1);
  });

  it("a name plain code refuses is dropped: no name for that part, and none in the bettors' text", async () => {
    const m = namingModels(() => ({ names: { retryWithBackoff: "safe retry" } }));
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const n = await c.post("/paste/names", { target: t });
    expect(n.json.ok).toBe(false);
    expect(n.json.reason).toBe("plain code refused every name");
    const e = await c.post("/experiments", { target: t, params: NEVER });
    expect(e.json.seenContext).not.toContain("Short names for the parts");
  });

  it("names that arrive after a round's text was written are never shown", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const m = namingModels(() => ({ names: { retryWithBackoff: "retry with waits" } }), hold);
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const asked = c.post("/paste/names", { target: t });
    // The round waits at most 1.5 s for names on their way; here they never come in time.
    const { vi } = await import("vitest");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const made = c.post("/experiments", { target: t, params: NEVER });
    await vi.advanceTimersByTimeAsync(21_000);
    vi.useRealTimers();
    const e = await made;
    expect(e.json.seenContext).not.toContain("Short names for the parts");
    release();
    const n = await asked;
    expect(n.json.ok).toBe(false);
    expect(n.json.reason).toMatch(/after the bettors' text/);
  });

  it("review B3: a round made before names were asked closes them for that file: the page never shows names the bettors lack", async () => {
    const m = namingModels(() => ({ names: { retryWithBackoff: "retry with waits" } }));
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const e = await c.post("/experiments", { target: t, params: NEVER });
    expect(e.json.seenContext).not.toContain("suggested for the parts");
    const n = await c.post("/paste/names", { target: t });
    expect(n.json.ok).toBe(false);
    expect(n.json.reason).toMatch(/after the bettors' text/);
    expect(m.calls.some((x) => x.messages.some((y) => y.content.includes(NAME_TASK)))).toBe(false);
  });

  it("review m5: a copy that differs only in comments reuses the names: no second call", async () => {
    const m = namingModels(() => ({ names: { retryWithBackoff: "retry with waits" } }));
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    for (const code of [RETRY_SRC, `// a comment added\n${RETRY_SRC}`]) {
      const p = await c.post("/paste", { code });
      const n = await c.post("/paste/names", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 } });
      expect(n.json.names).toEqual({ retryWithBackoff: "retry with waits" });
    }
    expect(m.calls.filter((x) => x.messages.some((y) => y.content.includes(NAME_TASK)))).toHaveLength(1);
  });

  it("review M1: a file with more parts than the machine draws asks for no names", async () => {
    const m = namingModels(() => ({ names: {} }));
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const code = Array.from({ length: NAMES_PART_LIMIT + 1 }, (_, i) => `export function f${String.fromCharCode(97 + i)}(x: number) { return x + ${i}; }`).join("\n");
    const p = await c.post("/paste", { code, language: "ts" });
    const n = await c.post("/paste/names", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 } });
    expect(n.json.ok).toBe(false);
    expect(n.json.reason).toMatch(/more than 8 parts/);
    expect(m.calls.some((x) => x.messages.some((y) => y.content.includes(NAME_TASK)))).toBe(false);
  });

  it("the example's names are kept: no model call", async () => {
    const m = namingModels(() => ({ names: {} }));
    const { app } = makeApp({ paste: { proposer: { chat: m.chat } } });
    const c = client(app);
    const p = await c.post("/paste", { code: U1_EXAMPLE, language: "ts" });
    const n = await c.post("/paste/names", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 } });
    expect(n.json).toMatchObject({ ok: true, names: EXAMPLE_NAMES });
    expect(m.calls.some((x) => x.messages.some((y) => y.content.includes(NAME_TASK)))).toBe(false);
  });

  it("no model on this server: a plain reason, and nothing else changes", async () => {
    const { app } = makeApp({ paste: {} });
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const n = await c.post("/paste/names", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 } });
    expect(n.json).toMatchObject({ ok: false, reason: "this server asks no Meta model" });
  });
});

describe("where natural names may appear", () => {
  const outline = fileOutline(U1_EXAMPLE, "ts");
  const model = benchModel({ fileName: "x", outline, test: null, source: U1_EXAMPLE, language: "ts" });
  const parts = machineParts({ ...model, tested: "fetchWithRetry" }, outline, U1_EXAMPLE, "ts");
  const named = { ...parts, housings: parts.housings.map((h) => ({ ...h, natural: EXAMPLE_NAMES[h.id]! })) };
  it("the shared picture (no name lines) is byte for byte the same with or without them", () => {
    expect(drawMachine(named, { seed: "p", ended: true }).svg).toBe(drawMachine(parts, { seed: "p", ended: true }).svg);
  });
  it("the person's screen marks them as Meta's AI's words", () => {
    const svg = drawMachine(named, { seed: "p", nameLines: true }).svg;
    expect(svg).toContain("named by Muse Wonder, Meta&#39;s AI".replace("&#39;", "'"));
    expect(svg).toContain("m-ai-mark");
  });
  it("the panel says whose words they are, then the exact name and the parser's facts", () => {
    const panel = partPanel(named, "fetchWithRetry")!;
    expect(panel.natural).toBe(`Meta's AI calls this: ${EXAMPLE_NAMES.fetchWithRetry} (its words, not a check)`);
    expect(panel.title).toBe("fetchWithRetry");
    expect(panel.says).toContain("Runs a loop (line 12).");
  });
  it("with no names, the panel says why, quietly", () => {
    expect(partPanel(parts, "sleep", { namesNote: "the model call failed" })!.note).toBe("Natural names unavailable: the model call failed");
  });
});
