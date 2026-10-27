// Writes a refusal record to proofs/refusals/.
//
// A refusal is a real moment when Atlas would not run or would not judge: the gate refused an
// experiment, a model declined to bet, or the judge said "can't check". proofs/ is PUBLIC, so a
// record holds only the experiment, the trigger, the reason, the model id (when a model was
// involved) and the time: no keys, no URLs, no local paths (scrub() removes any that slip into a
// reason or a parameter).
//
// Who writes: the live server writes one automatically for every gate refusal and every can't-check
// verdict (server/app.ts, `refusals` option; server/index.ts passes fileRefusalWriter()). Tests and
// scripts pass an in-memory writer or none, so `pnpm test` never adds a file here.
//
// File names: <YYYY-MM-DD>-<runId>-<betId>.json for a can't-check verdict,
// <YYYY-MM-DD>-<experimentId>.json for a gate refusal (no run exists), <YYYY-MM-DD>-<betId>.json for
// a declined bet recorded by the Claimant evidence scripts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RefusalRecord {
  kind: "gate_rejection" | "declined_bet" | "cant_check";
  /** The refused experiment's id, or the bet's id. */
  id: string;
  time: string;
  /** Who proposed the refused experiment, or who placed the bet. */
  role: "claimant" | "adversary" | "human";
  /** The Meta model involved, when a model proposed or bet. Absent for a person's own experiment or bet. */
  model?: string;
  /** The experiment params as proposed (for a bet, the experiment it was placed on). */
  experiment: unknown;
  /** Plain reason: the gate's reason, the bettor's own reason for declining, or the judge's reason. */
  reason: string;
  /** What triggered it, in plain words, e.g. "POST /experiments: the gate refused the params". */
  trigger?: string;
  /** cant_check: the run that was judged, and the bet. */
  runId?: string;
  betId?: string;
  experimentId?: string;
  /** Bets only: which measured field and the plain-code question. */
  measures?: string;
  question?: string;
}

/** Receives each refusal. The server calls it; what it does (write a file, keep it in memory) is the caller's choice. */
export type RefusalWriter = (record: RefusalRecord) => void;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REFUSALS_DIR = join(REPO_ROOT, "proofs", "refusals");

const safePart = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

export function refusalFileName(record: RefusalRecord): string {
  const date = safePart(record.time.slice(0, 10));
  if (record.kind === "cant_check" && record.runId && record.betId) return `${date}-${safePart(record.runId)}-${safePart(record.betId)}.json`;
  return `${date}-${safePart(record.id)}.json`;
}

// Anything that looks like a local path, a URL or a secret is replaced before a record is written.
const LOCAL_PATH = /(?:\/(?:Users|home|private|tmp|var|etc|opt|root|Volumes)\/[^\s"'`)]*|[A-Za-z]:\\[^\s"'`)]*|~\/[^\s"'`)]*)/g;
const URL_TEXT = /\b(?:https?|wss?):\/\/[^\s"'`)]+/gi;
// A long unbroken run of letters/digits looks like a key; a 64-hex SHA-256 (a code fingerprint) is kept.
const SECRET_TEXT = /\b(?:sk|pk|key|token|secret|bearer)[-_ ]?[A-Za-z0-9_-]{16,}\b|\b[A-Za-z0-9_-]{40,}\b/gi;

/** Removes local paths, URLs and secret-looking strings from text (and the live key / RPC URL, when set). */
export function scrubText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const name of ["META_API_KEY", "BASE_RPC_URL", "ATLAS_BASE_RPC_URL", "RPC_URL"]) {
    const v = env[name]?.trim();
    if (v && v.length >= 8) out = out.split(v).join(`[${name.toLowerCase().includes("key") ? "key" : "url"} removed]`);
  }
  return out.replace(URL_TEXT, "[url removed]").replace(LOCAL_PATH, "[local path removed]").replace(SECRET_TEXT, (m) => (/^[0-9a-f]{64}$/.test(m) ? m : "[removed]"));
}

/** scrubText applied to every string in a JSON value (keys too). */
export function scrub(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === "string") return scrubText(value, env);
  if (Array.isArray(value)) return value.map((v) => scrub(v, env));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[scrubText(k, env)] = scrub(v, env);
    return out;
  }
  return value;
}

/** The record with only its known fields, scrubbed. */
export function cleanRecord(record: RefusalRecord, env: NodeJS.ProcessEnv = process.env): RefusalRecord {
  const s = (v: string) => scrubText(v, env);
  return {
    kind: record.kind,
    id: record.id,
    time: record.time,
    role: record.role,
    ...(record.model !== undefined ? { model: record.model } : {}),
    ...(record.trigger !== undefined ? { trigger: s(record.trigger) } : {}),
    ...(record.experimentId !== undefined ? { experimentId: record.experimentId } : {}),
    ...(record.runId !== undefined ? { runId: record.runId } : {}),
    ...(record.betId !== undefined ? { betId: record.betId } : {}),
    experiment: scrub(record.experiment, env),
    reason: s(record.reason),
    ...(record.measures !== undefined ? { measures: record.measures } : {}),
    ...(record.question !== undefined ? { question: record.question } : {}),
  };
}

/**
 * Writes the record and returns its path. Never overwrites: an experiment id can be chosen by the
 * client, so a name already taken gets "-2", "-3", ... instead of replacing an earlier record.
 */
export function writeRefusal(record: RefusalRecord, dir: string = REFUSALS_DIR): string {
  const base = refusalFileName(record).replace(/\.json$/, "");
  mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(cleanRecord(record), null, 2) + "\n";
  for (let n = 1; n <= 1000; n++) {
    const path = join(dir, `${base}${n === 1 ? "" : `-${n}`}.json`);
    try {
      writeFileSync(path, body, { flag: "wx" }); // fails if the file exists
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error(`more than 1000 refusal records named ${base}`);
}

/** Most records one server process writes, so a public URL cannot fill the disk with refusals. */
export const MAX_RECORDS_PER_PROCESS = 1000;

/** The live server's writer: one file per refusal in `dir`. A failed write never stops a round. */
export function fileRefusalWriter(dir: string = REFUSALS_DIR, onError: (e: unknown) => void = () => {}, max = MAX_RECORDS_PER_PROCESS): RefusalWriter {
  let written = 0;
  return (record) => {
    if (written >= max) return onError(new Error(`this server already wrote ${max} refusal records; no more are written until it restarts`));
    written++;
    try {
      writeRefusal(record, dir);
    } catch (e) {
      onError(e);
    }
  };
}

/** For tests and scripts: keeps the records in memory, writes nothing. */
export function memoryRefusalWriter(): RefusalWriter & { records: RefusalRecord[] } {
  const records: RefusalRecord[] = [];
  const w = ((record: RefusalRecord) => {
    records.push(cleanRecord(record));
  }) as RefusalWriter & { records: RefusalRecord[] };
  w.records = records;
  return w;
}
