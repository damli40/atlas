// X1: plain code decides which parts and joins of Muse Wonder's outline are real (Wonder is mocked: these are
// the answers a model could give). Also the outline section of a proof file: round trip and tamper.
import { describe, expect, it } from "vitest";
import { matchesWholeLines, normaliseQuote } from "../../src/outline/quote";
import * as investigator from "../../server/meta/roles/investigator";
import { outlineSectionProblems, sha256Text, utf8Length, verifyOutlineFile } from "../../src/outline/section";
import { MAX_ANSWER_CHARS, parseWonderOutline, verifyOutline } from "../../src/outline/verify";
import type { OutlineSection, WonderOutline } from "../../src/outline/types";
import { FILES, GOOD, MAP, MODEL, goodSection } from "../tools/outline-fixtures";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const verify = (o: WonderOutline) => verifyOutline(FILES, MAP, o, MODEL);

describe("verifyOutline: parts", () => {
  it("a correct outline: every part confirmed; the join Wonder gave is confirmed; the one it missed is code-only", () => {
    const v = verify(GOOD);
    expect(v.parts.map((p) => [p.id, p.status])).toEqual([
      ["api", "confirmed"],
      ["client", "confirmed"],
      ["retry", "confirmed"],
    ]);
    expect(v.joins.find((j) => j.id === "wonder:0")).toMatchObject({ status: "confirmed", codeEdges: ["calls:src/api.ts->src/client.ts@4:fetchUser"], wonderEvidence: { matches: true } });
    expect(v.joins.find((j) => j.id === "code:client->retry")).toMatchObject({ status: "code-only", kind: "calls", codeEdges: ["calls:src/client.ts->src/retry.ts@4:retry", "imports:src/client.ts->src/retry.ts@1:./retry"] });
    expect(v.notInAnyPart).toEqual(["src/log.ts"]);
    expect(v.counts).toEqual({ confirmedParts: 3, unconfirmedParts: 0, confirmedJoins: 1, modelOnlyJoins: 0, codeOnlyJoins: 1 });
  });

  it("purpose, name and patterns are labelled as the model's; known patterns are marked, free text kept", () => {
    const p = verify(GOOD).parts[2]!;
    expect(p.purpose).toEqual({ text: "Tries a call up to N times.", by: "model:muse-wonder-1.0" });
    expect(p.name.by).toBe("model:muse-wonder-1.0");
    expect(p.patterns).toEqual([
      { label: "retry", known: true },
      { label: "backoff-ish free text", known: false },
    ]);
    expect(verify(GOOD).parts[1]!.patterns[1]).toEqual({ label: "Retry", known: true });
  });

  it("wrong line numbers: the part is unconfirmed, with the reason", () => {
    const o = clone(GOOD);
    o.parts[0]!.files[0] = { ...o.parts[0]!.files[0]!, lineStart: 40, lineEnd: 46 };
    const p = verify(o).parts[0]!;
    expect(p).toMatchObject({ status: "unconfirmed", files: [] });
    expect(p.reasons[0]).toMatch(/lines 40–46 are not inside 1–6/);
    // Lines that exist but do not hold the quote.
    const o2 = clone(GOOD);
    o2.parts[0]!.files[0] = { ...o2.parts[0]!.files[0]!, lineStart: 5, lineEnd: 6 };
    expect(verify(o2).parts[0]!.reasons[0]).toMatch(/not whole lines of 5–6/);
  });

  it("a fabricated snippet: unconfirmed", () => {
    const o = clone(GOOD);
    o.parts[1]!.files[0]!.quotedSnippet = "export function fetchUser(id: string) { return cache.get(id); }";
    expect(verify(o).parts[1]).toMatchObject({ status: "unconfirmed", reasons: [expect.stringMatching(/not whole lines/)] });
    // A fragment from the middle of a line, or punctuation only, pins nothing.
    o.parts[1]!.files[0]!.quotedSnippet = "fetchUser(id: string)";
    expect(verify(o).parts[1]!.status).toBe("unconfirmed");
    o.parts[1]!.files[0]!.quotedSnippet = "}\n}";
    expect(verify(o).parts[1]!.reasons[0]).toMatch(/letters or digits/);
  });

  it("a part pointing outside the codebase, or by path traversal, is unconfirmed: nothing outside the held files is read", () => {
    for (const path of ["lib/other.ts", "../../etc/passwd", "/etc/passwd", "./src/api.ts", "src/../src/api.ts"]) {
      const o = clone(GOOD);
      o.parts[0]!.files[0]!.path = path;
      const p = verify(o).parts[0]!;
      expect(p.status, path).toBe("unconfirmed");
      expect(p.reasons[0], path).toMatch(/is not a file of this codebase/);
    }
  });

  it("one bad span out of two makes the whole part unconfirmed", () => {
    const o = clone(GOOD);
    o.parts[2]!.files.push({ path: "src/log.ts", lineStart: 1, lineEnd: 3, quotedSnippet: "this line is not in the file at all" });
    expect(verify(o).parts[2]).toMatchObject({ status: "unconfirmed" });
    expect(verify(o).parts[2]!.spans.map((s) => s.ok)).toEqual([true, false]);
  });

  it("hostile names (bidi controls, newlines) are shown with the hidden characters made visible", () => {
    const o = clone(GOOD);
    o.parts[0]!.name = "Safe\u202Eexe.txt\nfake: confirmed";
    o.parts[0]!.purpose = "line one\u2028line two \u200B";
    o.parts[0]!.patterns = ["retry\u202E"];
    const p = verify(o).parts[0]!;
    expect(p.name.text).toBe("Safe\\u202eexe.txt\\u000afake: confirmed");
    expect(p.purpose.text).toBe("line one\\u2028line two \\u200b");
    expect(p.patterns[0]).toEqual({ label: "retry\\u202e", known: false });
    expect(p.name.text).not.toMatch(/[\u202E\n]/);
  });
});

