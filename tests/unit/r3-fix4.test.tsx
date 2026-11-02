// R3 fix round 4: review round 4 and the second cold test. Each of these failed before its fix. The screen paths are in tests/evidence/R3/round4.mjs.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { withInviteGate } from "../../server/access/gate";
import { openInviteStore } from "../../server/access/store";
import { createApp } from "../../server/app";
import { momentOfRows, reachNote } from "../../src/moment";
import { theoryCaption } from "../../src/change";
import type { AtlasFile } from "../../src/types";
import { ProofCard } from "../../web/screens/ProofCard";
import { answersToSend, labelMarkWords, requiredArgs, whatDiffers } from "../../web/screens/Studio";
import { loadDotEnv } from "../../server/load-env";
import { marksOf } from "../../web/machines/bench/play";
import { CHANGE_CAPTION, CHANGE_CAPTION_READER } from "../../src/change";

const ENV = { ATLAS_INVITE_PEPPER: "x".repeat(64), ATLAS_INVITE_SECRET: "x".repeat(64) } as never;
const gated = (dir: string) => {
  const store = openInviteStore(mkdtempSync(join(tmpdir(), "inv-")), { env: ENV });
  const a = (store.create({ label: "a", dailyUsd: 3 }) as unknown as { code: string }).code;
  const b = (store.create({ label: "b", dailyUsd: 3 }) as unknown as { code: string }).code;
  return { codes: { a, b }, app: withInviteGate(createApp({ keptProofsDir: dir }), { store, require: true, secureCookie: false }) };
};
const round = async (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, session: string, code: string) => {
  const headers = { "content-type": "application/json", "x-atlas-session": session, "x-atlas-invite": code };
  const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers, body: JSON.stringify(body) })).json() as Promise<Record<string, never>>;
  const p = await post("/paste", { code: "export function f(a){\n  return a + 1;\n}\n", language: "js" });
  const target = { ref: (p.target as { ref: string }).ref, codeSha256: (p.target as { codeSha256: string }).codeSha256 };
  const e = await post("/experiments", { target, params: { shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }, quiz: true });
  const qs = e.questions as { measures: string }[];
  await post("/bets", { experimentId: (e.experiment as { id: string }).id, who: "human", bets: qs.map((q) => ({ measures: q.measures, answer: { kind: "declined", reason: "can't tell" } })) });
  return ((await post("/runs", { experimentId: (e.experiment as { id: string }).id })).run as { id: string }).id;
};

describe("R1: deleting a public link takes it down", () => {
  it("logged out the card answers gone at once, in memory and after a restart; its own session still reads its round", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const { app, codes } = gated(dir);
    const s = "ssdeletedeletedele1";
    const id = await round(app, s, codes.a);
    const hdr = { "content-type": "application/json", "x-atlas-session": s, "x-atlas-invite": codes.a };
    await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr, body: "{}" });
    expect((await app.request(`/proofs/${id}`)).status).toBe(200);
    expect((await app.request(`/proofs/${id}/keep`, { method: "DELETE", headers: hdr })).status).toBe(200);
    const gone = await app.request(`/proofs/${id}`);
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as { error: string }).error).toMatch(/deleted/);
    expect((await app.request(`/proofs/${id}`, { headers: { "x-atlas-session": s } })).status).toBe(200);
    expect((await gated(dir).app.request(`/proofs/${id}`)).status).toBe(410);
  }, 60_000);
  it("nobody but its maker can bring a deleted link back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const { app, codes } = gated(dir);
    const s = "ssdeletedeletedele2";
    const id = await round(app, s, codes.a);
    const hdr = (code: string, session = s) => ({ "content-type": "application/json", "x-atlas-session": session, "x-atlas-invite": code });
    await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr(codes.a), body: "{}" });
    await app.request(`/proofs/${id}/keep`, { method: "DELETE", headers: hdr(codes.a) });
    expect((await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr(codes.b, "ssotherotherother02"), body: "{}" })).status).toBe(410);
    expect((await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr(codes.a), body: "{}" })).status).toBe(200);
    expect((await app.request(`/proofs/${id}`)).status).toBe(200);
  }, 60_000);
});

