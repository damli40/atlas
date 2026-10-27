// E3 review r2 M1: sandbox run folders left behind by a run that was cut short (the server died mid-run).
//
// Plain words: every run writes the pasted file into a fresh temporary folder (atlas-exec-*, atlas-pyexec-*,
// atlas-pyprofile-*) and deletes the folder when the run ends. If the server process dies during a run, the folder
// stays. At startup Atlas deletes such folders. Only folders older than LEFTOVER_AGE_MS are touched: a run lasts at
// most a few seconds of real time, so a younger folder may belong to another Atlas server on the same machine.

import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SANDBOX_DIR_PREFIXES = ["atlas-exec-", "atlas-pyexec-", "atlas-pyprofile-"] as const;
export const LEFTOVER_AGE_MS = 10 * 60 * 1000;

/** Deletes leftover sandbox folders older than `ageMs` in `dir` (default: the OS temp folder). Returns how many. */
export function removeSandboxLeftovers(dir: string = tmpdir(), ageMs: number = LEFTOVER_AGE_MS, now: number = Date.now()): number {
  let removed = 0;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!SANDBOX_DIR_PREFIXES.some((p) => name.startsWith(p))) continue;
    const full = join(dir, name);
    try {
      if (now - statSync(full).mtimeMs < ageMs) continue;
      rmSync(full, { recursive: true, force: true });
      removed++;
    } catch {
      // gone already, or not ours to delete
    }
  }
  return removed;
}
