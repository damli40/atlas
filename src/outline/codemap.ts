// X1: the code map, built by plain code from a codebase's files (no model, never runs the code).
//
// Plain words: each file is read by its language's parser (src/outline/parse-js.ts with the TypeScript compiler
// for .js .jsx .mjs .cjs .ts .tsx .mts .cts; src/outline/parse-py.ts for .py). Then, with every file in view, this
// module decides where each import goes:
// - a file of the codebase (relative imports, Python packages, `index` files, "./a.js" written for a.ts, tsconfig
//   `paths` / `baseUrl` when the codebase holds a tsconfig.json or jsconfig.json);
// - an outside package, by name ("react", "@scope/pkg", "node:fs", "requests"): listed, never fetched. Python's
//   standard library (src/outline/py-stdlib.ts) is always outside: `import logging` never reaches a local
//   logging.py (review B2);
// - "unresolved", with the reason (a dynamic import, a computed name, a path alias, a file Atlas did not read).
// It then turns each call of an imported name into an edge "file A calls file B", following re-exports (index
// files, `from .sub import f` in a package's __init__.py) to the file that defines the name. All calls of the same
// name from one file to another are ONE edge with every line where they happen (review M1).
//
// The result is deterministic: files sorted by path, symbols by line, edges by id. The same files always give
// the same code map, byte for byte (the proof-file check rebuilds it and compares).

import { parseJsFile, type ParsedFile, type RawImport } from "./parse-js";
import { parsePyFile } from "./parse-py";
import { PYTHON_FOUND_FIRST, PYTHON_STDLIB, PYTHON_STDLIB_VERSION } from "./py-stdlib";
import { plural } from "../words";
import { visibleText } from "../gate";
import type { CodeEdge, CodeImport, CodeMap, CodeMapFile, CodeSymbol, ConfigFile, ImportTarget, OutlineFile, OutlineLanguage } from "./types";

/** Brackets nested deeper than this are not parsed (a hostile file must not exhaust the parser's stack). */
export const MAX_BRACKET_DEPTH = 400;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Language from the file name; null when Atlas does not read that kind of file. */
export function languageOf(path: string): OutlineLanguage | null {
  if (/\.d\.(?:ts|mts|cts)$/.test(path)) return null;
  if (/\.(?:ts|tsx|mts|cts)$/.test(path)) return "ts";
  if (/\.(?:js|jsx|mjs|cjs)$/.test(path)) return "js";
  if (/\.py$/.test(path)) return "py";
  return null;
}

/** Config files Atlas reads for path aliases (never as code). */
export const isConfigFile = (path: string) => /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[A-Za-z0-9_-]+)?\.json$/.test(path);

/** Lines as an editor numbers them: a final "\n" does not start a new line. 0 for an empty file. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const n = text.split("\n").length - 1;
  return text.endsWith("\n") ? n : n + 1;
}

/** The deepest bracket nesting in the text, stopping early once it passes `limit`. Strings are not skipped (an over-count only refuses more). */
export function bracketDepth(text: string, limit = MAX_BRACKET_DEPTH): number {
  let d = 0;
  let max = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 40 || c === 91 || c === 123) {
      d++;
      if (d > max) {
        max = d;
        if (max > limit) return max;
      }
    } else if ((c === 41 || c === 93 || c === 125) && d > 0) d--;
  }
  return max;
}

function parseOne(f: Pick<OutlineFile, "path" | "language" | "text">): ParsedFile {
  if (bracketDepth(f.text) > MAX_BRACKET_DEPTH) {
    return { symbols: [], imports: [], calls: [], exportedLocals: [], notes: [`brackets nest deeper than ${MAX_BRACKET_DEPTH} levels, so plain code did not parse this file`] };
  }
  try {
    return f.language === "py" ? parsePyFile(f.text) : parseJsFile(f.path, f.text, f.language);
  } catch (e) {
    const why = e instanceof RangeError ? "it nests too deeply" : "the parser stopped";
    return { symbols: [], imports: [], calls: [], exportedLocals: [], notes: [`plain code could not parse this file (${why})`] };
  }
}

// ---------- paths ----------