describe("J3, J4: who is looking", () => {
  it("the viewer route says yours only for the session that bet, or the maker; the card file itself stays clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const { app, codes } = gated(dir);
    const s = "ssviewerviewerview1";
    const id = await round(app, s, codes.a);
    const view = async (h: Record<string, string>) => (await (await app.request(`/proofs/${id}/viewer`, { headers: h })).json()) as { yours: boolean; keepsCards: boolean };
    expect(await view({ "x-atlas-session": s })).toEqual({ yours: true, keepsCards: true, canKeep: true });
    expect((await view({ "x-atlas-session": "ssotherotherother01" })).yours).toBe(false);
    expect((await view({})).yours).toBe(false);
    const f = (await (await app.request(`/proofs/${id}`)).json()) as Record<string, unknown>;
    expect(f.yours).toBeUndefined();
  }, 60_000);
  it("C3: a server with no volume says it keeps no cards", async () => {
    const app = createApp({});
    expect(((await (await app.request("/proofs/none/viewer")).json()) as { keepsCards: boolean }).keepsCards).toBe(false);
  });
});

const d20 = JSON.parse(readFileSync(new URL("../evidence/D20/d20.atlas.json", import.meta.url), "utf8")) as AtlasFile;

describe("the proof card for someone who did not bet", () => {
  const changed = d20;
  it("J3: a logged-out reader has no Re-run, no pencil and no Delete", () => {
    const html = renderToStaticMarkup(<ProofCard file={changed} api={{ pencil: async () => ({ words: "" }) } as never} stranger reader />);
    expect(html).not.toContain('data-testid="pc-rerun"');
    expect(html).not.toContain('data-testid="pc-pencil"');
    expect(html).not.toContain('data-testid="pc-delete-link"');
    expect(html).toContain('data-testid="pc-copy-link"');
  });
  it("J4: a stranger's image and caption never say 'you'", () => {
    const html = renderToStaticMarkup(<ProofCard file={changed} stranger />);
    expect(html).toContain("the bet was");
    expect(html).not.toMatch(/aria-label="[^"]*you bet/);
    expect(html).toContain(CHANGE_CAPTION_READER);
    expect(html).not.toContain(CHANGE_CAPTION);
    expect(html).not.toMatch(/<td class="pc-who">You</);
    expect(renderToStaticMarkup(<ProofCard file={changed} />)).toMatch(/aria-label="[^"]*you bet/);
  });
  it("R2: the image says which question its bet answers", () => {
    expect(renderToStaticMarkup(<ProofCard file={changed} />)).toMatch(/YOU BET<tspan[^>]*> on cbETH in dollars</);
  });
});

describe("J2: D20's sentence on the image", () => {
  it("wraps whole: nothing of it is cut", () => {
    const html = renderToStaticMarkup(<ProofCard file={d20} />);
    const name = d20.change!.directWired![0]!.oracleName;
    const lines = [...html.matchAll(/data-testid="pc-image-change"[^>]*>([^<]*)</g)].map((m) => m[1]!).join(" ");
    expect(lines).toContain(theoryCaption(name));
    expect(lines).not.toContain("…");
    expect([...html.matchAll(/data-testid="pc-image-change"/g)].length).toBeGreaterThan(1);
  });
});

describe("R2 on real rows: a miss on the ending leads, never the matched count", () => {
  const threw = { trace: [{ t: 0, event: "start" }], controlPassed: true, result: { measured: { outcome: "threw", thrownName: "Error", thrownMessage: "HTTP 429", "calls:x": 2, virtualMs: 0 }, notMeasured: {} } } as never;
  it("the retry shape", () => {
    const row = (measures: string, question: string, said: string, outcome: "matched" | "not_matched") => ({ who: "human", name: "You", measures, question, said, observed: "o", outcome });
    const m = momentOfRows([row("calls:x", "calls to x", "2 or more times", "matched"), row("virtualMs", "how long", "0 ms", "matched"), row("outcome", "how it ends", "returns a value", "not_matched")], threw)!;
    expect(m).toMatchObject({ kind: "not_matched", question: "how it ends", you: "returns a value" });
    expect(m.run).toMatch(/^threw Error: HTTP 429, after 2 calls to x/);
  });
});

