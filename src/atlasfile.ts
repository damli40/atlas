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
// - the captions this kind of run requires are present (pre-existing label, "after the fact", fork wording).
// - a Level 2 file's false-alarm table is exactly what src/falsealarm.ts rebuilds from its run (so a run
//   whose control failed shows "can't check" on every flag, never a stored "flagged").
// No I/O, no clock (except `createdAt`, passed in), no model.

import { z } from "zod";
import { judge } from "./judge";
import { falseAlarmFromRun } from "./falsealarm";
import { canonicalJson, verifySeal } from "./seal";
import type { AgentEvent, AtlasFile, Bet, Experiment, Finding, Run, Target, Verdict } from "./types";

/** Caption for a Level 2 run (fork before the proposal, actions applied). Same text as runners/evm/level2.ts LEVEL2_CAPTION. */
export const LEVEL2_CAPTION = "fork of Base one block before MIP-X43 ran; Atlas applied the proposal's oracle-feed actions as the governor";
/** Caption for a Level 1 run (read after the proposal ran). Never "caught before shipping". */
export const level1Caption = (forkBlock: number) => `re-run after the fact, on a fork of Base at block ${forkBlock}`;
/** Caption when a person picked the cbETH line and no Investigator finding covered it. */
export const HUMAN_PICKED_CBETH_CAPTION = "the cbETH line was picked by a person; the Investigator pointed elsewhere";
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
  for (const c of requiredCaptions(file)) if (!file.captions.includes(c)) say(`missing caption: "${c}"`);
  // The false-alarm table is never trusted as stored: it is rebuilt from the run (src/falsealarm.ts),
  // which also makes every flag "can't check" when the run's control did not pass.
  const level2Run = isLevel2(file);
  if (level2Run && !file.falseAlarm) say("a Level 2 file must carry its false-alarm table");
  if (!level2Run && file.falseAlarm) say("only a Level 2 file carries a false-alarm table");
  if (level2Run && file.falseAlarm && !sameJson(falseAlarmFromRun(level2Run), file.falseAlarm)) say("the false-alarm table is not what src/falsealarm.ts rebuilds from the run");
  return problems.length ? { ok: false, problems } : { ok: true, file };
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
  findings?: Finding[];
  agentLog: AgentEvent[];
  /** Captions beyond the required ones (e.g. HUMAN_PICKED_CBETH_CAPTION). Required ones are added here. */
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
