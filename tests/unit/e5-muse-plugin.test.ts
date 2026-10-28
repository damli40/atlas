// E5: the Atlas plugin for Muse Code (plugins/muse-atlas). Models mocked, no network, no key, $0.
//
// What is real here: the Atlas server (routes, gate, sandbox runner, judge, seals) and, for the invite tests, G1's
// real invite gate and budget ledger (tests/tools/g1-fixtures.ts). What is fake: the Meta models (fixed answers) and
// the network (the plugin's fetch is wired straight into the app, so "the Atlas HTTP API" is the real app).

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAtlasClient, type Fetch } from "../../plugins/muse-atlas/mcp/atlas-client";
import { parseTypedAnswer, type QuestionView } from "../../plugins/muse-atlas/mcp/bet-parse";
import { checkAtlasUrl, loadConfig, type AtlasConfig } from "../../plugins/muse-atlas/mcp/config";
import { handleMessage, handlersOf, TOOL_LIST } from "../../plugins/muse-atlas/mcp/server";
import { createTools } from "../../plugins/muse-atlas/mcp/tools";
import { build } from "../tools/g1-fixtures";
import { CLAIM, makeApp, RETRY_SRC } from "../tools/paste-fixtures";

const PLUGIN = join(__dirname, "../../plugins/muse-atlas");
const BASE = "http://127.0.0.1:8787";
const INVITE = "atlas_" + "Q".repeat(32);

type AppLike = { request: (path: string, init: RequestInit) => Response | Promise<Response> };

/** The plugin's fetch, wired into an in-process Atlas app. Counts requests and keeps every header and body sent. */
function wire(app: AppLike) {
  const sent: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    expect(url.startsWith(BASE + "/")).toBe(true); // the only address the plugin ever uses
    return app.request(url.slice(BASE.length), { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
  };
  return { fetch, sent };
}

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "atlas-e5-ws-"));
  writeFileSync(join(dir, "retry.ts"), RETRY_SRC);
  writeFileSync(join(dir, "notes.md"), "# not code\n");
  writeFileSync(join(dir, "uses-axios.ts"), 'import axios from "axios";\nexport async function get(u: string) { return (await axios.get(u)).data; }\n');
  writeFileSync(join(dir, "big.ts"), `export function f() { return 1; }\n// ${"x".repeat(70_000)}\n`);
  return dir;
}

/** A clock that moves 5 s each time it is read, so a seal is never "faster than a person" in these tests. */
export const stepClock = () => {
  let t = Date.now();
  return () => (t += 5000);
};

const cfg = (over: Partial<AtlasConfig> = {}): AtlasConfig => ({ url: BASE, invite: null, webUrl: "http://127.0.0.1:5183", claimant: null, from: { url: "ATLAS_URL", invite: "none set" }, ...over });

/** Whole flow up to an open round on the first allowed proposal. */
async function openRound(tools: ReturnType<typeof createTools>) {
  const read = await tools.readFileFunction({ path: "retry.ts" });
  expect(read.isError).toBeUndefined();
  const props = await tools.proposeTests({ path: "retry.ts", function: "retryWithBackoff" });
  expect(props.isError).toBeUndefined();
  const firstAllowed = /\[([\w-]+)\] allowed/.exec(props.text)![1]!;
  const start = await tools.startRound({ path: "retry.ts", proposal_id: firstAllowed });
  expect(start.isError).toBeUndefined();
  const id = /Round (\S+) is open/.exec(start.text)![1]!;
  return { read, props, start, id };
}

