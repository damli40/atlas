// R3 fix round 3: review round 3 and the cold test. Each of these failed before its fix.
import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { withInviteGate } from "../../server/access/gate";
import { openInviteStore } from "../../server/access/store";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { gate } from "../../src/gate";
import { endingFacts, momentOf, runEnding, type MomentMark } from "../../src/moment";
import { makePastedTarget } from "../../src/pasted-code";
import { whatHappened } from "../../renderer/authors/what-happened";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner";
import { longValues } from "../../web/screens/Studio";

let ctl: Awaited<ReturnType<typeof runCallControl>>["run"];
let pyctl: Awaited<ReturnType<typeof runPyCallControl>>["run"];
beforeAll(async () => {
  ctl = (await runCallControl()).run;
  pyctl = (await runPyCallControl()).run;
}, 120_000);
const si = (name: string, calls: unknown[]) => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls });
const real = async (lang: "js" | "py", src: string, p: Record<string, unknown>) => {
  const g = gate({ shape: "call-function", ...p }, { exportNames: [p.exportName as string] });
  if (!g.allowed) throw new Error(g.reason);
  const e = { id: "e1", target: makePastedTarget(src, lang), runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } } as never;
  return { experiment: e as { params: never }, run: lang === "py" ? await runPyCallExperiment(e, pyctl) : await runCallExperiment(e, ctl) };
};

describe("the moment's words come from structured facts", () => {
  it("B2: a function with no return returned nothing", async () => {
    expect(runEnding((await real("js", "export function f(){ const a = 1; }\n", { exportName: "f", args: [] })).run)).toBe("returned nothing");
  });
  it("B2: thrown values say what they are", async () => {
    expect(runEnding((await real("js", 'export function f(){ throw "plain"; }\n', { exportName: "f", args: [] })).run)).toMatch(/threw a(n)? .*string.*not an Error|threw .*plain/);
    expect(runEnding((await real("js", "export function f(){ throw undefined; }\n", { exportName: "f", args: [] })).run)).toBe("threw undefined (not an Error)");
  });
  it("B3: a value holding ', after' stays whole", async () => {
    const { run } = await real("js", 'export async function f(x){ await x(); return "a, after b"; }\n', { exportName: "f", args: [si("x", [{ do: "return", value: 1 }])] });
    const m = momentOf([{ measures: "outcome", question: "q", measured: "m", picks: [{ who: "human", name: "You", pick: "throws", outcome: "not_matched" }] }], run)!;
    expect(m.run).toBe('returned "a, after b", after 1 call to x');
  });
  it("B4: a count not measured means no 'after' clause", () => {
    const run = { trace: [], controlPassed: true, result: { measured: { outcome: "returned", returnedJson: "1", "calls:y": 1 }, notMeasured: { "calls:x": "the two runs differed" } } } as never;
    expect(endingFacts(run)!.after).toBe("");
    expect(runEnding(run)).toBe("returned 1");
  });
  it("M1: hidden characters are shown as escapes in the largest words", async () => {
    const { run } = await real("js", 'export function f(){ return "payment \\u202edeliaf"; }\n', { exportName: "f", args: [] });
    expect(runEnding(run)).not.toContain("‮");
  });
  it("minor: Python's moment writes Python", async () => {
    expect(runEnding((await real("py", "def f():\n    return None\n", { exportName: "f", args: [] })).run, "py")).toMatch(/returned (None|nothing)/);
    expect(runEnding((await real("py", "def f():\n    return True\n", { exportName: "f", args: [] })).run, "py")).toBe("returned True");
  });
});

describe("D64: which question leads", () => {
  const run = { trace: [{ t: 0, event: "start" }], controlPassed: true, result: { measured: { outcome: "returned", returnedJson: "5549", "calls:x": 2, virtualMs: 100 }, notMeasured: {} } } as never;
  const mark = (measures: string, outcome: "matched" | "not_matched" | "cant_check", pick = "p"): MomentMark => ({ measures, question: measures, measured: "m", picks: [{ who: "human", name: "You", pick, outcome }] });
  it("a missed ending, then a missed value, then a matched value, then a matched ending", () => {
    expect(momentOf([mark("returnedJson", "matched", "typed 5549"), mark("outcome", "not_matched")], run)!.measures).toBe("outcome");
    expect(momentOf([mark("outcome", "matched"), mark("returnedJson", "not_matched")], run)!.measures).toBe("returnedJson");
    expect(momentOf([mark("outcome", "matched"), mark("returnedJson", "matched")], run)!.measures).toBe("returnedJson");
  });
  it("never a count or a time: with only those answered, the run's ending stands alone", () => {
    expect(momentOf([mark("outcome", "not_matched"), mark("virtualMs", "matched")], run)!.measures).toBe("outcome");
    expect(momentOf([mark("outcome", "matched"), mark("calls:x", "matched")], run)!.measures).toBe("outcome");
    expect(momentOf([mark("calls:a", "matched"), mark("calls:x", "not_matched")], run)).toMatchObject({ kind: "ending", measures: null, you: null });
    expect(momentOf([mark("returnedJson", "cant_check"), mark("outcome", "matched")], run)!.measures).toBe("outcome");
  });
});

