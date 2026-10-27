// Reads a unified diff (the text a Fixer proposes) by plain code. No I/O, no model.
//
// Plain words: a unified diff lists, per file, the old path ("--- a/x"), the new path ("+++ b/x"),
// then "hunks": blocks headed "@@ -oldStart,oldCount +newStart,newCount @@" whose lines start with
// " " (kept), "-" (removed) or "+" (added). This file finds which files a diff touches and which
// lines it adds and removes, so the Fixer's checks (server/meta/roles/fixer.ts) can refuse a change
// that touches another file, is too large, or adds a network import. It does NOT apply the diff:
// `git apply --check` in a scratch copy does that (runners/scratch.ts).
//
// The line counts in a hunk header ("@@ -56,1 +56,6 @@") are NOT trusted: a model often miscounts
// them. Like `git apply --recount` (which runners/scratch.ts uses), the hunk is read line by line
// until the next hunk or file header, and the counts are inferred. The diff's text is never changed.
// Blank lines at the very end of the text are ignored; a blank line inside a hunk is an empty
// context line (as git reads it).
//
// S5 (day-6 review): no reason written here quotes a path from the diff. A path is text the model
// wrote; Atlas's sentences name lines and files it knows, never the model's words.

export interface DiffFile {
  /** Path after stripping "a/"; null for /dev/null (a created file). */
  oldPath: string | null;
  /** Path after stripping "b/"; null for /dev/null (a deleted file). */
  newPath: string | null;
  /** Text of every added line, without the leading "+". */
  added: string[];
  /** Text of every removed line, without the leading "-". */
  removed: string[];
  hunks: number;
  /** Each hunk's lines in order (" " kept, "-" removed, "+" added), and the old start line from its header. */
  hunkLines: { oldStart: number; lines: { tag: " " | "-" | "+"; text: string }[] }[];
}

export type DiffParse = { ok: true; files: DiffFile[] } | { ok: false; reason: string };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** Git extended headers that mean something other than "edit lines of an existing file". */
const REFUSED_HEADERS: [RegExp, string][] = [
  [/^new file mode /, "creates a new file"],
  [/^deleted file mode /, "deletes a file"],
  [/^rename (from|to) /, "renames a file"],
  [/^copy (from|to) /, "copies a file"],
  [/^(old|new) mode /, "changes a file mode"],
  [/^Binary files /, "changes a binary file"],
  [/^GIT binary patch/, "changes a binary file"],
];

function stripPrefix(p: string, prefix: "a/" | "b/"): string | null {
  const path = p.replace(/\t.*$/, "").trim(); // "--- a/x\t2026-10-27 ..." carries a date after a tab
  if (path === "/dev/null") return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Parse a unified diff. Refuses anything that is not plain line edits to existing files. */
export function parseUnifiedDiff(text: string): DiffParse {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    for (const [re, why] of REFUSED_HEADERS) if (re.test(line)) return { ok: false, reason: `the diff ${why} (line ${i + 1}); only edits to existing files are allowed` };
    if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("similarity index ") || line.startsWith("dissimilarity index ")) {
      i++;
      continue;
    }
    if (line.startsWith("--- ")) {
      const next = lines[i + 1];
      if (next === undefined || !next.startsWith("+++ ")) return { ok: false, reason: `line ${i + 1} starts a file ("--- ") with no "+++ " line after it` };
      cur = { oldPath: stripPrefix(line.slice(4), "a/"), newPath: stripPrefix(next.slice(4), "b/"), added: [], removed: [], hunks: 0, hunkLines: [] };
      files.push(cur);
      i += 2;
      continue;
    }
    const h = HUNK.exec(line);
    if (h) {
      if (!cur) return { ok: false, reason: `line ${i + 1} is a hunk with no file header before it` };
      const file = cur;
      file.hunks++;
      const hunk = { oldStart: Number(h[1]), lines: [] as { tag: " " | "-" | "+"; text: string }[] };
      file.hunkLines.push(hunk);
      i++;
      let body = 0;
      // Read until the next hunk, the next file header, or the end (the counts are inferred, see above).
      while (i < lines.length) {
        const l = lines[i]!;
        // M4 (day-6 review): like `git apply --recount`, a hunk ends only at the next "@@ " or "diff "
        // line. A "--- a/x" line inside a hunk is a removed line, exactly as git reads it.
        if (l.startsWith("@@ ") || l.startsWith("diff ")) break;
        if (l.startsWith("\\")) {
          i++; // "\ No newline at end of file"
          continue;
        }
        const tag = l[0];
        if (tag === "-") file.removed.push(l.slice(1));
        else if (tag === "+") file.added.push(l.slice(1));
        if (tag === "-" || tag === "+") hunk.lines.push({ tag, text: l.slice(1) });
        else if (tag === " " || l === "") hunk.lines.push({ tag: " ", text: l.slice(1) });
        if (tag !== "-" && tag !== "+" && tag !== " " && l !== "") return { ok: false, reason: `line ${i + 1} of the diff is inside a hunk but does not start with " ", "-" or "+"` };
        body++;
        i++;
      }
      if (body === 0) return { ok: false, reason: `the hunk at line ${i} of the diff has no lines` };
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    return { ok: false, reason: `line ${i + 1} is not part of a unified diff` };
  }
  if (files.length === 0) return { ok: false, reason: "the text holds no file in unified diff form (no \"--- a/…\" / \"+++ b/…\" lines)" };
  for (const f of files) if (f.hunks === 0) return { ok: false, reason: "the diff names a file but changes no lines in it" };
  return { ok: true, files };
}

