// The .atlas.json file: everything a stranger needs to replay one round and check it.
//
// Plain words: after a round (bets sealed → run → verdicts), the server writes one file holding the
// target (which code, its SHA-256), the experiment, every sealed bet with its nonce, the run with its
// trace and measured values, the verdicts, the finding the round worked on, the agent log, and the
// captions a replayer must show. This module builds that file, parses it with zod, and verifies it
// by plain code:
// - every bet's seal recomputes (src/seal.ts) and was made before its run started;
// - every verdict is exactly what src/judge.ts gives today for that bet and run (re-judged here);
// - the code fingerprint, fork block and seed agree everywhere they appear;
// - the captions are exactly the ones this run earns: the required ones (pre-existing label, Level 2 at
//   fork 42194662 with the apply shape, Level 1 at fork 42194663 with the price-read shape) plus, only
//   when a person's finding quotes the cbETH config line, the "picked by a person" caption, whose second
//   half (pointed elsewhere / also pointed here) is recomputed from the Investigator findings in the file;
// - an EVM run's measured values equal its own trace (every price read, the reference, the call-trace
//   counts, the applied actions), the reference recomputes from its recorded Chainlink inputs, and the
//   trace's control event agrees with controlPassed;
// - experiments and runs link by id (runs[0] is the run of experiments[0], which /replay relies on);
// - a Level 2 file's false-alarm table is exactly what src/falsealarm.ts rebuilds from its run (so a run
//   whose control failed shows "can't check" on every flag, never a stored "flagged").
// No I/O, no clock (except `createdAt`, passed in), no model.

import { z } from "zod";
import { judge } from "./judge";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FORK_BLOCK, PR578_CODE_SHA256 } from "../runners/evm/moonwell-base";
import { evaluateReplayRule, falseAlarmFromRun } from "./falsealarm";
import { chainlinkTo1e18, usdTimesRatio1e18 } from "./units";
import { canonicalJson, sha256Hex, verifySeal } from "./seal";
import { applyFileDiff, parseUnifiedDiff, type DiffFile } from "./diff";
import { CHANGE_CAPTION, theoryCaptions, towardFromBets } from "./change";
import { planChangedConfig } from "../runners/change";
import type { AgentEvent, AtlasFile, Bet, BettorSlot, Change, Experiment, Finding, Run, RunAttempt, Target, Verdict } from "./types";

// The two level captions live in src/captions.ts (no Node imports), so the web page can use them
// without loading this file, which reads the Moonwell copy from disk.
import { LEVEL2_CAPTION, PASTED_CAPTION, level1Caption } from "./captions";
import { lineSpan } from "./words";
import { pastedTargetProblems } from "./pasted-code";
export { LEVEL2_CAPTION, level1Caption };
/** M7: the two halves of the "chosen line" caption. Each half is earned from the file's findings (chosenLineCaptions). */
export const CBETH_PICKED_BY_PERSON = "the cbETH line was picked by a person";
export const INVESTIGATOR_POINTED_ELSEWHERE = "the Investigator pointed elsewhere";
export const INVESTIGATOR_ALSO_POINTED_HERE = "the Investigator also pointed here";
export const INVESTIGATOR_NO_CHECKED_PLACE = "the Investigator had no checked place on this code";
/** m5: said instead of "no checked place" when the file's agent log shows no Investigator call at all. */
export const INVESTIGATOR_NOT_ASKED = "the Investigator was not asked";
/** S3: the first half when a person picked several lines that hold the cbETH line (never "the cbETH line was picked"). */
export const personPickedLinesCaption = (lineStart: number, lineEnd: number, cbEth: { from: number; to: number } | null) =>
  cbEth
    ? `the person picked ${lineSpan(lineStart, lineEnd)}, which hold${lineStart === lineEnd ? "s" : ""} the cbETH line (${lineSpan(cbEth.from, cbEth.to)})`
    : `the person picked ${lineSpan(lineStart, lineEnd)}`;
/** Caption when a person picked the cbETH line and no verified Investigator finding covers it. */
export const HUMAN_PICKED_CBETH_CAPTION = `${CBETH_PICKED_BY_PERSON}; ${INVESTIGATOR_POINTED_ELSEWHERE}`;
/** Caption when a person picked the cbETH line and a verified Investigator finding covers it too. */
export const HUMAN_PICKED_CBETH_ALSO_CAPTION = `${CBETH_PICKED_BY_PERSON}; ${INVESTIGATOR_ALSO_POINTED_HERE}`;
/** Caption when a person picked the cbETH line and the file holds no verified Investigator finding at all. */
export const HUMAN_PICKED_CBETH_ALONE_CAPTION = `${CBETH_PICKED_BY_PERSON}; ${INVESTIGATOR_NO_CHECKED_PLACE}`;
/** Caption for a target written before the hackathon (PRE-EXISTING.md). */
export const preExistingCaption = (t: Target) => (t.preExisting ? `${t.preExisting.label} (listed in ${t.preExisting.listedIn})` : undefined);

// ---------- schema ----------

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const iso = z.iso.datetime();
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const targetSchema = z
  .object({
    kind: z.enum(["ts-fixture", "github-pr", "pasted"]),
    ref: z.string().min(1),
    codeSha256: sha,
    commit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
    preExisting: z.object({ label: z.string().min(1), listedIn: z.literal("PRE-EXISTING.md") }).strict().optional(),
    // E1: a pasted target carries its language and its source (verify recomputes the SHA-256 from it).
    language: z.enum(["js", "ts", "py"]).optional(),
    source: z.string().optional(),
  })
  .strict();

const answerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("integer"), value: z.number().int() }).strict(),
  z.object({ kind: z.literal("number"), value: z.number(), tolerancePct: z.number(), unit: z.string() }).strict(),
  z.object({ kind: z.literal("enum"), value: z.string(), options: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("declined"), reason: z.string() }).strict(),
  z.object({ kind: z.literal("json"), value: z.json() }).strict(),
]);

const betSchema = z
  .object({
    id: z.string().min(1),
    experimentId: z.string().min(1),
    who: z.union([z.literal("human"), z.string().regex(/^model:.+/)]),
    question: z.string().min(1),
    measures: z.string().min(1),
    answer: answerSchema,
    nonce: z.string().min(1),
    sealedAt: iso,
    sealedHash: sha,
    rationale: z.string().optional(),
  })
  .strict();

const experimentSchema = z
  .object({
    id: z.string().min(1),
    target: targetSchema,
    runner: z.enum(["ts", "evm"]),
    params: z.object({ shape: z.string() }).loose(),
    proposedBy: z.object({ role: z.enum(["claimant", "adversary", "human"]), model: z.string().optional() }).strict(),
    gate: z.union([z.object({ allowed: z.literal(true) }).strict(), z.object({ allowed: z.literal(false), reason: z.string() }).strict()]),
  })
  .strict();