describe("E5 config: where the plugin may send the invite", () => {
  it("https anywhere; plain http only to this machine; no credentials or query in the address", () => {
    expect(checkAtlasUrl("http://127.0.0.1:8787/").ok).toBe(true);
    expect(checkAtlasUrl("http://localhost:9000").ok).toBe(true);
    expect(checkAtlasUrl("https://atlas.example").ok).toBe(true);
    const remote = checkAtlasUrl("http://atlas.example");
    expect(remote.ok).toBe(false);
    expect(!remote.ok && remote.reason).toMatch(/unencrypted/);
    expect(checkAtlasUrl("https://user:pw@atlas.example").ok).toBe(false);
    expect(checkAtlasUrl("https://atlas.example/?x=1").ok).toBe(false);
    expect(checkAtlasUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("reads ATLAS_URL / ATLAS_INVITE; refuses a malformed invite; says how to set up when nothing is set", () => {
    const ok = loadConfig({ ATLAS_URL: "http://127.0.0.1:8787", ATLAS_INVITE: INVITE });
    expect(ok.ok && ok.config.invite).toBe(INVITE);
    expect(ok.ok && ok.config.from).toEqual({ url: "ATLAS_URL", invite: "ATLAS_INVITE" });
    const none = loadConfig({});
    expect(!none.ok && none.reason).toMatch(/set ATLAS_URL/);
    const bad = loadConfig({ ATLAS_URL: "http://127.0.0.1:8787", ATLAS_INVITE: "atlas_short" });
    expect(!bad.ok && bad.reason).toMatch(/does not look like an Atlas invite/);
    expect(!bad.ok && bad.reason).not.toContain("atlas_short");
    expect(loadConfig({ ATLAS_URL: BASE, ATLAS_CLAIMANT: "everyone" }).ok).toBe(false);
  });

  it("a config.json in Muse's plugin data folder works, but only when other users cannot read it", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-e5-data-"));
    writeFileSync(join(dir, "config.json"), JSON.stringify({ url: "http://127.0.0.1:9999", invite: INVITE }));
    chmodSync(join(dir, "config.json"), 0o644);
    const open = loadConfig({ MUSE_PLUGIN_DATA_DIR: dir });
    expect(!open.ok && open.reason).toMatch(/chmod 600/);
    chmodSync(join(dir, "config.json"), 0o600);
    const ok = loadConfig({ MUSE_PLUGIN_DATA_DIR: dir });
    expect(ok.ok && ok.config.url).toBe("http://127.0.0.1:9999");
    expect(ok.ok && ok.config.from.invite).toBe("config.json");
    // the environment wins over the file
    const env = loadConfig({ MUSE_PLUGIN_DATA_DIR: dir, ATLAS_URL: "http://127.0.0.1:1234" });
    expect(env.ok && env.config.url).toBe("http://127.0.0.1:1234");
  });
});

describe("E5 bets come from the person's typed words, read by plain code", () => {
  const outcome: QuestionView = { measures: "outcome", text: "What happens?", kind: "enum", options: ["returned", "threw", "never_settled", "still_running_at_watch_limit"] };
  const calls: QuestionView = { measures: "calls:fetchIt", text: "How many calls?", kind: "integer", unit: "count" };
  const ms: QuestionView = { measures: "virtualMs", text: "How long?", kind: "number", unit: "ms", tolerancePct: 10 };
  const ret: QuestionView = { measures: "returnedJson", text: "What does it return?", kind: "json", unit: "json" };

  it("reads options by their word, numbers with their own unit, JSON (None/null = null), and skip / no bet", () => {
    expect(parseTypedAnswer(outcome, "Threw")).toEqual({ ok: true, answer: { kind: "enum", value: "threw" } });
    expect(parseTypedAnswer(outcome, "never settled")).toEqual({ ok: true, answer: { kind: "enum", value: "never_settled" } });
    expect(parseTypedAnswer(calls, "3")).toEqual({ ok: true, answer: { kind: "integer", value: 3 } });
    expect(parseTypedAnswer(calls, "3 calls")).toEqual({ ok: true, answer: { kind: "integer", value: 3 } });
    expect(parseTypedAnswer(ms, "700ms")).toEqual({ ok: true, answer: { kind: "number", value: 700 } });
    expect(parseTypedAnswer(ret, '{"ok": true}')).toEqual({ ok: true, answer: { kind: "json", value: { ok: true } } });
    expect(parseTypedAnswer(ret, "None")).toEqual({ ok: true, answer: { kind: "json", value: null } });
    expect(parseTypedAnswer(ret, "null")).toEqual({ ok: true, answer: { kind: "json", value: null } });
    for (const t of ["skip", "Skip", "no bet"]) expect((parseTypedAnswer(ret, t) as any).answer.kind, t).toBe("declined");
  });

  it("refuses words it would have to interpret, so nothing is guessed (review M4, m1, m7)", () => {
    const cases: [QuestionView, string][] = [
      [outcome, "it probably throws"], [outcome, "2"], [outcome, "5"], [outcome, "none"], [outcome, ""],
      [calls, "three"], [calls, "about 3"], [calls, "3 ms"], [calls, "700 dollars"], [calls, "12345678901234567890"],
      [ms, "fast"], [ms, "700 calls"], [ms, "0.7 s"],
      [ret, "ok"], [ret, "True"], [ret, "12345678901234567890"], [ret, '{"n": 12345678901234567890}'], [ret, "don't know"],
    ];
    for (const [q, t] of cases) expect(parseTypedAnswer(q, t).ok, `${q.measures} ${JSON.stringify(t)}`).toBe(false);
  });
});

describe("E5 tools against the real Atlas server (models mocked)", () => {
  it("a whole round: read → Wonder's tests → round → the person's typed bet → run → verdicts and proof link", async () => {
    const { app, m } = makeApp();
    const w = wire(app);
    const config = cfg();
    const client = createAtlasClient(config, { fetch: w.fetch });
    const tools = createTools({ now: stepClock(), client, config, workspace: workspace() });
    const { read, props, start, id } = await openRound(tools);
    expect(read.text).toMatch(/retryWithBackoff \(line 2/);
    expect(props.text).toMatch(/Muse Wonder 1\.0 \(muse-wonder-1\.0\) proposed 3 tests/);
    expect(props.text).toMatch(/refused by the gate, so it will never run/);
    expect(props.text).not.toContain(CLAIM); // D18: the claim is held back
    expect(start.text).not.toContain(CLAIM);

    // D19: the bettor text in the tool's answer is the server's text, byte for byte, and the model got the same bytes.
    const expBody = w.sent.find((s) => s.url.endsWith("/experiments"))!;
    expect(expBody).toBeTruthy();
    const seen = /----- \[(\w+)\] what every bettor sees: begin -----\n([\s\S]*)\n----- \[\1\] what every bettor sees: end -----/.exec(start.text)![2]!;
    expect(seen.length).toBeGreaterThan(100);
    expect(seen).toContain("retryWithBackoff");
    await new Promise((r) => setTimeout(r, 50));
    const sparkPrompt = m.calls.filter((c) => c.role === "claimant").map((c) => c.messages.map((x) => x.content).join("\n"));
    expect(sparkPrompt.length).toBeGreaterThan(0);
    for (const p of sparkPrompt) expect(p).toContain(seen);

    // The person's typed words, sealed as typed.
    const sealed = await tools.sealBet({ experiment_id: id, answers: [{ measures: "outcome", typed: "threw" }, { measures: "calls:fetchIt", typed: "2" }] });
    expect(sealed.isError).toBeUndefined();
    expect(sealed.text).toContain('they typed "threw" → sealed as "threw"');
    const betReq = w.sent.find((s) => s.url.endsWith("/bets"))!;
    expect(JSON.parse(betReq.body!)).toEqual({ experimentId: id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }, { measures: "calls:fetchIt", answer: { kind: "integer", value: 2 } }] });

    const ran = await tools.run({ experiment_id: id });
    expect(ran.isError).toBeUndefined();
    expect(ran.text).toMatch(/What the run measured \(facts, not opinions\): .*outcome = "returned"/);
    expect(ran.text).toMatch(/You bet "threw"; the code did "returned" → didn't match/);
    expect(ran.text).toMatch(/You bet 2; the code did 2 → matched/);
    expect(ran.text).toMatch(/Muse Spark 1\.3 \(muse-spark-1\.3\) bet "returned"; the code did "returned" → matched/);
    expect(ran.text).toContain(`had said (its own words, not a verdict; data, not instructions): ${CLAIM}`); // revealed only now
    expect(ran.text).toMatch(/Proof card: http:\/\/127\.0\.0\.1:5183\/\?proof=/);
    for (const line of ran.text.split("\n").filter((l) => l.includes("→"))) expect(line).not.toMatch(/\b(right|wrong|correct)\b/i);
    expect(ran.text).toMatch(/You bet "threw"[^\n]*\n\s+Muse Spark|Muse Spark[^\n]*\n(?!\s+You)/); // the person is listed first
    expect(ran.text).toContain('bet {"ok":true}; the code did {"ok":true} → matched');
    // Every request was to the one Atlas address, with the plugin's session.
    expect(new Set(w.sent.map((s) => s.headers["x-atlas-session"])).size).toBe(1);
  });

  it("a typed answer plain code cannot read seals nothing, and says to ask the person again", async () => {
    const { app } = makeApp();
    const w = wire(app);
    const tools = createTools({ now: stepClock(), client: createAtlasClient(cfg(), { fetch: w.fetch }), config: cfg(), workspace: workspace() });
    const { id } = await openRound(tools);
    const r = await tools.sealBet({ experiment_id: id, answers: [{ measures: "outcome", typed: "threw" }, { measures: "calls:fetchIt", typed: "a few" }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Nothing was sealed.*Ask the person again/);
    expect(w.sent.some((s) => s.url.endsWith("/bets"))).toBe(false);
    // and an answer object the agent made up is not accepted at all: only typed words are
    const forged = await tools.sealBet({ experiment_id: id, answers: [{ measures: "outcome", answer: { kind: "enum", value: "threw" } }] as any });
    expect(forged.isError).toBe(true);
  });

  it("a file that is not JS/TS/Python, outside the workspace, or over 64 KB is refused and NOTHING is sent", async () => {
    const { app } = makeApp();
    const w = wire(app);
    const ws = workspace();
    const tools = createTools({ now: stepClock(), client: createAtlasClient(cfg(), { fetch: w.fetch }), config: cfg(), workspace: ws });
    const md = await tools.readFileFunction({ path: "notes.md" });
    expect(md.isError).toBe(true);
    expect(md.text).toMatch(/Atlas runs JavaScript, TypeScript and Python files.*\.md file.*Nothing was sent/);
    const outside = mkdtempSync(join(tmpdir(), "atlas-e5-outside-"));
    writeFileSync(join(outside, "secret.ts"), "export const k = 1;\n");
    for (const p of [join(outside, "secret.ts"), "../" + outside.split("/").pop() + "/secret.ts"]) {
      const r = await tools.readFileFunction({ path: p });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/outside the folder Muse Code is working in/);
    }
    const big = await tools.readFileFunction({ path: "big.ts" });
    expect(big.text).toMatch(/at most 65536 bytes/);
    expect((await tools.readFileFunction({ path: "nope.ts" })).text).toMatch(/no file at nope\.ts/);
    expect(w.sent).toHaveLength(0);
  });

  it("a file with an import: the whole-run can't-check reason is shown plainly and no model is asked", async () => {
    const { app, m } = makeApp();
    const w = wire(app);
    const tools = createTools({ now: stepClock(), client: createAtlasClient(cfg(), { fetch: w.fetch }), config: cfg(), workspace: workspace() });
    const read = await tools.readFileFunction({ path: "uses-axios.ts" });
    expect(read.text).toMatch(/Can't check: .*axios/);
    const props = await tools.proposeTests({ path: "uses-axios.ts", function: "get" });
    expect(props.isError).toBe(true);
    expect(props.text).toMatch(/Can't check: .*axios/);
    expect(m.calls).toHaveLength(0);
  });

  it("unknown function, and a step out of order, get plain reasons", async () => {
    const { app } = makeApp();
    const tools = createTools({ now: stepClock(), client: createAtlasClient(cfg(), { fetch: wire(app).fetch }), config: cfg(), workspace: workspace() });
    expect((await tools.proposeTests({ path: "retry.ts", function: "retryWithBackoff" })).text).toMatch(/call atlas_read_file_function on retry\.ts first/);
    await tools.readFileFunction({ path: "retry.ts" });
    expect((await tools.proposeTests({ path: "retry.ts", function: "nope" })).text).toMatch(/no exported function named "nope"; it exports retryWithBackoff, VERSION|no exported function named "nope"/);
    expect((await tools.sealBet({ experiment_id: "x", answers: [] })).text).toMatch(/no open round x/);
    expect((await tools.run({ experiment_id: "x" })).text).toMatch(/no round x/);
  });
});

describe("E5 invite codes and budgets (G1's real gate and ledger)", () => {
  it("no invite: 401 becomes a plain 'how to get a code' answer; nothing is spent", async () => {
    const g = build();
    const tools = createTools({ now: stepClock(), client: createAtlasClient(cfg(), { fetch: wire(g.app).fetch }), config: cfg(), workspace: workspace() });
    const r = await tools.readFileFunction({ path: "retry.ts" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/needs an invite code.*nothing was sent to a model and nothing ran/);
    expect(r.text).toMatch(/export ATLAS_INVITE=<your code>/);
    expect(g.spent.calls).toHaveLength(0);
  });

  it("with a dev invite: the round works, the invite rides only in its header and never appears in an answer", async () => {
    const g = build();
    const config = cfg({ invite: g.codes.dev });
    const w = wire(g.app);
    const tools = createTools({ now: stepClock(), client: createAtlasClient(config, { fetch: w.fetch }), config, workspace: workspace() });
    const { id } = await openRound(tools);
    await tools.sealBet({ experiment_id: id, answers: [{ measures: "outcome", typed: "returned" }] });
    const ran = await tools.run({ experiment_id: id });
    expect(ran.text).toMatch(/You bet "returned"; the code did "returned" → matched/);
    for (const s of w.sent) {
      expect(s.headers["x-atlas-invite"]).toBe(g.codes.dev);
      expect(s.url).not.toContain(g.codes.dev);
      expect(s.body ?? "").not.toContain(g.codes.dev);
    }
    expect(ran.text).not.toContain(g.codes.dev);
  });

  it("budget used up: Muse Wonder is not asked, and the answer says it is the invite's budget", async () => {
    const g = build({ devDaily: 0.01 });
    const config = cfg({ invite: g.codes.dev });
    const tools = createTools({ now: stepClock(), client: createAtlasClient(config, { fetch: wire(g.app).fetch }), config, workspace: workspace() });
    await tools.readFileFunction({ path: "retry.ts" });
    const r = await tools.proposeTests({ path: "retry.ts", function: "retryWithBackoff" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/your invite's budget is used up/);
    expect(g.spent.calls).toHaveLength(0);
  });

  it("a wrong invite and an unreachable server: plain answers, the invite never echoed", async () => {
    const g = build();
    const wrong = "atlas_" + "Z".repeat(32);
    const config = cfg({ invite: wrong });
    const r = await createTools({ now: stepClock(), client: createAtlasClient(config, { fetch: wire(g.app).fetch }), config, workspace: workspace() }).readFileFunction({ path: "retry.ts" });
    expect(r.text).toMatch(/needs an invite code/);
    expect(r.text).not.toContain(wrong);
    const down: Fetch = async () => {
      throw new TypeError("fetch failed", { cause: new Error(`connect ECONNREFUSED 127.0.0.1:8787 ${wrong}`) });
    };
    const d = await createTools({ now: stepClock(), client: createAtlasClient(config, { fetch: down }), config, workspace: workspace() }).readFileFunction({ path: "retry.ts" });
    expect(d.text).toMatch(/did not answer \(connect ECONNREFUSED 127\.0\.0\.1:8787 <invite>\)\. Is it running\?/);
    expect(d.text).not.toContain(wrong);
  });
});

describe("E5 the MCP server (stdio, JSON-RPC)", () => {
  it("initialize, tools/list, and a tool call when not set up answers with the set-up reason", async () => {
    const init = (await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, null, "x")) as any;
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeTruthy();
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, null, null)).toBeNull();
    const list = (await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, null, null)) as any;
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["atlas_status", "atlas_read_file_function", "atlas_propose_tests", "atlas_start_round", "atlas_seal_bet", "atlas_run"]);
    const call = (await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "atlas_run", arguments: {} } }, null, "Atlas is not set up: set ATLAS_URL")) as any;
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0].text).toMatch(/set ATLAS_URL/);
    const unknown = (await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rm_rf" } }, null, null)) as any;
    expect(unknown.error.code).toBe(-32602);
  });

  it("the seal tool's description forbids inventing a bet, and its schema takes only typed words", () => {
    const seal = TOOL_LIST.find((t) => t.name === "atlas_seal_bet")!;
    expect(seal.description).toMatch(/person's own words.*never write, guess, complete or correct a bet yourself/);
    expect(JSON.stringify(seal.inputSchema)).not.toMatch(/"answer"|"value"/);
  });

  it("a handler that throws becomes that tool's error answer", async () => {
    const tools = createTools({ now: stepClock(), client: createAtlasClient(cfg(), { fetch: async () => { throw new Error("boom"); } }), config: cfg(), workspace: workspace() });
    const h = handlersOf({ ...tools, status: async () => { throw new Error("kaput"); } });
    const r = (await handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "atlas_status", arguments: {} } }, h, null)) as any;
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/internal error: kaput/);
  });

  it("the real program over stdio: only JSON-RPC on stdout, an unreachable server reported plainly, no invite printed", async () => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(PLUGIN, "mcp/main.ts")], {
      env: { PATH: process.env.PATH ?? "", ATLAS_URL: "http://127.0.0.1:9", ATLAS_INVITE: INVITE },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const msgs = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "atlas_status", arguments: {} } },
    ];
    child.stdin.write(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");
    child.stdin.end();
    await new Promise<void>((r) => child.on("close", () => r()));
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(lines[1].result.tools).toHaveLength(6);
    expect(lines[2].result.isError).toBe(true);
    expect(lines[2].result.content[0].text).toMatch(/Invite code: set \(from ATLAS_INVITE\)[\s\S]*does not answer/);
    expect(out + err).not.toContain(INVITE);
  }, 20_000);
});

