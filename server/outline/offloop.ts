// X1 review round 2 (B2): runs the code map and the outline check off the server's event loop
// (server/outline/map-child.ts in its own Node process), with a wall-clock limit as a backstop on top of the
// counted work budgets in src/outline/codemap.ts and src/outline/verify.ts.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { OutlineSectionInput } from "../../src/outline/section";
import type { CodeMap, ConfigFile, OutlineFile, OutlineSection } from "../../src/outline/types";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CHILD = fileURLToPath(new URL("./map-child.ts", import.meta.url));
/** The most one map or one check may take before its process is killed. */
export const OFF_LOOP_LIMIT_MS = 60_000;
/** The largest answer read back (a section holds at most 300 KB of code plus its map). */
const MAX_ANSWER_BYTES = 64 * 1024 * 1024;

export class OffLoopError extends Error {}

function run<T>(request: unknown, limitMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CHILD], { cwd: REPO_ROOT, env: { PATH: process.env.PATH ?? "" }, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (f: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      f();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new OffLoopError(`plain code took longer than ${Math.round(limitMs / 1000)} s on this codebase, so Atlas stopped it`)));
    }, limitMs);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > MAX_ANSWER_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new OffLoopError("the code map's answer was larger than Atlas reads")));
      } else out.push(b);
    });
    child.stderr.on("data", () => {});
    child.on("error", () => finish(() => reject(new OffLoopError("the code-map process could not start"))));
    child.on("close", () =>
      finish(() => {
        try {
          const a = JSON.parse(Buffer.concat(out).toString("utf8")) as { ok: boolean; reason?: string } & T;
          if (a.ok) resolve(a);
          else reject(new OffLoopError(a.reason ?? "the code-map process gave no answer"));
        } catch {
          reject(new OffLoopError("the code-map process gave no answer"));
        }
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export interface OffLoop {
  map(files: OutlineFile[], configFiles: ConfigFile[]): Promise<CodeMap>;
  section(input: OutlineSectionInput): Promise<OutlineSection>;
}

export function childProcessOffLoop(limitMs = OFF_LOOP_LIMIT_MS): OffLoop {
  return {
    map: async (files, configFiles) => (await run<{ codeMap: CodeMap }>({ op: "map", files, configFiles }, limitMs)).codeMap,
    section: async (input) => (await run<{ section: OutlineSection }>({ op: "section", input }, limitMs)).section,
  };
}
