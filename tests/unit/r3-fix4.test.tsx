// R3 fix round 4: review round 4 and the second cold test. Each of these failed before its fix. The screen paths are in tests/evidence/R3/round4.mjs.
import { mkdtempSync, readFileSync } from "node:fs";
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
import { labelMarkWords } from "../../web/screens/Studio";
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
    const hdr = (code: string) => ({ "content-type": "application/json", "x-atlas-session": s, "x-atlas-invite": code });
    await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr(codes.a), body: "{}" });
    await app.request(`/proofs/${id}/keep`, { method: "DELETE", headers: hdr(codes.a) });
    expect((await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr(codes.b), body: "{}" })).status).toBe(410);
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
    expect(await view({ "x-atlas-session": s })).toEqual({ yours: true, keepsCards: true });
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
    expect(renderToStaticMarkup(<ProofCard file={changed} />)).toMatch(/YOU BET, ON [A-Z ]+/);
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