const runSchema = z
  .object({
    id: z.string().min(1),
    experimentId: z.string().min(1),
    runner: z.enum(["ts", "evm"]),
    executor: z.enum(["local", "modal"]),
    codeSha256: sha,
    forkBlock: z.number().int().positive().optional(),
    chainId: z.number().int().positive().optional(),
    seed: z.string().optional(),
    startedAt: iso,
    finishedAt: iso,
    trace: z.array(z.object({ t: z.number(), event: z.string(), data: z.record(z.string(), z.unknown()).optional() }).strict()),
    result: z
      .object({
        measured: z.record(z.string(), scalar),
        notMeasured: z.record(z.string(), z.string()),
        references: z.record(z.string(), z.object({ value: z.string(), method: z.string() }).strict()).optional(),
      })
      .strict(),
    controlPassed: z.boolean(),
    controlRunId: z.string().optional(),
    replayOf: z.object({ runId: z.string(), changeId: z.string() }).strict().optional(),
  })
  .strict();

const verdictSchema = z
  .object({
    betId: z.string().min(1),
    runId: z.string().min(1),
    outcome: z.enum(["matched", "not_matched", "cant_check"]),
    observed: scalar.optional(),
    reference: z.object({ value: z.string(), method: z.string() }).strict().optional(),
    reason: z.string().optional(),
    judgedBy: z.literal("src/judge.ts"),
  })
  .strict();

const findingSchema = z
  .object({
    id: z.string().min(1),
    file: z.string().min(1),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    kind: z.enum(["retry", "price", "other"]),
    claim: z.string(),
    verified: z.boolean(),
    quotedSnippet: z.string(),
    proposedBy: z.union([
      z.object({ role: z.literal("investigator"), model: z.string().min(1) }).strict(),
      z.object({ role: z.literal("human"), model: z.literal("none: picked by a person") }).strict(),
    ]),
  })
  .strict();

const agentEventSchema = z
  .object({
    t: iso,
    role: z.enum(["investigator", "claimant", "gate", "runner", "judge", "fixer", "adversary", "seal", "human"]),
    model: z.string().optional(),
    action: z.string().min(1),
    ref: z.object({ kind: z.enum(["finding", "experiment", "bet", "run", "verdict", "change", "target"]), id: z.string() }).strict().optional(),
    usage: z.object({ promptTokens: z.number(), completionTokens: z.number(), reasoningTokens: z.number().optional(), usd: z.number() }).strict().optional(),
  })
  .strict();

const nstr = z.string().nullable();
const falseAlarmRowSchema = z
  .object({
    market: z.string().min(1),
    preUsd1e18: nstr,
    postUsd1e18: nstr,
    diffVsPrePct: nstr,
    flagReference: z.enum(["refUsd1e18:cbETH (raw Chainlink ETH/USD × cbETH/ETH)", "pre-apply price, same fork block"]),
    flagReferenceUsd1e18: nstr,
    diffVsFlagReferencePct: nstr,
    flagged: z.boolean().nullable(),
    withinFalseAlarmPct: z.boolean().nullable(),
    controlPassed: z.boolean(),
    feedBefore: nstr,
    feedAfter: nstr,
    note: z.string().optional(),
  })
  .strict();

export const atlasFileSchema = z
  .object({
    version: z.literal(1),
    target: targetSchema,
    codeSha256: sha,
    forkBlock: z.number().int().positive().optional(),
    chainId: z.number().int().positive().optional(),
    seed: z.string().optional(),
    experiments: z.array(experimentSchema).min(1),
    bets: z.array(betSchema).min(1),
    runs: z.array(runSchema).min(1),
    verdicts: z.array(verdictSchema),
    change: z
      .object({
        id: z.string().min(1),
        runId: z.string().min(1),
        diff: z.string().min(1),
        // M8 (day-6 review): a model id, never a sentence.
        proposedBy: z.object({ role: z.literal("fixer"), model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/), path: z.enum(["muse-exec", "chat-fallback"]).optional() }).strict(),
        toward: z.string().min(1),
        replayRunId: z.string().optional(),
        // D20: the theoretical-direct-wire mode and the feeds wired directly (recomputed below).
        mode: z.literal("theoretical-direct-wire").optional(),
        directWired: z.array(z.object({ oracleName: z.string().regex(/^[A-Za-z0-9_]{1,64}$/), market: z.string().min(1), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).strict()).optional(),
      })
      .strict()
      .optional(),
    replay: z
      .object({
        run: runSchema,
        verdicts: z.array(verdictSchema),
        passRule: z.array(z.object({ rule: z.string(), outcome: z.enum(["matched", "didn't match", "can't check"]), detail: z.string() }).strict()).optional(),
      })
      .strict()
      .optional(),
    findings: z.array(findingSchema).optional(),
    falseAlarm: z.array(falseAlarmRowSchema).optional(),
    agentLog: z.array(agentEventSchema),
    bettors: z
      .array(
        z
          .object({
            who: z.string().regex(/^(human|model:[A-Za-z0-9][A-Za-z0-9._:/-]{0,79})$/),
            status: z.enum(["sealed", "no_usable_answer", "not_asked"]),
            reason: z.string().min(1).max(300).optional(),
          })
          .strict(),
      )
      .optional(),
    // Final review S2: earlier attempts that did not finish (never a verdict). Checked below.
    attempts: z
      .array(z.object({ attempt: z.number().int().positive(), startedAt: iso, stoppedAt: iso, reason: z.string().min(1).max(500) }).strict())
      .max(20)
      .optional(),
    captions: z.array(z.string().min(1)).min(1),
    createdAt: iso,
  })
  .strict();

// ---------- verify ----------

/** Deep-equal as JSON (key order ignored; undefined fields dropped, as JSON.stringify does). */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => canonicalJson(v === undefined ? null : JSON.parse(JSON.stringify(v)));
  return norm(a) === norm(b);
}

/** The captions a file of this kind must carry (plain code decides, from the target and the runs). */
export function requiredCaptions(file: Pick<AtlasFile, "target" | "experiments" | "runs">): string[] {
  const out: string[] = [];
  const pre = preExistingCaption(file.target);
  if (pre) out.push(pre);
  if (file.target.kind === "pasted") out.push(PASTED_CAPTION);
  for (const run of file.runs) {
    if (run.runner !== "evm") continue;
    const exp = file.experiments.find((e) => e.id === run.experimentId);
    if (exp?.params.shape === "apply-proposal-then-read") out.push(LEVEL2_CAPTION);
    if (exp?.params.shape === "price-read" && run.forkBlock !== undefined) out.push(level1Caption(run.forkBlock));
  }
  return [...new Set(out)];
}

const CBETH_CONFIG = /OracleConfig\(\s*"cbETHETH_ORACLE"\s*,\s*"cbETH"\s*,\s*"MOONWELL_cbETH"\s*\)/;
const overlaps = (a: Pick<Finding, "file" | "lineStart" | "lineEnd">, b: Pick<Finding, "file" | "lineStart" | "lineEnd">) =>
  a.file === b.file && a.lineStart <= b.lineEnd && b.lineStart <= a.lineEnd;

