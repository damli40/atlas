// The Fixer: Muse Code proposes a change to the code, toward what the bettors expected.
//
// Plain words on who decides what:
// - Muse Code (Meta's coding agent, the `muse` CLI) runs HEADLESS (`muse exec --json`) with a
//   scratch copy of the target's files as its only workspace AND its working directory. It may read
//   those files; it may NOT write them (--disable-write), run a shell (--disable-shell), use the web
//   (--disable-web-tools), ask a person anything (--disable-request-user-input), have an LLM judge
//   approve a tool call (--approval-judge off) or load anyone's personal skills (a fresh, empty HOME
//   and --no-foreign-personal-context). Its environment holds only PATH, that empty HOME and TMPDIR,
//   and MUSE_NO_AUTO_UPDATE=1; it authenticates with the Meta key on stdin (--api-key-stdin) and
//   nothing else (S8, day-6 review). Its answer is text: the instruction asks for a unified diff only.
// - S4 (day-6 review): the model is named (--model muse-spark-1.3) and contributor mode is asked OFF.
//   Before any code is sent, a one-step PREFLIGHT run with an empty workspace and no code asks for
//   "OK" and reads which model id muse exec reports; Atlas sends the code only when that id is one it
//   knows (server/meta/client.ts KNOWN_META_MODELS) and not a contributor model. After the real run,
//   every model id muse exec reports (in its JSON events) and any "contributor" in its stdout or stderr
//   is checked again; an unknown, missing or contributor id means the answer is not used. Honestly: a
//   refusal AFTER the run cannot un-send the code; the preflight is what keeps it from being sent.
// - S8: the raw answer is scrubbed (key, secret shapes, the RPC URL, absolute paths) before it is kept,
//   and it never goes to the browser: POST /changes returns only the diff that plain code accepted.
// - If `muse exec` cannot give an answer at all (missing binary, no key, timeout, a failed run),
//   the fallback is one muse-spark-1.3 chat completion with the same prompt. The log says which
//   path ran and which model id answered.
// - What the bettors expected (`toward`) is written HERE by plain code from the sealed bets that
//   did not match the run: who bet, the question, their sealed answer, what the run measured.
//   Never a model's rationale.
// - Only plain code (runners/change.ts) decides whether the diff is tried: it must touch only the
//   files that may change, change at most 200 lines, add no network/file/process import (TS), edit
//   only the proposal's config and name only addresses the PR's own address book holds (Moonwell),
//   and `git apply --check` must accept it in a scratch copy. One repair try with the reason; then
//   "Muse Code: no usable change (<reason>)", and nothing replays. Nothing is invented and the diff
//   is never edited by hand: whatever Muse Code proposes is the result.
// - Only the diff is ever shown. Any sentence the model wrote around it is dropped.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extractDiff } from "../../../src/diff";
import type { Experiment } from "../../../src/types";
import { changeProposer } from "../../../src/claimants";
import { redactSecret } from "../redact-secret";
import { checkChange, MAX_CHANGED_LINES, type ChangeContext, type CheckedChange } from "../../../runners/change";
import { makeScratch } from "../../../runners/scratch";
import { chat as realChat, costUsd, DEFAULT_USAGE_PATH, loadApiKey, modelRefusal, priceFor, shownModelId, type ChatArgs, type ChatResult, type Usage } from "../client";
import { redactRpc } from "../../../runners/evm/redact";
import { oneLine, type SessionEmitter } from "../../log/agentlog";
import { addUsage, COST_UNKNOWN, NO_USAGE, numbered } from "./claimant";
import { DEFAULT_WATCH_LIMIT_MS } from "../../../runners/ts/harness";
import { lineSpan, plural } from "../../../src/words";

export const FIXER_INSTRUCTION = "Change the code toward what the bettors expected. Do not explain whether the original was right. Output a unified diff only.";
/** What the screen calls the agent (D10: Meta's names stay visible). */
export const MUSE_CODE = "Muse Code";
export const FIXER_FALLBACK_MODEL = "muse-spark-1.3";
/**
 * The model Muse Code is asked to use. Named explicitly: on Oct 27 a run with only
 * `--contributor-mode off` still reported "muse-spark-1.3-contributor" (tests/evidence/D06-01).
 */
