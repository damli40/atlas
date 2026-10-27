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
// 4. TS only (S9, day-6 review): no added line may load or reach code from outside the file: no
//    import of any kind (static, dynamic import(), import.meta), no require / createRequire /
//    getBuiltinModule, no eval, no Function constructor (Function(...), .constructor), no computed
//    access on global / self / window / process, no globalThis at all (globalThis["fe"+"tch"]), no process.*
//    and no fetch. This is a strict SCREEN on the text, not the security boundary: text can always be
//    disguised in ways a screen misses. The boundary is the sandbox the code runs in
//    (runners/executor/local.ts: Node's permission model, no network, no file writes, no child
//    processes, only its own temp folder readable), and runners/ts/primordials.ts guards the record.
//    No added line may hold a lone carriage return either (M3): JavaScript runs the text after a "\r"
//    as code while a diff view can show it inside a comment.
// 5. Atlas's own reader places every hunk (src/diff.ts placeHunks: no hunk without an unchanged or
//    removed line, no hunk past the end of the file, no ambiguous place), and `git apply` in a scratch
//    copy of the target's exact bytes must give exactly the same bytes (S3). .atlas.json verify uses the
//    same placeHunks, so the file and the run always agree on the changed code.
// 6. Moonwell only: the changed config still parses by the same parser the runner uses
//    (runners/evm/apply.ts), and every name it uses resolves in the PR's own chains/8453.json
//    (the wrapper name is <oracle name>_OEV_WRAPPER, as mip-x43.sol's _wireCoreFeeds builds it).
//    An unknown name is "no usable change", never a guess.
//    D20 (decided Oct 27): when the ONLY reason the changed config cannot be wired is that a named
//    oracle has no "<name>_OEV_WRAPPER" while "<name>" itself IS in the PR's chains/8453.json, the change
//    is accepted in the separately named mode "theoretical-direct-wire": Atlas wires "<name>" directly on
//    the fork, and the change, the replay and every screen say "In theory". Neither name present: still
//    "no usable change". No address is ever invented.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { changedLineCount, parseUnifiedDiff, placeHunks, type DiffFile } from "../src/diff.ts";
import { loadAddressBook, MOONWELL_PR_COPY, parseBaseOracleConfigs, planFeedActions, THEORETICAL_DIRECT_WIRE, type PlannedFeedAction } from "./evm/apply.ts";
import { applyInScratch } from "./scratch.ts";

export const MAX_CHANGED_LINES = 200;

/** The proposal's config: the one Moonwell file a change may edit. */
export const MOONWELL_CONFIG_FILE = "proposals/ChainlinkOracleConfigs.sol";
/** The PR files the scratch copy holds (paths as in the PR). Only the config is editable. */
export const MOONWELL_SCRATCH_FILES = [MOONWELL_CONFIG_FILE, "proposals/mips/mip-x43/mip-x43.sol", "chains/8453.json"] as const;

/**
 * S9 (day-6 review): what an added TS line may not contain. A strict screen on the text (see rule 4 above);
 * the sandbox is the boundary. Each entry: the pattern, and what Atlas says in plain words.
 */
