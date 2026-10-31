// R3 phase 2: a proof file's "what happened" path in the forked pencil engine, as a PNG. Optional: the engine needs the
// @napi-rs/canvas package, a dev dependency, so it is simply unavailable in the production image and the answer says so.
// Holds no code text: the spec is drawn from the run's trace and the verdicts.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moonwellFlow } from "../renderer/authors/moonwell";
import { whatHappened } from "../renderer/authors/what-happened";
import type { AtlasFile } from "../src/types";

/** Only this many images are kept; one is drawn at a time, because the engine holds the thread while it paints. */
const KEPT = 8;
const cache = new Map<string, Uint8Array>();
let busy: Promise<unknown> = Promise.resolve();

/** The PNG, or null when the pencil engine is not installed here or the run may not be drawn. */
export function pencilPng(runId: string, file: AtlasFile): Promise<Uint8Array | null> {
  const hit = cache.get(runId);
  if (hit) return Promise.resolve(hit);
  const next = busy.then(async () => {
    const run = file.runs[0];
    if (!run) return null;
    const human = file.bets.filter((b) => b.who === "human");
    const spec = run.runner === "evm" ? moonwellFlow({ run, bets: file.bets, verdicts: file.verdicts, fileCaptions: file.captions, seed: `proof:${runId}` }) : whatHappened({ run, ...(file.experiments[0] ? { experiment: file.experiments[0] } : {}), bets: human, verdicts: file.verdicts, seed: `proof:${runId}`, title: "What happened" });
    if (spec.notShown !== undefined) return null;
    let plate: typeof import("../renderer/export/plate");
    try {
      plate = await import("../renderer/export/plate");
    } catch {
      return null;
    }
    const dir = mkdtempSync(join(tmpdir(), "atlas-pencil-"));
    try {
      const out = join(dir, "plate.png");
      await plate.drawPlate(spec, { out, ppm: 6 });
      const png = readFileSync(out);
      if (cache.size >= KEPT) cache.delete(cache.keys().next().value!);
      cache.set(runId, png);
      return png as Uint8Array;
    } catch (e) {
      if (e instanceof plate.ExportUnavailable) return null;
      throw e;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  busy = next.catch(() => undefined);
  return next;
}