export const FIXER_MUSE_MODEL = "muse-spark-1.3";
export { CHANGE_CAPTION } from "../../../src/change";
export const MUSE_BIN_DEFAULT = join(homedir(), ".local", "bin", "muse");
export const MUSE_TIMEOUT_MS = 240_000;
/**
 * Muse Code's model steps per attempt. Was 3 on Oct 27; on the Moonwell PR that ended Muse Code's try
 * while it was still reading (tests/evidence/D06-01), so it is 6 now. Each step re-sends the context
 * (about 35–45k tokens here), so 6 steps cost at most about $1.10 at the unverified upper-bound price.
 */
export const MUSE_MAX_STEPS = 6;
/** Tool output fed back per call (bytes): keeps a read of the 41 KB address book from filling the context. */
export const MUSE_MAX_TOOL_OUTPUT_BYTES = 20_000;

export type FixerPath = "muse-exec" | "chat-fallback";

export interface FixerInput {
  /** The scratch-copy files and which of them may change (runners/change.ts). */
  context: ChangeContext;
  /** The place in the code the round worked on. */
  finding: { file: string; lineStart: number; lineEnd: number };
  /** Plain-code text from towardFromBets(). */
  toward: string;
  experiment: Experiment;
  /** EVM: the fork block the original run used (said in the prompt). */
  forkBlock?: number;
}

/**
 * `models`: every model id muse exec reported in its usage events (S4). `contributorSeen`: the word
 * "contributor" appeared anywhere in its stdout or stderr.
 */
export type MuseExecResult =
  | { ok: true; text: string; model: string; usage?: Usage; models?: string[]; contributorSeen?: boolean }
  | { ok: false; reason: string; model?: string; usage?: Usage; models?: string[]; contributorSeen?: boolean };

/** Runs `muse exec` once with this workspace and prompt. Injected in tests. `maxSteps` defaults to MUSE_MAX_STEPS. */
export type MuseExec = (req: { files: Record<string, string>; prompt: string; timeoutMs: number; maxSteps?: number }) => Promise<MuseExecResult>;

/** S4: the preflight's prompt. No code, no file content, nothing from the round. */
export const PREFLIGHT_PROMPT = "Reply with the single word OK.";
export const PREFLIGHT_TIMEOUT_MS = 60_000;

export interface FixerAttempt {
  attempt: number;
  path: FixerPath;
  model: string;
  ok: boolean;
  /** Why the answer was not used (absent when it was). */
  reason?: string;
  usage?: Usage;
  /** The model's whole answer, kept for the record (evidence). Never rendered as Atlas's words: the page shows only the diff. */
  answer?: string;
  /** True when the model id that answered is a "-contributor" model (Meta may train on its inputs). */
  contributorModel?: boolean;
}

export type FixerResult =
  | { ok: true; diff: string; path: FixerPath; model: string; attempts: FixerAttempt[]; usage?: Usage; checked: Extract<CheckedChange, { ok: true }> }
  | { ok: false; reason: string; path: FixerPath; model: string; attempts: FixerAttempt[]; usage?: Usage };

export interface FixerDeps {
  /** Default: the real `muse exec`. Pass null to skip Muse Code and go straight to the chat fallback. */
  museExec?: MuseExec | null;
  /**
   * S4: the no-code preflight run that shows which model muse exec routes to before any code is sent.
   * Default: the real `muse exec` when museExec is the real one; none when a test injects museExec.
   */
  musePreflight?: MuseExec | null;
  chat?: (args: ChatArgs) => Promise<ChatResult>;
  /** Wraps each model call (the server passes its budget's track()). Default: the call runs as is. */
  guard?: <R extends { usage?: { usd: number } }>(call: () => Promise<R>, refused: (reason: string) => R) => Promise<R>;
  log?: Pick<SessionEmitter, "emit" | "model">;
  /**
   * Which path the one repair try uses when Muse Code answered but plain code refused the diff:
   * "same" (default: Muse Code again) or "chat-fallback" (the muse-spark-1.3 chat, once).
   */
  repairWith?: "same" | "chat-fallback";
  /** Where the muse path's usage lines go. Default: ATLAS_USAGE_PATH, else tests/evidence/usage/usage.jsonl. */
  usagePath?: string;
  now?: () => Date;
}

