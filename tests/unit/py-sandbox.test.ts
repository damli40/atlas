// E2: the Python executor (macOS sandbox-exec). These tests run RAW Python scripts in the sandbox, with none of
// Atlas's in-process checks (no harness, no audit hook), so each denial below is the operating system's own:
// network, file writes, reading the home folder or /etc, starting a program, forking, loading ctypes. They also
// pin the executor's own refusals (flags, environment, network, non-macOS) and its hard wall-clock kill.

import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PYTHON_CANDIDATES, findPython, pythonRefusal, pythonSandboxExecutor, pythonSandboxProfile } from "../../runners/executor/sandbox-exec-python.ts";

const py = findPython();
const run = (script: string, wallClockMs = 10_000) => pythonSandboxExecutor.exec({ files: { "probe.py": script }, cmd: ["python3", "probe.py"], wallClockMs, allowNetwork: false });

/** A script that tries `body` and prints ALLOWED or DENIED with the error. */
const probe = (body: string) => `
import os, sys
try:
${body
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}
    print("ALLOWED")
except BaseException as e:
    print("DENIED", type(e).__name__, getattr(e, "errno", None))
`;

describe("the Python sandbox profile", () => {
  it("starts from deny-everything and allows only the interpreter, its install, the run folder and system libraries", () => {
    const p = pythonSandboxProfile({ interpreter: "/x/Python", prefix: "/x", workdir: "/private/var/folders/t/atlas-pyexec-1" });
    expect(p).toMatch(/^\(version 1\)\n\(deny default\)\n/);
    expect(p).toContain('(allow process-exec (literal "/x/Python"))');
    expect(p).toContain('(subpath "/private/var/folders/t/atlas-pyexec-1")');
    expect(p).not.toMatch(/network|file-write|process-fork|file-read-metadata|sysctl|mach-lookup/);
    // A path holding a quote cannot break out of its string.
    expect(pythonSandboxProfile({ interpreter: '/a"b', prefix: "/p", workdir: "/w" })).toContain('(literal "/a\\"b")');
  });

  it("picks Python from a fixed list, in a fixed order", () => {
    expect(PYTHON_CANDIDATES[0]).toBe("/opt/homebrew/bin/python3");
    expect(findPython()).toBe(findPython()); // cached: the same machine always gets the same one
  });

  it("refuses on any OS other than macOS", () => {
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      expect(pythonRefusal()).toMatch(/only on macOS .*Modal/);
    } finally {
      Object.defineProperty(process, "platform", { value: real });
    }
  });
});

describe.skipIf(!py)("the Python executor (real sandbox-exec)", () => {
  it("runs Python 3.12+ in isolated mode with an empty environment", async () => {
    const r = await run("import sys, os\nprint(sys.version_info[:2] >= (3, 12), sys.flags.isolated, sys.flags.no_site, dict(os.environ))");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("True 1 1 {}");
  });

  it("refuses commands it cannot keep in the sandbox", async () => {
    const base = { files: {}, wallClockMs: 1000, allowNetwork: false as const };
    await expect(pythonSandboxExecutor.exec({ ...base, cmd: ["node", "x.js"] })).rejects.toThrow(/only "python3"/);
    await expect(pythonSandboxExecutor.exec({ ...base, cmd: ["python3", "-c", "print(1)"] })).rejects.toThrow(/no interpreter flags/);
    await expect(pythonSandboxExecutor.exec({ ...base, cmd: ["python3", "x.py"], env: { PYTHONPATH: "/" } })).rejects.toThrow(/empty environment/);
    await expect(pythonSandboxExecutor.exec({ ...base, cmd: ["python3", "x.py"], allowNetwork: { hosts: ["localhost"] } })).rejects.toThrow(/never allows network/);
    await expect(pythonSandboxExecutor.exec({ ...base, files: { "../x.py": "" }, cmd: ["python3", "x.py"] })).rejects.toThrow(/leaves the sandbox folder/);
  });

  const denials: [string, string][] = [
    ["opening a network connection", 'import socket\nsocket.create_connection(("1.1.1.1", 80), timeout=2)'],
    ["listening on a port", 'import socket\nsocket.socket().bind(("127.0.0.1", 0))'],
    ["writing a file in its own folder", 'open("out.txt", "w").write("x")'],
    ["writing a file in /private/tmp", 'open("/private/tmp/atlas-e2-probe.txt", "w").write("x")'],
    ["reading a file under ~/.config", `open(${JSON.stringify(join(homedir(), ".config", "atlas", "rpc.env"))}).read(1)`],
    ["listing the home folder", `os.listdir(${JSON.stringify(homedir())})`],
    ["reading /etc/passwd", 'open("/etc/passwd").read(1)'],
    ["starting a program (subprocess)", 'import subprocess\nsubprocess.run(["/bin/echo", "hi"])'],
    ["forking (os.fork)", "os.fork()"],
    ["loading ctypes", "import ctypes\nctypes.CDLL(None)"],
  ];
  for (const [what, body] of denials) {
    it(`the OS denies ${what}`, async () => {
      const r = await run(probe(body));
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim(), r.stderr).toMatch(/^DENIED PermissionError 1$/);
    });
  }

  it("leaves no file behind from the write attempts", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("/private/tmp/atlas-e2-probe.txt")).toBe(false);
  });

  it("the raw _ctypes module still loads at the OS level (so the harness refuses it in-process: py-call tests)", async () => {
    const r = await run(probe("import _ctypes"));
    expect(r.stdout.trim()).toBe("ALLOWED");
  });

  it("can read its own run folder and the standard library, nothing else", async () => {
    const r = await run('import os, json\nprint(sorted(os.listdir(".")), json.__name__)');
    expect(r.stdout.trim()).toBe("['probe.py'] json");
  });

  it("kills a run that passes the wall-clock limit", async () => {
    const r = await run("while True:\n    pass", 800);
    expect(r.timedOut).toBe(true);
  });
});
