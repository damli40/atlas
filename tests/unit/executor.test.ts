import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localExecutor } from "../../runners/executor/local.ts";

const run = (script: string, extra: Partial<Parameters<typeof localExecutor.exec>[0]> = {}) =>
  localExecutor.exec({ files: { "s.mjs": script }, cmd: ["node", "s.mjs"], wallClockMs: 5000, allowNetwork: false, ...extra });

describe("local executor boundary (Node permission model)", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    // A real listener on this machine, so a blocked connection proves the sandbox (not a missing server).
    server = createServer((s) => s.end("hi"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("runs node in its temp folder and returns stdout", async () => {
    const r = await run(`console.log("ok", process.cwd().includes("atlas-exec-"))`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ok true");
    expect(r.timedOut).toBe(false);
  });

  it("blocks a network connection to a listening local port", async () => {
    const r = await run(`
      import net from "node:net";
      try { const s = net.connect(${port}, "127.0.0.1"); s.on("connect", () => { console.log("CONNECTED"); s.destroy(); }); s.on("error", (e) => console.log("ERR", e.code)); }
      catch (e) { console.log("ERR", e.code); }`);
    expect(r.stdout).not.toContain("CONNECTED");
    expect(r.stdout).toContain("ERR_ACCESS_DENIED");
  });

  it("blocks reading files outside its folder and writing anywhere", async () => {
    const r = await run(`
      import fs from "node:fs";
      for (const f of [() => fs.readFileSync("/etc/hosts"), () => fs.writeFileSync("x.txt", "x")]) {
        try { f(); console.log("ALLOWED"); } catch (e) { console.log("ERR", e.code); }
      }`);
    expect(r.stdout).not.toContain("ALLOWED");
    expect(r.stdout.match(/ERR_ACCESS_DENIED/g)).toHaveLength(2);
  });

  it("blocks starting a child process", async () => {
    const r = await run(`
      import cp from "node:child_process";
      try { cp.execSync("echo hi"); console.log("ALLOWED"); } catch (e) { console.log("ERR", e.code); }`);
    expect(r.stdout).toContain("ERR_ACCESS_DENIED");
  });

  it("passes no environment from the parent", async () => {
    process.env.ATLAS_TEST_SECRET = "must-not-leak";
    const r = await run(`console.log(JSON.stringify(Object.keys(process.env)))`, { env: { ONLY: "1" } });
    delete process.env.ATLAS_TEST_SECRET;
    expect(r.stdout).not.toContain("ATLAS_TEST_SECRET");
    expect(JSON.parse(r.stdout)).toContain("ONLY");
  });

  it("kills the child at the wall-clock limit and says so", async () => {
    const r = await run(`while (true) {}`, { wallClockMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
    expect(r.durationMs).toBeLessThan(3000);
  });

  it("refuses flags that widen the sandbox, non-node commands, host-limited network and NODE_OPTIONS", async () => {
    await expect(run("", { cmd: ["node", "--allow-net", "s.mjs"] })).rejects.toThrow(/refuses the node flag/);
    await expect(run("", { cmd: ["node", "--allow-fs-read=/", "s.mjs"] })).rejects.toThrow(/refuses the node flag/);
    await expect(run("", { cmd: ["bash", "-c", "true"] })).rejects.toThrow(/only "node"/);
    await expect(run("", { allowNetwork: { hosts: ["127.0.0.1"] } })).rejects.toThrow(/cannot limit network/);
    await expect(run("", { env: { NODE_OPTIONS: "" } })).rejects.toThrow(/NODE_OPTIONS/);
    await expect(run("", { files: { "../x.mjs": "" } })).rejects.toThrow(/leaves the sandbox/);
  });
});