export { towardFromBets } from "../../../src/change";

// ── the prompt ──────────────────────────────────────────────────────────────────────────────────

function fullFile(path: string, text: string): string {
  return `=== ${path} (lines 1–${text.split("\n").length}) ===\n${numbered(text, 1, text.split("\n").length)}`;
}

/**
 * Moonwell: the names in the PR's own address book (chains/8453.json) that name an oracle, exactly as
 * written there, in file order. Plain data a developer editing the config would look up; no name is
 * singled out and nothing is said about which to use.
 */
export function oracleNamesIn(chainsJson: string): string[] {
  const rows = JSON.parse(chainsJson) as Array<{ name?: unknown }>;
  return rows.map((r) => r.name).filter((n): n is string => typeof n === "string" && (/ORACLE/.test(n) || /^CHAINLINK_/.test(n)));
}

function oracleNamesSection(ctx: ChangeContext): string[] {
  const book = ctx.files["chains/8453.json"];
  if (book === undefined) return [];
  const names = oracleNamesIn(book);
  return ["", `Oracle names that exist in chains/8453.json (${names.length}, names only, in file order):`, names.join("\n")];
}

export function buildFixerPrompt(input: FixerInput): string {
  const { context: ctx, finding } = input;
  const findingText = ctx.files[finding.file];
  const readOnly = Object.keys(ctx.files).filter((f) => !ctx.editable.includes(f));
  const parts = [
    FIXER_INSTRUCTION,
    "",
    "Your workspace is a scratch copy of the code. Plain code will apply your diff to that copy, run the same experiment again with the same inputs, and compare the same sealed bets with what the changed code does.",
    "",
    `Files you may change: ${ctx.editable.join(", ")}.`,
    ...(readOnly.length ? [`Read-only (a diff that touches them is refused): ${readOnly.join(", ")}.`] : []),
    `The diff must be a unified diff with paths relative to the workspace root and a/ b/ prefixes (for example "--- a/${ctx.editable[0]}" and "+++ b/${ctx.editable[0]}"), at most ${MAX_CHANGED_LINES} changed lines, editing existing files only.`,
    ...(ctx.kind === "ts"
      ? [
          "Do not add imports of network, file-system or process modules, and do not call fetch.",
          `How the experiment runs: a harness calls withRpcRetry(label, fn, opts) and passes opts.sleep and opts.log. Time passes only through opts.sleep (a virtual clock). A real timer (setTimeout) is outside the harness's control, and a run that waits on one is reported as "can't check". Atlas stops watching after ${DEFAULT_WATCH_LIMIT_MS} ms of virtual time; a run still going then is also reported as "can't check".`,
          `The experiment: ${JSON.stringify(input.experiment.params)}.`,
        ]
      : [
          "Only the proposal's configuration may change. Moonwell's contracts, the proposal script and the address book (chains/8453.json) may not change.",
          `How the experiment runs: Atlas forks Base at block ${input.forkBlock ?? "(the original run's block)"}, derives the proposal's setFeed actions from proposals/ChainlinkOracleConfigs.sol the way proposals/mips/mip-x43/mip-x43.sol's _wireCoreFeeds does (both files are in the workspace), applies them as the oracle's admin, and reads ChainlinkOracle.getUnderlyingPrice for each market.`,
          `The experiment: ${JSON.stringify(input.experiment.params)}.`,
          ...oracleNamesSection(ctx),
        ]),
    "",
    `The place in the code (${finding.file}, ${lineSpan(finding.lineStart, finding.lineEnd)}):`,
    findingText !== undefined ? numbered(findingText, finding.lineStart, finding.lineEnd) : "(not in the workspace)",
    "",
    "What the bettors expected (written by plain code from their sealed bets; each of these did not match the run):",
    input.toward,
    "",
    ...ctx.editable.map((f) => fullFile(f, ctx.files[f]!)),
    "",
    FIXER_INSTRUCTION,
  ];
  return parts.join("\n");
}