/** POSIX-style join + normalise. Returns null when the path climbs above the codebase. */
export function joinPath(dir: string, rel: string): string | null {
  const out = dir === "" ? [] : dir.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const JS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_INDEX = JS_EXTS.map((e) => `/index${e}`);
/** "./a.js" may be written for a.ts (TypeScript's ESM rule): the written extension → the TS ones to try. */
const TS_FOR: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

/** The codebase file a path (without or with an extension) names, trying extensions and index files. */
function fileFor(base: string, files: ReadonlySet<string>): string | undefined {
  const ext = /\.(?:js|jsx|mjs|cjs)$/.exec(base)?.[0];
  const stem = ext ? base.slice(0, -ext.length) : null;
  const candidates = [base, ...JS_EXTS.map((e) => base + e), ...(stem !== null ? TS_FOR[ext!]!.map((e) => stem + e) : []), ...JS_INDEX.map((e) => (base === "" ? e.slice(1) : base + e))];
  return candidates.find((c) => files.has(c));
}

/** The path aliases of one tsconfig/jsconfig: its folder, baseUrl folder and `paths` patterns. */
export interface PathAliases {
  config: string;
  dir: string;
  /** baseUrl's folder (bare names resolve from it), or null. */
  baseDir: string | null;
  /** The folder `paths` targets are relative to (baseUrl's, else the folder of the config that sets them). */
  pathsDir: string;
  paths: { pattern: string; targets: string[] }[];
}

/** Removes // and block comments and trailing commas (tsconfig is "JSON with comments"), outside strings. */
function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** One config's raw JSON, or a reason it cannot be read. */
function parseConfig(cfg: Pick<ConfigFile, "path" | "text">): { ok: true; json: Record<string, unknown> } | { ok: false; why: string } {
  try {
    const json = JSON.parse(stripJsonc(cfg.text)) as unknown;
    return json && typeof json === "object" && !Array.isArray(json) ? { ok: true, json: json as Record<string, unknown> } : { ok: false, why: "is not a JSON object" };
  } catch {
    return { ok: false, why: "could not be read as JSON" };
  }
}

/**
 * Reads `compilerOptions.baseUrl` and `paths` of a tsconfig/jsconfig, following `extends` to another config the
 * codebase holds (a relative path, up to 5 steps; the child's options win; baseUrl and paths are relative to the
 * config that sets them). Returns the aliases, or why there are none (review round 2, minor 5).
 */
export function readPathAliases(cfg: Pick<ConfigFile, "path" | "text">, all: ReadonlyArray<Pick<ConfigFile, "path" | "text">> = [cfg]): { ok: true; aliases: PathAliases; followed: string[] } | { ok: false; why: string } {
  let baseUrl: { dir: string; value: string } | null = null;
  let paths: { dir: string; value: Record<string, unknown> } | null = null;
  const followed: string[] = [];
  let cur: Pick<ConfigFile, "path" | "text"> | undefined = cfg;
  for (let step = 0; cur && step < 6; step++) {
    const r = parseConfig(cur);
    if (!r.ok) return step === 0 ? { ok: false, why: r.why } : { ok: false, why: `extends ${cur.path}, which ${r.why}` };
    const co = r.json.compilerOptions as { baseUrl?: unknown; paths?: unknown } | undefined;
    const dir = dirOf(cur.path);
    if (co && typeof co === "object") {
      if (baseUrl === null && typeof co.baseUrl === "string") baseUrl = { dir, value: co.baseUrl };
      if (paths === null && co.paths && typeof co.paths === "object" && !Array.isArray(co.paths)) paths = { dir, value: co.paths as Record<string, unknown> };
    }
    const ext = r.json.extends;
    if (typeof ext !== "string" || !ext.startsWith(".")) {
      if (typeof ext === "string") followed.push(`${ext} (a package: not followed)`);
      break;
    }
    const target = joinPath(dir, ext.endsWith(".json") ? ext : `${ext}.json`);
    cur = target === null ? undefined : all.find((c) => c.path === target);
    followed.push(cur ? cur.path : `${ext} (not among the files Atlas read)`);
  }
  if (baseUrl === null && paths === null) return { ok: false, why: "sets no baseUrl or paths" };
  const out: PathAliases["paths"] = [];
  for (const [pattern, targets] of Object.entries(paths?.value ?? {})) {
    if ((pattern.match(/\*/g) ?? []).length > 1 || !Array.isArray(targets)) continue;
    out.push({ pattern, targets: targets.filter((t): t is string => typeof t === "string").slice(0, 10) });
  }
  // TypeScript picks the pattern with the longest prefix before "*".
  out.sort((a, b) => b.pattern.split("*")[0]!.length - a.pattern.split("*")[0]!.length || cmp(a.pattern, b.pattern));
  const baseDir = baseUrl ? joinPath(baseUrl.dir, baseUrl.value) : null;
  // Without baseUrl, paths are relative to the config that sets them.
  return { ok: true, aliases: { config: cfg.path, dir: dirOf(cfg.path), baseDir, pathsDir: baseDir ?? paths?.dir ?? dirOf(cfg.path), paths: out }, followed };
}

/** Where a JS/TS import goes. */
export function resolveJs(importer: string, imp: Pick<RawImport, "specifier" | "kind" | "computed">, files: ReadonlySet<string>, aliases: readonly PathAliases[] = []): ImportTarget {
  const spec = imp.specifier;
  const shown = visibleText(spec);
  if (imp.computed) return { kind: "unresolved", reason: "the module name is computed at run time, so plain code cannot follow it" };
  if (imp.kind === "dynamic") return { kind: "unresolved", reason: "a dynamic import(): plain code lists it but does not follow it" };
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    const base = joinPath(dirOf(importer), spec);
    if (base === null) return { kind: "unresolved", reason: `"${shown}" points outside the codebase` };
    const hit = fileFor(base, files);
    return hit ? { kind: "file", path: hit } : { kind: "unresolved", reason: `no file for "${shown}" among the files Atlas read` };
  }
  if (spec.startsWith("/")) return { kind: "unresolved", reason: "an absolute path: plain code does not follow it" };
  if (spec.startsWith("node:")) return { kind: "external", name: shown };
  // Review M3: tsconfig/jsconfig `paths`, then `baseUrl`, from the nearest config whose folder holds the importer.
  const plain = (c: PathAliases) => (/(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(c.config) ? 0 : 1);
  const cfg = aliases.filter((a) => a.dir === "" || importer.startsWith(`${a.dir}/`)).sort((a, b) => b.dir.length - a.dir.length || plain(a) - plain(b) || cmp(a.config, b.config))[0];
  if (cfg) {
    const root = cfg.pathsDir;
    for (const p of cfg.paths) {
      const [pre, post] = p.pattern.includes("*") ? (p.pattern.split("*") as [string, string]) : [p.pattern, null];
      let star: string | null = null;
      if (post === null) {
        if (spec !== pre) continue;
        star = "";
      } else if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) star = spec.slice(pre.length, spec.length - post.length);
      if (star === null) continue;
      for (const t of p.targets) {
        const target = joinPath(root, t.replace("*", star));
        const hit = target === null ? undefined : fileFor(target, files);
        if (hit) return { kind: "file", path: hit };
      }
      return { kind: "unresolved", reason: `"${shown}" matches the path alias "${visibleText(p.pattern)}" in ${cfg.config}, but no file for it is among the files Atlas read` };
    }
    if (cfg.baseDir !== null) {
      const target = joinPath(cfg.baseDir, spec);
      const hit = target === null ? undefined : fileFor(target, files);
      if (hit) return { kind: "file", path: hit };
    }
  }
  if (spec.startsWith("@/") || spec.startsWith("~/") || spec.startsWith("#") || spec === "") {
    return { kind: "unresolved", reason: `"${shown}" looks like a path alias set in a config file Atlas did not read` };
  }
  const first = spec.split("/")[0]!;
  const topFolders = new Set([...files].filter((f) => f.includes("/")).map((f) => f.split("/")[0]!));
  if (topFolders.has(first) || first === "src") {
    return { kind: "unresolved", reason: `"${shown}" may be a path alias: a folder of this codebase is called "${visibleText(first)}", and plain code found no config that maps it` };
  }
  const parts = spec.split("/");
  const name = spec.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
  return { kind: "external", name: visibleText(name) };
}