const FORBIDDEN_TS: [RegExp, string][] = [
  [/\bimport\b/, "an import (static, dynamic or import.meta)"],
  [/\brequire\b/, "a require"],
  [/\bcreateRequire\b/, "createRequire"],
  [/\bgetBuiltinModule\b/, "getBuiltinModule"],
  [/\beval\b/, "eval"],
  [/\bFunction\s*\(/, "the Function constructor"],
  [/\.\s*constructor\b|\[\s*["'`]constructor["'`]\s*\]/, "a .constructor access (it reaches the Function constructor)"],
  [/\bglobalThis\b/, "a use of globalThis"],
  [/\b(?:global|self|window|process)\s*\)?\s*(?:as\s+\w+\s*\)?\s*)?(?:\?\.)?\s*\[/, "a computed property access on a global object"],
  [/\bprocess\s*(?:\?\.|\.)/, "a use of process"],
  [/\bfetch\b/, "fetch"],
];

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
      /** D20: set when the config could be wired only by wiring a feed directly. */
      mode?: typeof THEORETICAL_DIRECT_WIRE;
      /** D20: the directly wired feeds (oracle name, market, address from the PR's address book). */
      directWired?: { oracleName: string; market: string; address: string }[];
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

/** Rule 4: the first added line that holds something the TS screen refuses, in plain words. */
export function forbiddenImport(files: DiffFile[]): string | null {
  for (const f of files) {
    for (const line of f.added) {
      for (const [re, what] of FORBIDDEN_TS) {
        if (re.test(line)) return `the change adds ${what}, which a change to this code may not add (network, file, process and code-loading access are refused)`;
      }
    }
  }
  return null;
}

/** S5: a path from the diff is named only when it is a file of this target; otherwise it is described. */
const pathName = (p: string | null, ctx: ChangeContext) => (p !== null && p in ctx.files ? p : "a file outside this target");

/** Rules 1–6, in that order. The first that fails is the reason. */
export async function checkChange(diff: string, ctx: ChangeContext): Promise<CheckedChange> {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) return parsed;
  const files = parsed.files;
  for (const f of files) {
    if (f.oldPath !== f.newPath) return { ok: false, reason: `the diff moves ${pathName(f.oldPath, ctx)} to ${pathName(f.newPath, ctx)}; only edits to existing files are allowed` };
    if (!ctx.editable.includes(f.newPath!)) {
      const known = f.newPath! in ctx.files;
      return {
        ok: false,
        reason: known
          ? `the diff touches ${f.newPath}, which may not change (only ${ctx.editable.join(", ")} may)`
          : `the diff touches a file outside this target (only ${ctx.editable.join(", ")} may change)`,
      };
    }
  }
  if (new Set(files.map((f) => f.newPath)).size !== files.length) return { ok: false, reason: "the diff names the same file twice" };
  const changedLines = changedLineCount(files);
  if (changedLines === 0) return { ok: false, reason: "the diff changes no lines" };
  if (changedLines > MAX_CHANGED_LINES) return { ok: false, reason: `the diff changes ${changedLines} lines; at most ${MAX_CHANGED_LINES} are allowed` };
  if (files.some((f) => f.added.some((l) => l.includes("\r")))) return { ok: false, reason: "an added line holds a carriage return on its own, which can hide code after it" };
  if (ctx.kind === "ts") {
    const bad = forbiddenImport(files);
    if (bad) return { ok: false, reason: bad };
  }
  // S3: Atlas's own reader places the change; git must give the same bytes.
  const placed: Record<string, string> = { ...ctx.files };
  for (const f of files) {
    const r = placeHunks(ctx.files[f.newPath!]!, f);
    if (!r.ok) return { ok: false, reason: `${f.newPath}: ${r.reason}` };
    placed[f.newPath!] = r.text;
  }
  const applied = await applyInScratch(ctx.files, diff);
  if (!applied.ok) return applied;
  for (const rel of Object.keys(ctx.files)) {
    if (applied.files[rel] !== placed[rel]) return { ok: false, reason: `git apply and Atlas's own reader place the change in ${rel} differently, so it is not tried` };
  }
  // The files that may not change must be byte-identical after `git apply` (belt and braces).
  for (const [rel, text] of Object.entries(ctx.files)) {
    if (!ctx.editable.includes(rel) && applied.files[rel] !== text) return { ok: false, reason: `${rel} changed in the scratch copy, and it may not` };
  }
  if (ctx.kind === "evm") {
    const wired = planChangedConfig(applied.files);
    if (!wired.ok) return wired;
    return { ok: true, diffFiles: files, changedLines, changedFiles: applied.files, ...wired.value };
  }
  return { ok: true, diffFiles: files, changedLines, changedFiles: applied.files };
}

/**
 * The Moonwell config after a change, wired by plain code: first by the proposal's own rule (every name
 * through "<name>_OEV_WRAPPER"); if that fails, by D20's theoretical-direct-wire mode (a missing wrapper
 * replaced by "<name>" itself, only when "<name>" is in the address book). Exported for .atlas.json verify.
 */
export function planChangedConfig(files: Record<string, string>):
  | { ok: true; value: { planned: PlannedFeedAction[]; mode?: typeof THEORETICAL_DIRECT_WIRE; directWired?: { oracleName: string; market: string; address: string }[] } }
  | { ok: false; reason: string } {
  let configs: ReturnType<typeof parseBaseOracleConfigs>;
  let book: ReturnType<typeof loadAddressBook>;
  try {
    configs = parseBaseOracleConfigs(files[MOONWELL_CONFIG_FILE]!);
    book = loadAddressBook(files["chains/8453.json"]!);
  } catch (e) {
    return { ok: false, reason: `the changed config cannot be wired: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (configs.length === 0) return { ok: false, reason: "the changed config wires no Base market at all" };
  try {
    return { ok: true, value: { planned: planFeedActions(configs, book) } };
  } catch (e) {
    const reason = `the changed config cannot be wired: ${e instanceof Error ? e.message : String(e)}`;
    try {
      const planned = planFeedActions(configs, book, { directWire: true });
      const direct = planned.filter((a) => a.directWire);
      if (direct.length === 0) return { ok: false, reason };
      return {
        ok: true,
        value: { planned, mode: THEORETICAL_DIRECT_WIRE, directWired: direct.map((a) => ({ oracleName: a.config.oracleName, market: a.config.mTokenKey, address: a.wrapper })) },
      };
    } catch {
      return { ok: false, reason };
    }
  }
}