describe("the drawing's words about waits", () => {
  it("cold test: a folded ticket never gives a range that leaves a wait out", async () => {
    const src = `const wait = (ms) => new Promise((r) => setTimeout(r, ms));\nexport async function a(x, y){\n for (const ms of [100, 200, 400, 800]) { await x(); await y(); await wait(ms); }\n return 1;\n}\n`;
    const { run, experiment } = await real("js", src, { exportName: "a", args: [si("x", [{ do: "return", value: 1 }]), si("y", [{ do: "return", value: 1 }])] });
    const words = whatHappened({ run, experiment: experiment as never }).edges.map((e) => e.words ?? "").join(" | ");
    expect(words).not.toMatch(/100 to 200|100 to 400/);
    expect(words).toMatch(/100, 200, 400/);
  });
});

describe("show the whole test", () => {
  it("cold test: a value the sentence cuts is given whole", () => {
    const long = "route-".repeat(30);
    expect(longValues({ args: [{ kind: "json", value: long }] }, "js")[0]).toContain(long);
    expect(longValues({ network: { calls: [{ do: "respond", status: 200, body: { a: long } }] } }, "js")[0]).toContain(long);
    expect(longValues({ args: [{ kind: "json", value: "short" }] }, "js")).toEqual([]);
  });
});

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

describe("public links, behind the real gate", () => {
  it("B1: the page's own request keeps the card, and it opens logged out after a restart, with its expiry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const { app, codes } = gated(dir);
    const id = await round(app, "ssmakermakermaker1", codes.a);
    const r = await app.request(`/proofs/${id}/keep`, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "ssmakermakermaker1", "x-atlas-invite": codes.a }, body: "{}" });
    expect(r.status).toBe(200);
    const kept = (await r.json()) as { kept: boolean; until: string };
    expect(kept.kept).toBe(true);
    const days = (Date.parse(kept.until) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const fresh = gated(dir);
    const open = await fresh.app.request(`/proofs/${id}`);
    expect(open.status).toBe(200);
    expect(((await open.json()) as { keptCard?: { until: string } }).keptCard?.until).toBe(kept.until);
  }, 60_000);
  it("D63: the maker can delete it; someone else can't; an expired card is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const { app, codes } = gated(dir);
    const id = await round(app, "ssmakermakermaker2", codes.a);
    const hdr = (code: string) => ({ "content-type": "application/json", "x-atlas-session": "ssmakermakermaker2", "x-atlas-invite": code });
    await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr(codes.a), body: "{}" });
    expect((await app.request(`/proofs/${id}/keep`, { method: "DELETE", headers: hdr(codes.b) })).status).toBe(403);
    expect((await app.request(`/proofs/${id}/keep`, { method: "DELETE", headers: hdr(codes.a) })).status).toBe(200);
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toEqual([]);
    await app.request(`/proofs/${id}/keep`, { method: "POST", headers: hdr(codes.a), body: "{}" });
    const at = join(dir, `${id}.json`);
    const e = JSON.parse(readFileSync(at, "utf8"));
    writeFileSync(at, JSON.stringify({ ...e, until: new Date(Date.now() - 1000).toISOString() }));
    utimesSync(at, new Date(), new Date());
    const app2 = gated(dir).app;
    expect((await app2.request(`/proofs/${id}`)).status).toBe(404);
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toEqual([]);
  }, 60_000);
  it("D63: the caps hold, per client and in total", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const app = createApp({ keptProofsDir: dir, keptProofsCaps: { perClient: 1 } });
    const s = "sscapcapcapcapcap1";
    const a = await round(app, s, "");
    const b = await round(app, s, "");
    const keep = (id: string) => app.request(`/proofs/${id}/keep`, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": s }, body: "{}" });
    expect((await keep(a)).status).toBe(200);
    const second = await keep(b);
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: string }).error).toMatch(/delete one/);
  }, 60_000);
  it("D63 Moonwell: the saved result is public and read only", async () => {
    const { app } = gated(mkdtempSync(join(tmpdir(), "kept-")));
    const r = await app.request("/moonwell/saved");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { runs: { runner: string }[] }).runs[0]!.runner).toBe("evm");
  });
  it("D63 Moonwell: with no chain connection, nothing is spent and the words say so", async () => {
    const was = process.env.BASE_RPC_URL;
    delete process.env.BASE_RPC_URL;
    let calls = 0;
    const chat = async (_a: ChatArgs): Promise<ChatResult> => {
      calls++;
      return { ok: true, finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, usd: 0 }, content: "{}" };
    };
    const app = createApp({ modelBets: { chat, budget: createModelBudget({ spendCeilingUsd: 5, callsPerHour: 100 }) }, investigator: { chat }, checkChainFirst: true });
    const r = await app.request("/investigate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pr: "moonwell-fi/moonwell-contracts-v2#578" }) });
    if (was !== undefined) process.env.BASE_RPC_URL = was;
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toMatch(/no chain connection.*Nothing was spent/);
    expect(calls).toBe(0);
  });
});

