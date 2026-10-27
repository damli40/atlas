// X1 (the code explorer's outline engine): the shapes every other outline module shares.
//
// Plain words:
// - A "codebase" is a small set of source files (at most 50 JS/TS/Python files, 300 KB) that Atlas read from a
//   public GitHub repo or that a person uploaded. Each file carries its own SHA-256.
// - The "code map" is what PLAIN CODE reads from those files without running them: what each file defines
//   (functions, classes, with their lines), what it imports (another file of the codebase, an outside package,
//   or "unresolved" with the reason), and where one file calls something another file defines.
// - The "outline" is Muse Wonder's PROPOSAL: named parts, what each part is for, which lines belong to it, and
//   how parts join. Plain code then checks every part and join against the bytes and the code map; that check
//   is the "verified outline". Wonder proposes; plain code decides what is real.
// Types only: no I/O, no clock, no model.

export type OutlineLanguage = "js" | "ts" | "py";

/** One source file of the codebase, exactly as Atlas read it. */
export interface OutlineFile {
  /** Path inside the codebase: forward slashes, no leading "/", no "." or ".." segments. */
  path: string;
  language: OutlineLanguage;
  /** SHA-256 (lowercase hex) of the file's bytes (its UTF-8 text). */
  sha256: string;
  bytes: number;
  /** The file's text. Kept in memory and in the outline proof file only; never written to the repo. */
  text: string;
  /**
   * Review minor 6: git's blob id for these bytes (SHA-1 of "blob <size>\0" + bytes), recorded for GitHub sources, so
   * a checker can compare it online with the repo's tree at the named commit. Verify recomputes it from the text.
   */
  gitBlob?: string;
}

/** A file Atlas did not read, and why (plain code's words). */
export interface SkippedFile {
  path: string;
  reason: string;
}

/** Where the codebase came from. */
export type OutlineSource =
  | {
      kind: "github";
      /** "owner/repo" */
      repo: string;
      /** The branch, tag or commit the person asked for; absent = the repo's default branch. */
      requestedRef?: string;
      /** The commit the files were read at (40 hex). */
      commit: string;
      /** The folder inside the repo the codebase is ("" = the whole repo). File paths are relative to it. */
      subfolder: string;
    }
  | { kind: "upload" };

// ---------- the code map (plain code) ----------

export type SymbolKind = "function" | "class" | "variable";

/** Something a file defines at its top level (or a method of a top-level class). */
export interface CodeSymbol {
  /** Stable id: "<path>#<name>" (a second definition with the same name adds "@<line>"). */
  id: string;
  name: string;
  kind: SymbolKind;
  /** Exported (JS/TS) or public at module level (Python: a top-level name not starting with "_"). */
  exported: boolean;
  /** JS/TS: `export default`. */
  isDefault?: boolean;
  /** Methods: the class they belong to. */
  parent?: string;
  lineStart: number;
  lineEnd: number;
  /** The declaration's first line(s) as written, whitespace squashed, at most 200 characters (functions and classes). */
  signature?: string;
  /** Parameter texts as written ("a: number", "b=1"), functions only. */
  params?: string[];
  /** The written return type ("Promise<string>", "-> int"), when the code states one. */
  returns?: string;
}

/** How an import names things: imported name → local name. "*" = the whole module (namespace / `import x`). */
export interface ImportName {
  imported: string;
  local: string;
}

export type ImportKind = "static" | "re-export" | "require" | "dynamic" | "type-only";

export type ImportTarget =
  | { kind: "file"; path: string }
  | { kind: "external"; name: string }
  | { kind: "unresolved"; reason: string };

export interface CodeImport {
  line: number;
  /** The module text exactly as written ("./a", "../lib/x.js", "react", ".mod", "pkg.sub"). */
  specifier: string;
  kind: ImportKind;
  names: ImportName[];
  target: ImportTarget;
}

export interface CodeMapFile {
  path: string;
  language: OutlineLanguage;
  /** Lines as an editor numbers them. */
  lines: number;
  symbols: CodeSymbol[];
  imports: CodeImport[];
  /** What the parser could not read (syntax errors, a Python line it skipped). Empty when it read everything. */
  parseNotes: string[];
}

/**
 * An edge between two DIFFERENT files, found by plain code. Review M1: every import or call of the same name from
 * one file to another is ONE edge, with the lines where it happens (so 24,000 calls of `f()` are one edge, count
 * 24,000), never one edge per line.
 */
export interface CodeEdge {
  /** Stable id: "<kind>:<from>-><to>:<what>" ("#type" added for a type-only import). */
  id: string;
  kind: "imports" | "calls";
  from: string;
  to: string;
  /** The first line in `from` where it happens. */
  line: number;
  /** Every line in `from` where it happens, sorted, at most MAX_EDGE_LINES (src/outline/codemap.ts). */
  lines: number[];
  /** How many times it happens (calls on the same line count separately). */
  count: number;
  /** imports: the specifier as written (hidden characters made visible); calls: the name as called ("save", "db.save", "new Queue"). */
  what: string;
  /** calls: the symbol id in `to` the call reaches, when plain code can name it. */
  toSymbol?: string;
  /** imports: the symbols of `to` the import names, when they are defined in `to` itself. */
  toSymbols?: string[];
  /** imports: `import type` / `export type`: no link at run time. */
  typeOnly?: true;
  /** Plain code's note on the target (for example an ambiguous re-export). */
  note?: string;
}

