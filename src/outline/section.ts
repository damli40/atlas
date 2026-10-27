// X1: the `outline` section of a .atlas.json, and how plain code re-judges it without any model.
//
// Plain words: the section carries the codebase itself (every file's text and SHA-256), where it came from (repo,
// commit, folder), the code map, Wonder's schema-checked outline with the model id, plain code's verified outline
// and the usage. The check below recomputes, from the stored file texts alone:
// - each file's SHA-256 and size, the codebase fingerprint, the limits (50 files, 300 KB, 100 KB a file) and the
//   path rules (no "..", no leading "/", only .js .mjs .cjs .ts .tsx .py);
// - the whole code map (src/outline/codemap.ts), which must equal the stored one;
// - Wonder's outline against the schema again, and the verified outline (src/outline/verify.ts), which must equal
//   the stored one. So marking an unconfirmed part "confirmed" by hand, or adding an edge, makes the check fail.
// - the usage total equals the sum of the recorded calls.
// It never throws: the caller (src/atlasfile.ts) has already refused files nested too deeply, and every size here
// is capped by the schema before any parsing starts.
// What it cannot check: that the files really are those of the named commit (that needs GitHub; /outline intake
// checks every file against its git blob hash when it reads it), or that Wonder really said this outline (the
// file is not signed). Both are said in the evidence README.

import { createHash } from "node:crypto";
import { z } from "zod";
import { buildCodeMap, languageOf } from "./codemap";
import { checkOutlineValue, verifyOutline } from "./verify";
import type { CodeMap, OutlineAtlasFile, OutlineSection } from "./types";
import { canonicalJson, jsonDepth } from "../seal";

export const MAX_OUTLINE_FILES = 50;
export const MAX_OUTLINE_TOTAL_BYTES = 300 * 1024;
export const MAX_OUTLINE_FILE_BYTES = 100 * 1024;
export const MAX_PATH_CHARS = 300;
/** How deep an outline-only file may nest (the code map nests about 8 levels). */
export const MAX_OUTLINE_FILE_DEPTH = 60;

/** Why this path cannot be a file of a codebase (null when it can). Plain ASCII-printable paths only. */
export function pathProblem(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return "the path is empty";
  if (path.length > MAX_PATH_CHARS) return `the path is longer than ${MAX_PATH_CHARS} characters`;
  if (!/^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/.test(path)) return "the path has characters other than plain printable ASCII (or starts or ends with a space)";
  if (path.includes("\\")) return "the path has a backslash";
  if (path.startsWith("/")) return "the path starts with /";
  if (path.split("/").some((s) => s === "" || s === "." || s === "..")) return 'the path has an empty, "." or ".." part';
  return null;
}

export const utf8Length = (s: string) => Buffer.byteLength(s, "utf8");
export const sha256Text = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** server/targets/github.ts codeSha256Of, on texts: for each file in path order, UTF-8(path) + "\n" + bytes + "\n". */
export function codebaseSha256(files: ReadonlyArray<{ path: string; text: string }>): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(f.path, "utf8");
    h.update("\n");
    h.update(f.text, "utf8");
    h.update("\n");
  }
  return h.digest("hex");
}

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const usageSchema = z.strictObject({ promptTokens: z.number().int().min(0), completionTokens: z.number().int().min(0), reasoningTokens: z.number().int().min(0).optional(), usd: z.number().min(0) });
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

export const outlineSectionSchema = z.strictObject({
  version: z.literal(1),
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("github"),
      repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
      requestedRef: z.string().min(1).max(200).optional(),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
      subfolder: z.string().max(MAX_PATH_CHARS),
    }),
    z.strictObject({ kind: z.literal("upload") }),
  ]),
  files: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(MAX_PATH_CHARS),
        language: z.enum(["js", "ts", "py"]),
        sha256: sha,
        bytes: z.number().int().min(0).max(MAX_OUTLINE_FILE_BYTES),
        text: z.string().max(MAX_OUTLINE_FILE_BYTES),
      }),
    )
    .min(1)
    .max(MAX_OUTLINE_FILES),
  skipped: z.array(z.strictObject({ path: z.string().max(1000), reason: z.string().min(1).max(500) })).max(5000),
  codeSha256: sha,
  // Recomputed and compared as a whole below, so its own shape is only bounded here.
  codeMap: z.record(z.string(), z.unknown()),
  wonder: z.strictObject({
    model: z.string().regex(MODEL_ID),
    outline: z.unknown().nullable(),
    attempts: z
      .array(z.strictObject({ attempt: z.number().int().min(1).max(2), finishReason: z.string().max(40).optional(), error: z.string().max(600).optional(), usage: usageSchema.optional() }))
      .max(2),
    failure: z.string().min(1).max(600).optional(),
  }),
  verified: z.record(z.string(), z.unknown()).nullable(),
  usage: usageSchema.nullable(),
});