export function repairPrompt(base: string, reason: string, previous: string | null): string {
  return [
    base,
    "",
    `Your previous answer could not be used: ${reason}.`,
    ...(previous ? ["Your previous diff was:", previous] : []),
    "Output a unified diff only.",
  ].join("\n");
}

// ── Muse Code, headless ─────────────────────────────────────────────────────────────────────────

/** The `muse exec` arguments, in one place (the README lists them). */
export function museArgs(workspace: string, promptFile: string, maxSteps: number = MUSE_MAX_STEPS): string[] {
  return [
    "exec",
    "--json",
    "--api-key-stdin",
    "--workspace", workspace,
    "--model", FIXER_MUSE_MODEL,
    "--contributor-mode", "off",
    "--disable-web-tools",
    "--disable-shell",
    "--disable-write",
    "--disable-request-user-input",
    "--approval-mode", "never",
    "--approval-judge", "off",
    "--no-foreign-personal-context",
    "--disable-reminders",
    "--no-session-log",
    "--reasoning-effort", "low",
    "--max-model-steps", String(maxSteps),
    "--max-tool-output-bytes", String(MUSE_MAX_TOOL_OUTPUT_BYTES),
    "--prompt-file", promptFile,
  ];
}

interface MuseEvent {
  payload_type?: string;
  payload?: {
    terminal?: string;
    text?: string | null;
    reason?: string | null;
    models?: { model?: string | null; input_tokens?: number; output_tokens?: number; reasoning_tokens?: number }[];
  };
}

/** Reads `muse exec --json` stdout (JSON lines). Pure; exported for tests. */
export function parseMuseJsonl(stdout: string): MuseExecResult {
  let text: string | null = null;
  let terminal: string | null = null;
  let termReason: string | null = null;
  let model: string | undefined;
  const models: string[] = [];
  let usage: Usage | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let ev: MuseEvent;
    try {
      ev = JSON.parse(line) as MuseEvent;
    } catch {
      continue;
    }
    if (ev.payload_type === "run.usage" && Array.isArray(ev.payload?.models)) {
      for (const m of ev.payload.models) {
        if (m.model) model ??= m.model;
        // S4: every reported id is kept and checked, not only the first.
        if (typeof m.model === "string" && !models.includes(m.model)) models.push(m.model);
        const promptTokens = m.input_tokens ?? 0;
        const completionTokens = m.output_tokens ?? 0;
        // Cached input tokens are counted at the full input price: the logged cost is an upper bound.
        const u: Usage = { promptTokens, completionTokens, ...(m.reasoning_tokens !== undefined ? { reasoningTokens: m.reasoning_tokens } : {}), usd: costUsd(m.model ?? FIXER_FALLBACK_MODEL, promptTokens, completionTokens) };
        usage = addUsage(usage, u);
      }
    }
    if (typeof ev.payload_type === "string" && ev.payload_type.startsWith("run.terminal.")) {
      terminal = ev.payload?.terminal ?? ev.payload_type.slice("run.terminal.".length);
      text = ev.payload?.text ?? null;
      termReason = ev.payload?.reason ?? null;
    }
  }
  const m = model ?? "unknown (muse exec reported no model id)";
  const extra = { model: m, models, contributorSeen: /contributor/i.test(stdout), ...(usage ? { usage } : {}) };
  if (terminal === null) return { ok: false, reason: "muse exec ended without a final answer", ...extra };
  if (terminal !== "completed") return { ok: false, reason: `muse exec ended "${terminal}"${termReason ? ` (${termReason})` : ""}`, ...extra };
  if (!text || !text.trim()) return { ok: false, reason: "muse exec completed with an empty answer", ...extra };
  return { ok: true, text, ...extra };
}