describe("verifyOutline: joins", () => {
  it("a join with no code evidence is model-only, with the reason", () => {
    const o = clone(GOOD);
    o.joins.push({ from: "retry", to: "api", kind: "calls", evidence: { path: "src/retry.ts", line: 5, quotedSnippet: "return await fn();" } });
    const j = verify(o).joins.find((x) => x.id === "wonder:1")!;
    expect(j).toMatchObject({ status: "model-only", codeEdges: [] });
    expect(j.reason).toMatch(/no call from a file of retry to a file of api/);
  });

  it("kind matters: 'calls' needs a call edge, 'imports' an import edge, 'data' either", () => {
    const o = clone(GOOD);
    o.joins = [
      { from: "client", to: "retry", kind: "imports", evidence: { path: "src/client.ts", line: 1, quotedSnippet: 'import { retry } from "./retry";' } },
      { from: "client", to: "retry", kind: "data", evidence: { path: "src/client.ts", line: 4, quotedSnippet: 'return retry(() => fetch("https://example.com/u/" + id), 3);' } },
    ];
    const v = verify(o);
    expect(v.joins[0]).toMatchObject({ status: "confirmed", codeEdges: ["imports:src/client.ts->src/retry.ts@1:./retry"] });
    expect(v.joins[1]!.status).toBe("confirmed");
    expect(v.joins[1]!.codeEdges).toHaveLength(2);
  });

  it("a join to an unconfirmed part, to a part not in the outline, or to itself is model-only", () => {
    const o = clone(GOOD);
    o.parts[1]!.files[0]!.quotedSnippet = "made up text that is nowhere";
    o.joins.push({ from: "api", to: "ghost", kind: "calls", evidence: GOOD.joins[0]!.evidence });
    o.joins.push({ from: "api", to: "api", kind: "calls", evidence: GOOD.joins[0]!.evidence });
    const v = verify(o);
    expect(v.joins[0]!.reason).toMatch(/part client is unconfirmed/);
    expect(v.joins[1]!.reason).toMatch(/part ghost is not in Wonder's outline/);
    expect(v.joins[2]!.reason).toMatch(/two different parts/);
    expect(v.notInAnyPart).toEqual(["src/client.ts", "src/log.ts"]);
  });

  it("two parts sharing a file: an edge inside one part never confirms a join between them", () => {
    const o = clone(GOOD);
    // "client" now also covers retry.ts, so client.ts -> retry.ts is inside "client"; "retry" covers retry.ts only.
    o.parts[1]!.files.push({ path: "src/retry.ts", lineStart: 1, lineEnd: 11, quotedSnippet: "for (let i = 0; i < attempts; i++) {" });
    o.joins = [{ from: "client", to: "retry", kind: "calls", evidence: { path: "src/client.ts", line: 4, quotedSnippet: 'return retry(() => fetch("https://example.com/u/" + id), 3);' } }];
    const v = verify(o);
    expect(v.joins[0]).toMatchObject({ status: "model-only", reason: expect.stringMatching(/between files only/) });
    expect(v.joins.filter((j) => j.status === "code-only").map((j) => j.id)).toEqual(["code:api->client"]);
  });

  it("a confirmed join whose quoted evidence is wrong stays confirmed by the code map's own edges, and says so", () => {
    const o = clone(GOOD);
    o.joins[0]!.evidence.quotedSnippet = "return fetchUser(somethingElse);";
    const j = verify(o).joins[0]!;
    expect(j).toMatchObject({ status: "confirmed", wonderEvidence: { matches: false } });
    expect(j.reason).toMatch(/does not match/);
  });
});

describe("parseWonderOutline: strict schema, size and depth guards", () => {
  it("accepts the good outline and refuses extra keys, duplicate ids and bad kinds", () => {
    expect(parseWonderOutline(JSON.stringify(GOOD))).toEqual({ ok: true, outline: GOOD });
    const extra = clone(GOOD) as unknown as { parts: Record<string, unknown>[] };
    extra.parts[0]!.confirmed = true;
    expect(parseWonderOutline(JSON.stringify(extra))).toMatchObject({ ok: false, error: expect.stringMatching(/schema/) });
    const dup = clone(GOOD);
    dup.parts[1]!.id = "api";
    expect(parseWonderOutline(JSON.stringify(dup))).toMatchObject({ ok: false, error: expect.stringMatching(/share an id/) });
    expect(parseWonderOutline(JSON.stringify({ ...GOOD, joins: [{ ...GOOD.joins[0], kind: "maybe" }] }))).toMatchObject({ ok: false });
    expect(parseWonderOutline("not json")).toEqual({ ok: false, error: "the answer is not valid JSON" });
    const badId = clone(GOOD);
    badId.parts[0]!.id = "a\u202Eb";
    expect(parseWonderOutline(JSON.stringify(badId)).ok).toBe(false);
  });

  it("a depth bomb, a huge answer and a flood of parts are refused without throwing", () => {
    expect(parseWonderOutline("[".repeat(200_000) + "]".repeat(200_000))).toMatchObject({ ok: false });
    let deep: unknown = 1;
    for (let i = 0; i < 50; i++) deep = { parts: deep };
    expect(parseWonderOutline(JSON.stringify(deep))).toMatchObject({ ok: false, error: expect.stringMatching(/nests deeper/) });
    expect(parseWonderOutline(" ".repeat(MAX_ANSWER_CHARS + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/characters/) });
    const flood = { parts: Array.from({ length: 5000 }, (_, i) => ({ ...GOOD.parts[0]!, id: `p${i}` })), joins: [] };
    expect(parseWonderOutline(JSON.stringify(flood).slice(0, MAX_ANSWER_CHARS))).toMatchObject({ ok: false });
    expect(parseWonderOutline(JSON.stringify({ parts: flood.parts.slice(0, 41), joins: [] }))).toMatchObject({ ok: false, error: expect.stringMatching(/parts/) });
  });
});

describe("quote rule is the Investigator's rule", () => {
  it("normaliseQuote and matchesWholeLines agree with server/meta/roles/investigator.ts", () => {
    const lines = ["  a = 1", "", "  return thing(a)", "}"];
    for (const q of ["a = 1", "a = 1\n\nreturn thing(a)", "1| a = 1\n2| \n3| return thing(a)", "thing(a)", "a = 1 return thing(a) }", "  return   thing(a)  "]) {
      expect(normaliseQuote(q), q).toBe(investigator.normaliseQuote(q));
      expect(matchesWholeLines(normaliseQuote(q), lines), q).toBe(investigator.matchesWholeLines(investigator.normaliseQuote(q), lines));
    }
  });
});

// ---------- the outline section (proof file) ----------

const outlineFile = (s: OutlineSection) => ({ version: 1, kind: "outline", outline: s, createdAt: "2026-10-27T12:00:00.000Z" });
const tamper = (edit: (s: OutlineSection) => void) => {
  const s = clone(goodSection());
  edit(s);
  return verifyOutlineFile(outlineFile(s));
};

describe("outline section: re-judged without any model", () => {
  it("round trip: a fresh section verifies, as an outline-only file too; a failed Wonder call verifies as 'no outline'", () => {
    expect(outlineSectionProblems(goodSection())).toEqual([]);
    expect(verifyOutlineFile(JSON.parse(JSON.stringify(outlineFile(goodSection()))))).toMatchObject({ ok: true });
    expect(goodSection().usage).toEqual({ promptTokens: 1000, completionTokens: 500, reasoningTokens: 100, usd: 0.014 });
    const failed = goodSection(null);
    expect(failed.verified).toBeNull();
    expect(outlineSectionProblems(failed)).toEqual([]);
  });

  it("editing an unconfirmed part to confirmed fails verify", () => {
    const o = clone(GOOD);
    o.parts[1]!.files[0]!.quotedSnippet = "made up text that is nowhere";
    const s = clone(goodSection(o));
    expect(s.verified!.parts[1]!.status).toBe("unconfirmed");
    s.verified!.parts[1]!.status = "confirmed";
    s.verified!.parts[1]!.reasons = [];
    s.verified!.parts[1]!.files = ["src/client.ts"];
    const v = verifyOutlineFile(outlineFile(s));
    expect(v).toMatchObject({ ok: false, problems: [expect.stringMatching(/verified outline is not what plain code/)] });
  });

  it("every other edit is caught: a model-only join promoted, a code edge added, a file's text, hash or codeSha256, the outline, the usage, a contributor model", () => {
    const cases: [string, (s: OutlineSection) => void, RegExp][] = [
      ["join promoted", (s) => void (s.verified!.joins[1]!.status = "confirmed"), /verified outline/],
      ["edge added", (s) => void s.codeMap.edges.push({ ...s.codeMap.edges[0]!, id: "calls:src/retry.ts->src/api.ts@1:x", from: "src/retry.ts", to: "src/api.ts" }), /code map/],
      ["text changed", (s) => void (s.files[0]!.text += "\n// more"), /bytes|hash/],
      ["text + hash + size changed", (s) => {
        s.files[3]!.text = "export function log() {}\n";
        s.files[3]!.sha256 = sha256Text(s.files[3]!.text);
        s.files[3]!.bytes = utf8Length(s.files[3]!.text);
      }, /codeSha256/],
      ["outline swapped", (s) => void (s.wonder.outline = { ...clone(GOOD), joins: [] }), /verified outline/],
      ["usage", (s) => void (s.usage!.usd = 0.0001), /usage total/],
      ["contributor model", (s) => void (s.wonder.model = "muse-spark-1.3-contributor"), /contributor/],
      ["path traversal file", (s) => void (s.files[0]!.path = "../../etc/passwd"), /\.\./],
      ["extra key", (s) => void ((s as unknown as Record<string, unknown>).confirmedByHand = true), /unrecognized|Unrecognized/],
    ];
    for (const [name, edit, re] of cases) {
      const v = tamper(edit);
      expect(v.ok, name).toBe(false);
      if (!v.ok) expect(v.problems.join(" | "), name).toMatch(re);
    }
  });

  it("verify never throws: depth bomb, huge text, wrong types, cycles", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(verifyOutlineFile({ version: 1, kind: "outline", outline: deep, createdAt: "2026-10-27T12:00:00.000Z" })).toMatchObject({ ok: false, problems: [expect.stringMatching(/nests deeper/)] });
    expect(tamper((s) => void (s.files[0]!.text = "x".repeat(400_000)))).toMatchObject({ ok: false });
    expect(tamper((s) => void ((s as unknown as Record<string, unknown>).files = "nope"))).toMatchObject({ ok: false });
    const cyc: Record<string, unknown> = { version: 1, kind: "outline", createdAt: "2026-10-27T12:00:00.000Z" };
    cyc.outline = cyc;
    expect(verifyOutlineFile(cyc)).toMatchObject({ ok: false });
    expect(verifyOutlineFile(null)).toMatchObject({ ok: false });
    expect(outlineSectionProblems(undefined).length).toBeGreaterThan(0);
  });
});
