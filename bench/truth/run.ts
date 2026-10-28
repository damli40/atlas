// B1 (D35) bench T, "Does Atlas tell the truth?": runs every test in bench/truth/expected.json through Atlas's real
// call-function runners and compares what Atlas measured with the facts written by hand before any run.
//
// Usage:
//   npx tsx bench/truth/run.ts                      # bench T, local executor (Node --permission; macOS sandbox-exec for Python)
//   npx tsx bench/truth/run.ts --bench truth-2      # bench T2 (the found failures, bench/truth-2/)
//   ATLAS_EXECUTOR=modal npx tsx bench/truth/run.ts # Modal sandboxes (batch E4's executor, runners/executor/select.ts)
//   npx tsx bench/truth/run.ts --only t03a,p04b     # a subset (the result file then says it is partial)
//
// What it does, in order, for each test: build the pasted target and gate-check the call exactly as a pasted round
// does (bench/lib/corpus.ts); run it with tsRunner().run, the production entry point (the known-case control runs
// first, every time); classify the result with bench/truth/classify.ts under the rules of PASS-RULE.md. It writes
// bench/truth/results/<date>.json (everything) and <date>.md (the table). It never edits expected.json, never calls
// a model, and costs $0. Tests run one at a time so one slow test cannot push another past Atlas's real-time limit.
//
// After the B1 review: it reads expectations ONLY from the registered path of the chosen bench (BENCH_CORPORA, equal to
// bench/lib/registration.ts; tests/unit/bench-order.test.ts checks both), refuses to run on a working tree with
// uncommitted changes, and records in every result the registration's content hash, the SHA-256 of every file that
// produced it (tooling), the reason categories used, and how many fields were compared.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { experimentFor, loadCorpus, type LoadedFunction, type CorpusTest } from "../lib/corpus.ts";
import { CLASSES, classify, type Classified, type TruthClass, type TruthExpect } from "./classify.ts";
import type { ClassifyOptions, ReasonCategories, RunInfo } from "./classify.ts";
import { tsRunner } from "../../runners/ts/control.ts";
import { executorFromEnv } from "../../runners/executor/select.ts";
import { findPython } from "../../runners/executor/sandbox-exec-python.ts";
import type { Executor } from "../../runners/runner.ts";
import type { Run } from "../../src/types.ts";
import { REGISTRATIONS, contentHash, toolingHashes, workingFiles } from "../lib/registration.ts";

const ROOT = new URL("../..", import.meta.url).pathname;

/** The ONLY expectation files this runner reads, by bench name. Must equal bench/lib/registration.ts (tested). */
export const BENCH_CORPORA: Readonly<Record<string, string>> = { truth: "bench/truth/expected.json", "truth-2": "bench/truth-2/expected.json" };

/** Bench T's reason categories come from its amendment (registered after its result); T2 registers its own. */
export const TRUTH_CATEGORIES_FILE = "bench/truth/reason-categories.json";

/** The reason categories and per-trap category for a bench, read from the registered places only. */
export function categoriesFor(bench: string, root = ROOT): { categories: ReasonCategories; perTest: Record<string, string | string[]> } {
  if (bench === "truth") {
    const path = join(root, TRUTH_CATEGORIES_FILE);
    if (!existsSync(path)) return { categories: {}, perTest: {} };
    const j = JSON.parse(readFileSync(path, "utf8")) as { categories: ReasonCategories; traps: Record<string, string | string[]> };
    return { categories: j.categories, perTest: j.traps };
  }
  const j = JSON.parse(readFileSync(join(root, BENCH_CORPORA[bench]!), "utf8")) as { reasonCategories?: ReasonCategories };
  return { categories: j.reasonCategories ?? {}, perTest: {} };
}

/** Bench T2's amendment 1 (labelled values, the double run) is in force when the file is present. */
export const T2_AMENDMENT = "bench/truth-2/AMENDMENT-1.md";

export function classifyOptions(bench: string, testId: string, root = ROOT, run?: RunInfo): ClassifyOptions {
  const c = categoriesFor(bench, root);
  const labels = bench === "truth-2" && existsSync(join(root, T2_AMENDMENT));
  return { categories: c.categories, ...(c.perTest[testId] !== undefined ? { reasonCategory: c.perTest[testId] } : {}), ...(labels ? { labels } : {}), ...(run ? { run } : {}) };
}