// ── S8: the OS sandbox around muse exec ─────────────────────────────────────────────────────────
//
// Plain words: on Oct 27 a live probe (tests/evidence/D06-review/s8-live-probe.txt) showed that Muse
// Code's own file tools READ a file outside its workspace when given an absolute path, with every flag
// above set. So Atlas does not rely on muse's own policy. On macOS, muse exec runs inside the OS sandbox
// (sandbox-exec) with a profile that refuses to read or write the contents of anything under the user's
// home folder, /private/tmp or /private/var/folders, except: the scratch workspace, muse's empty HOME,
// and the folder the muse program itself is installed in. Network stays open (muse must reach Meta's
// API). File NAMES and sizes outside stay visible (stat is allowed: muse fails to start without it);
// file CONTENTS do not. Where no OS sandbox exists (any non-macOS machine), muse exec is not run at all
// and the Fixer goes to the chat fallback, which has no file access.

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** Quotes a path for the sandbox profile language (a string literal). */
const sbString = (p: string) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The sandbox profile for one muse exec run. Paths must be real paths (no symlinks: /var is /private/var). */
export function museSandboxProfile(o: { workspace: string; home: string; museDir: string; userHome: string }): string {
  const denied = [o.userHome, "/private/tmp", "/private/var/folders"];
  return [
    "(version 1)",
    "(allow default)",
    ...denied.map((d) => `(deny file-read-data file-write* (subpath ${sbString(d)}))`),
    `(allow file-read-data (subpath ${sbString(o.museDir)}))`,
    `(allow file-read-data file-write* (subpath ${sbString(o.workspace)}) (subpath ${sbString(o.home)}))`,
    "",
  ].join("\n");
}

/** The OS sandbox command on this machine, or null when there is none Atlas can use. */
export function osSandbox(): string | null {
  return process.platform === "darwin" && existsSync(SANDBOX_EXEC) ? SANDBOX_EXEC : null;
}

/** The real `muse exec`: scratch workspace, empty HOME, key on stdin, OS sandbox, hard time limit. */
export function realMuseExec(opts: { bin?: string; apiKey?: string } = {}): MuseExec {
  return async ({ files, prompt, timeoutMs, maxSteps }) => {
    const key = opts.apiKey ?? loadApiKey();
    if (!key) return { ok: false, reason: "no Meta API key for muse exec" };
    const bin = process.env.ATLAS_MUSE_BIN ?? opts.bin ?? MUSE_BIN_DEFAULT;
    const sandbox = osSandbox();
    if (!sandbox) return { ok: false, reason: "muse exec not run: this machine has no OS sandbox Atlas can use to keep Muse Code inside its workspace" };
    const scratch = await makeScratch(files, "atlas-muse-ws-");
    const home = realpathSync(mkdtempSync(join(tmpdir(), "atlas-muse-home-")));
    const workspace = realpathSync(scratch.dir);
    const promptFile = join(home, "prompt.txt"); // outside the workspace: Muse Code reads it as the prompt only
    writeFileSync(promptFile, prompt);
    const profile = join(home, "atlas-muse.sb");
    writeFileSync(profile, museSandboxProfile({ workspace, home, museDir: dirname(realpathSync(bin)), userHome: realpathSync(homedir()) }));
    const scrub = (s: string) => redactSecret(s, key).split(workspace).join("<scratch>").split(scratch.dir).join("<scratch>").split(home).join("<home>");
    try {
      return await new Promise<MuseExecResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const done = (r: MuseExecResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        };
        const child = spawn(sandbox, ["-f", profile, bin, ...museArgs(workspace, promptFile, maxSteps)], {
          // S8: the working directory is the scratch copy, so a relative path resolves inside it.
          cwd: workspace,
          // A fresh, empty HOME: no personal skills, rules, ~/.config or stored credentials reach the run.
          // Nothing else is inherited. Muse authenticates with the key on stdin only (--api-key-stdin);
          // MUSE_NO_AUTO_UPDATE=1 keeps its launcher from updating itself over the network mid-run.
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: home, MUSE_NO_AUTO_UPDATE: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          const parsed = parseMuseJsonl(stdout);
          done({ ok: false, reason: `muse exec did not finish within ${Math.round(timeoutMs / 1000)} s`, ...(parsed.model ? { model: parsed.model } : {}), ...(parsed.usage ? { usage: parsed.usage } : {}) });
        }, timeoutMs);
        child.stdout.on("data", (d: Buffer) => {
          if (stdout.length < 32 * 1024 * 1024) stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d: Buffer) => {
          if (stderr.length < 64 * 1024) stderr += d.toString("utf8");
        });
        child.on("error", (e) => done({ ok: false, reason: `muse exec could not start: ${scrub(e.message)}` }));
        child.on("close", (code) => {
          const parsed0 = parseMuseJsonl(stdout);
          // S4: "contributor" anywhere in stdout OR stderr counts.
          const parsed = { ...parsed0, contributorSeen: parsed0.contributorSeen === true || /contributor/i.test(stderr) } as MuseExecResult;
          if (code !== 0 && parsed.ok) return done({ ok: false, reason: `muse exec exited with code ${code}`, model: parsed.model, ...(parsed.usage ? { usage: parsed.usage } : {}) });
          if (code !== 0) {
            const tail = scrub(stderr.trim().split("\n").filter((l) => !/^muse: (workspace root|local session|Agent delegation)/.test(l)).slice(-2).join(" | "));
            return done({ ...parsed, reason: `muse exec exited with code ${code}${tail ? ` (${tail.slice(0, 200)})` : ""}` } as MuseExecResult);
          }
          done(parsed);
        });
        child.stdin.end(`${key}\n`);
      });
    } finally {
      scratch.dispose();
      rmSync(home, { recursive: true, force: true });
    }
  };
}

