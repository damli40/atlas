// B1 (D35): reading a benchmark corpus and turning each of its tests into a gate-checked Atlas experiment.
//
// Plain words: a corpus is a JSON file listing pasted files (each one JavaScript, TypeScript or Python) and, for
// each file, the calls Atlas will make to it (`call-function` tests). This module only READS: it loads the file,
// reads each case file's text, and builds the same Experiment the paste screen would build, through the same gate.
// It never runs anything and never calls a model. Both benches (bench/truth, bench/models) use it.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gate } from "../../src/gate.ts";
import { exportedFunctionsFor, makePastedTarget, type PastedLanguage } from "../../src/pasted-code.ts";
import type { ArgSpec, Experiment, ExperimentShape } from "../../src/types.ts";

export type CallParams = Extract<ExperimentShape, { shape: "call-function" }>;

/** One call to one function of a case file. `expect` is bench-specific (bench/truth has hand-written facts). */
export interface CorpusTest<E = unknown> {
  id: string;
  exportName: string;
  args: ArgSpec[];
  watchLimitMs?: number;
  expect?: E;
  why?: string;
}

export interface CorpusFunction<E = unknown> {
  id: string;
  /** Path of the case file, relative to the corpus JSON file's folder. */
  file: string;
  language: PastedLanguage;
  category: string;
  tests: CorpusTest<E>[];
}

export interface Corpus<E = unknown> {
  bench: string;
  functions: CorpusFunction<E>[];
}

export interface LoadedFunction<E = unknown> extends CorpusFunction<E> {
  source: string;
  sourceSha256: string;
}

export const sha256Hex = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** Loads a corpus and the text of every case file it names. Throws on a missing file (a corpus mistake). */
export function loadCorpus<E>(corpusPath: string): { corpus: Corpus<E>; corpusSha256: string; functions: LoadedFunction<E>[] } {
  const raw = readFileSync(corpusPath);
  const corpus = JSON.parse(raw.toString("utf8")) as Corpus<E>;
  const base = dirname(corpusPath);
  const functions = corpus.functions.map((f) => {
    const source = readFileSync(join(base, f.file), "utf8");
    return { ...f, source, sourceSha256: sha256Hex(source) };
  });
  return { corpus, corpusSha256: sha256Hex(raw), functions };
}

/** The call-function params of one test, as the gate sees them. */
export function paramsOf(t: CorpusTest): CallParams {
  return { shape: "call-function", exportName: t.exportName, args: t.args, ...(t.watchLimitMs !== undefined ? { watchLimitMs: t.watchLimitMs } : {}) };
}

/**
 * The Experiment for one test, built exactly as a pasted round is: a pasted target from the source, then the gate
 * with the export names plain code found. Returns the gate's refusal instead when it refuses (never runs it).
 */
export function experimentFor(f: LoadedFunction, t: CorpusTest): { ok: true; experiment: Experiment } | { ok: false; reason: string } {
  const target = makePastedTarget(f.source, f.language);
  const exportNames = exportedFunctionsFor(f.source, f.language).map((e) => e.name);
  const g = gate(paramsOf(t), { exportNames });
  if (!g.allowed) return { ok: false, reason: g.reason };
  return { ok: true, experiment: { id: t.id, target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } } };
}

/** The stand-in names a test passes, in argument order. */
export function standInNames(t: CorpusTest): string[] {
  return t.args.filter((a): a is Extract<ArgSpec, { kind: "stand-in" }> => a.kind === "stand-in").map((a) => a.name);
}
