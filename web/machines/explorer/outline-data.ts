// X2 prototype: the shape of the outline the explorer machine draws. Types only.
//
// Plain words: this is the outline record X1 wrote for one real codebase (tests/fixtures/outline/*.json):
// Muse Wonder proposed named parts and joins, then plain code checked every one against the bytes.
// The record keeps, per part, Wonder's name and purpose sentence (the model's words), the line ranges
// plain code confirmed, and a status; per join, its kind and whether plain code confirmed it, could not
// check it (model-only), or found it on its own (code-only).
//
// Copied from the shapes on branch x1-outline (src/outline/types.ts: JoinKind, VerifiedJoin status names),
// narrowed to the summary fields this record carries. X1 code is not imported or changed.

export type JoinKind = "calls" | "imports" | "data";

export interface OutlineRecordPart {
  id: string;
  status: "confirmed" | "unconfirmed";
  /** Wonder's name for the part (model's words). */
  name: string;
  /** Wonder's sentence for what the part is for (model's words, never Atlas's). */
  purposeByModel: string;
  /** Files of the codebase this part covers (confirmed spans only). */
  files: string[];
  /** "path:start-end", with " (whole file)" when the span is the whole file. */
  ranges: string[];
  /** Unconfirmed only: plain code's reasons. */
  reasons: string[];
  patterns: { label: string; known: boolean }[];
}

export interface OutlineRecordJoin {
  id: string;
  from: string;
  to: string;
  kind: JoinKind;
  /**
   * confirmed: Wonder said it and plain code found an import or call between the two parts' lines.
   * model-only: Wonder said it; plain code could not check it.
   * code-only: plain code found it; Wonder did not say it.
   */
  status: "confirmed" | "model-only" | "code-only";
  /** How many code-map edges show it (0 for model-only). */
  codeEdges: number;
  reason?: string;
  wonderEvidenceMatches?: boolean;
}

export interface OutlineRecordFile {
  path: string;
  language: "js" | "ts" | "py";
  bytes: number;
  sha256: string;
}

export interface OutlineRecord {
  ranAt: string;
  source:
    | { kind: "github"; repo: string; requestedRef?: string; commit: string; subfolder: string }
    | { kind: "upload" };
  codeSha256: string;
  files: OutlineRecordFile[];
  wonder: { model: string };
  /** Set when the outline was too large to check: then nothing is confirmed. */
  cantCheck?: string;
  counts: { confirmedParts: number; unconfirmedParts: number; confirmedJoins: number; modelOnlyJoins: number; codeOnlyJoins: number };
  parts: OutlineRecordPart[];
  joins: OutlineRecordJoin[];
  /** Files that more than one part covers. */
  splitFiles: string[];
  /** Files no confirmed part covers. */
  notInAnyPart: string[];
}