// ── S8: what is kept of a model's raw answer ────────────────────────────────────────────────────

/** Generic secret shapes (the same list as tests/tools/secret-scan.mjs). */
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  /[a-z0-9.-]*\.(?:quiknode|quicknode)\.pro\/[A-Za-z0-9]{8,}/gi,
  /alchemy\.com\/v2\/[A-Za-z0-9_-]{8,}/gi,
  /infura\.io\/v3\/[0-9a-f]{16,}/gi,
];
/** Absolute paths on this kind of machine, and ~/ paths: never kept, never shown. */
const ABSOLUTE_PATH = /(?:~|\/Users|\/home|\/private|\/var\/folders|\/tmp|\/etc|\/root)\/[^\s"'`)<>]*/g;

/** True when `text` holds the Meta key or a secret shape (the diff is then not used at all). */
export function holdsSecret(text: string, key: string | undefined = loadApiKey()): boolean {
  if (key && key.length >= 12 && redactSecret(text, key) !== text) return true; // M2: a 12+ character piece counts
  return SECRET_SHAPES.some((re) => new RegExp(re.source, re.flags.replace("g", "")).test(text));
}

/** A model's raw answer as Atlas keeps it: the key, secret shapes, the RPC URL and absolute paths removed. */
export function scrubModelText(text: string, key: string | undefined = loadApiKey()): string {
  let out = key && key.length >= 12 ? redactSecret(text, key, "[redacted key]") : text;
  for (const re of SECRET_SHAPES) out = out.replace(re, "[redacted secret]");
  out = redactRpc(out);
  return out.replace(ABSOLUTE_PATH, "<path>");
}

function logMuseUsage(path: string, model: string, usage: Usage, finishReason: string, now: Date): string | undefined {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({ ts: now.toISOString(), role: "fixer", model, via: "muse exec", promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, reasoningTokens: usage.reasoningTokens ?? null, usd: usage.usd, finishReason, priceVerified: priceFor(model).verified }) + "\n",
    );
    return undefined;
  } catch (e) {
    return `the usage line could not be written (${(e as NodeJS.ErrnoException).code ?? "unknown error"})`;
  }
}

// ── the role ────────────────────────────────────────────────────────────────────────────────────

const pathLabel = (p: FixerPath, model: string) => changeProposer(p, model);