/**
 * S3: the exact line(s) of the cbETH oracle-config push inside the chosen finding, located by plain code in
 * its quoted snippet. A person's snippet is exactly lines lineStart..lineEnd of the file (server/evm-round.ts
 * humanFinding), so the match's line offset in the snippet is its line in the file. null when the snippet
 * does not have one line per picked line (then the line cannot be placed).
 */
export function cbEthLineIn(f: Pick<Finding, "lineStart" | "lineEnd" | "quotedSnippet">): { from: number; to: number } | null {
  const m = CBETH_CONFIG.exec(f.quotedSnippet);
  if (!m) return null;
  if (f.quotedSnippet.split("\n").length !== f.lineEnd - f.lineStart + 1) return null;
  const before = f.quotedSnippet.slice(0, m.index).split("\n").length - 1;
  const inside = m[0].split("\n").length - 1;
  return { from: f.lineStart + before, to: f.lineStart + before + inside };
}

/**
 * M7: the "chosen line" caption, decided by plain code from the findings alone (the server and verify
 * call this same function, with the same inputs from the file).
 * - `findings[0]` is the finding the round worked on; the rest are the Investigator's places on this code.
 * - A caption exists only when the chosen finding quotes the cbETH oracle-config line
 *   (OracleConfig(..., "MOONWELL_cbETH")) AND a person picked it (proposedBy.role "human").
 * - First half: "the cbETH line was picked by a person" when the person picked that one line; when they
 *   picked several lines, "the person picked lines A–B, which hold the cbETH line (line N)" (S3).
 * - Second half, compared against the cbETH line ITSELF (located by plain code, S3), never against the
 *   person's whole range: "the Investigator also pointed here" when a VERIFIED Investigator place covers
 *   that line (same file); "the Investigator pointed elsewhere" when there are verified places and none
 *   does; "the Investigator had no checked place on this code" when there is none; "the Investigator was
 *   not asked" when `investigatorAsked` is false (m5). If the cbETH line cannot be placed inside a
 *   several-line pick, the caption says only "the person picked lines A–B".
 */
export function chosenLineCaptions(findings: readonly Finding[] | undefined, investigatorAsked = true): string[] {
  const chosen = findings?.[0];
  if (!chosen || chosen.proposedBy.role !== "human" || !CBETH_CONFIG.test(chosen.quotedSnippet)) return [];
  const single = chosen.lineStart === chosen.lineEnd;
  const line = single ? { from: chosen.lineStart, to: chosen.lineEnd } : cbEthLineIn(chosen);
  const first = single ? CBETH_PICKED_BY_PERSON : personPickedLinesCaption(chosen.lineStart, chosen.lineEnd, line);
  if (!line) return [first];
  const byModel = findings!.slice(1).filter((f) => f.proposedBy.role === "investigator" && f.verified);
  const second = !investigatorAsked
    ? INVESTIGATOR_NOT_ASKED
    : byModel.length === 0
      ? INVESTIGATOR_NO_CHECKED_PLACE
      : byModel.some((f) => overlaps(f, { file: chosen.file, lineStart: line.from, lineEnd: line.to }))
        ? INVESTIGATOR_ALSO_POINTED_HERE
        : INVESTIGATOR_POINTED_ELSEWHERE;
  return [`${first}; ${second}`];
}

/**
 * m5 + final review M3: the file's agent log shows the Investigator (a Meta model) read THIS code. Since the
 * final review each Investigator line names the code it read (`ref: { kind: "target", id: codeSha256 }`), so a
 * call on another target in the same session does not count. A log with no such ref on any Investigator line
 * was written before that change: then any Investigator call counts, as it did, so older files still verify.
 */
export const investigatorWasAsked = (agentLog: readonly Pick<AgentEvent, "role" | "model" | "ref">[], codeSha256?: string) => {
  const calls = agentLog.filter((e) => e.role === "investigator" && typeof e.model === "string" && e.model.length > 0);
  if (codeSha256 !== undefined && calls.some((e) => e.ref?.kind === "target")) return calls.some((e) => e.ref?.kind === "target" && e.ref.id === codeSha256);
  return calls.length > 0;
};

/** Captions a file may carry beyond the required ones: exactly the chosen-line caption its findings earn. */
export function allowedExtraCaptions(file: Pick<AtlasFile, "findings" | "agentLog"> & { codeSha256?: string }): string[] {
  return chosenLineCaptions(file.findings, investigatorWasAsked(file.agentLog, file.codeSha256));
}

const asRecord = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** The cbETH reference recomputed from its recorded raw-Chainlink inputs (decimals must be 8 and 18), or a reason. */
export function recomputeReference(inputs: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  const i = asRecord(inputs);
  const eth = asRecord(i.ethUsd);
  const ratio = asRecord(i.cbEthEth);
  if (eth.decimals !== 8 || ratio.decimals !== 18) return { ok: false, reason: "its recorded feed decimals are not 8 (ETH/USD) and 18 (cbETH/ETH)" };
  if (typeof eth.answer !== "string" || typeof ratio.answer !== "string" || !/^\d+$/.test(eth.answer) || !/^\d+$/.test(ratio.answer)) return { ok: false, reason: "its recorded answers are not whole numbers" };
  return { ok: true, value: usdTimesRatio1e18(chainlinkTo1e18(BigInt(eth.answer), 8), chainlinkTo1e18(BigInt(ratio.answer), 18)).toString() };
}

const POST_READ_FIELDS = ["priceUsd1e18", "rawUnderlyingPrice", "feedAddress", "feedDecimals", "feedDescription", "tokenDecimals"] as const;
const PRE_READ_FIELDS = { priceUsd1e18: "preApplyPriceUsd1e18", feedAddress: "preApplyFeedAddress" } as const;

/**
 * An EVM run's measured values against its own trace. Every number a verdict or the table uses must
 * be the number the trace recorded when it was read, so editing one without the other is caught.
 * (The trace and the measured values are both in the file: this proves they agree, not that the chain
 * said them. /replay re-runs the fork for that.)
 */