/** Python module "a.b" → the codebase file for it, by exact path from `base`, else null. */
function pyModuleAt(base: string, mod: string, files: ReadonlySet<string>): string | null {
  const rel = mod === "" ? "" : mod.split(".").join("/");
  const p = rel === "" ? base : base === "" ? rel : `${base}/${rel}`;
  if (rel !== "" && files.has(`${p}.py`)) return `${p}.py`;
  const init = p === "" ? "__init__.py" : `${p}/__init__.py`;
  return files.has(init) ? init : null;
}

/**
 * Review B2: the folders an absolute Python import is looked up from, in order: the importing file's own folder
 * when it is not inside a package (Python puts a script's folder first on its path; pytest does the same for a
 * test folder), the codebase root, then every "src-style" root: a folder that directly holds a top-level package
 * (a folder X/ with X/__init__.py whose own folder has no __init__.py). Never a match on the end of a path.
 */
export function pyRoots(importer: string, files: ReadonlySet<string>): string[] {
  const roots: string[] = [];
  const own = dirOf(importer);
  if (!files.has(own === "" ? "__init__.py" : `${own}/__init__.py`)) roots.push(own);
  roots.push("");
  const pkgRoots = new Set<string>();
  for (const f of files) {
    if (!f.endsWith("/__init__.py")) continue;
    const pkg = dirOf(f);
    const parent = dirOf(pkg);
    if (!files.has(parent === "" ? "__init__.py" : `${parent}/__init__.py`)) pkgRoots.add(parent);
  }
  for (const r of [...pkgRoots].sort(cmp)) roots.push(r);
  return [...new Set(roots)];
}