describe("D63: tests written ahead", () => {
  const mk = () => {
    let calls = 0;
    const chat = async (_a: ChatArgs): Promise<ChatResult> => {
      calls++;
      return { ok: true, finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, usd: 0 }, content: JSON.stringify({ claim: "c", experiments: [{ shape: "call-function", exportName: "f", args: [{ kind: "json", value: 1 }] }] }) };
    };
    const app = createApp({ modelBets: { chat, budget: createModelBudget({ spendCeilingUsd: 5, callsPerHour: 1000 }) }, paste: { proposer: { chat } } });
    const ask = async (session: string, code: string, early: boolean) => {
      const headers = { "content-type": "application/json", "x-atlas-session": session };
      const p = (await (await app.request("/paste", { method: "POST", headers, body: JSON.stringify({ code, language: "js" }) })).json()) as { target: { ref: string; codeSha256: string } };
      return (await (await app.request("/paste/proposals", { method: "POST", headers, body: JSON.stringify({ target: { ref: p.target.ref, codeSha256: p.target.codeSha256 }, exportName: "f", ...(early ? { early: true } : {}) }) })).json()) as { ok: boolean; reason?: string };
    };
    return { ask, calls: () => calls };
  };
  it("only 2 per tab an hour; the third is not asked", async () => {
    const m = mk();
    const code = (n: number) => `export function f(){ return ${n}; }\n`;
    expect((await m.ask("sstabtabtabtabtab1", code(1), true)).ok).toBe(true);
    expect((await m.ask("sstabtabtabtabtab1", code(2), true)).ok).toBe(true);
    const third = await m.ask("sstabtabtabtabtab1", code(3), true);
    expect(third.ok).toBe(false);
    expect(third.reason).toMatch(/twice an hour/);
  }, 30_000);
  it("unused early calls take nothing from the per-tab allowance that bets need", async () => {
    const m = mk();
    const code = (n: number) => `export function f(){ return ${n}; }\n`;
    await m.ask("sstabtabtabtabtab2", code(1), true);
    await m.ask("sstabtabtabtabtab2", code(2), true);
    for (let i = 3; i <= 8; i++) expect((await m.ask("sstabtabtabtabtab2", code(i), false)).ok).toBe(true);
    expect((await m.ask("sstabtabtabtabtab2", code(9), false)).ok).toBe(false);
  }, 30_000);
});

describe("part B: words and dead ends", () => {
  it("an hourly limit reads plainly and says when it frees up", async () => {
    const { plainLimit } = await import("../../src/paste-words");
    expect(plainLimit("not asked (call limit reached: one client address may ask for 20 model rounds an hour. The next one frees up in about 12 min)")).toBe("You've used this hour's 20 model rounds. The next one frees up in about 12 min");
    expect(plainLimit("the model call failed")).toBe("The model call failed.");
  });
  it("two tests can be told apart by what differs", async () => {
    const { whatDiffers } = await import("../../web/screens/Studio");
    const t = (route: string) => ({ exportName: "f", args: [{ kind: "json", value: [{ ms: 10, route }] }] });
    expect(whatDiffers(t("/b"), t("/a"))).toBe('This test has "/b" where the last test has "/a".');
    expect(whatDiffers(t("/a"), t("/a"))).toBe("The same as the last test.");
  });
  it("a file with no exported function offers no bet", async () => {
    const { defaultFunction } = await import("../../web/screens/Studio");
    const { fileOutline } = await import("../../src/file-outline");
    expect(defaultFunction(fileOutline("export const RATE = 3;\n", "js"), [{ name: "RATE" }])).toBeNull();
    expect(defaultFunction(fileOutline("export function f(){ return 1; }\n", "js"), [{ name: "f" }])).toBe("f");
  });
});
