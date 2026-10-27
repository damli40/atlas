// The Fixer: Muse Code proposes a change to the code, toward what the bettors expected.
//
// Plain words on who decides what:
// - Muse Code (Meta's coding agent, the `muse` CLI) runs HEADLESS (`muse exec --json`) with a
//   scratch copy of the target's files as its only workspace. It may read those files; it may NOT
//   write them (--disable-write), run a shell (--disable-shell), use the web (--disable-web-tools),
//   ask a person anything (--disable-request-user-input) or load anyone's personal skills (a fresh,
//   empty HOME and --no-foreign-personal-context). Its answer is text: the instruction asks for a
//   unified diff only. The model is named (--model muse-spark-1.3) and contributor mode is asked OFF;
//   the model id muse exec REPORTS is what the log and the answer show, and an attempt answered by a
//   "-contributor" model is flagged (contributorModel: true).
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
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extractDiff } from "../../../src/diff";
import { formatUsd1e18 } from "../../../src/units";
import type { Bet, Experiment, Verdict } from "../../../src/types";
import { checkChange, MAX_CHANGED_LINES, type ChangeContext, type CheckedChange } from "../../../runners/change";
import { makeScratch } from "../../../runners/scratch";
import { chat as realChat, contributorRefusal, costUsd, DEFAULT_USAGE_PATH, loadApiKey, priceFor, type ChatArgs, type ChatResult, type Usage } from "../client";
import { oneLine, type SessionEmitter } from "../../log/agentlog";
import { addUsage, COST_UNKNOWN, NO_USAGE, numbered } from "./claimant";
import { DEFAULT_WATCH_LIMIT_MS } from "../../../runners/ts/harness";

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
/** Muse Code's model steps per attempt. The files are in the prompt, so one step can answer; 3 leaves room to read. */
export const MUSE_MAX_STEPS = 3;
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

export type MuseExecResult =
  | { ok: true; text: string; model: string; usage?: Usage }
  | { ok: false; reason: string; model?: string; usage?: Usage };

/** Runs `muse exec` once with this workspace and prompt. Injected in tests. */
export type MuseExec = (req: { files: Record<string, string>; prompt: string; timeoutMs: number }) => Promise<MuseExecResult>;

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
  chat?: (args: ChatArgs) => Promise<ChatResult>;
  /** Wraps each model call (the server passes its budget's track()). Default: the call runs as is. */
  guard?: <R extends { usage?: { usd: number } }>(call: () => Promise<R>, refused: (reason: string) => R) => Promise<R>;
  log?: Pick<SessionEmitter, "emit" | "model">;
  /** Where the muse path's usage lines go. Default: ATLAS_USAGE_PATH, else tests/evidence/usage/usage.jsonl. */
  usagePath?: string;
  now?: () => Date;
}

// ── toward: written by plain code from the sealed bets ──────────────────────────────────────────

function answerText(b: Bet): string {
  const a = b.answer;
  if (a.kind === "number") return `${a.value} ${a.unit} (match if within ${a.tolerancePct}% of what the run measures)`;
  if (a.kind === "declined") return "declined to guess";
  return String(a.value);
}

function observedText(measures: string, v: Verdict["observed"]): string {
  if (v === undefined) return "not measured";
  if (typeof v === "string" && measures.startsWith("priceUsd1e18:") && /^\d+$/.test(v)) return `${formatUsd1e18(BigInt(v))} USD`;
  return String(v);
}

/**
 * What the bettors expected, from the bets the run did NOT match (a matched bet asks for no change).
 * Returns null when no bet is left to move toward. One line per bet; plain code only.
 */
export function towardFromBets(bets: readonly Bet[], verdicts: readonly Verdict[], names: Record<string, string> = {}): string | null {
  const lines: string[] = [];
  for (const b of bets) {
    const v = verdicts.find((x) => x.betId === b.id);
    if (!v || v.outcome !== "not_matched") continue;
    const who = b.who === "human" ? "The person" : (names[b.who] ?? b.who.replace(/^model:/, ""));
    lines.push(`- ${who} bet on "${b.question}" (${b.measures}): ${answerText(b)}. The run measured: ${observedText(b.measures, v.observed)}.`);
  }
  return lines.length ? lines.join("\n") : null;
}

// ── the prompt ──────────────────────────────────────────────────────────────────────────────────

