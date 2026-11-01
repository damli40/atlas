// R3: a proof file's drawing in the forked pencil engine, as a PNG. Optional: the engine needs the @napi-rs/canvas package, a
// dev dependency, so it is simply unavailable in the production image and the answer says so. Holds no code text: the spec is
// drawn from the run's trace and the verdicts.
//
// R3 review B8: the engine took 150 s on the server's only thread for a 141-step path, so nothing else answered. Now:
// - it runs in a separate process (server/pencil-worker.ts) with a kill limit and a memory limit, so /health stays fast;
// - a long path is refused before any drawing starts;
// - one drawing at a time. Asking for the run already being drawn shares that drawing; asking for another is told to retry;
// - each code has an hourly limit, counted only for a drawing that really starts; a finished image is kept per run.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { specOfFile } from "../renderer/authors/from-file";
import type { AtlasFile } from "../src/types";

export type PencilAnswer =
  | { kind: "ok"; png: Uint8Array }
  /** The engine is not installed on this server. */
  | { kind: "no-engine" }
  /** This run has no drawing: words say why. */
  | { kind: "not-drawn"; words: string }
  /** Too long for pencil. */
  | { kind: "too-long"; words: string }
  /** Another drawing is under way, or this code has used its hour. */
  | { kind: "busy"; words: string }
  | { kind: "failed"; words: string };

export const PENCIL_WORDS = {
  noEngine: "This server has no pencil engine; the drawing above is the same chart.",
  notDrawn: "This run has no drawing to put in pencil.",
  tooLong: (steps: number, max: number) => `This path has ${steps} steps; pencil draws up to ${max}. The drawing above is the same chart.`,
  busy: "The pencil is drawing something else. Try again in a moment.",
  timedOut: (s: number) => `The pencil drawing was stopped after ${s} seconds. The drawing above is the same chart.`,
  failed: "The pencil drawing failed. The drawing above is the same chart.",
} as const;

export interface PencilOptions {
  /** The worker script: tests pass a fake one. */
  worker?: string;
  killAfterMs?: number;
  maxSteps?: number;
  /** Says whether this client may start one more drawing; counts it if so. */
  take?: (client: string) => { ok: true } | { ok: false; reason: string };
}

const KEPT = 8;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export function createPencil(o: PencilOptions = {}) {
  const worker = o.worker ?? join(here, "pencil-worker.ts");
  const killAfterMs = o.killAfterMs ?? 30_000;
  const maxSteps = o.maxSteps ?? 30;
  const cache = new Map<string, Uint8Array>();
  let drawing: { runId: string; done: Promise<PencilAnswer> } | null = null;

  const inChild = (specJson: string): Promise<PencilAnswer> =>
    new Promise((resolve) => {
      const dir = mkdtempSync(join(tmpdir(), "atlas-pencil-"));
      const specPath = join(dir, "spec.json");
      const out = join(dir, "plate.png");
      writeFileSync(specPath, specJson);
      // No secrets: the child gets only what it needs to start.
      const child = spawn(process.execPath, ["--max-old-space-size=768", "--import", "tsx", worker, specPath, out], { cwd: root, stdio: "ignore", env: { PATH: process.env.PATH ?? "", ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) } });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, killAfterMs);
      const finish = (a: PencilAnswer) => {
        clearTimeout(timer);
        rmSync(dir, { recursive: true, force: true });
        resolve(a);
      };
      child.on("error", () => finish({ kind: "failed", words: PENCIL_WORDS.failed }));
      child.on("close", (code) => {
        if (timedOut) return finish({ kind: "failed", words: PENCIL_WORDS.timedOut(Math.round(killAfterMs / 1000)) });
        if (code === 3) return finish({ kind: "no-engine" });
        if (code === 4) return finish({ kind: "not-drawn", words: PENCIL_WORDS.notDrawn });
        if (code !== 0) return finish({ kind: "failed", words: PENCIL_WORDS.failed });
        try {
          finish({ kind: "ok", png: new Uint8Array(readFileSync(out)) });
        } catch {
          finish({ kind: "failed", words: PENCIL_WORDS.failed });
        }
      });
    });

  return {
    draw(runId: string, file: AtlasFile, client: string): Promise<PencilAnswer> {
      const hit = cache.get(runId);
      if (hit) return Promise.resolve({ kind: "ok", png: hit });
      if (drawing?.runId === runId) return drawing.done;
      const spec = specOfFile(file, `proof:${runId}`);
      if (!spec || spec.notShown !== undefined) return Promise.resolve({ kind: "not-drawn", words: spec?.notShown ?? PENCIL_WORDS.notDrawn });
      const steps = Math.max(spec.steps.length, spec.nodes.length);
      if (steps > maxSteps) return Promise.resolve({ kind: "too-long", words: PENCIL_WORDS.tooLong(steps, maxSteps) });
      if (drawing) return Promise.resolve({ kind: "busy", words: PENCIL_WORDS.busy });
      const allowed = o.take?.(client) ?? { ok: true as const };
      if (!allowed.ok) return Promise.resolve({ kind: "busy", words: allowed.reason });
      const done = inChild(JSON.stringify(spec)).then((a) => {
        drawing = null;
        if (a.kind === "ok") {
          if (cache.size >= KEPT) cache.delete(cache.keys().next().value!);
          cache.set(runId, a.png);
        }
        return a;
      });
      drawing = { runId, done };
      return done;
    },
  };
}