export function evmRunAgreesWithItsTrace(r: Run): string[] {
  const out: string[] = [];
  const m = r.result.measured;
  const ev = (name: string) => r.trace.filter((t) => t.event === name);
  // Control: exactly one control event, agreeing with controlPassed; a failed control says why.
  const ctl = r.trace.filter((t) => t.event === "control_matched" || t.event === "control_did_not_match");
  if (ctl.length !== 1) out.push(`its trace has ${ctl.length} control events, not 1`);
  else if ((ctl[0]!.event === "control_matched") !== (r.controlPassed === true)) out.push(`its trace says ${ctl[0]!.event} but controlPassed is ${r.controlPassed}`);
  if (r.controlPassed !== true && typeof r.result.notMeasured.control !== "string") out.push("its control did not pass but notMeasured.control gives no reason");
  if (r.controlPassed === true && r.result.notMeasured.control !== undefined) out.push("controlPassed is true but notMeasured.control says the control failed");
  const fork = ev("fork_started");
  if (fork.length !== 1 || asRecord(fork[0]!.data).forkBlock !== r.forkBlock) out.push("its fork_started event does not name the run's fork block");

  // Price reads.
  const seen = new Set<string>();
  for (const t of ev("price_read")) {
    const d = asRecord(t.data);
    const sym = String(d.symbol);
    const pre = d.phase === "pre-apply";
    const k = `${pre ? "pre" : "post"}:${sym}`;
    if (seen.has(k)) out.push(`its trace reads ${sym} (${pre ? "pre-apply" : "post-apply"}) twice`);
    seen.add(k);
    if (pre) {
      for (const [f, key] of Object.entries(PRE_READ_FIELDS)) if (m[`${key}:${sym}`] !== d[f]) out.push(`measured ${key}:${sym} is not the value its trace read (${String(d[f])})`);
    } else {
      for (const f of POST_READ_FIELDS) if (m[`${f}:${sym}`] !== d[f]) out.push(`measured ${f}:${sym} is not the value its trace read (${String(d[f])})`);
    }
  }
  for (const key of Object.keys(m)) {
    const pre = /^preApplyPriceUsd1e18:(.+)$/.exec(key);
    const post = /^priceUsd1e18:(.+)$/.exec(key);
    if (pre && !seen.has(`pre:${pre[1]}`)) out.push(`measured ${key} has no price_read in its trace`);
    if (post && !seen.has(`post:${post[1]}`)) out.push(`measured ${key} has no price_read in its trace`);
  }

  // References: equal to the trace's reference event, and recomputed from its inputs.
  const refs = r.result.references ?? {};
  const refEvents = ev("reference");
  for (const [key, ref] of Object.entries(refs)) {
    const e = refEvents.filter((t) => asRecord(t.data).key === key);
    if (e.length !== 1) {
      out.push(`reference ${key} has ${e.length} reference events in its trace, not 1`);
      continue;
    }
    const d = asRecord(e[0]!.data);
    if (d.value !== ref.value || d.method !== ref.method) out.push(`reference ${key} is not the value its trace recorded`);
    const again = recomputeReference(d.inputs);
    if (!again.ok) out.push(`reference ${key} cannot be recomputed: ${again.reason}`);
    else if (again.value !== ref.value) out.push(`reference ${key} is ${ref.value}, but its recorded inputs give ${again.value}`);
  }
  for (const t of refEvents) if (!(String(asRecord(t.data).key) in refs)) out.push(`its trace has a reference ${String(asRecord(t.data).key)} the result does not`);

  // Price-source counts and applied actions.
  for (const t of ev("call_trace")) {
    const d = asRecord(t.data);
    const key = d.phase === "pre-apply" ? "preApplyPriceSources:cbETH" : "priceSources:cbETH";
    if (d.ok === true) {
      if (m[key] !== d.count) out.push(`measured ${key} is not the count its trace recorded (${String(d.count)})`);
      if (!Array.isArray(d.sources) || d.sources.length !== d.count) out.push(`its ${String(d.phase)} call trace counts ${String(d.count)} sources but lists ${Array.isArray(d.sources) ? d.sources.length : "none"}`);
    } else if (m[key] !== undefined) out.push(`measured ${key} is set but its trace says the count was not measured`);
  }
  if ("appliedFeedActions" in m && m.appliedFeedActions !== ev("feed_set").length) out.push(`measured appliedFeedActions is ${String(m.appliedFeedActions)} but its trace has ${ev("feed_set").length} feed_set events`);
  return out;
}

/**
 * S1 (day-6 review): a TS run's measured values against its own trace (runners/ts/harness.ts runScenario
 * writes both). Every count, wait, log line and the outcome must be what the trace's events add up to, so
 * editing `measured` without the trace (or deleting trace events) is caught. Concurrency sweeps are not
 * checked here (they have their own trace shape and no bets).
 */
export function tsRunAgreesWithItsTrace(r: Run): string[] {
  const out: string[] = [];
  const m = r.result.measured;
  const ev = (name: string) => r.trace.filter((t) => t.event === name);
  if (ev("stopped_watching").length > 0) {
    for (const k of ["calls", "outcome", "waitCount", "totalWaitMs", "logCount"]) if (k in m) out.push(`its trace says Atlas stopped watching, but measured ${k} is set`);
    return out;
  }
  if (!("outcome" in m)) return out.length ? out : ["it measured no outcome and its trace does not say Atlas stopped watching"];
  const sleeps = ev("sleep").map((t) => asRecord(t.data).ms);
  const logs = ev("log").map((t) => String(asRecord(t.data).msg));
  const want: Record<string, unknown> = {
    calls: ev("call").length,
    waitCount: sleeps.length,
    waitsMs: sleeps.join(","),
    logCount: logs.length,
    logAttempts: logs.map((msg) => /attempt (\d+\/\d+)/.exec(msg)?.[1] ?? "?").join(","),
  };
  if (sleeps.every((w) => typeof w === "number" && Number.isFinite(w) && w >= 0)) want.totalWaitMs = (sleeps as number[]).reduce((a, b) => a + b, 0);
  const ends = [...ev("returns"), ...ev("throws"), ...ev("pending")];
  if (ends.length !== 1) out.push(`its trace has ${ends.length} outcome events (returns / throws / pending), not 1`);
  else {
    const e = ends[0]!;
    want.outcome = e.event;
    if (e.event === "returns") {
      want.returned = asRecord(e.data).value;
      want.settledAtMs = e.t;
    }
    if (e.event === "throws") {
      want.thrown = asRecord(e.data).error;
      want.settledAtMs = e.t;
    }
  }
  for (const [k, v] of Object.entries(want)) if (m[k] !== v) out.push(`measured ${k} is ${JSON.stringify(m[k] ?? null)}, but its trace adds up to ${JSON.stringify(v)}`);
  return out;
}

/**
 * E1: a call-function run's measured values against its own trace (runners/ts/call-harness.ts writes both):
 * one ending event, the outcome it names, its time as virtualMs, and each stand-in's call count equal to its
 * `stand_in_call` events. A run whose runner wrote `wholeRun` measured nothing, and must not claim to.
 */
