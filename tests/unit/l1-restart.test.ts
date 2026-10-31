// L1: the plugin's program stopping must not lose the person's round silently. Oct 31: in real Muse Code it was gone when
// the person replied, and nothing recorded why. Models mocked, $0. The real MCP program, over real stdio, against a real
// Atlas server on a local port.

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterAll, describe, expect, it } from "vitest";
import { LOG_FILE, cleanLine, createRoundStore, createRuntimeLog } from "../../plugins/muse-atlas/mcp/round-store";
import { watchProcess } from "../../plugins/muse-atlas/mcp/server";
import { verifyAtlasFile } from "../../src/atlasfile";
import { LOOP_PHRASE } from "../../src/loop";
import { makeApp } from "../tools/paste-fixtures";

const MAIN = join(__dirname, "../../plugins/muse-atlas/mcp/main.ts");
const code = (wait: string) => `export async function retryWithBackoff(fetchIt: () => Promise<unknown>, attempts: number = 3, baseMs: number = 100) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchIt();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, ${wait}));
    }
  }
  throw last;
}
`;
const servers: { close: () => void }[] = [];
afterAll(() => servers.forEach((s) => s.close()));

async function liveServer() {
  const { app } = makeApp();
  const server = await new Promise<ReturnType<typeof serve>>((ok) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => ok(s));
  });
  servers.push(server);
  return { app, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function folders() {
  const ws = mkdtempSync(join(tmpdir(), "atlas-l1r-ws-"));
  writeFileSync(join(ws, "retry.ts"), code("baseMs"));
  return { ws, data: mkdtempSync(join(tmpdir(), "atlas-l1r-data-")) };
}

/** One run of the real program. */
function program(ws: string, url: string, data?: string) {
  const child: ChildProcess = spawn("node", ["--experimental-strip-types", "--no-warnings", MAIN], { cwd: ws, env: { PATH: process.env.PATH!, HOME: tmpdir(), ATLAS_URL: url, ...(data ? { MUSE_PLUGIN_DATA_DIR: data } : {}) }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let id = 0;
  const wait = new Map<number, (v: any) => void>();
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (d: string) => {
    buf += d;
    let n;
    while ((n = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, n));
      buf = buf.slice(n + 1);
      wait.get(m.id)?.(m);
    }
  });
  const rpc = (method: string, params: unknown) =>
    new Promise<any>((ok) => {
      const i = ++id;
      wait.set(i, ok);
      child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id: i, method, params })}\n`);
    });
  const tool = async (name: string, args: unknown = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    return { text: r.result.content[0].text as string, isError: r.result.isError === true };
  };
  const gone = new Promise<void>((ok) => child.on("exit", () => ok()));
  return { tool, rpc, child, gone };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A whole round up to the offer. */
async function roundToOffer(p: ReturnType<typeof program>) {
  await p.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  await p.tool("atlas_read_file_function", { path: "retry.ts" });
  const props = await p.tool("atlas_propose_tests", { path: "retry.ts", function: "retryWithBackoff" });
  const ids = [...props.text.matchAll(/\[([\w-]+)\] allowed/g)].map((m) => m[1]!);
  const start = await p.tool("atlas_start_round", { path: "retry.ts", proposal_id: ids[1] });
  const id = /Round (\S+) is open/.exec(start.text)![1]!;
  await pause(2100);
  await p.tool("atlas_seal_bet", { experiment_id: id, answers: [{ measures: "outcome", typed: "threw" }, { measures: "virtualMs", typed: "700" }, { measures: "calls:fetchIt", typed: "3" }] });
  const ran = await p.tool("atlas_run", { experiment_id: id });
  expect(ran.text).toContain(LOOP_PHRASE);
  return id;
}

describe("L1 the round survives a restart of the plugin's program", () => {
  for (const [how, signal] of [["stopped with SIGTERM", "SIGTERM"], ["killed outright with SIGKILL", "SIGKILL"]] as const) {
    it(`${how}: a new program carries on with the same round, and the proof holds`, async () => {
      const { url, app } = await liveServer();
      const { ws, data } = folders();
      const one = program(ws, url, data);
      const id = await roundToOffer(one);
      one.child.kill(signal);
      await one.gone;
      const log = readFileSync(join(data, LOG_FILE), "utf8");
      expect(log).toMatch(/started: process \d+/);
      if (signal === "SIGTERM") expect(log).toContain("stopped: signal SIGTERM");
      else expect(log).not.toContain("stopped:"); // what a hard kill looks like: started, and nothing after

      const two = program(ws, url, data);
      await pause(2100); // the 2-second reading floor holds across a restart too
      expect((await two.tool("atlas_status")).text).toContain("Rounds carried over from before this program last restarted: 1");
      const chosen = await two.tool("atlas_choose_target", { experiment_id: id, typed: LOOP_PHRASE });
      expect(chosen.isError).toBe(false);
      expect(chosen.text).toContain("Their sealed answers are now the target");
      writeFileSync(join(ws, "retry.ts"), code("baseMs * 2 ** i"));
      const three = program(ws, url, data); // and again after the choice: it is remembered
      two.child.kill();
      const again = await three.tool("atlas_rerun", { experiment_id: id });
      expect(again.isError).toBe(false);
      expect(again.text).toContain("Re-run 1 of 3");
      expect(again.text).toMatch(/You bet 700; the code did 700 → matched/);
      const runId = /proofs\/([\w-]+)/.exec(again.text)![1]!;
      const session = JSON.parse(readFileSync(join(data, readdirSync(data).find((f) => f.startsWith("rounds-"))!), "utf8")).session as string;
      const file = await (await app.request(`/proofs/${runId}`, { headers: { "x-atlas-session": session } })).json();
      const v = verifyAtlasFile(file);
      expect(v.ok ? [] : v.problems).toEqual([]);
      three.child.kill();
    }, 60_000);
  }

  it("the saved file is private and holds no code and no invite", async () => {
    const { url } = await liveServer();
    const { ws, data } = folders();
    const p = program(ws, url, data);
    await roundToOffer(p);
    p.child.kill();
    await p.gone;
    for (const f of readdirSync(data)) {
      expect(statSync(join(data, f)).mode & 0o077, f).toBe(0);
      expect(readFileSync(join(data, f), "utf8"), f).not.toContain("setTimeout");
    }
  }, 30_000);

  it("with no data folder, the loss is said plainly and says what to do", async () => {
    const { url } = await liveServer();
    const { ws } = folders();
    const one = program(ws, url);
    const id = await roundToOffer(one);
    one.child.kill();
    await one.gone;
    const two = program(ws, url);
    const r = await two.tool("atlas_choose_target", { experiment_id: id, typed: LOOP_PHRASE });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("probably restarted");
    expect(r.text).toContain("start again with /atlas");
    two.child.kill();
  }, 30_000);

  it("a server that lost the round: said plainly, nothing ran", async () => {
    const first = await liveServer();
    const { ws, data } = folders();
    const one = program(ws, first.url, data);
    const id = await roundToOffer(one);
    one.child.kill();
    await one.gone;
    const fresh = await liveServer(); // a restarted server knows nothing
    const two = program(ws, fresh.url, data);
    await pause(2100);
    const r = await two.tool("atlas_choose_target", { experiment_id: id, typed: LOOP_PHRASE });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no longer holds round");
    expect(r.text).toContain("start again with /atlas");
    two.child.kill();
  }, 30_000);

  it("another workspace does not see the round; a broken file is ignored and written down", async () => {
    const data = mkdtempSync(join(tmpdir(), "atlas-l1r-data-"));
    const log = createRuntimeLog(data, null);
    const a = createRoundStore<{ n: number }>(data, "/work/a", log)!;
    a.save("sess_a", new Map([["r1", { n: 1 }]]));
    expect(a.load().rounds).toEqual({ r1: { n: 1 } });
    expect(createRoundStore<{ n: number }>(data, "/work/b", log)!.load().rounds).toEqual({});
    writeFileSync(join(data, readdirSync(data).find((f) => f.startsWith("rounds-"))!), "{not json");
    expect(a.load().rounds).toEqual({});
    expect(log.lastProblem()).toContain("could not read the saved rounds");
    expect(createRoundStore(undefined, "/work/a")).toBeNull();
  });
});

describe("L1 nothing ends the program silently", () => {
  function fakeProcess() {
    const p = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; exit: (c: number) => void; exits: number[] };
    p.pid = 7;
    p.stdout = new EventEmitter();
    p.exits = [];
    p.exit = (c) => void p.exits.push(c);
    return p;
  }
  it("an uncaught error and an unhandled rejection are written down and the program stays up", () => {
    const data = mkdtempSync(join(tmpdir(), "atlas-l1r-data-"));
    const log = createRuntimeLog(data, null);
    const p = fakeProcess();
    watchProcess(log, p as never);
    p.emit("uncaughtException", new Error("bad thing"));
    p.emit("unhandledRejection", new Error("bad promise"));
    expect(p.exits).toEqual([]);
    const text = readFileSync(join(data, LOG_FILE), "utf8");
    expect(text).toContain("uncaught-error: bad thing");
    expect(text).toContain("unhandled-rejection: bad promise");
  });

  it("a closed stdout and a signal are the ways out, and each is written down first", () => {
    for (const fire of [(p: ReturnType<typeof fakeProcess>) => p.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), (p: ReturnType<typeof fakeProcess>) => p.emit("uncaughtException", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), (p: ReturnType<typeof fakeProcess>) => p.emit("SIGHUP")]) {
      const data = mkdtempSync(join(tmpdir(), "atlas-l1r-data-"));
      const p = fakeProcess();
      watchProcess(createRuntimeLog(data, null), p as never);
      fire(p);
      expect(p.exits).toEqual([0]);
      expect(readFileSync(join(data, LOG_FILE), "utf8")).toContain("stopped:");
    }
  });

  it("the log never holds an invite, keeps one line per event, and stays short; no folder means no file", () => {
    const code = `atlas_${"Q".repeat(32)}`;
    expect(cleanLine(`failed with ${code} here`, code)).toBe("failed with <invite> here");
    expect(cleanLine(`other atlas_${"Z".repeat(32)}`, null)).toBe("other <invite>");
    expect(cleanLine("a\nb\n  c", null)).toBe("a b c");
    expect(cleanLine("x".repeat(900), null).length).toBeLessThanOrEqual(500);
    const data = mkdtempSync(join(tmpdir(), "atlas-l1r-data-"));
    const log = createRuntimeLog(data, null);
    for (let i = 0; i < 100; i++) log.note("started", String(i));
    expect(readFileSync(join(data, LOG_FILE), "utf8").trim().split("\n").length).toBe(40);
    expect(log.lastProblem()).toBeNull(); // a plain start is not a problem
    const none = createRuntimeLog(undefined, null);
    none.note("x", "y");
    expect(none.lastProblem()).toBeNull();
    expect(existsSync(join(tmpdir(), LOG_FILE))).toBe(false);
  });
});