/** The run facts a record keeps for re-scoring (conditions, pins, the twin's measured fields). */
export function runInfoOf(r: { language: string; conditions?: RunInfo["conditions"]; seed?: string; timeZone?: string; locale?: string; twinMeasured?: RunInfo["twinMeasured"] }): RunInfo {
  return { language: r.language, ...(r.conditions ? { conditions: r.conditions } : {}), ...(r.seed ? { seed: r.seed } : {}), ...(r.timeZone ? { timeZone: r.timeZone } : {}), ...(r.locale ? { locale: r.locale } : {}), ...(r.twinMeasured ? { twinMeasured: r.twinMeasured } : {}) };
}

export interface TestRecord {
  id: string;
  functionId: string;
  file: string;
  language: string;
  category: string;
  exportName: string;
  expected: TruthExpect;
  why: string;
  classification: TruthClass | "not run";
  fields: Classified["fields"];
  notes: string[];
  cantCheckReason?: string;
  measured?: Run["result"]["measured"];
  notMeasured?: Run["result"]["notMeasured"];
  runId?: string;
  controlRunId?: string;
  controlPassed?: boolean;
  executor?: string;
  pythonVersion?: string;
  realMs?: number;
  notRunBecause?: string;
  /** Batch R1: the run's conditions line, pins and second run. */
  conditions?: RunInfo["conditions"];
  seed?: string;
  timeZone?: string;
  locale?: string;
  twinMeasured?: RunInfo["twinMeasured"];
}

/** Removes any absolute local path from text the runner returned (the repo is public). Counts what it removed. */
export function scrubPaths(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(/(?:\/private)?\/(?:var\/folders|tmp|Users|home)\/[^\s"'`),;:]*/g, () => {
    removed++;
    return "<local-path>";
  });
  return { text: out, removed };
}