/**
 * Take the diff out of a model's answer. The instruction asks for a unified diff only; a model may
 * still wrap it in a ```diff fence or add a sentence. Only the diff is kept (and shown): the prose is
 * dropped, and `hadProse` says that it was there.
 */
export function extractDiff(answer: string): { diff: string; hadProse: boolean } | null {
  const text = answer.replace(/\r\n/g, "\n");
  const fence = /```(?:diff|patch|udiff)?[^\n]*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(fence)) {
    const body = m[1]!;
    if (/^(diff --git |--- )/m.test(body)) {
      const outside = text.replace(m[0], "").trim();
      // Blank lines after the last hunk are dropped, as parseUnifiedDiff ignores them: git apply --recount
      // would otherwise read them as empty context lines that the file does not have.
      return { diff: `${body.replace(/\n(?:[ \t]*\n)+$/, "\n").replace(/\n?$/, "")}\n`, hadProse: outside.length > 0 };
    }
  }
  const lines = text.split("\n");
  const start = lines.findIndex((l, k) => l.startsWith("diff --git ") || (l.startsWith("--- ") && (lines[k + 1] ?? "").startsWith("+++ ")));
  if (start === -1) return null;
  // Keep from the first header to the last line that can belong to a diff.
  let end = lines.length;
  while (end > start && !/^([ +\-@\\]|diff --git |index |$)/.test(lines[end - 1]!)) end--;
  while (end > start && lines[end - 1] === "") end--;
  const diff = `${lines.slice(start, end).join("\n")}\n`;
  const hadProse = lines.slice(0, start).some((l) => l.trim() !== "") || lines.slice(end).some((l) => l.trim() !== "");
  return { diff, hadProse };
}

/** Added + removed lines across the whole diff. */
export function changedLineCount(files: DiffFile[]): number {
  return files.reduce((n, f) => n + f.added.length + f.removed.length, 0);
}

/**
 * S3 (day-6 review): place one file's hunks in its text, by plain code, with no I/O. This is THE way
 * Atlas applies a change: runners/change.ts uses it to build the changed code (and refuses the change
 * when `git apply` in the scratch copy gives different bytes), and .atlas.json verify uses it to
 * recompute the changed code. So both place every line identically.
 *
 * Rules, each hunk in order:
 * - Its old lines (kept + removed) must appear exactly, at or after the end of the previous hunk.
 * - A hunk with no old line at all (only "+" lines, the `--unidiff-zero` insert) is refused: nothing
 *   in the file says where it goes except the header's number, which models often get wrong.
 * - A hunk with no kept line (only "-" and "+") must match exactly ONE place in the rest of the file.
 * - A hunk whose header starts past the end of the file is refused.
 * - Otherwise the place nearest the header's line wins; two places equally near are refused.
 */
export function placeHunks(text: string, file: DiffFile): { ok: true; text: string } | { ok: false; reason: string } {
  const endsWithNewline = text.endsWith("\n");
  const lines = (endsWithNewline ? text.slice(0, -1) : text).split("\n");
  const out: string[] = [];
  let at = 0;
  for (let n = 0; n < file.hunkLines.length; n++) {
    const h = file.hunkLines[n]!;
    const which = file.hunkLines.length === 1 ? "the hunk" : `hunk ${n + 1}`;
    const old = h.lines.filter((l) => l.tag !== "+").map((l) => l.text);
    const neu = h.lines.filter((l) => l.tag !== "-").map((l) => l.text);
    const hasContext = h.lines.some((l) => l.tag === " ");
    if (old.length === 0) {
      return { ok: false, reason: `${which} only adds lines, with no unchanged or removed line around it, so where it goes in the file is not certain` };
    }
    if (h.oldStart - 1 > lines.length) {
      return { ok: false, reason: `${which} starts at line ${h.oldStart}, past the end of the file (${lines.length} lines)` };
    }
    const fits = (k: number) => old.every((o, j) => lines[k + j] === o);
    const places: number[] = [];
    for (let k = at; k + old.length <= lines.length; k++) if (fits(k)) places.push(k);
    if (places.length === 0) return { ok: false, reason: `${which}'s unchanged and removed lines do not appear in the file as written` };
    let best: number;
    if (!hasContext) {
      if (places.length !== 1) return { ok: false, reason: `${which} has no unchanged lines around it and its removed lines appear ${places.length} times, so where it goes is not certain` };
      best = places[0]!;
    } else {
      const want = h.oldStart - 1;
      const dist = (k: number) => Math.abs(k - want);
      best = places.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      if (places.filter((k) => dist(k) === dist(best)).length > 1) return { ok: false, reason: `${which} fits two places equally near line ${h.oldStart}, so where it goes is not certain` };
    }
    out.push(...lines.slice(at, best), ...neu);
    at = best + old.length;
  }
  out.push(...lines.slice(at));
  return { ok: true, text: out.join("\n") + (endsWithNewline ? "\n" : "") };
}

/** placeHunks, as text or null (used by .atlas.json verify to recompute the changed code). */
export function applyFileDiff(text: string, file: DiffFile): string | null {
  const r = placeHunks(text, file);
  return r.ok ? r.text : null;
}