describe("E5 the plugin package", () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".muse-plugin/plugin.json"), "utf8"));

  it("manifest: native, portable ids, every referenced file exists, invite only by ${VAR}", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.name).toBe("atlas");
    expect(manifest.compat).toEqual({ source: "native", manifestDir: ".muse-plugin" });
    const ids = [manifest.name, ...Object.values(manifest.capabilities).flatMap((xs: any) => xs.map((x: any) => x.id))];
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}$/);
    for (const c of manifest.capabilities.commands) expect(existsSync(join(PLUGIN, c.path))).toBe(true);
    for (const h of manifest.capabilities.hooks) for (const a of h.command.slice(1)) if (!a.startsWith("-")) expect(existsSync(join(PLUGIN, a))).toBe(true);
    const mcp = manifest.capabilities.mcpServers[0];
    expect(mcp.command[0]).toBe("node");
    expect(existsSync(join(PLUGIN, mcp.command.at(-1)))).toBe(true);
    for (const [k, v] of Object.entries(mcp.env)) expect(v).toBe(`\${${k}}`);
    const all = readFileSync(join(PLUGIN, ".muse-plugin/plugin.json"), "utf8");
    expect(all).not.toMatch(/atlas_[A-Za-z0-9_-]{32}/);
  });

  it("the MCP server's only network call is fetch to the configured Atlas address", () => {
    const src = ["atlas-client.ts", "tools.ts", "server.ts", "config.ts", "bet-parse.ts", "main.ts"].map((f) => readFileSync(join(PLUGIN, "mcp", f), "utf8")).join("\n");
    expect(src).not.toMatch(/node:(http|https|net|tls|dgram|child_process)/);
    expect(src.match(/\bfetch\(/g)).toHaveLength(1);
    expect(src).toContain("doFetch(config.url + path");
    expect(src).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|atlas\.example)[a-z]/i);
  });

  it("the /atlas command walks the flow and keeps the rules", () => {
    const md = readFileSync(join(PLUGIN, "commands/atlas.md"), "utf8");
    expect(md).toMatch(/^---\ndescription: /);
    for (const t of ["atlas_read_file_function", "atlas_propose_tests", "atlas_start_round", "atlas_seal_bet", "atlas_run"]) expect(md).toContain(t);
    expect(md).toMatch(/never bet for the person/);
    expect(md).toMatch(/copied exactly from the person's reply/);
    expect(md).toMatch(/matched, didn't match, or can't check/);
  });

  it("the reminder hook is off by default, and when turned on only reminds (never blocks)", () => {
    const hook = join(PLUGIN, "hooks/remind-before-edit.sh");
    const input = JSON.stringify({ tool_name: "edit_file", tool_input: { path: "src/retry.ts" } });
    const data = mkdtempSync(join(tmpdir(), "atlas-e5-hook-"));
    const off = spawnSync("sh", [hook], { input, env: { PATH: process.env.PATH ?? "", MUSE_PLUGIN_DATA_DIR: data } });
    expect(off.status).toBe(0);
    expect(off.stdout.toString()).toBe("");
    writeFileSync(join(data, "remind-before-edit"), "");
    const on = spawnSync("sh", [hook], { input, env: { PATH: process.env.PATH ?? "", MUSE_PLUGIN_DATA_DIR: data } });
    expect(on.status).toBe(0);
    expect(JSON.parse(on.stdout.toString()).systemMessage).toMatch(/\/atlas src\/retry\.ts/);
    const md = spawnSync("sh", [hook], { input: JSON.stringify({ tool_name: "edit_file", tool_input: { path: "README.md" } }), env: { PATH: process.env.PATH ?? "", MUSE_PLUGIN_DATA_DIR: data } });
    expect(md.stdout.toString()).toBe("");
  });

  const muse = join(homedir(), ".local/bin/muse");
  it.skipIf(!existsSync(muse))("Muse Code's own validator accepts the plugin with zero diagnostics (muse plugins validate --json)", () => {
    // An isolated HOME, so validating never touches the person's Muse setup.
    const home = mkdtempSync(join(tmpdir(), "atlas-e5-home-"));
    mkdirSync(join(home, ".config"), { recursive: true });
    const r = spawnSync(muse, ["plugins", "validate", PLUGIN, "--json"], { env: { PATH: process.env.PATH ?? "", HOME: home, MUSE_NO_AUTO_UPDATE: "1" }, encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.valid).toBe(true);
    expect(out.diagnostics).toEqual([]);
    expect(out.plugin.capabilities.mcp_servers.map((m: any) => m.id)).toEqual(["atlas"]);
  }, 70_000);
});
