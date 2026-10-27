// Writes a refusal record to proofs/refusals/<date>-<id>.json.
//
// A refusal is a real moment when Atlas would not run or would not judge: the gate refused a
// model's experiment, or a model declined to bet. proofs/ is PUBLIC, so a record holds only the
// experiment, the reason, the model id and the time. Callers write one only for a real live call,
// never for a test or a constructed example.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RefusalRecord {
  kind: "gate_rejection" | "declined_bet";
  /** The refused experiment's id, or the declined bet's id. */
  id: string;
  time: string;
  role: "claimant" | "adversary";
  model: string;
  /** The experiment params as proposed (for a declined bet, the experiment it was placed on). */
  experiment: unknown;
  /** Plain reason: the gate's reason, or the bettor's own reason for declining. */
  reason: string;
  /** declined_bet only: which measured field and the plain-code question. */
  measures?: string;
  question?: string;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REFUSALS_DIR = join(REPO_ROOT, "proofs", "refusals");

/** Writes the record and returns its path. The file name is <YYYY-MM-DD>-<id>.json. */
export function writeRefusal(record: RefusalRecord, dir: string = REFUSALS_DIR): string {
  const safeId = record.id.replace(/[^A-Za-z0-9_-]/g, "_");
  const path = join(dir, `${record.time.slice(0, 10)}-${safeId}.json`);
  mkdirSync(dirname(path), { recursive: true });
  const clean: RefusalRecord = {
    kind: record.kind,
    id: record.id,
    time: record.time,
    role: record.role,
    model: record.model,
    experiment: record.experiment,
    reason: record.reason,
    ...(record.measures !== undefined ? { measures: record.measures } : {}),
    ...(record.question !== undefined ? { question: record.question } : {}),
  };
  writeFileSync(path, JSON.stringify(clean, null, 2) + "\n");
  return path;
}
