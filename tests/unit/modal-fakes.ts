// Fake Modal backends for the E4 unit tests (no network, no Modal account).
//
// - scriptedBackend: records every call (the sandbox spec, every command, every stdin text, terminate) and answers
//   with whatever the test scripts. Used to check exactly what the executor sends to Modal.
// - emulatingBackend: runs the commands on THIS machine, so the real call-worker runs through the Modal executor's
//   code path end to end. It strips the container-only prefix (`env -i ... setpriv ...`), keeps the env pairs, and
//   swaps the container folder for a temp folder. It is a stand-in for Modal's plumbing, not for its isolation:
//   the isolation is tested live (tests/unit/modal-live.test.ts).

import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { findPython } from "../../runners/executor/sandbox-exec-python.ts";
import { MODAL_IMAGE, NODE_BIN, PYTHON_BIN, SANDBOX_DIR, type ModalBackend, type ModalProcess, type ModalSandbox, type SandboxSpec } from "../../runners/executor/modal.ts";

export interface Recorded {
  specs: SandboxSpec[];
  cmds: string[][];
  stdins: string[];
  terminated: string[];
}

export interface ScriptedAnswer {
  stdout?: string | string[];
  stderr?: string;
  exitCode?: number;
  /** Never exits and never closes its streams (until terminate). */
  hang?: boolean;
  /** exec itself rejects with this message. */
  execError?: string;
  /** exec never answers. */
  execHang?: boolean;
  /** Streams close normally, but wait() rejects with this message (the sandbox went away under the command). */
  waitError?: string;
  /** Writing stdin fails with this message (and the process never exits until terminate). */
  stdinError?: string;
}

/** A process whose answer is fixed. Streams emit `stdout` chunks then close; `wait` gives the exit code. */
export function scriptedProcess(a: ScriptedAnswer, onStdin: (s: string) => void, killed: Promise<void>): ModalProcess {
  let input = "";
  const chunks = a.stdout === undefined ? [] : Array.isArray(a.stdout) ? a.stdout : [a.stdout];
  const stream = (parts: string[]) =>
    new ReadableStream<string>({
      async start(c) {
        if (a.hang || a.stdinError) {
          await killed;
          c.error(new Error("sandbox terminated"));
          return;
        }
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    });
  return {
    stdin: {
      writeText: async (t) => {
        if (a.stdinError) throw new Error(a.stdinError);
        input += t;
      },
      close: async () => onStdin(input),
    },
    stdout: stream(chunks),
    stderr: stream(a.stderr ? [a.stderr] : []),
    wait: () =>
      a.hang || a.stdinError
        ? killed.then(() => Promise.reject(new Error("sandbox terminated")))
        : a.waitError
          ? Promise.reject(new Error(a.waitError))
          : Promise.resolve(a.exitCode ?? 0),
  };
}

/**
 * A fake whose commands answer by kind: the unpacker prints the pinned Node version, `python3 --version` the
 * pinned Python, and the run command answers with `run` (or `runFor(i)` for the i-th sandbox).
 */
export function scriptedBackend(opts: {
  run?: ScriptedAnswer;
  runFor?: (i: number) => ScriptedAnswer;
  unpack?: ScriptedAnswer;
  python?: ScriptedAnswer;
  createError?: string;
  /** create waits for this before answering. */
  createGate?: Promise<void>;
} = {}): ModalBackend & { rec: Recorded } {
  const rec: Recorded = { specs: [], cmds: [], stdins: [], terminated: [] };
  let n = 0;
  return {
    rec,
    async createSandbox(spec) {
      rec.specs.push(spec);
      if (opts.createGate) await opts.createGate;
      if (opts.createError) throw new Error(opts.createError);
      const i = n++;
      const id = `sb-fake-${i}`;
      let kill!: () => void;
      const killed = new Promise<void>((r) => (kill = r));
      const sb: ModalSandbox = {
        sandboxId: id,
        async exec(cmd) {
          rec.cmds.push(cmd);
          let a: ScriptedAnswer;
          if (cmd[0] === NODE_BIN && cmd[1] === "-e") a = opts.unpack ?? { stdout: MODAL_IMAGE.nodeVersion };
          else if (cmd[0] === PYTHON_BIN) a = opts.python ?? { stdout: `${MODAL_IMAGE.pythonVersion}\n` };
          else a = opts.runFor?.(i) ?? opts.run ?? { stdout: "ok\n" };
          if (a.execError) throw new Error(a.execError);
          if (a.execHang) await killed;
          return scriptedProcess(a, (s) => rec.stdins.push(s), killed);
        },
        async terminate() {
          rec.terminated.push(id);
          kill();
        },
      };
      return sb;
    },
  };
}

const toWeb = (r: Readable): ReadableStream<string> => {
  r.setEncoding("utf8");
  return Readable.toWeb(r) as unknown as ReadableStream<string>;
};

/** Runs the executor's commands on this machine (see the header). */
export function emulatingBackend(): ModalBackend & { rec: Recorded } {
  const rec: Recorded = { specs: [], cmds: [], stdins: [], terminated: [] };
  let n = 0;
  return {
    rec,
    async createSandbox(spec) {
      rec.specs.push(spec);
      const id = `sb-emulated-${n++}`;
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-exec-modal-")));
      const children = new Set<ReturnType<typeof spawn>>();
      return {
        sandboxId: id,
        async exec(cmd) {
          rec.cmds.push(cmd);
          let file: string;
          let args: string[];
          let env: Record<string, string> = {};
          if (cmd[0] === PYTHON_BIN) {
            file = process.execPath;
            args = ["-e", `process.stdout.write(${JSON.stringify(MODAL_IMAGE.pythonVersion)})`];
          } else if (cmd[0] === NODE_BIN && cmd[1] === "-e") {
            file = process.execPath;
            // The real unpacker, into the temp folder; it prints this machine's Node version (pinned in the image).
            args = ["-e", cmd[2]!, dir];
          } else if (cmd[0] === "/usr/bin/env" && cmd[1] === "-i") {
            let i = 2;
            for (; cmd[i] !== "/usr/bin/setpriv"; i++) {
              const eq = cmd[i]!.indexOf("=");
              env[cmd[i]!.slice(0, eq)] = cmd[i]!.slice(eq + 1);
            }
            while (cmd[i] !== NODE_BIN && cmd[i] !== PYTHON_BIN) i++;
            if (cmd[i] === PYTHON_BIN) {
              // Hosted Python: this Mac's python3 with the same flags (-s -P -S -B), no sandbox-exec (the container's job).
              const py = findPython();
              if (!py) throw new Error("emulatingBackend: no python3 on this machine");
              file = py.foundAs;
            } else file = process.execPath;
            args = cmd.slice(i + 1).map((a) => a.replaceAll(SANDBOX_DIR, dir));
          } else throw new Error(`emulatingBackend: unexpected command ${cmd[0]}`);
          const child = spawn(file, args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
          children.add(child);
          child.stdin.on("error", () => {});
          let input = "";
          const exited = new Promise<number>((resolve, reject) => {
            child.on("error", reject);
            child.on("close", (code) => {
              children.delete(child);
              resolve(code ?? 137);
            });
          });
          return {
            stdin: {
              writeText: async (t: string) => {
                input += t;
                child.stdin.write(t);
              },
              close: async () => {
                rec.stdins.push(input);
                child.stdin.end();
              },
            },
            stdout: toWeb(child.stdout),
            stderr: toWeb(child.stderr),
            wait: () => exited,
          };
        },
        async terminate() {
          rec.terminated.push(id);
          for (const c of children) c.kill("SIGKILL");
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  };
}