describe("C1: plain code says when a claim test may not reach the sentence", () => {
  const run = (measured: Record<string, unknown>, notMeasured = {}) => ({ trace: [], result: { measured, notMeasured } }) as never;
  it("the same ending and no call to the fakes", () => {
    expect(reachNote(run({ outcome: "threw", thrownName: "Error", thrownMessage: "no key", "calls:fetch": 0 }), "threw Error: no key")).toBe("This test ended the same way as the last one and made 0 calls to fetch. It may not reach what the sentence is about.");
  });
  it("each alone, and neither", () => {
    expect(reachNote(run({ outcome: "returned", returnedJson: "1", "calls:fetch": 0 }), "threw x")).toBe("This test made 0 calls to fetch. It may not reach what the sentence is about.");
    expect(reachNote(run({ outcome: "returned", returnedJson: "1", "calls:fetch": 2 }), "returned 1")).toBe("This test ended the same way as the last one. It may not reach what the sentence is about.");
    expect(reachNote(run({ outcome: "returned", returnedJson: "1", "calls:fetch": 2 }), "threw x")).toBeNull();
  });
  it("a count not measured is not said to be zero", () => {
    expect(reachNote(run({ outcome: "returned", returnedJson: "1", "calls:fetch": 0 }, { "calls:y": "differed" }), "threw x")).toBeNull();
  });
});

describe("C2: a label is what could fail, not what the code has", () => {
  it("reads as a failure the code could have", () => {
    expect(labelMarkWords("found in this code", "timeout", "line 13")).toBe("could fail: timeout, line 13 (read, not run)");
    expect(labelMarkWords("reproduced", "timeout", "line 13")).toBe("reproduced: timeout, line 13");
  });
});

describe("a person's own test", () => {
  it("D: what a function needs, from its signature", () => {
    expect(requiredArgs("getTemperature(city: string)")).toEqual(["city"]);
    expect(requiredArgs("f(a, b = 2, ...rest)")).toEqual(["a"]);
    expect(requiredArgs("f(a?: number)")).toEqual([]);
    expect(requiredArgs("f()")).toEqual([]);
    expect(requiredArgs("def f(self, x, y=1, *args)")).toEqual(["x"]);
    expect(requiredArgs("f(m: Map<string, number>, cb: (a: number) => void)")).toEqual(["m", "cb"]);
    expect(requiredArgs(undefined)).toBeNull();
  });
  it("D: two tests are told apart by their values, never the test's internal words", () => {
    const t = (then: string, value: number) => ({ args: [{ kind: "stand-in", name: "x", then, calls: [{ do: "return", value }] }] });
    expect(whatDiffers(t("throw_exhausted", 1), t("repeat_last", 1))).toBe("Differs from the last test in what its fakes do.");
    expect(whatDiffers(t("throw_exhausted", 2), t("repeat_last", 1))).toBe("This test has 2 where the last test has 1.");
  });
});

describe("E: the proof card says what the function was given", () => {
  it("on the card and on the image, and links back quietly", () => {
    const f = structuredClone(d20) as AtlasFile;
    f.experiments[0]!.params = { shape: "call-function", exportName: "f", args: [{ kind: "json", value: 7 }] } as never;
    const html = renderToStaticMarkup(<ProofCard file={f} />);
    expect(html).toContain('data-testid="pc-call"');
    expect(html).toMatch(/data-testid="pc-image-call"[^>]*>Atlas calls f\(7\)\./);
    expect(html).toContain('data-testid="pc-home"');
  });
});

describe("B1: the chain connection", () => {
  it("a server with no setting says so at once, with nothing spent", async () => {
    const was = process.env.BASE_RPC_URL;
    delete process.env.BASE_RPC_URL;
    const app = createApp({ checkChainFirst: true });
    const a = (await (await app.request("/moonwell/ready")).json()) as { ready: boolean; words?: string };
    expect(a.ready).toBe(false);
    expect(a.words).toMatch(/no chain connection/);
    expect(a.words).not.toMatch(/stays above/);
    if (was !== undefined) process.env.BASE_RPC_URL = was;
  });
  it("a setting that doesn't answer is not a connection", async () => {
    const was = process.env.BASE_RPC_URL;
    process.env.BASE_RPC_URL = "http://127.0.0.1:9/nothing";
    const app = createApp({ checkChainFirst: true });
    const a = (await (await app.request("/moonwell/ready")).json()) as { ready: boolean; words?: string };
    expect(a.ready).toBe(false);
    expect(a.words).toMatch(/did not answer/);
    expect(JSON.stringify(a)).not.toContain("127.0.0.1");
    if (was !== undefined) process.env.BASE_RPC_URL = was;
    else delete process.env.BASE_RPC_URL;
  });
  it("the rpc file is read by name only, and a value already set wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "rpc-"));
    const at = join(dir, "rpc.env");
    writeFileSync(at, "BASE_RPC_URL=https://example.test/key\n");
    const env: Record<string, string | undefined> = {};
    expect(loadDotEnv(at, env).loaded).toEqual(["BASE_RPC_URL"]);
    expect(env.BASE_RPC_URL).toBe("https://example.test/key");
    const set: Record<string, string | undefined> = { BASE_RPC_URL: "x" };
    loadDotEnv(at, set);
    expect(set.BASE_RPC_URL).toBe("x");
  });
});