function fullFile(path: string, text: string): string {
  return `=== ${path} (lines 1–${text.split("\n").length}) ===\n${numbered(text, 1, text.split("\n").length)}`;
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
        ]),
    "",
    `The place in the code (${finding.file}, lines ${finding.lineStart}–${finding.lineEnd}):`,
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
export function museArgs(workspace: string, promptFile: string): string[] {
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
    "--no-foreign-personal-context",
    "--disable-reminders",
    "--no-session-log",
    "--reasoning-effort", "low",
    "--max-model-steps", String(MUSE_MAX_STEPS),
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
  const extra = { model: m, ...(usage ? { usage } : {}) };
  if (terminal === null) return { ok: false, reason: "muse exec ended without a final answer", ...extra };
  if (terminal !== "completed") return { ok: false, reason: `muse exec ended "${terminal}"${termReason ? ` (${termReason})` : ""}`, ...extra };
  if (!text || !text.trim()) return { ok: false, reason: "muse exec completed with an empty answer", ...extra };
  return { ok: true, text, ...extra };
}

/** The real `muse exec`: scratch workspace, empty HOME, key on stdin, hard time limit. */
export function realMuseExec(opts: { bin?: string; apiKey?: string } = {}): MuseExec {
  return async ({ files, prompt, timeoutMs }) => {
    const key = opts.apiKey ?? loadApiKey();
    if (!key) return { ok: false, reason: "no Meta API key for muse exec" };
    const bin = process.env.ATLAS_MUSE_BIN ?? opts.bin ?? MUSE_BIN_DEFAULT;
    const scratch = await makeScratch(files, "atlas-muse-ws-");
    const home = mkdtempSync(join(tmpdir(), "atlas-muse-home-"));
    const promptFile = join(home, "prompt.txt"); // outside the workspace: Muse Code reads it as the prompt only
    writeFileSync(promptFile, prompt);
    const scrub = (s: string) => s.split(key).join("[redacted]").split(scratch.dir).join("<scratch>").split(home).join("<home>");
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
        const child = spawn(bin, museArgs(scratch.dir, promptFile), {
          cwd: scratch.dir,
          // A fresh HOME: no personal skills, rules or stored credentials reach the run. Nothing else inherited.
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: home },
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
          const parsed = parseMuseJsonl(stdout);
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

const pathLabel = (p: FixerPath, model: string) => (p === "muse-exec" ? `${MUSE_CODE} (muse exec, ${model})` : `${model} (chat fallback)`);

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

  const askMuse = async (): Promise<MuseExecResult> => {
    const before = contributorRefusal(FIXER_MUSE_MODEL);
    if (before) return { ok: false, reason: `not asked (${before})` };
    const r = await guard(() => museExec!({ files: input.context.files, prompt, timeoutMs: MUSE_TIMEOUT_MS }), (reason): MuseExecResult => ({ ok: false, reason: `not asked (${reason})` }));
    // The model id muse exec REPORTS is logged as is; a contributor model's answer is not used.
    if (r.usage && r.model) logMuseUsage(usagePath, r.model, r.usage, r.ok ? "completed" : "failed", now());
    const after = r.model ? contributorRefusal(r.model) : null;
    if (after) return { ok: false, reason: `muse exec answered with ${after}`, model: r.model!, ...(r.usage ? { usage: r.usage } : {}) };
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
    const checked: CheckedChange = got ? await checkChange(got.diff, input.context) : { ok: false, reason: "the answer holds no unified diff" };
    const kept = { answer: r.text.slice(0, 20_000), ...(/-contributor$/.test(model) ? { contributorModel: true } : {}) };
    if (checked.ok) {
      attempts.push({ attempt, path, model, ok: true, ...(r.usage ? { usage: r.usage } : {}), ...kept });
      const files = checked.diffFiles.map((f) => f.newPath).join(", ");
      say(model, `${pathLabel(path, model)} proposes a change to ${files} (${checked.changedLines} lines); plain code accepted it`, r.usage);
      return { ok: true, diff: got!.diff, path, model, attempts, ...(total ? { usage: total } : {}), checked };
    }
    lastReason = checked.reason;
    attempts.push({ attempt, path, model, ok: false, reason: checked.reason, ...(r.usage ? { usage: r.usage } : {}), ...kept });
    say(model, `${pathLabel(path, model)}: answer refused by plain code (${checked.reason})${attempt === 1 ? "; one repair try" : ""}`, r.usage);
    prompt = repairPrompt(base, checked.reason, got?.diff ?? null);
  }
  const who = path === "muse-exec" ? MUSE_CODE : `${MUSE_CODE} (fallback ${FIXER_FALLBACK_MODEL})`;
  const reason = `${who}: no usable change (${lastReason})`;
  log?.emit({ role: "runner", action: oneLine(`does not re-run: ${reason}`) });
  return { ok: false, reason, path, model, attempts, ...(total ? { usage: total } : {}) };
}