/**
 * Where a Python import goes. A `from pkg import a, b` may name submodules (pkg/a.py), so one import line can
 * become several CodeImports: one per submodule, and one for the names that live in the package itself.
 */
export function resolvePy(importer: string, imp: RawImport, files: ReadonlySet<string>, skipped: ReadonlySet<string> = new Set()): CodeImport[] {
  const base = { line: imp.line, specifier: imp.specifier, kind: imp.kind };
  if (imp.computed || imp.kind === "dynamic") {
    return [{ ...base, names: imp.names, target: { kind: "unresolved", reason: imp.computed ? "the module name is computed at run time, so plain code cannot follow it" : "a dynamic import (importlib / __import__): plain code lists it but does not follow it" } }];
  }
  const dots = /^\.*/.exec(imp.specifier)![0].length;
  const mod = imp.specifier.slice(dots);
  // `import a.b [as c]` is recorded with names [{imported:"*", local}]; `from x import *` has local "*".
  const plainImport = imp.names.length === 1 && imp.names[0]!.imported === "*" && imp.names[0]!.local !== "*";
  let pkgDir: string | null;
  let target: ImportTarget;
  if (dots > 0) {
    let dir: string | null = dirOf(importer);
    // Review round 2 (minor 1): Python refuses a relative import that is not inside a package, or that climbs
    // above the top package. Each folder climbed (the importer's own and dots−1 above it) must hold __init__.py.
    const isPkg = (d: string) => files.has(d === "" ? "__init__.py" : `${d}/__init__.py`);
    let check: string | null = dir;
    for (let k = 0; k < dots; k++) {
      if (check === null || !isPkg(check)) {
        return [{ ...base, names: imp.names, target: { kind: "unresolved", reason: `Python refuses "${imp.specifier}" here: the folder it climbs through is not a package (no __init__.py)${check === null ? " or it climbs above the codebase" : ""}` } }];
      }
      check = check === "" ? null : dirOf(check);
    }
    for (let k = 1; k < dots && dir !== null; k++) dir = dir === "" ? null : dirOf(dir);
    if (dir === null) return [{ ...base, names: imp.names, target: { kind: "unresolved", reason: `"${imp.specifier}" climbs above the codebase` } }];
    const hit = pyModuleAt(dir, mod, files);
    pkgDir = mod === "" ? dir : joinPath(dir, mod.split(".").join("/"));
    target = hit ? { kind: "file", path: hit } : { kind: "unresolved", reason: `no file for "${imp.specifier}" among the files Atlas read` };
  } else {
    const top = mod.split(".")[0]!;
    // Review round 3 (R3-B1, S1): CPython looks for a built-in or frozen module first, then along its path, whose first
    // folder is a script's own folder. So a script's sibling queue.py beats the standard library's queue; then the
    // standard library; then the codebase root and src-style roots.
    const roots = pyRoots(importer, files);
    const scriptDir = roots[0] !== "" || !files.has("__init__.py") ? roots[0]! : null;
    const foundFirst = PYTHON_FOUND_FIRST.has(top) || PYTHON_FOUND_FIRST.has(mod);
    const own = dirOf(importer);
    const ownIsScript = !files.has(own === "" ? "__init__.py" : `${own}/__init__.py`);
    const sibling = !foundFirst && ownIsScript && scriptDir === own && pyModuleAt(own, mod, files) !== null ? own : undefined;
    const root = sibling ?? (PYTHON_STDLIB.has(top) ? undefined : roots.find((r) => pyModuleAt(r, mod, files) !== null));
    const rel = mod.split(".").join("/");
    const skippedHit = root === undefined && !PYTHON_STDLIB.has(top) ? roots.map((r) => (r === "" ? rel : `${r}/${rel}`)).find((p) => skipped.has(`${p}.py`) || skipped.has(`${p}/__init__.py`)) : undefined;
    if (skippedHit !== undefined) {
      // Review round 3 (L7): a local module Atlas skipped (over a cap) is never called an outside package.
      target = { kind: "unresolved", reason: `"${imp.specifier}" is a file of this codebase that Atlas did not read (it was skipped)` };
      pkgDir = null;
    } else if (root !== undefined) {
      const hit = pyModuleAt(root, mod, files)!;
      target = { kind: "file", path: hit };
      pkgDir = hit.endsWith("/__init__.py") || hit === "__init__.py" ? dirOf(hit) : hit.replace(/\.py$/, "");
    } else {
      // Review round 2 (minor 2): a folder of .py files without __init__.py is a namespace package. It is not an
      // outside package; a submodule named in `from ns.sub import mod` still resolves below.
      const ns = PYTHON_STDLIB.has(top) ? undefined : pyRoots(importer, files).map((r) => (r === "" ? rel : `${r}/${rel}`)).find((d) => [...files].some((f) => f.startsWith(`${d}/`)));
      if (ns !== undefined) {
        target = { kind: "unresolved", reason: `"${imp.specifier}" is a namespace package (a folder without __init__.py), which plain code does not read as a module` };
        pkgDir = ns;
      } else {
        target = { kind: "external", name: top };
        pkgDir = null;
      }
    }
  }
  if (plainImport || pkgDir === null) return [{ ...base, names: imp.names, target }];
  // from pkg import sub1, name2: a name that is a submodule file goes to that file.
  const out: CodeImport[] = [];
  const rest: typeof imp.names = [];
  for (const n of imp.names) {
    const sub = n.imported !== "*" ? pyModuleAt(pkgDir, n.imported, files) : null;
    if (sub && sub !== (target.kind === "file" ? target.path : null)) out.push({ ...base, names: [{ imported: "*", local: n.local }], target: { kind: "file", path: sub } });
    else rest.push(n);
  }
  if (rest.length > 0 || out.length === 0) out.unshift({ ...base, names: rest, target });
  return out;
}