describe("E: a model answers, only a person types", () => {
  it("a model's value on the result reads 'answered'", () => {
    const q = { measures: "returnedJson", text: "q", kind: "quiz", quiz: [{ id: "a", label: "x" }] };
    const run = { id: "r", controlPassed: true, trace: [], result: { measured: { outcome: "returned", returnedJson: "1" }, notMeasured: {} } };
    const bet = (who: string) => ({ id: who, who, measures: "returnedJson", answer: { kind: "json", value: 1 } });
    const marks = marksOf([q] as never, [bet("human"), bet("muse-spark-1.3")] as never, [{ betId: "human", outcome: "matched" }, { betId: "muse-spark-1.3", outcome: "matched" }] as never, run as never, null, "js");
    const picks = marks[0]!.picks;
    expect(picks.find((p) => p.who === "human")!.pick).toMatch(/^typed /);
    expect(picks.find((p) => p.who !== "human")!.pick).toMatch(/^answered /);
  });
});

describe("round 5, S1: a typed null is a value", () => {
  const qs = [{ measures: "returnedJson", text: "q", kind: "quiz", allowsTyped: true, quiz: [] }] as never;
  const sealed = (typed: string, lang: "js" | "py") => answersToSend(qs, {}, { returnedJson: typed }, lang).answers[0]!.answer;
  it("null and None seal as null, the same as a model's null (D19)", () => {
    expect(sealed("null", "js")).toEqual({ kind: "json", value: null });
    expect(sealed("None", "py")).toEqual({ kind: "json", value: null });
  });
  it("the text null, in quotes, stays text; an unquoted word stays text", () => {
    expect(sealed('"null"', "js")).toEqual({ kind: "json", value: "null" });
    expect(sealed("hello", "js")).toEqual({ kind: "json", value: "hello" });
  });
});

describe("round 5, S2: making a link never makes someone the bettor", () => {
  const code2 = (dir: string) => gated(dir);
  it("someone who did not run a non-pasted or pasted round can't keep it, and is never told it is theirs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const { app, codes } = code2(dir);
    const a = "ssrunnerrunnerrunn1";
    const id = await round(app, a, codes.a);
    const other = { "content-type": "application/json", "x-atlas-session": "ssreaderreaderread1", "x-atlas-invite": codes.b };
    expect((await app.request(`/proofs/${id}/keep`, { method: "POST", headers: other, body: "{}" })).status).toBe(403);
    const v = (await (await app.request(`/proofs/${id}/viewer`, { headers: other })).json()) as { yours: boolean; canKeep: boolean };
    expect(v).toMatchObject({ yours: false, canKeep: false });
    expect((await app.request(`/proofs/${id}/keep`, { method: "DELETE", headers: other })).status).toBe(404);
  }, 60_000);
  it("the runner keeps and deletes, reads their own round after, and makes the link again; the same invite on another session is not the bettor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const { app, codes } = code2(dir);
    const a = "ssrunnerrunnerrunn2";
    const id = await round(app, a, codes.a);
    const mine = { "content-type": "application/json", "x-atlas-session": a, "x-atlas-invite": codes.a };
    expect((await app.request(`/proofs/${id}/keep`, { method: "POST", headers: mine, body: "{}" })).status).toBe(200);
    const sameCode = { "x-atlas-session": "ssothersessionxxxx1", "x-atlas-invite": codes.a };
    expect(((await (await app.request(`/proofs/${id}/viewer`, { headers: sameCode })).json()) as { yours: boolean }).yours).toBe(false);
    expect((await app.request(`/proofs/${id}/keep`, { method: "DELETE", headers: mine })).status).toBe(200);
    expect((await app.request(`/proofs/${id}`, { headers: { "x-atlas-session": a } })).status).toBe(200);
    expect((await app.request(`/proofs/${id}/keep`, { method: "POST", headers: mine, body: "{}" })).status).toBe(200);
  }, 60_000);
  it("a reader's Copy link offers no public link", () => {
    const html = renderToStaticMarkup(<ProofCard file={d20} canKeep={false} />);
    expect(html).toContain('data-testid="pc-copy-link"');
    expect(html).not.toContain('data-testid="pc-link-ask"');
  });
});
