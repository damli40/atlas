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
import { falseAlarmFromRun } from "./falsealarm";
import { chainlinkTo1e18, usdTimesRatio1e18 } from "./units";
import { canonicalJson, verifySeal } from "./seal";
import type { AgentEvent, AtlasFile, Bet, Experiment, Finding, Run, Target, Verdict } from "./types";

/** Caption for a Level 2 run (fork before the proposal, actions applied). Same text as runners/evm/level2.ts LEVEL2_CAPTION. */
export const LEVEL2_CAPTION = "fork of Base one block before MIP-X43 ran; Atlas applied the proposal's oracle-feed actions as the governor";
/** Caption for a Level 1 run (read after the proposal ran). Never "caught before shipping". */
export const level1Caption = (forkBlock: number) => `re-run after the fact, on a fork of Base at block ${forkBlock}`;
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
    ? `the person picked lines ${lineStart}–${lineEnd}, which hold the cbETH line (${cbEth.from === cbEth.to ? `line ${cbEth.from}` : `lines ${cbEth.from}–${cbEth.to}`})`
    : `the person picked lines ${lineStart}–${lineEnd}`;
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
    kind: z.enum(["ts-fixture", "github-pr"]),
    ref: z.string().min(1),
    codeSha256: sha,
    commit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
    preExisting: z.object({ label: z.string().min(1), listedIn: z.literal("PRE-EXISTING.md") }).strict().optional(),
  })
  .strict();

const answerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("integer"), value: z.number().int() }).strict(),
  z.object({ kind: z.literal("number"), value: z.number(), tolerancePct: z.number(), unit: z.string() }).strict(),
  z.object({ kind: z.literal("enum"), value: z.string(), options: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("declined"), reason: z.string() }).strict(),
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
    ref: z.object({ kind: z.enum(["finding", "experiment", "bet", "run", "verdict", "change"]), id: z.string() }).strict().optional(),
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
    change: z.unknown().optional(),
    findings: z.array(findingSchema).optional(),
    falseAlarm: z.array(falseAlarmRowSchema).optional(),
    agentLog: z.array(agentEventSchema),
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

/** m5: the file's agent log shows the Investigator (a Meta model) was called in this session. */
export const investigatorWasAsked = (agentLog: readonly Pick<AgentEvent, "role" | "model">[]) => agentLog.some((e) => e.role === "investigator" && typeof e.model === "string" && e.model.length > 0);

/** Captions a file may carry beyond the required ones: exactly the chosen-line caption its findings earn. */
export function allowedExtraCaptions(file: Pick<AtlasFile, "findings" | "agentLog">): string[] {
  return chosenLineCaptions(file.findings, investigatorWasAsked(file.agentLog));
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
    }
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
  for (const p of findingProblems(file)) say(p);
  const required = requiredCaptions(file);
  for (const c of required) if (!file.captions.includes(c)) say(`missing caption: "${c}"`);
  const allowed = new Set([...required, ...allowedExtraCaptions(file)]);
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
      out.push(`finding ${f.id}: lines ${f.lineStart}–${f.lineEnd} are not inside 1–${count} of ${f.file}`);
      continue;
    }
    const range = lines.slice(f.lineStart - 1, f.lineEnd);
    if (f.proposedBy.role === "human" && f.quotedSnippet !== range.join("\n")) out.push(`finding ${f.id}: its quote is not lines ${f.lineStart}–${f.lineEnd} of ${f.file}`);
    if (byModel && !squashWs(range.join("\n")).includes(squashWs(unprefixed(f.quotedSnippet)))) out.push(`finding ${f.id}: its quote is not inside lines ${f.lineStart}–${f.lineEnd} of ${f.file}`);
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
  /** Captions beyond the required ones (e.g. chosenLineCaptions(findings)). Required ones are added here. */
  extraCaptions?: string[];
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