// ---------- the map ----------

interface Parsed {
  file: Pick<OutlineFile, "path" | "language" | "text">;
  parsed: ParsedFile;
  imports: CodeImport[];
  symbols: CodeSymbol[];
}

/** Builds the code map. Pure and deterministic; never throws for any file content. */
export function buildCodeMap(
  files: ReadonlyArray<Pick<OutlineFile, "path" | "language" | "text">>,
  configs: ReadonlyArray<Pick<ConfigFile, "path" | "text">> = [],
  /** Review round 3 (L7): paths the intake skipped (over a cap): an import of one is "Atlas did not read it". */
  skippedPaths: readonly string[] = [],
): CodeMap {
  const sorted = [...files].sort((a, b) => cmp(a.path, b.path));
  const paths = new Set(sorted.map((f) => f.path));
  const byPath = new Map<string, Parsed>();
  const notes: string[] = [];
  if (sorted.some((f) => f.language === "py")) notes.push(`Python standard library: the module list of CPython ${PYTHON_STDLIB_VERSION}`);
  const aliases: PathAliases[] = [];
  const sortedConfigs = [...configs].sort((a, b) => cmp(a.path, b.path));
  for (const c of sortedConfigs) {
    const a = readPathAliases(c, sortedConfigs);
    if (a.ok) {
      notes.push(`path aliases read from ${c.path} (${plural(a.aliases.paths.length, "pattern")}${a.aliases.baseDir !== null ? ", a base folder" : ""}${a.followed.length ? `; extends ${a.followed.join(" then ")}` : ""})`);
      aliases.push(a.aliases);
    } else notes.push(`${c.path} ${a.why}, so it gives no path aliases`);
  }

  try {
    return buildChecked(sorted, paths, aliases, notes, new Set(skippedPaths));
  } catch (e) {
    if (!(e instanceof TooComplex)) throw e;
    // Review round 2 (B2): past the counted work budget the map is given up, the same way on every machine.
    return {
      version: 1,
      files: sorted.map((f) => ({ path: f.path, language: f.language, lines: countLines(f.text), symbols: [], imports: [], parseNotes: [] })),
      edges: [],
      externals: [],
      notes,
      cantMap: TOO_COMPLEX_TO_MAP,
    };
  }
}