export function callRunAgreesWithItsTrace(r: Run): string[] {
  const out: string[] = [];
  const m = r.result.measured;
  if (Object.prototype.hasOwnProperty.call(r.result.notMeasured, "wholeRun")) {
    return Object.keys(m).length > 0 ? ["it says nothing in the run counts (wholeRun), but it has measured values"] : [];
  }
  // "stopped_watching": Atlas stopped before it could report how the call ended (even if it had settled).
  if (r.trace.some((t) => t.event === "stopped_watching")) {
    for (const k of ["outcome", "virtualMs", "returnedJson", "thrownName"]) if (k in m) out.push(`its trace says Atlas stopped watching, but measured ${k} is set`);
    return out;
  }
  const ends = r.trace.filter((t) => ["returned", "threw", "never_settled", "still_running_at_watch_limit"].includes(t.event));
  if (ends.length !== 1) return [`its trace has ${ends.length} ending events, not 1`];
  const end = ends[0]!;
  if (m.outcome !== end.event) out.push(`measured outcome is ${JSON.stringify(m.outcome ?? null)}, but its trace ends with ${end.event}`);
  if ((end.event === "returned" || end.event === "threw") && m.virtualMs !== end.t) out.push(`measured virtualMs is ${JSON.stringify(m.virtualMs ?? null)}, but its trace settles at ${end.t}`);
  if (end.event !== "returned" && end.event !== "threw" && "virtualMs" in m) out.push("measured virtualMs is set, but the call did not settle");
  const counts = new Map<string, number>();
  for (const t of r.trace) if (t.event === "stand_in_call") counts.set(String(asRecord(t.data).name), (counts.get(String(asRecord(t.data).name)) ?? 0) + 1);
  for (const [k, v] of Object.entries(m)) {
    if (!k.startsWith("calls:")) continue;
    const n = counts.get(k.slice("calls:".length)) ?? 0;
    if (v !== n) out.push(`measured ${k} is ${JSON.stringify(v)}, but its trace has ${n} calls of that stand-in`);
  }
  return out;
}

const isCallRun = (file: Pick<AtlasFile, "experiments">, r: Run) => r.runner === "ts" && file.experiments.find((e) => e.id === r.experimentId)?.params.shape === "call-function";

const isRetryRun = (file: Pick<AtlasFile, "experiments">, r: Run) => r.runner === "ts" && file.experiments.find((e) => e.id === r.experimentId)?.params.shape === "retry-scenario";

/** The file's Level 2 run (an EVM apply-proposal-then-read run), if it has one. */
function isLevel2(file: Pick<AtlasFile, "experiments" | "runs">): Run | undefined {
  return file.runs.find((r) => r.runner === "evm" && file.experiments.find((e) => e.id === r.experimentId)?.params.shape === "apply-proposal-then-read");
}

export type Verification = { ok: true; file: AtlasFile } | { ok: false; problems: string[] };

/** Parse with zod, then check every cross-reference by plain code. Never throws. */
export function verifyAtlasFile(raw: unknown): Verification {
  const parsed = atlasFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "file"}: ${i.message}`) };
  }
  const file = parsed.data as unknown as AtlasFile;
  const problems: string[] = [];
  const say = (p: string) => problems.push(p);

  if (file.codeSha256 !== file.target.codeSha256) say("codeSha256 differs from target.codeSha256");
  // E1: a pasted target's source must hash to its fingerprint and its ref must name that fingerprint.
  for (const p of pastedTargetProblems(file.target)) say(p);
  if (file.target.kind !== "pasted" && (file.target.source !== undefined || file.target.language !== undefined)) say("only a pasted target carries source and language");
  for (const e of file.experiments) {
    if (e.target.codeSha256 !== file.codeSha256 || e.target.ref !== file.target.ref) say(`experiment ${e.id} is about other code than the file's target`);
    if (!e.gate.allowed) say(`experiment ${e.id} was refused by the gate, so it has no run to replay`);
  }
  for (const r of file.runs) {
    if (r.codeSha256 !== file.codeSha256) say(`run ${r.id} ran code ${r.codeSha256.slice(0, 12)}…, not the target's`);
    if (!file.experiments.some((e) => e.id === r.experimentId)) say(`run ${r.id} names experiment ${r.experimentId}, which is not in the file`);
    if (r.runner === "evm") {
      if (r.forkBlock === undefined) say(`EVM run ${r.id} has no fork block`);
      else if (file.forkBlock !== r.forkBlock) say(`EVM run ${r.id} forked at ${r.forkBlock}, the file says ${file.forkBlock}`);
    }
    if (r.runner === "ts") {
      if (r.seed === undefined) say(`TS run ${r.id} has no seed`);
      else if (file.seed !== r.seed) say(`TS run ${r.id} used seed ${r.seed}, the file says ${file.seed}`);
      if (isRetryRun(file, r)) for (const p of tsRunAgreesWithItsTrace(r)) say(`run ${r.id}: ${p}`);
      if (isCallRun(file, r)) for (const p of callRunAgreesWithItsTrace(r)) say(`run ${r.id}: ${p}`);
    }
    if (Date.parse(r.finishedAt) < Date.parse(r.startedAt)) say(`run ${r.id} finished before it started`);
  }
  // Experiments and runs link by id: /replay re-runs experiments[0] and compares it with runs[0].
  const ids = file.experiments.map((e) => e.id);
  if (new Set(ids).size !== ids.length) say("two experiments share an id");
  if (file.runs[0]!.experimentId !== file.experiments[0]!.id) say(`runs[0] is the run of experiment ${file.runs[0]!.experimentId}, not of experiments[0] (${file.experiments[0]!.id})`);
  for (const e of file.experiments) if (!file.runs.some((r) => r.experimentId === e.id)) say(`experiment ${e.id} has no run`);
  for (const b of file.bets) if (!file.experiments.some((e) => e.id === b.experimentId)) say(`bet ${b.id} names experiment ${b.experimentId}, which is not in the file`);
  // The fork block is fixed by the shape (server/evm-round.ts forkBlockFor), never by the file.
  for (const r of file.runs) {
    if (r.runner !== "evm") continue;
    const shape = file.experiments.find((e) => e.id === r.experimentId)?.params.shape;
    if (shape === "apply-proposal-then-read" && r.forkBlock !== FORK_BLOCK.beforeProposal) say(`a Level 2 (apply-proposal-then-read) run must fork at ${FORK_BLOCK.beforeProposal}, run ${r.id} forked at ${r.forkBlock}`);
    if (shape === "price-read" && r.forkBlock !== FORK_BLOCK.proposalExecuted) say(`a Level 1 (price-read) run must fork at ${FORK_BLOCK.proposalExecuted}, run ${r.id} forked at ${r.forkBlock}`);
    for (const p of evmRunAgreesWithItsTrace(r)) say(`run ${r.id}: ${p}`);
  }
  const runOf = (b: Bet) => file.runs.find((r) => r.experimentId === b.experimentId);
  for (const b of file.bets) {
    if (!verifySeal(b)) say(`bet ${b.id}: its fields do not hash to its sealedHash`);
    const run = runOf(b);
    if (!run) {
      say(`bet ${b.id} has no run for experiment ${b.experimentId}`);
      continue;
    }
    if (!(Date.parse(b.sealedAt) < Date.parse(run.startedAt))) say(`bet ${b.id} was not sealed before run ${run.id} started`);
    const v = file.verdicts.find((x) => x.betId === b.id);
    if (!v) {
      say(`bet ${b.id} has no verdict`);
      continue;
    }
    if (v.runId !== run.id) say(`the verdict on bet ${b.id} names run ${v.runId}, not ${run.id}`);
    // Re-judge: the stored verdict must be exactly what plain code gives for this bet and run.
    const again = judge(b, run);
    if (!sameJson(again, v)) say(`the verdict on bet ${b.id} is not what src/judge.ts gives for it (stored ${v.outcome}, judged ${again.outcome})`);
  }
  for (const v of file.verdicts) if (!file.bets.some((b) => b.id === v.betId)) say(`verdict names bet ${v.betId}, which is not in the file`);
  if (file.bettors) {
    // Day-7 review M3/M7: the bettor list must agree with the bets: sealed ⇔ has bets; every bettor of a bet is listed once.
    const whos = file.bettors.map((s) => s.who);
    if (new Set(whos).size !== whos.length) say("a bettor is listed twice in bettors");
    for (const s of file.bettors) {
      const has = file.bets.some((b) => b.who === s.who);
      if (s.status === "sealed" && !has) say(`bettors says ${s.who} sealed bets, but the file has none from it`);
      if (s.status !== "sealed" && has) say(`bettors says ${s.who} sealed nothing (${s.status}), but the file has its bets`);
    }
    for (const b of file.bets) if (!whos.includes(b.who)) say(`bet ${b.id} is from ${b.who}, who is not in bettors`);
    const autonomous = file.experiments[0]!.proposedBy.role === "adversary";
    if (autonomous && file.bets.some((b) => b.who === "human")) say("an autonomous round (proposed by the Adversary) cannot hold a person's bet");
  }
  // Final review S2: an attempt that did not finish ran before the run that did, on the SAME frozen bets: every
  // bet was sealed before the first attempt started, and every attempt stopped before the run started.
  if (file.attempts) {
    const run0 = file.runs[0]!;
    file.attempts.forEach((a, i) => {
      if (a.attempt !== i + 1) say(`attempt ${i + 1} is numbered ${a.attempt}`);
      if (Date.parse(a.stoppedAt) < Date.parse(a.startedAt)) say(`attempt ${a.attempt} stopped before it started`);
      if (!(Date.parse(a.stoppedAt) < Date.parse(run0.startedAt))) say(`attempt ${a.attempt} did not stop before run ${run0.id} started`);
      if (i > 0 && Date.parse(a.startedAt) < Date.parse(file.attempts![i - 1]!.stoppedAt)) say(`attempt ${a.attempt} started before attempt ${a.attempt - 1} stopped`);
    });
    const first = file.attempts[0];
    if (first) for (const b of file.bets) if (!(Date.parse(b.sealedAt) < Date.parse(first.startedAt))) say(`bet ${b.id} was not sealed before the first attempt started (the bets must stay frozen across attempts)`);
  }
  for (const p of findingProblems(file)) say(p);
  for (const p of changeProblems(file)) say(`change: ${p}`);
  const required = requiredCaptions(file);
  for (const c of required) if (!file.captions.includes(c)) say(`missing caption: "${c}"`);
  const allowed = new Set([...required, ...allowedExtraCaptions(file), ...(file.change ? [CHANGE_CAPTION, ...theoryCaptions(file.change)] : [])]);
  for (const c of file.captions) if (!allowed.has(c)) say(`caption "${c}" is not one this run earns`);
  if (new Set(file.captions).size !== file.captions.length) say("a caption appears twice");
  // The false-alarm table is never trusted as stored: it is rebuilt from the run (src/falsealarm.ts),
  // which also makes every flag "can't check" when the run's control did not pass.
  const level2Run = isLevel2(file);
  if (level2Run && !file.falseAlarm) say("a Level 2 file must carry its false-alarm table");
  if (level2Run && falseAlarmFromRun(level2Run).length === 0) say("a Level 2 run must record the actions it applied (its proposal_derived trace event); without them the false-alarm table would be empty");
  if (!level2Run && file.falseAlarm) say("only a Level 2 file carries a false-alarm table");
  if (level2Run && file.falseAlarm && !sameJson(falseAlarmFromRun(level2Run), file.falseAlarm)) say("the false-alarm table is not what src/falsealarm.ts rebuilds from the run");
  return problems.length ? { ok: false, problems } : { ok: true, file };
}

