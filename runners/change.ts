// The plain-code checks on a proposed change, shared by the Fixer (before anything replays) and by
// both runners' replayWithChange (again, on the bytes they actually run).
//
// Plain words: a model may propose a diff; only this file decides whether Atlas will try it. A diff
// is tried only when ALL of these hold:
// 1. It is a unified diff of line edits to existing files (src/diff.ts): no new, deleted, renamed or
//    binary files.
// 2. It touches only the files this target allows to change:
//    - the TS fixture: the one target file;
//    - the Moonwell pull request: ONLY the proposal's config, proposals/ChainlinkOracleConfigs.sol
//      (which oracle name is wired for which market). Never Moonwell's contracts, never mip-x43.sol,
//      never chains/8453.json (the address book).
// 3. It changes at most 200 lines (added + removed).
// 4. TS only: no added line imports a network, file-system or process module, and none calls fetch.
// 5. `git apply --check` accepts it in a scratch copy of the target's exact bytes.
// 6. Moonwell only: the changed config still parses by the same parser the runner uses
//    (runners/evm/apply.ts), and every name it uses resolves in the PR's own chains/8453.json
//    (the wrapper name is <oracle name>_OEV_WRAPPER, as mip-x43.sol's _wireCoreFeeds builds it).
//    An unknown name is "no usable change", never a guess.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { changedLineCount, parseUnifiedDiff, type DiffFile } from "../src/diff.ts";
import { loadAddressBook, MOONWELL_PR_COPY, parseBaseOracleConfigs, planFeedActions, type PlannedFeedAction } from "./evm/apply.ts";
import { applyInScratch } from "./scratch.ts";

export const MAX_CHANGED_LINES = 200;

/** The proposal's config: the one Moonwell file a change may edit. */
export const MOONWELL_CONFIG_FILE = "proposals/ChainlinkOracleConfigs.sol";
/** The PR files the scratch copy holds (paths as in the PR). Only the config is editable. */
export const MOONWELL_SCRATCH_FILES = [MOONWELL_CONFIG_FILE, "proposals/mips/mip-x43/mip-x43.sol", "chains/8453.json"] as const;

/** Module names an added TS line may not import (with or without "node:"). */
const FORBIDDEN_MODULE = /^(node:)?(fetch|https?|http2|net|tls|dgram|dns|child_process|cluster|worker_threads|fs|fs\/promises|undici)(\/.*)?$/;
/** Import forms: static import/export-from, side-effect import, dynamic import(), require(). */
const IMPORT_SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;

export interface ChangeContext {
  kind: "ts" | "evm";
  /** Every file of the scratch copy: relative path → the exact text Atlas read. */
  files: Record<string, string>;
  /** The paths a change may edit. */
  editable: string[];
}

export type CheckedChange =
  | {
      ok: true;
      diffFiles: DiffFile[];
      changedLines: number;
      /** Every file after the change, as `git apply` left it in the scratch copy. */
      changedFiles: Record<string, string>;
      /** Moonwell only: the actions re-derived from the changed config by runners/evm/apply.ts. */
      planned?: PlannedFeedAction[];
    }
  | { ok: false; reason: string };

/** The scratch-copy context for the withRpcRetry fixture (or any one-file TS target). */
export function tsChangeContext(ref: string, text: string): ChangeContext {
  return { kind: "ts", files: { [ref]: text }, editable: [ref] };
}

/** The scratch-copy context for Moonwell PR #578: the three PR files Atlas reads, config editable. */
export function moonwellChangeContext(dir = MOONWELL_PR_COPY): ChangeContext {
  const files: Record<string, string> = {};
  for (const rel of MOONWELL_SCRATCH_FILES) files[rel] = readFileSync(join(dir, rel), "utf8");
  return { kind: "evm", files, editable: [MOONWELL_CONFIG_FILE] };
}

/** Rule 4: the first added line that imports a forbidden module or calls fetch, in plain words. */
export function forbiddenImport(files: DiffFile[]): string | null {
  for (const f of files) {
    for (const line of f.added) {
      for (const m of line.matchAll(IMPORT_SPECIFIERS)) {
        if (FORBIDDEN_MODULE.test(m[1]!)) return `the change adds an import of "${m[1]}" in ${f.newPath} (network, file-system and process modules are not allowed)`;
      }
      if (/\bfetch\s*\(/.test(line)) return `the change adds a call to fetch in ${f.newPath} (network calls are not allowed)`;
      if (/\bprocess\s*\.\s*(binding|dlopen)\b/.test(line)) return `the change reaches into process internals in ${f.newPath}`;
    }
  }
  return null;
}

/** Rules 1–6, in that order. The first that fails is the reason. */
export async function checkChange(diff: string, ctx: ChangeContext): Promise<CheckedChange> {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) return parsed;
  const files = parsed.files;
  for (const f of files) {
    if (f.oldPath !== f.newPath) return { ok: false, reason: `the diff moves ${f.oldPath ?? "/dev/null"} to ${f.newPath ?? "/dev/null"}; only edits to existing files are allowed` };
    if (!ctx.editable.includes(f.newPath!)) {
      const known = f.newPath! in ctx.files;
      return {
        ok: false,
        reason: known
          ? `the diff touches ${f.newPath}, which may not change (only ${ctx.editable.join(", ")} may)`
          : `the diff touches ${f.newPath}, which is not a file of this target (only ${ctx.editable.join(", ")} may change)`,
      };
    }
  }
  const changedLines = changedLineCount(files);
  if (changedLines === 0) return { ok: false, reason: "the diff changes no lines" };
  if (changedLines > MAX_CHANGED_LINES) return { ok: false, reason: `the diff changes ${changedLines} lines; at most ${MAX_CHANGED_LINES} are allowed` };
  if (ctx.kind === "ts") {
    const bad = forbiddenImport(files);
    if (bad) return { ok: false, reason: bad };
  }
  const applied = await applyInScratch(ctx.files, diff);
  if (!applied.ok) return applied;
  // The files that may not change must be byte-identical after `git apply` (belt and braces).
  for (const [rel, text] of Object.entries(ctx.files)) {
    if (!ctx.editable.includes(rel) && applied.files[rel] !== text) return { ok: false, reason: `${rel} changed in the scratch copy, and it may not` };
  }
  if (ctx.kind === "evm") {
    let planned: PlannedFeedAction[];
    try {
      const configs = parseBaseOracleConfigs(applied.files[MOONWELL_CONFIG_FILE]!);
      planned = planFeedActions(configs, loadAddressBook(applied.files["chains/8453.json"]!));
    } catch (e) {
      return { ok: false, reason: `the changed config cannot be wired: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (planned.length === 0) return { ok: false, reason: "the changed config wires no Base market at all" };
    return { ok: true, diffFiles: files, changedLines, changedFiles: applied.files, planned };
  }
  return { ok: true, diffFiles: files, changedLines, changedFiles: applied.files };
}