/** Review round 2 (B2): the most steps (re-export lookups, uses) one code map may take. */
export const MAX_MAP_WORK = 3_000_000;
export const TOO_COMPLEX_TO_MAP = "can't check: the codebase is too complex to map (its re-exports and uses need more steps than Atlas allows)";
class TooComplex extends Error {}

function buildChecked(sorted: ReadonlyArray<Pick<OutlineFile, "path" | "language" | "text">>, paths: ReadonlySet<string>, aliases: readonly PathAliases[], notes: string[], skipped: ReadonlySet<string>): CodeMap {
  const byPath = new Map<string, Parsed>();
  let work = 0;
  const spend = (n = 1) => {
    work += n;
    if (work > MAX_MAP_WORK) throw new TooComplex();
  };
  /** For each file, its imports grouped by the parser's import index (a Python import line may become several). */
  const byRaw = new Map<string, CodeImport[][]>();
  for (const f of sorted) {
    const parsed = parseOne(f);
    spend(Math.ceil(f.text.length / 100));
    const groups: CodeImport[][] = parsed.imports.map((imp) =>
      f.language === "py" ? resolvePy(f.path, imp, paths, skipped) : [{ line: imp.line, specifier: visibleText(imp.specifier), kind: imp.kind, names: imp.names, target: resolveJs(f.path, imp, paths, aliases) }],
    );
    byRaw.set(f.path, groups);
    const imports = groups.flat();
    imports.sort((a, b) => a.line - b.line || cmp(a.specifier, b.specifier) || cmp(a.kind, b.kind) || cmp(JSON.stringify(a.names), JSON.stringify(b.names)));
    const seen = new Map<string, number>();
    const symbols: CodeSymbol[] = [...parsed.symbols]
      .sort((a, b) => a.lineStart - b.lineStart || cmp(a.parent ?? "", b.parent ?? "") || cmp(a.name, b.name))
      .map((s) => {
        const key = visibleText(`${f.path}#${s.parent ? `${s.parent}.` : ""}${s.name}`);
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        // Review minor 5: text read from the code is shown with hidden characters made visible.
        const shownText = {
          ...(s.signature !== undefined ? { signature: visibleText(s.signature) } : {}),
          ...(s.params !== undefined ? { params: s.params.map(visibleText) } : {}),
          ...(s.returns !== undefined ? { returns: visibleText(s.returns) } : {}),
        };
        return { id: n === 0 ? key : `${key}@${s.lineStart}`, ...s, name: visibleText(s.name), ...shownText };
      });
    byPath.set(f.path, { file: f, parsed, imports, symbols });
  }

  /**
   * A file's top-level definition of a name. Review round 3 (minor 1): Python runs the LAST definition (the first
   * ones may be `@overload` stubs); JS/TS keeps the one definition (overload signatures have no body and are skipped).
   */
  const topSym = (p: Parsed, name: string): CodeSymbol | undefined => {
    const all = p.symbols.filter((s) => s.parent === undefined && s.name === name);
    return p.file.language === "py" ? all[all.length - 1] : all[0];
  };
  type Found = { path: string; symbol?: string; note?: string };
  const memo = new Map<string, Found>();
  const inProgress = new Set<string>();
  /**
   * The file (and symbol) that defines `name` as exported by `path`, following re-exports. Review round 2 (B2):
   * every (file, name) is worked out once and remembered, and `export *` / `from .x import *` chains are walked
   * breadth-first with ONE visited set, so the time grows with files × star links, never with the number of paths.
   */
  const definer = (path: string, name: string): Found => {
    const key = `${path}\u0000${name}`;
    const known = memo.get(key);
    if (known) return known;
    if (inProgress.has(key)) return { path }; // a cycle of named re-exports: nothing defines it
    inProgress.add(key);
    const found = lookup(path, name);
    inProgress.delete(key);
    memo.set(key, found);
    return found;
  };
  /** Own definition or named re-export only (no `*`). */
  const direct = (path: string, name: string): Found | null => {
    spend();
    const p = byPath.get(path);
    if (!p) return { path };
    const exportedAs = p.parsed.exportedLocals.find((e) => e.exported === name);
    const local = exportedAs?.local ?? name;
    const own = name === "default" ? p.symbols.find((s) => s.parent === undefined && s.isDefault) : topSym(p, local);
    if (own) return { path, symbol: own.id };
    // A named re-export, or an import bound to that name. In JS/TS an imported name is reachable only when the file
    // exports it again (review minor 4); in Python every module-level name, imported ones included, is reachable.
    for (const imp of p.imports) {
      if (imp.target.kind !== "file") continue;
      const n = imp.names.find((x) => x.local === local && x.local !== "*");
      if (!n) continue;
      if (p.file.language !== "py" && imp.kind !== "re-export" && !exportedAs) continue;
      return n.imported === "*" ? { path: imp.target.path } : definer(imp.target.path, n.imported);
    }
    return null;
  };
  const starTargets = (path: string) => (byPath.get(path)?.imports ?? []).filter((i) => i.target.kind === "file" && i.names.some((x) => x.local === "*")).map((i) => (i.target as { path: string }).path);
  const lookup = (path: string, name: string): Found => {
    const d = direct(path, name);
    if (d) return d;
    // export * from "./x" / from .x import *: breadth-first; a file that defines the name ends that branch. When
    // several files give the name, TypeScript calls it ambiguous; so does Atlas (no symbol, and a note why).
    const hits: Found[] = [];
    const visited = new Set<string>([path]);
    const queue = [...starTargets(path)];
    while (queue.length > 0) {
      spend();
      const g = queue.shift()!;
      if (visited.has(g)) continue;
      visited.add(g);
      const h = name === "default" ? null : direct(g, name);
      if (h?.symbol) {
        if (!hits.some((x) => x.symbol === h.symbol)) hits.push(h);
        continue;
      }
      for (const t of starTargets(g)) if (!visited.has(t)) queue.push(t);
    }
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      const where = hits.map((x) => x.path).sort(cmp);
      return { path, note: `"${visibleText(name)}" is exported by ${plural(where.length, "file")} through "export *" (${where.slice(0, 3).join(", ")}), so plain code does not pick one` };
    }
    return { path };
  };
  /** Review round 2 (M1): `Cls.method` → the method's own definition when the code map knows it, else the class. */
  const memberOf = (found: Found, member: string | undefined): Found => {
    if (!found.symbol || !member) return found;
    const p = byPath.get(found.path);
    const cls = p?.symbols.find((s) => s.id === found.symbol);
    if (!cls || cls.kind !== "class") return found;
    const m = p!.symbols.find((s) => s.parent === cls.name && s.name === member.split(".")[0]);
    return m ? { ...found, symbol: m.id } : found;
  };

  const edges = new Map<string, CodeEdge & { all: number[] }>();
  const addEdge = (e: Omit<CodeEdge, "id" | "line" | "lines" | "count">, line: number) => {
    spend();
    // A use inside one file is an edge only when it names the definition it reaches (review round 2, M2).
    if (e.from === e.to && !e.toSymbol) return;
    // Calls of one name are one edge (review M1). Each import statement stays its own edge, so the definitions it
    // names stay tied to its line (two `from .timed import …` lines name different classes).
    const id = `${e.kind}:${e.from}->${e.to}:${e.what}${e.typeOnly ? "#type" : ""}${e.kind === "imports" ? `@${line}` : ""}`;
    const had = edges.get(id);
    if (had) had.all.push(line);
    else edges.set(id, { id, ...e, line, lines: [], count: 0, all: [line] });
  };

  for (const p of byPath.values()) {
    const from = p.file.path;
    for (const imp of p.imports) {
      if (imp.target.kind !== "file") continue;
      const to = byPath.get(imp.target.path);
      const named = imp.names.filter((n) => n.imported !== "*").map((n) => (n.imported === "default" ? to?.symbols.find((s) => s.parent === undefined && s.isDefault) : to?.symbols.find((s) => s.parent === undefined && s.name === (to.parsed.exportedLocals.find((e) => e.exported === n.imported)?.local ?? n.imported)))?.id);
      const toSymbols = [...new Set(named.filter((x): x is string => x !== undefined))].sort(cmp);
      addEdge({ kind: "imports", from, to: imp.target.path, what: imp.specifier, ...(toSymbols.length ? { toSymbols } : {}), ...(imp.kind === "type-only" ? { typeOnly: true as const } : {}) }, imp.line);
    }
    const groups = byRaw.get(from) ?? [];
    for (const use of p.parsed.calls) {
      let kind: CodeEdge["kind"] = use.form === "extends" || use.form === "ref" || use.form === "export" ? "uses" : "calls";
      const onExport = use.form === "export" ? { onExport: true as const } : {};
      const shown = visibleText(
        `${use.form === "new" ? "new " : use.form === "jsx" ? "<" : use.form === "extends" ? "extends " : use.form === "export" ? "export " : ""}${use.member ? `${use.local}.${use.member}` : use.local}${use.form === "jsx" ? ">" : ""}`,
      );
      if (use.own) {
        // A use of this file's own top-level definition (a call inside one file, a base class, a reference).
        const sym = topSym(p, use.local);
        if (!sym) continue;
        const d = memberOf({ path: from, symbol: sym.id }, use.member);
        // Review round 3 (minor 2): `X.map()` on a constant calls the value's method, not code of X: a use.
        if (kind === "calls" && use.member && sym.kind === "variable") kind = "uses";
        addEdge({ kind, from, to: from, what: shown, toSymbol: d.symbol!, ...onExport }, use.line);
        continue;
      }
      if (use.imp === undefined) continue;
      // The import that bound this name, in its real scope (Python "pkg.mod" locals included).
      const imp = (groups[use.imp] ?? []).find((i) => i.names.some((n) => n.local === use.local));
      if (!imp || imp.target.kind !== "file" || imp.kind === "type-only") continue;
      const n = imp.names.find((x) => x.local === use.local)!;
      const parts = use.member?.split(".") ?? [];
      const wanted = n.imported === "*" ? parts[0] : n.imported;
      const rest = n.imported === "*" ? parts.slice(1).join(".") : use.member;
      const d: Found = wanted !== undefined ? memberOf(definer(imp.target.path, wanted), rest || undefined) : { path: imp.target.path };
      const base = wanted !== undefined ? definer(imp.target.path, wanted) : undefined;
      const baseSym = base?.symbol ? byPath.get(base.path)?.symbols.find((x) => x.id === base.symbol) : undefined;
      if (kind === "calls" && rest && baseSym?.kind === "variable") kind = "uses";
      addEdge({ kind, from, to: d.path, what: shown, ...(d.symbol ? { toSymbol: d.symbol } : {}), ...(d.note ? { note: d.note } : {}), ...onExport }, use.line);
    }
  }

  const externals = new Map<string, Set<string>>();
  for (const p of byPath.values()) for (const i of p.imports) if (i.target.kind === "external") (externals.get(i.target.name) ?? externals.set(i.target.name, new Set()).get(i.target.name)!).add(p.file.path);

  const mapFiles: CodeMapFile[] = [...byPath.values()].map((p) => ({
    path: p.file.path,
    language: p.file.language,
    lines: countLines(p.file.text),
    symbols: p.symbols,
    imports: p.imports,
    parseNotes: p.parsed.notes.map(visibleText),
  }));
  return {
    version: 1,
    files: mapFiles,
    // Review round 2 (minor 3): every line is kept (the work budget bounds them), so no part loses its uses.
    edges: [...edges.values()]
      .sort((a, b) => cmp(a.id, b.id))
      .map(({ all, ...e }) => {
        const lines = [...new Set(all)].sort((x, y) => x - y);
        return { ...e, line: lines[0]!, lines, count: all.length };
      }),
    externals: [...externals.entries()].sort((a, b) => cmp(a[0], b[0])).map(([name, by]) => ({ name, importedBy: [...by].sort(cmp) })),
    notes,
  };
}

/** Review M1: limits on the code map itself, so the prompt and the memory a job holds stay bounded. */
export const MAX_CODEMAP_EDGES = 3000;
export const MAX_CODEMAP_SYMBOLS = 6000;
/** Why this code map is too large for Atlas to use (null when it is not). */
export function codeMapTooLarge(map: CodeMap): string | null {
  const symbols = map.files.reduce((n, f) => n + f.symbols.length, 0);
  if (map.edges.length > MAX_CODEMAP_EDGES) return `the code map has ${map.edges.length} edges; Atlas works with at most ${MAX_CODEMAP_EDGES}. Choose a smaller folder.`;
  if (symbols > MAX_CODEMAP_SYMBOLS) return `the code map has ${symbols} definitions; Atlas works with at most ${MAX_CODEMAP_SYMBOLS}. Choose a smaller folder.`;
  return null;
}