// m6 (day-5 review): a finding in the file is checked where plain code can check it.
// - Every Investigator finding (a model id, not "none: …") must be one the server's gate verified in this
//   session: the agent log carries "verifies finding <id> …" with that finding as its ref, and an
//   Investigator call by that model. A finding added to the file by hand has neither.
// - When the target is MIP-X43 (#578), the finding's lines are re-read from the committed copy Atlas
//   applies (contracts/lib/moonwell, the same bytes the EVM runner uses): the lines must exist, a person's
//   quote must be exactly those lines, and an Investigator's quote must sit inside them.
// What this cannot catch: someone who also forges the matching agent-log lines AND quotes the real line.
// The file is not signed; the README says so.
const MOONWELL_COPY = join(import.meta.dirname, "..", "contracts", "lib", "moonwell");
const MOONWELL_COPY_FILES = ["chains/8453.json", "proposals/ChainlinkOracleConfigs.sol", "proposals/mips/mip-x43/mip-x43.sol"];
const squashWs = (s: string) => s.replace(/\s+/g, " ").trim();
const unprefixed = (q: string) => {
  const lines = q.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  return nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\d+\| ?/.test(l)) ? lines.map((l) => l.replace(/^\s*\d+\| ?/, "")).join("\n") : q;
};

function findingProblems(file: AtlasFile): string[] {
  const out: string[] = [];
  const copy = file.target.codeSha256 === PR578_CODE_SHA256 && file.target.kind === "github-pr";
  for (const f of file.findings ?? []) {
    const byModel = f.proposedBy.role === "investigator" && !f.proposedBy.model.startsWith("none:");
    if (byModel) {
      const gate = file.agentLog.some((e) => e.ref?.kind === "finding" && e.ref.id === f.id && e.action.startsWith(`verifies finding ${f.id} `));
      const called = file.agentLog.some((e) => e.role === "investigator" && e.model === f.proposedBy.model);
      if (!gate || !called) out.push(`finding ${f.id} says ${f.proposedBy.model} proposed it, but the agent log shows no ${!called ? "call to that model" : "gate check of that finding"}`);
    }
    if (!copy || !MOONWELL_COPY_FILES.includes(f.file)) continue;
    let text: string;
    try {
      text = readFileSync(join(MOONWELL_COPY, f.file), "utf8");
    } catch {
      continue; // the copy is not on this machine: cannot check, so not checked
    }
    const lines = text.split("\n");
    const count = text.endsWith("\n") ? lines.length - 1 : lines.length;
    if (f.lineStart < 1 || f.lineEnd < f.lineStart || f.lineEnd > count) {
      out.push(`finding ${f.id}: ${lineSpan(f.lineStart, f.lineEnd)} ${f.lineStart === f.lineEnd ? "is" : "are"} not inside 1–${count} of ${f.file}`);
      continue;
    }
    const range = lines.slice(f.lineStart - 1, f.lineEnd);
    if (f.proposedBy.role === "human" && f.quotedSnippet !== range.join("\n")) out.push(`finding ${f.id}: its quote is not ${lineSpan(f.lineStart, f.lineEnd)} of ${f.file}`);
    if (byModel && !squashWs(range.join("\n")).includes(squashWs(unprefixed(f.quotedSnippet)))) out.push(`finding ${f.id}: its quote is not inside ${lineSpan(f.lineStart, f.lineEnd)} of ${f.file}`);
  }
  return out;
}