const sameJson = (a: unknown, b: unknown) => canonicalJson(JSON.parse(JSON.stringify(a ?? null))) === canonicalJson(JSON.parse(JSON.stringify(b ?? null)));

/** Every way the section disagrees with what plain code recomputes from its own file texts. Empty = it checks out. Never throws. */
export function outlineSectionProblems(raw: unknown): string[] {
  try {
    return sectionProblems(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return [`the outline could not be checked: ${msg.length > 200 ? `${msg.slice(0, 199)}…` : msg}`];
  }
}

function sectionProblems(raw: unknown): string[] {
  const parsed = outlineSectionSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "outline"}: ${i.message}`);
  const s = parsed.data;
  const out: string[] = [];
  const say = (p: string) => out.push(p);

  // The files: paths, languages, hashes, sizes, limits.
  const paths = s.files.map((f) => f.path);
  if (new Set(paths).size !== paths.length) say("two files share a path");
  let total = 0;
  for (const f of s.files) {
    const p = pathProblem(f.path);
    if (p) say(`file ${JSON.stringify(f.path)}: ${p}`);
    if (languageOf(f.path) !== f.language) say(`file ${f.path}: its language ${f.language} is not what its name says`);
    const bytes = utf8Length(f.text);
    total += bytes;
    if (bytes !== f.bytes) say(`file ${f.path}: it is ${bytes} bytes, not the ${f.bytes} recorded`);
    if (bytes > MAX_OUTLINE_FILE_BYTES) say(`file ${f.path}: over the ${MAX_OUTLINE_FILE_BYTES}-byte limit for one file`);
    if (sha256Text(f.text) !== f.sha256) say(`file ${f.path}: its text does not hash to its recorded SHA-256`);
  }
  if (total > MAX_OUTLINE_TOTAL_BYTES) say(`the files total ${total} bytes, over the ${MAX_OUTLINE_TOTAL_BYTES}-byte limit`);
  if (s.source.kind === "github" && s.source.subfolder !== "" && pathProblem(s.source.subfolder)) say(`the subfolder is not a plain path (${pathProblem(s.source.subfolder)})`);
  if (out.length > 0) return out; // nothing below means anything when the files themselves do not check out
  const codeSha = codebaseSha256(s.files);
  if (codeSha !== s.codeSha256) say(`the files hash to ${codeSha.slice(0, 12)}…, not the recorded codeSha256 ${s.codeSha256.slice(0, 12)}…`);

  // The code map, rebuilt.
  const map = buildCodeMap(s.files);
  if (!sameJson(map, s.codeMap)) say("the code map is not what plain code (src/outline/codemap.ts) builds from these files");

  // Wonder's outline and plain code's verdict on it.
  if (/contributor/i.test(s.wonder.model)) say(`${s.wonder.model} is a contributor model; code is never sent to one`);
  if (s.wonder.outline === null) {
    if (s.verified !== null) say("there is no Wonder outline, so there can be no verified outline");
    if (s.wonder.failure === undefined) say("there is no Wonder outline, but the file does not say why");
  } else {
    if (s.wonder.failure !== undefined) say("the file has a Wonder outline and also says there is none");
    const again = checkOutlineValue(s.wonder.outline);
    if (!again.ok) say(`Wonder's outline does not pass the schema: ${again.error}`);
    else if (!sameJson(again.outline, s.wonder.outline)) say("Wonder's outline changes when it is schema-checked again");
    else if (s.verified === null) say("the file has a Wonder outline but no verified outline");
    else if (!sameJson(verifyOutline(s.files, map, again.outline, s.wonder.model), s.verified)) say("the verified outline is not what plain code (src/outline/verify.ts) decides for this outline and these files");
  }

  // Usage: the total is the sum of the recorded calls.
  const used = s.wonder.attempts.map((a) => a.usage).filter((u): u is NonNullable<typeof u> => u !== undefined);
  if (used.length === 0 && s.usage !== null) say("the file records usage but no call that reported any");
  if (used.length > 0) {
    if (s.usage === null) say("the calls reported usage but the file's usage is empty");
    else {
      const sum = (k: "promptTokens" | "completionTokens") => used.reduce((n, u) => n + u[k], 0);
      const usd = used.reduce((n, u) => n + u.usd, 0);
      if (s.usage.promptTokens !== sum("promptTokens") || s.usage.completionTokens !== sum("completionTokens") || Math.abs(s.usage.usd - usd) > 1e-9) say("the usage total is not the sum of the recorded calls");
    }
  }
  return out;
}

