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
      cur = { oldPath: stripPrefix(line.slice(4), "a/"), newPath: stripPrefix(next.slice(4), "b/"), added: [], removed: [], hunks: 0 };
      files.push(cur);
      i += 2;
      continue;
    }
    const h = HUNK.exec(line);
    if (h) {
      if (!cur) return { ok: false, reason: `line ${i + 1} is a hunk with no file header before it` };
      const file = cur;
      file.hunks++;
      i++;
      let body = 0;
      // Read until the next hunk, the next file header, or the end (the counts are inferred, see above).
      while (i < lines.length) {
        const l = lines[i]!;
        if (HUNK.test(l) || l.startsWith("diff --git ") || (l.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ "))) break;
        if (l.startsWith("\\")) {
          i++; // "\ No newline at end of file"
          continue;
        }
        const tag = l[0];
        if (tag === "-") file.removed.push(l.slice(1));
        else if (tag === "+") file.added.push(l.slice(1));
        else if (tag !== " " && l !== "") return { ok: false, reason: `line ${i + 1} inside a hunk of ${file.newPath ?? file.oldPath} does not start with " ", "-" or "+"` };
        body++;
        i++;
      }
      if (body === 0) return { ok: false, reason: `a hunk of ${file.newPath ?? file.oldPath} has no lines` };
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    return { ok: false, reason: `line ${i + 1} is not part of a unified diff` };
  }
  if (files.length === 0) return { ok: false, reason: "the text holds no file in unified diff form (no \"--- a/…\" / \"+++ b/…\" lines)" };
  for (const f of files) if (f.hunks === 0) return { ok: false, reason: `the diff names ${f.newPath ?? f.oldPath} but changes no lines in it` };
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
      return { diff: body.endsWith("\n") ? body : `${body}\n`, hadProse: outside.length > 0 };
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