/** Parse a .atlas.json text. Throws with the problems listed when it does not verify. */
export function parseAtlasFile(text: string): AtlasFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("the .atlas.json is not valid JSON");
  }
  const v = verifyAtlasFile(raw);
  if (!v.ok) throw new Error(`the .atlas.json does not verify: ${v.problems.join("; ")}`);
  return v.file;
}

// ---------- the change and its replay (D06-01) ----------

/** The one file a change may edit, per runner (runners/change.ts says the same). */
const EDITABLE: Record<"ts" | "evm", (t: Target) => string> = { ts: (t) => t.ref, evm: () => "proposals/ChainlinkOracleConfigs.sol" };
/** The bytes the EVM replay reads, in this order (runners/change.ts MOONWELL_SCRATCH_FILES). */
const EVM_REPLAY_FILES = ["proposals/ChainlinkOracleConfigs.sol", "proposals/mips/mip-x43/mip-x43.sol", "chains/8453.json"];

/**
 * Recompute everything about a change and its replay from the file itself: the links, same seed / same
 * fork block, the "toward" text from the bets, the diff touching only the allowed file, the changed
 * code's SHA-256 (the diff re-applied by plain code to the copy on this machine, when it is here), the
 * verdicts on the replay (src/judge.ts again) and, on Moonwell, the PASS-RULE.md replay lines.
 */
export function changeProblems(file: AtlasFile): string[] {
  const out: string[] = [];
  const { change, replay } = file;
  if (!change && !replay) return out;
  if (!change || !replay) return ["a change and its replay must come together"];
  const run = file.runs[0]!;
  const exp = file.experiments[0]!;
  const r = replay.run;
  if (change.runId !== run.id) out.push(`it is for run ${change.runId}, not runs[0] (${run.id})`);
  if (change.replayRunId !== r.id) out.push(`it names replay ${change.replayRunId ?? "none"}, the file holds ${r.id}`);
  if (!sameJson(r.replayOf, { runId: run.id, changeId: change.id })) out.push(`the replay does not name run ${run.id} and change ${change.id}`);
  if (r.experimentId !== exp.id || r.runner !== run.runner) out.push("the replay is not the same experiment on the same runner");
  if (run.runner === "ts" && (r.seed === undefined || r.seed !== run.seed)) out.push(`the replay used seed ${r.seed}, not the original ${run.seed}`);
  if (run.runner === "evm" && (r.forkBlock === undefined || r.forkBlock !== run.forkBlock)) out.push(`the replay forked at ${r.forkBlock}, not the original ${run.forkBlock}`);
  if (change.toward !== towardFromBets(file.bets, file.verdicts)) out.push("its \"toward\" text is not what plain code writes from the bets and verdicts");
  const parsed = parseUnifiedDiff(change.diff);
  if (!parsed.ok) out.push(`its diff does not read: ${parsed.reason}`);
  else {
    const allowed = EDITABLE[run.runner](file.target);
    const other = parsed.files.find((f) => f.oldPath !== allowed || f.newPath !== allowed);
    if (other) out.push(`its diff touches ${other.newPath ?? other.oldPath}; only ${allowed} may change`);
    else {
      const sha = changedCodeSha256(file, run.runner, parsed.files[0]!, parsed.files);
      if (sha.ok && sha.value !== r.codeSha256) out.push(`the diff applied to the code gives ${sha.value.slice(0, 12)}…, the replay ran ${r.codeSha256.slice(0, 12)}…`);
      if (!sha.ok && sha.reason === "does not apply") out.push("its diff does not apply to the code the file names");
      if (run.runner === "evm") for (const p of modeProblems(change, parsed.files[0]!)) out.push(p);
    }
  }
  const checksEv = r.trace.filter((e) => e.event === "replay_checks");
  const checks = checksEv.length === 1 ? checksEv[0]!.data : undefined;
  if (checksEv.length !== 1) out.push(`the replay has ${checksEv.length} replay_checks events, not 1`);
  if (!checks || checks.originalCodeSha256 !== file.codeSha256) out.push("the replay's replay_checks event does not name the file's code");
  if (checks && (checks.replayOf !== run.id || checks.changeId !== change.id)) out.push("the replay's replay_checks event does not name the original run and this change");
  if (Date.parse(r.finishedAt) < Date.parse(r.startedAt)) out.push("the replay finished before it started");
  if (!file.captions.includes(CHANGE_CAPTION)) out.push(`the file does not carry the caption "${CHANGE_CAPTION}"`);
  // D20: a theoretical-direct-wire change carries its "In theory" captions, in the file and in its replay.
  for (const c of theoryCaptions(change)) if (!file.captions.includes(c)) out.push(`the file does not carry the caption "${c}"`);
  if ((checks?.mode ?? null) !== (change.mode ?? null)) out.push("the replay's replay_checks event does not record the change's mode");
  if (change.mode && (change.directWired ?? []).length === 0) out.push("a theoretical-direct-wire change must name the feeds it wired directly");
  if (run.runner !== "evm" && change.mode) out.push("only a Moonwell change can be theoretical-direct-wire");
  // S1 (day-6 review): the replay is checked as strictly as the original run.
  if (run.runner === "ts") {
    const hc = asRecord(checks?.harnessCheck);
    if (typeof hc.passed !== "boolean") out.push("the replay's harness check has no result");
    else if (hc.passed !== (r.controlPassed === true)) out.push(`the replay's harness check says passed = ${hc.passed}, but its controlPassed is ${r.controlPassed}`);
    if (r.controlPassed !== true && typeof r.result.notMeasured.control !== "string") out.push("the replay's control did not pass but notMeasured.control gives no reason");
    if (r.controlPassed === true && r.result.notMeasured.control !== undefined) out.push("the replay's controlPassed is true but notMeasured.control says it failed");
    if (checks && (checks.seed !== run.seed || checks.changedCodeSha256 !== r.codeSha256)) out.push("the replay's replay_checks event does not name the same seed and the changed code it ran");
    if (isRetryRun(file, r)) for (const p of tsRunAgreesWithItsTrace(r)) out.push(`replay ${r.id}: ${p}`);
  }
  for (const b of file.bets) {
    const v = replay.verdicts.find((x) => x.betId === b.id);
    if (!v) out.push(`bet ${b.id} has no verdict on the replay`);
    else if (!sameJson(judge(b, r), v)) out.push(`the replay verdict on bet ${b.id} is not what src/judge.ts gives`);
    if (!(Date.parse(b.sealedAt) < Date.parse(r.startedAt))) out.push(`bet ${b.id} was not sealed before the replay started`);
  }
  if (replay.verdicts.length !== file.bets.length) out.push("the replay has verdicts for bets the file does not hold");
  if (run.runner === "evm") {
    if (!replay.passRule || !sameJson(replay.passRule, evaluateReplayRule(r, run))) out.push("its PASS-RULE.md replay lines are not what plain code gives for the replay");
    for (const p of evmRunAgreesWithItsTrace(r)) out.push(`replay ${r.id}: ${p}`);
  } else if (replay.passRule) out.push("only a Moonwell replay carries PASS-RULE.md lines");
  return out;
}