export type OutlineVerification = { ok: true; file: OutlineAtlasFile } | { ok: false; problems: string[] };

const outlineFileSchema = z.strictObject({ version: z.literal(1), kind: z.literal("outline"), outline: z.unknown(), createdAt: z.iso.datetime() });

/** Checks an outline-only proof file (the explorer before any bet). Never throws. */
export function verifyOutlineFile(raw: unknown): OutlineVerification {
  try {
    if (jsonDepth(raw, MAX_OUTLINE_FILE_DEPTH) > MAX_OUTLINE_FILE_DEPTH) return { ok: false, problems: [`the file nests deeper than ${MAX_OUTLINE_FILE_DEPTH} levels, so Atlas does not read it`] };
    const p = outlineFileSchema.safeParse(raw);
    if (!p.success) return { ok: false, problems: p.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "file"}: ${i.message}`) };
    const problems = outlineSectionProblems(p.data.outline).map((x) => `outline: ${x}`);
    return problems.length ? { ok: false, problems } : { ok: true, file: p.data as OutlineAtlasFile };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, problems: [`the file could not be checked: ${msg.length > 200 ? `${msg.slice(0, 199)}…` : msg}`] };
  }
}

export interface OutlineSectionInput {
  source: OutlineSection["source"];
  files: OutlineSection["files"];
  skipped: OutlineSection["skipped"];
  wonder: OutlineSection["wonder"];
  /** The code map, when the caller already built it from these same files (it is checked again below). */
  codeMap?: CodeMap;
}

/**
 * Builds the section: the code map (unless given), plain code's verified outline, the usage total and the
 * codebase fingerprint; then checks the whole section exactly as a proof-file check would. Throws when it does
 * not check out (a section that cannot be re-judged is never handed out).
 */
export function makeOutlineSection(input: OutlineSectionInput): OutlineSection {
  const files = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const codeMap = input.codeMap ?? buildCodeMap(files);
  const used = input.wonder.attempts.map((a) => a.usage).filter((u): u is NonNullable<typeof u> => u !== undefined);
  const reasoning = used.some((u) => u.reasoningTokens !== undefined) ? { reasoningTokens: used.reduce((n, u) => n + (u.reasoningTokens ?? 0), 0) } : {};
  const usage = used.length
    ? { promptTokens: used.reduce((n, u) => n + u.promptTokens, 0), completionTokens: used.reduce((n, u) => n + u.completionTokens, 0), ...reasoning, usd: used.reduce((n, u) => n + u.usd, 0) }
    : null;
  const section: OutlineSection = {
    version: 1,
    source: input.source,
    files,
    skipped: input.skipped,
    codeSha256: codebaseSha256(files),
    codeMap,
    wonder: input.wonder,
    verified: input.wonder.outline ? verifyOutline(files, codeMap, input.wonder.outline, input.wonder.model) : null,
    usage,
  };
  const copy = JSON.parse(JSON.stringify(section)) as OutlineSection;
  const problems = outlineSectionProblems(copy);
  if (problems.length) throw new Error(`the outline section does not check out: ${problems.join("; ")}`);
  return copy;
}