/** Ask for a change, check it by plain code, one repair try. Never throws for model trouble. */
export async function runFixer(input: FixerInput, deps: FixerDeps = {}): Promise<FixerResult> {
  const museExec = deps.museExec === undefined ? realMuseExec() : deps.museExec;
  const chat = deps.chat ?? realChat;
  const guard = deps.guard ?? (<R,>(call: () => Promise<R>) => call());
  const now = deps.now ?? (() => new Date());
  const usagePath = deps.usagePath ?? process.env.ATLAS_USAGE_PATH ?? DEFAULT_USAGE_PATH;
  const log = deps.log;
  const base = buildFixerPrompt(input);
  const attempts: FixerAttempt[] = [];
  let total: Usage | undefined;
  let path: FixerPath = museExec ? "muse-exec" : "chat-fallback";
  let model = path === "muse-exec" ? MUSE_CODE : FIXER_FALLBACK_MODEL;
  let prompt = base;
  let lastReason = "no answer";

  const say = (m: string, action: string, usage: Usage | undefined) =>
    log?.model({ role: "fixer", model: m, action: oneLine(usage ? action : `${action} (${COST_UNKNOWN})`), usage: usage ?? NO_USAGE });

  // S4: the preflight (no code sent) runs once, before the first real muse exec run.
  const preflight = deps.musePreflight === undefined ? (deps.museExec === undefined ? realMuseExec() : null) : deps.musePreflight;
  let preflightDone = false;
  /** Null when muse exec's reports allow the answer to be used; else why not (S4, fail closed). */
  const reportProblem = (r: MuseExecResult): string | null => {
    const ids = r.models && r.models.length ? r.models : r.model && !r.model.startsWith("unknown") ? [r.model] : [];
    if (ids.length === 0) return "muse exec reported no model id, so Atlas cannot tell which model received the code";
    for (const id of ids) {
      const refused = modelRefusal(id);
      if (refused) return refused;
    }
    if (r.contributorSeen) return "muse exec's output mentions a contributor model";
    return null;
  };
  const askMuse = async (): Promise<MuseExecResult> => {
    const before = modelRefusal(FIXER_MUSE_MODEL);
    if (before) return { ok: false, reason: `not asked (${before})` };
    if (preflight && !preflightDone) {
      const p = await guard(() => preflight({ files: { "README.txt": "Atlas preflight: no code here.\n" }, prompt: PREFLIGHT_PROMPT, timeoutMs: PREFLIGHT_TIMEOUT_MS, maxSteps: 1 }), (reason): MuseExecResult => ({ ok: false, reason }));
      if (p.usage && p.model) logMuseUsage(usagePath, p.model, p.usage, p.ok ? "preflight" : "preflight failed", now());
      total = addUsage(total, p.usage);
      const problem = p.ok ? reportProblem(p) : `the preflight did not finish (${p.reason})`;
      say(p.model ?? MUSE_CODE, problem ? `${MUSE_CODE} preflight (no code sent): ${problem}; the code is not sent` : `${MUSE_CODE} preflight (no code sent): muse exec answers with ${shownModelId(p.model ?? "")}`, p.usage);
      if (problem) return { ok: false, reason: `not asked (preflight, no code sent: ${problem})`, ...(p.model ? { model: p.model } : {}) };
      preflightDone = true;
    }
    const r = await guard(() => museExec!({ files: input.context.files, prompt, timeoutMs: MUSE_TIMEOUT_MS }), (reason): MuseExecResult => ({ ok: false, reason: `not asked (${reason})` }));
    // The model id muse exec REPORTS is logged as is; an unknown, missing or contributor id: the answer is not used.
    if (r.usage && r.model) logMuseUsage(usagePath, r.model, r.usage, r.ok ? "completed" : "failed", now());
    if (!r.ok) return r; // no answer: nothing is used either way (its model id, when reported, is in the log)
    const problem = reportProblem(r);
    if (problem) {
      return {
        ok: false,
        reason: `muse exec answered, but ${problem}; the answer is not used (the code was already sent, and refusing now cannot un-send it)`,
        ...(r.model ? { model: r.model } : {}),
        ...(r.usage ? { usage: r.usage } : {}),
      };
    }
    return r;
  };
  const askChat = async (): Promise<MuseExecResult> => {
    const r = await guard(
      () =>
        chat({
          role: "fixer",
          model: FIXER_FALLBACK_MODEL,
          messages: [
            { role: "system", content: "You propose. You never decide. Plain code will apply your change in a scratch copy, run the same experiment and judge. Output a unified diff only." },
            { role: "user", content: prompt },
          ],
          reasoningEffort: "low",
        }),
      (reason): ChatResult => ({ ok: false, reason: `not asked (${reason})` }),
    );
    return r.ok ? { ok: true, text: r.content, model: FIXER_FALLBACK_MODEL, usage: r.usage } : { ok: false, reason: r.reason, model: FIXER_FALLBACK_MODEL, ...(r.usage ? { usage: r.usage } : {}) };
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    let r: MuseExecResult;
    if (path === "muse-exec") {
      r = await askMuse();
      if (!r.ok) {
        // Muse Code gave no answer at all: say so, and ask the fallback model the same prompt.
        attempts.push({ attempt, path, model: r.model ?? MUSE_CODE, ok: false, reason: r.reason, ...(r.usage ? { usage: r.usage } : {}) });
        total = addUsage(total, r.usage);
        say(r.model ?? MUSE_CODE, `${MUSE_CODE} gave no answer (${r.reason}); falls back to ${FIXER_FALLBACK_MODEL} chat`, r.usage);
        path = "chat-fallback";
        r = await askChat();
      }
    } else {
      r = await askChat();
    }
    model = r.model ?? model;
    total = addUsage(total, r.usage);
    if (!r.ok) {
      lastReason = r.reason;
      attempts.push({ attempt, path, model, ok: false, reason: r.reason, ...(r.usage ? { usage: r.usage } : {}) });
      say(model, `${pathLabel(path, model)}: no answer (${r.reason})`, r.usage);
      if (r.reason.startsWith("not asked")) break; // a limit was reached: no repair try either
      prompt = repairPrompt(base, r.reason, null);
      continue;
    }
    const got = extractDiff(r.text);
    const checked: CheckedChange = !got
      ? { ok: false, reason: "the answer holds no unified diff" }
      : holdsSecret(got.diff)
        ? { ok: false, reason: "the diff holds text shaped like a secret, so it is not used or shown" }
        : await checkChange(got.diff, input.context);
    // S8: the raw answer is kept only scrubbed, for the record; it never goes to the browser.
    const kept = { answer: scrubModelText(r.text.slice(0, 20_000)), ...(/contributor/i.test(model) ? { contributorModel: true } : {}) };
    if (checked.ok) {
      attempts.push({ attempt, path, model, ok: true, ...(r.usage ? { usage: r.usage } : {}), ...kept });
      const files = checked.diffFiles.map((f) => f.newPath).join(", ");
      say(model, `${pathLabel(path, model)} proposes a change to ${files} (${plural(checked.changedLines, "line")}); plain code accepted it${checked.mode ? ` in ${checked.mode} mode (in theory only)` : ""}`, r.usage);
      return { ok: true, diff: got!.diff, path, model, attempts, ...(total ? { usage: total } : {}), checked };
    }
    lastReason = checked.reason;
    attempts.push({ attempt, path, model, ok: false, reason: checked.reason, ...(r.usage ? { usage: r.usage } : {}), ...kept });
    say(model, `${pathLabel(path, model)}: answer refused by plain code (${checked.reason})${attempt === 1 ? "; one more try" : ""}`, r.usage);
    prompt = repairPrompt(base, checked.reason, got?.diff ?? null);
    if (deps.repairWith === "chat-fallback" && path === "muse-exec") {
      // Same inputs for the fallback: the base prompt, not Muse Code's repair note.
      prompt = base;
      path = "chat-fallback";
    }
  }
  const who = path === "muse-exec" ? MUSE_CODE : `${MUSE_CODE} (fallback ${FIXER_FALLBACK_MODEL})`;
  const reason = `${who}: no usable change (${lastReason})`;
  log?.emit({ role: "runner", action: oneLine(`does not re-run: ${reason}`) });
  return { ok: false, reason, path, model, attempts, ...(total ? { usage: total } : {}) };
}