function pickExecutors(): { js: Executor; name: string } {
  // E4 (on main): ATLAS_EXECUTOR unset or "local" = this machine; "modal" = Modal sandboxes. The Python executor follows.
  const js = executorFromEnv(process.env);
  return { js, name: js.kind === "modal" ? "modal" : "local (Node --permission for JS/TS; macOS sandbox-exec for Python)" };
}

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** One cell of the table: short and single-line. */
function short(v: unknown, max = 70): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const one = (s ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function expectedCell(e: TruthExpect): string {
  if (e.cantCheck) return "can't check";
  const parts: string[] = [typeof e.outcome === "string" ? e.outcome : `outcome depends on ${e.outcome.dependsOn}`];
  if (e.returnedJson !== undefined) parts.push(`json ${short(JSON.stringify(e.returnedJson), 40)}`);
  if (e.returnedNotJson) parts.push(`not JSON (${e.returnedNotJson.type})`);
  if (e.thrownName !== undefined) parts.push(`name ${e.thrownName ?? "(none)"}`);
  if (e.thrownType !== undefined && e.outcome === "threw") parts.push(`type ${e.thrownType}`);
  if (e.virtualMs !== undefined) parts.push(`${e.virtualMs ?? "no"} ms`);
  for (const [k, n] of Object.entries(e.calls ?? {})) parts.push(`${k}×${n ?? "?"}`);
  return parts.join(", ");
}

function measuredCell(r: TestRecord): string {
  if (r.classification === "not run") return `not run: ${r.notRunBecause}`;
  const m = r.measured ?? {};
  if (r.notMeasured?.wholeRun) return `can't check: ${short(r.notMeasured.wholeRun, 60)}`;
  if (!("outcome" in m)) return `outcome not measured: ${short(r.notMeasured?.outcome ?? "", 60)}`;
  const parts = [String(m.outcome)];
  if (m.returnedJson !== undefined) parts.push(`json ${short(m.returnedJson, 40)}`);
  else if (m.outcome === "returned") parts.push(`not JSON (${m.returnedType})`);
  if (m.outcome === "threw") parts.push(`name ${m.thrownName ?? "(none)"}`, `type ${m.thrownType}`);
  if (m.virtualMs !== undefined) parts.push(`${m.virtualMs} ms`);
  for (const k of Object.keys(m).filter((k) => k.startsWith("calls:"))) parts.push(`${k.slice(6)}×${m[k]}`);
  return parts.join(", ");
}

export function renderMarkdown(meta: Record<string, unknown>, records: TestRecord[], counts: Record<string, number>, byLang: Record<string, Record<string, number>>): string {
  const lines: string[] = [];
  lines.push(`# Bench ${meta.bench === "truth" ? "T" : String(meta.bench)} result, ${meta.date}`, "");
  lines.push(`Sample: **${meta.testsRun} tests run** of ${meta.testsInCorpus} in the corpus (${meta.factTests} fact tests, ${meta.trapTests} can't-check traps), ${meta.filesInCorpus} case files. One run each. No general claim follows from this sample (PASS-RULE.md).`, "");
  lines.push(`- Executor: ${meta.executor}`);
  lines.push(`- Node ${meta.node}; Python ${meta.python}; ${meta.platform}`);
  lines.push(`- Git commit: \`${meta.commit}\`${meta.dirty ? " (working tree had uncommitted changes)" : ""}`);
  lines.push(`- expected.json SHA-256: \`${meta.corpusSha256}\``);
  lines.push(`- Wall time: ${meta.wallSeconds} s · cost $0 (no model call)`);
  if (meta.fieldsCompared !== undefined) lines.push(`- Fields compared: **${meta.fieldsCompared}** (${Object.entries((meta.fieldVerdicts ?? {}) as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  if (meta.partial) lines.push(`- **Partial run** (--only): not a full bench result.`);
  lines.push("", "## Counts", "");
  lines.push("| Classification | All | JS/TS | Python |", "|---|---|---|---|");
  for (const c of [...CLASSES, "not run"] as const) {
    const n = counts[c] ?? 0;
    if (n === 0 && (c === "control failed" || c === "not run")) continue;
    lines.push(`| ${c === "FALSE FACT" ? "**FALSE FACT**" : c} | ${n} | ${byLang.js?.[c] ?? 0} | ${byLang.py?.[c] ?? 0} |`);
  }
  const bad = records.filter((r) => r.classification !== "correct fact" && r.classification !== "correct can't-check");
  lines.push("", "## Tests that are not correct facts or correct can't-checks", "");
  if (bad.length === 0) lines.push("None.", "");
  for (const r of bad) {
    lines.push(`### ${r.id} (${r.file}, \`${r.exportName}\`): ${r.classification}`, "");
    lines.push(`- Expected: ${expectedCell(r.expected)}`);
    lines.push(`- Measured: ${measuredCell(r)}`);
    for (const f of r.fields.filter((f) => f.verdict !== "correct")) {
      lines.push(`- Field \`${f.field}\`: ${f.verdict}; expected ${short(f.expected, 200)}, measured ${short(f.measured, 200)}${f.notMeasured ? `; Atlas: "${short(f.notMeasured, 300)}"` : ""}`);
    }
    if (r.cantCheckReason) lines.push(`- Atlas's reason: "${short(r.cantCheckReason, 300)}"`);
    lines.push("");
  }
  const noted = records.filter((r) => r.notes.length > 0);
  if (noted.length) {
    lines.push("## Notes (do not change a classification)", "");
    for (const r of noted) for (const n of r.notes) lines.push(`- ${r.id}: ${n}`);
    lines.push("");
  }
  lines.push("## Every test", "");
  if (meta.factTestsWithConditions !== undefined) {
    lines.push("## Conditions (batch R1)", "");
    lines.push(`- Fact tests whose run carries a conditions line: ${meta.factTestsWithConditions}; with no condition ("None of the conditions Atlas checks for ..."): ${meta.factTestsWithNoCondition}.`);
    lines.push(`- Condition kinds seen: ${Object.entries((meta.conditionKinds ?? {}) as Record<string, number>).map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}.`);
    lines.push(`- Tests with a field refused by the double run: ${meta.doubleRunRefusals}.`);
    lines.push(`- Labelled values counted (bench T2 amendment 1 in force): ${meta.labelsInForce ? "yes" : "no"}.`, "");
  }
  lines.push("| Test | Lang | Category | Expected (written before the run) | Measured by Atlas | Conditions | Classification |", "|---|---|---|---|---|---|---|");
  for (const r of records) lines.push(`| ${r.id} | ${r.language} | ${short(r.category, 40)} | ${expectedCell(r.expected)} | ${measuredCell(r)} | ${(r.conditions ?? []).map((c) => c.kind).join(", ") || "none"} | ${r.classification} |`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg !== -1 ? new Set((process.argv[onlyArg + 1] ?? "").split(",").filter(Boolean)) : null;
  const benchArg = process.argv.indexOf("--bench");
  const bench = benchArg !== -1 ? (process.argv[benchArg + 1] ?? "") : "truth";
  const corpusRel = BENCH_CORPORA[bench];
  const reg = REGISTRATIONS.find((r) => r.name === bench);
  if (!corpusRel || !reg || reg.corpus !== corpusRel) throw new Error(`unknown bench ${JSON.stringify(bench)}; registered: ${Object.keys(BENCH_CORPORA).join(", ")}`);
  if (git("status", "--porcelain") !== "" && !process.argv.includes("--allow-dirty")) {
    throw new Error("the working tree has uncommitted changes; a result must be produced by committed files (its hashes are checked against git)");
  }
  const { js, name } = pickExecutors();
  const runner = tsRunner(js);
  const { corpus, corpusSha256, functions } = loadCorpus<TruthExpect>(join(ROOT, corpusRel));
  const python = findPython();
  const started = Date.now();
  const records: TestRecord[] = [];
  const all = functions.flatMap((f) => f.tests.map((t) => ({ f, t })));
  const todo = all.filter(({ t }) => !only || only.has(t.id));

  for (const { f, t } of todo) {
    records.push(await runOne(runner, f as LoadedFunction<TruthExpect>, t, name === "modal" || python !== null, bench));
    const r = records[records.length - 1]!;
    process.stdout.write(`${r.id.padEnd(6)} ${r.classification}\n`);
  }

  const counts: Record<string, number> = {};
  const byLang: Record<string, Record<string, number>> = { js: {}, py: {} };
  for (const r of records) {
    counts[r.classification] = (counts[r.classification] ?? 0) + 1;
    const lang = r.language === "py" ? "py" : "js";
    byLang[lang]![r.classification] = (byLang[lang]![r.classification] ?? 0) + 1;
  }
  const pyVersions = [...new Set(records.map((r) => r.pythonVersion).filter(Boolean))];
  const meta = {
    bench: corpus.bench,
    date: localDate(),
    startedAt: new Date(started).toISOString(),
    wallSeconds: Math.round((Date.now() - started) / 100) / 10,
    executor: name,
    node: process.version,
    python: pyVersions.join(", ") || (python ? "found, not used" : "none found (Python tests not run)"),
    platform: `${process.platform} ${process.arch}`,
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain") !== "",
    corpusSha256,
    filesInCorpus: functions.length,
    testsInCorpus: all.length,
    testsRun: records.filter((r) => r.classification !== "not run").length,
    factTests: all.filter(({ t }) => !t.expect?.cantCheck).length,
    trapTests: all.filter(({ t }) => t.expect?.cantCheck).length,
    partial: only !== null,
    costUsd: 0,
    sources: Object.fromEntries(functions.map((f) => [f.file, f.sourceSha256])),
    corpusPath: corpusRel,
    registrationSha256: contentHash(workingFiles(ROOT, reg.prereg)),
    tooling: toolingHashes(ROOT),
    reasonCategories: categoriesFor(bench),
    fieldsCompared: records.reduce((n, r) => n + r.fields.length, 0),
    amendments: Object.fromEntries(workingFiles(ROOT, [`bench/${bench}`]).filter((f) => /\/AMENDMENT[^/]*\.md$/.test(f.path)).map((f) => [f.path, f.sha256])),
    labelsInForce: bench === "truth-2" && existsSync(join(ROOT, T2_AMENDMENT)),
    factTestsWithConditions: records.filter((r) => !r.expected.cantCheck && (r.conditions?.length ?? 0) > 0).length,
    factTestsWithNoCondition: records.filter((r) => !r.expected.cantCheck && r.classification !== "not run" && (r.conditions?.length ?? 0) === 0).length,
    doubleRunRefusals: records.filter((r) => Object.values(r.notMeasured ?? {}).some((w) => w.startsWith("this value changed between two identical runs"))).length,
    conditionKinds: records.flatMap((r) => (r.conditions ?? []).map((c) => c.kind)).reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {}),
    fieldVerdicts: records.flatMap((r) => r.fields).reduce<Record<string, number>>((acc, f) => ((acc[f.verdict] = (acc[f.verdict] ?? 0) + 1), acc), {}),
  };

  const dir = join(ROOT, reg.results);
  mkdirSync(dir, { recursive: true });
  let stem = meta.date + (only ? "-partial" : "");
  for (let i = 2; existsSync(join(dir, `${stem}.json`)); i++) stem = `${meta.date}${only ? "-partial" : ""}-${i}`;
  const json = scrubPaths(JSON.stringify({ meta, counts, byLanguage: byLang, tests: records }, null, 2) + "\n");
  const md = scrubPaths(renderMarkdown(meta, records, counts, byLang));
  writeFileSync(join(dir, `${stem}.json`), json.text);
  writeFileSync(join(dir, `${stem}.md`), md.text);
  process.stdout.write(`\n${JSON.stringify(counts)}\nwrote ${reg.results}/${stem}.json and .md (local paths removed: ${json.removed + md.removed})\n`);
}

async function runOne(runner: ReturnType<typeof tsRunner>, f: LoadedFunction<TruthExpect>, t: CorpusTest<TruthExpect>, pythonAvailable: boolean, bench: string): Promise<TestRecord> {
  const base = { id: t.id, functionId: f.id, file: f.file, language: f.language, category: f.category, exportName: t.exportName, expected: t.expect!, why: t.why ?? "", fields: [], notes: [] };
  if (f.language === "py" && !pythonAvailable) return { ...base, classification: "not run", notRunBecause: "no Python 3.12+ on this machine" };
  const e = experimentFor(f, t);
  if (!e.ok) return { ...base, classification: "not run", notRunBecause: `the gate refused it: ${e.reason}` };
  const t0 = Date.now();
  const run = await runner.run(e.experiment, {});
  const realMs = Date.now() - t0;
  const runFacts = {
    language: f.language,
    ...(run.conditions ? { conditions: run.conditions.map((c) => ({ kind: c.kind, says: c.says })) } : {}),
    ...(run.seed ? { seed: run.seed } : {}),
    ...(run.timeZone ? { timeZone: run.timeZone } : {}),
    ...(run.locale ? { locale: run.locale } : {}),
    ...(run.twin ? { twinMeasured: run.twin.result.measured } : {}),
  };
  const c = classify(t.expect!, run.result, run.controlPassed === true, classifyOptions(bench, t.id, ROOT, runInfoOf(runFacts)));
  const py = run.trace.find((ev) => ev.event === "call_checks")?.data as { python?: string } | undefined;
  return {
    ...base,
    classification: c.classification,
    fields: c.fields,
    notes: c.notes,
    ...(c.cantCheckReason ? { cantCheckReason: c.cantCheckReason } : {}),
    measured: run.result.measured,
    notMeasured: run.result.notMeasured,
    ...(runFacts.conditions ? { conditions: runFacts.conditions } : {}),
    ...(runFacts.seed ? { seed: runFacts.seed } : {}),
    ...(runFacts.timeZone ? { timeZone: runFacts.timeZone } : {}),
    ...(runFacts.locale ? { locale: runFacts.locale } : {}),
    ...(runFacts.twinMeasured ? { twinMeasured: runFacts.twinMeasured } : {}),
    runId: run.id,
    ...(run.controlRunId ? { controlRunId: run.controlRunId } : {}),
    controlPassed: run.controlPassed === true,
    executor: run.executor,
    ...(typeof py?.python === "string" ? { pythonVersion: py.python } : {}),
    realMs,
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`bench T did not run: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}