/**
 * D20: the change's mode and directly wired feeds, recomputed by plain code (runners/change.ts
 * planChangedConfig) from the Moonwell copy on this machine. Not checked when the copy is absent.
 */
function modeProblems(change: NonNullable<AtlasFile["change"]>, diff: DiffFile): string[] {
  let files: Record<string, string>;
  try {
    files = Object.fromEntries(EVM_REPLAY_FILES.map((f) => [f, readFileSync(join(MOONWELL_COPY, f), "utf8")]));
  } catch {
    return [];
  }
  const changed = applyFileDiff(files[EVM_REPLAY_FILES[0]!]!, diff);
  if (changed === null) return [];
  const wired = planChangedConfig({ ...files, [EVM_REPLAY_FILES[0]!]: changed });
  if (!wired.ok) return [`its changed config cannot be wired by plain code: ${wired.reason}`];
  const out: string[] = [];
  if ((wired.value.mode ?? null) !== (change.mode ?? null)) out.push(`its mode is ${change.mode ?? "the proposal's own rule"}, but plain code wires the changed config ${wired.value.mode ? `only in ${wired.value.mode} mode` : "by the proposal's own rule"}`);
  if (!sameJson(wired.value.directWired ?? [], change.directWired ?? [])) out.push("its directly wired feeds are not the ones plain code derives from the address book");
  return out;
}

/** The changed code's SHA-256, recomputed from the copy on this machine. Not checked when the copy is absent. */
function changedCodeSha256(file: AtlasFile, runner: "ts" | "evm", diff: DiffFile, all: DiffFile[]): { ok: true; value: string } | { ok: false; reason: "absent" | "does not apply" } {
  if (all.length !== 1) return { ok: false, reason: "does not apply" };
  try {
    if (runner === "ts") {
      const text = readFileSync(join(import.meta.dirname, "..", file.target.ref), "utf8");
      if (sha256Hex(text) !== file.codeSha256) return { ok: false, reason: "absent" };
      const changed = applyFileDiff(text, diff);
      return changed === null ? { ok: false, reason: "does not apply" } : { ok: true, value: sha256Hex(changed) };
    }
    const texts = EVM_REPLAY_FILES.map((f) => readFileSync(join(MOONWELL_COPY, f), "utf8"));
    const changed = applyFileDiff(texts[0]!, diff);
    if (changed === null) return { ok: false, reason: "does not apply" };
    return { ok: true, value: sha256Hex([changed, ...texts.slice(1)].join("\n")) };
  } catch {
    return { ok: false, reason: "absent" };
  }
}

/** Add a change and its replay to a round's file, then verify the whole file again. Throws when it does not verify. */
export function withChange(file: AtlasFile, change: Change, replay: NonNullable<AtlasFile["replay"]>): AtlasFile {
  const next: AtlasFile = { ...file, change: { ...change, replayRunId: replay.run.id }, replay, captions: [...new Set([...file.captions, CHANGE_CAPTION, ...theoryCaptions(change)])] };
  const v = verifyAtlasFile(JSON.parse(JSON.stringify(next)));
  if (!v.ok) throw new Error(`the .atlas.json with its change does not verify: ${v.problems.join("; ")}`);
  return v.file;
}

// ---------- build ----------

export interface BuildInput {
  target: Target;
  experiment: Experiment;
  bets: Bet[];
  run: Run;
  verdicts: Verdict[];
  /** findings[0] = the round's finding; the rest = the Investigator's verified places on this code (M7). */
  findings?: Finding[];
  agentLog: AgentEvent[];
  /** Day-7 review M3/M7: every bettor of the round, including those who sealed nothing. */
  bettors?: BettorSlot[];
  /** Captions beyond the required ones (e.g. chosenLineCaptions(findings)). Required ones are added here. */
  extraCaptions?: string[];
  /** Final review S2: earlier attempts of this experiment that did not finish. */
  attempts?: RunAttempt[];
  createdAt: string;
}

/** Build the file for one round and verify it. Throws when it does not verify (a round that cannot be replayed is never written). */
export function buildAtlasFile(input: BuildInput): AtlasFile {
  const base = { target: input.target, experiments: [input.experiment], runs: [input.run] };
  const captions = [...new Set([...requiredCaptions(base), ...(input.extraCaptions ?? [])])];
  const file: AtlasFile = {
    version: 1,
    target: input.target,
    codeSha256: input.target.codeSha256,
    ...(input.run.forkBlock !== undefined ? { forkBlock: input.run.forkBlock } : {}),
    ...(input.run.chainId !== undefined ? { chainId: input.run.chainId } : {}),
    ...(input.run.seed !== undefined ? { seed: input.run.seed } : {}),
    experiments: [input.experiment],
    bets: input.bets,
    runs: [input.run],
    verdicts: input.verdicts,
    ...(input.findings && input.findings.length ? { findings: input.findings } : {}),
    ...(isLevel2(base) ? { falseAlarm: falseAlarmFromRun(input.run) } : {}),
    agentLog: input.agentLog,
    ...(input.bettors && input.bettors.length ? { bettors: input.bettors } : {}),
    ...(input.attempts && input.attempts.length ? { attempts: input.attempts } : {}),
    captions,
    createdAt: input.createdAt,
  };
  // Round-trip through JSON first: the file on disk is JSON, so verify exactly what will be written.
  const v = verifyAtlasFile(JSON.parse(JSON.stringify(file)));
  if (!v.ok) throw new Error(`the round's .atlas.json does not verify: ${v.problems.join("; ")}`);
  return v.file;
}

/** Field-by-field comparison of two runs' results (measured, notMeasured, references). Empty = deep-equal. */
export function resultDiff(a: Run["result"], b: Run["result"]): string[] {
  const out: string[] = [];
  for (const part of ["measured", "notMeasured", "references"] as const) {
    const x = (a[part] ?? {}) as Record<string, unknown>;
    const y = (b[part] ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!sameJson(x[k] ?? null, y[k] ?? null)) out.push(`${part}.${k}`);
    }
  }
  return out;
}