export interface CodeMap {
  version: 1;
  /** Sorted by path. */
  files: CodeMapFile[];
  /** Sorted by id; one edge per distinct (kind, from, to, line, what). */
  edges: CodeEdge[];
  /** Outside packages by name, with the files that import them; sorted. */
  externals: { name: string; importedBy: string[] }[];
  /** How plain code read this codebase (the Python standard-library list used, the tsconfig files read). */
  notes: string[];
}

/** A tsconfig.json / jsconfig.json of the codebase (read for its `paths` and `baseUrl`, never run). */
export interface ConfigFile {
  path: string;
  sha256: string;
  bytes: number;
  text: string;
}

// ---------- Wonder's outline (the model's proposal, schema-checked) ----------

export type JoinKind = "calls" | "imports" | "data";

export interface WonderSpan {
  path: string;
  lineStart: number;
  lineEnd: number;
  quotedSnippet: string;
}

export interface WonderPart {
  id: string;
  name: string;
  purpose: string;
  files: WonderSpan[];
  patterns: string[];
}

export interface WonderJoin {
  from: string;
  to: string;
  kind: JoinKind;
  evidence: { path: string; line: number; quotedSnippet: string };
}

export interface WonderOutline {
  parts: WonderPart[];
  joins: WonderJoin[];
}

// ---------- the verified outline (plain code's decision) ----------

/** A sentence a model wrote: always shown as the model's, never in Atlas's voice. */
export interface ModelText {
  /** The text with hidden characters (newlines, bidi controls) made visible (src/gate.ts visibleText). */
  text: string;
  by: `model:${string}`;
}

export interface SpanCheck {
  path: string;
  lineStart: number;
  lineEnd: number;
  ok: boolean;
  /** Why the span did not match the bytes (absent when ok). */
  reason?: string;
  /** Review M4: the span is the whole file (lines 1 to the last); the explorer says "whole file", not "these lines". */
  wholeFile?: true;
}

export interface VerifiedPart {
  id: string;
  /** The part's name as Wonder wrote it, hidden characters made visible. */
  name: ModelText;
  purpose: ModelText;
  status: "confirmed" | "unconfirmed";
  /** Unconfirmed only: every reason, in plain words. */
  reasons: string[];
  spans: SpanCheck[];
  /** Files of the codebase this part covers (confirmed spans only; empty when unconfirmed). */
  files: string[];
  /** Wonder's pattern labels: `known` when the label is one of Atlas's listed patterns, else free text. Model's words. */
  patterns: { label: string; known: boolean }[];
}

export interface VerifiedJoin {
  id: string;
  from: string;
  to: string;
  kind: JoinKind;
  /**
   * confirmed: Wonder said it AND plain code found an import or call between the two parts' files.
   * model-only: Wonder said it; the code does not show it ("Wonder says; the code doesn't show it").
   * code-only: plain code found it; Wonder did not say it.
   */
  status: "confirmed" | "model-only" | "code-only";
  /** The code-map edge ids that show it (empty for model-only). */
  codeEdges: string[];
  /** model-only: why; confirmed with a quote that does not match: what plain code saw instead. */
  reason?: string;
  /** Wonder's evidence quote checked against the bytes (absent for code-only). */
  wonderEvidence?: { path: string; line: number; matches: boolean };
  /** Review minor 3: every edge that shows it is a type-only import (no link at run time). */
  typeOnly?: true;
}

export interface VerifiedOutline {
  version: 1;
  model: string;
  /**
   * Review B3: set when the outline is too large to verify within Atlas's fixed work budget. Then every part is
   * unconfirmed and every Wonder join model-only, with this reason. Deterministic: the same outline always gives it.
   */
  cantCheck?: string;
  parts: VerifiedPart[];
  joins: VerifiedJoin[];
  /** Files of the codebase no confirmed part covers ("not in any part"). Sorted. */
  notInAnyPart: string[];
  counts: { confirmedParts: number; unconfirmedParts: number; confirmedJoins: number; modelOnlyJoins: number; codeOnlyJoins: number };
}

/** One Wonder call as recorded (usage as the API reported it). */
export interface OutlineAttempt {
  attempt: number;
  finishReason?: string;
  /** Why this answer was not usable (absent when it was). */
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; reasoningTokens?: number; usd: number };
}

/** The `outline` section of a .atlas.json: everything needed to re-judge the outline without any model. */
export interface OutlineSection {
  version: 1;
  source: OutlineSource;
  files: OutlineFile[];
  /** Review M3: tsconfig.json / jsconfig.json files of the codebase, read for path aliases only. */
  configFiles?: ConfigFile[];
  skipped: SkippedFile[];
  /** SHA-256 over the files in path order (server/targets/github.ts codeSha256Of rule). */
  codeSha256: string;
  codeMap: CodeMap;
  wonder: {
    model: string;
    /** The schema-checked outline Wonder returned; null when it gave no usable answer. */
    outline: WonderOutline | null;
    attempts: OutlineAttempt[];
    /** Why there is no outline (null outline only). */
    failure?: string;
  };
  /** Plain code's verdict on `wonder.outline` (null exactly when the outline is null). */
  verified: VerifiedOutline | null;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number; usd: number } | null;
}

/** An outline-only proof file (the explorer before any bet): checked by verifyOutlineFile. */
export interface OutlineAtlasFile {
  version: 1;
  kind: "outline";
  outline: OutlineSection;
  createdAt: string;
}
