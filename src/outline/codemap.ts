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
import { PYTHON_STDLIB, PYTHON_STDLIB_VERSION } from "./py-stdlib";
import { plural } from "../words";
import { visibleText } from "../gate";
import type { CodeEdge, CodeImport, CodeMap, CodeMapFile, CodeSymbol, ConfigFile, ImportTarget, OutlineFile, OutlineLanguage } from "./types";

/** Brackets nested deeper than this are not parsed (a hostile file must not exhaust the parser's stack). */
export const MAX_BRACKET_DEPTH = 400;
/** An edge keeps at most this many of its lines (its count is still exact). */
export const MAX_EDGE_LINES = 100;

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
export const isConfigFile = (path: string) => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(path);

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
  baseDir: string | null;
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

/** Reads `compilerOptions.baseUrl` and `paths` of a tsconfig/jsconfig. `extends` is not followed. Null when unreadable. */
export function readPathAliases(cfg: Pick<ConfigFile, "path" | "text">): PathAliases | null {
  let json: unknown;
  try {
    json = JSON.parse(stripJsonc(cfg.text));
  } catch {
    return null;
  }
  const co = (json as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null)?.compilerOptions;
  if (!co || typeof co !== "object") return null;
  const dir = dirOf(cfg.path);
  const baseDir = typeof co.baseUrl === "string" ? joinPath(dir, co.baseUrl) : null;
  const paths: PathAliases["paths"] = [];
  if (co.paths && typeof co.paths === "object" && !Array.isArray(co.paths)) {
    for (const [pattern, targets] of Object.entries(co.paths as Record<string, unknown>)) {
      if ((pattern.match(/\*/g) ?? []).length > 1 || !Array.isArray(targets)) continue;
      paths.push({ pattern, targets: targets.filter((t): t is string => typeof t === "string").slice(0, 10) });
    }
  }
  // TypeScript picks the pattern with the longest prefix before "*".
  paths.sort((a, b) => b.pattern.split("*")[0]!.length - a.pattern.split("*")[0]!.length || cmp(a.pattern, b.pattern));
  return { config: cfg.path, dir, baseDir, paths };
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
  const cfg = aliases.filter((a) => a.dir === "" || importer.startsWith(`${a.dir}/`)).sort((a, b) => b.dir.length - a.dir.length || cmp(a.config, b.config))[0];
  if (cfg) {
    const root = cfg.baseDir ?? cfg.dir;
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
export function resolvePy(importer: string, imp: RawImport, files: ReadonlySet<string>): CodeImport[] {
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
    for (let k = 1; k < dots && dir !== null; k++) dir = dir === "" ? null : dirOf(dir);
    if (dir === null) return [{ ...base, names: imp.names, target: { kind: "unresolved", reason: `"${imp.specifier}" climbs above the codebase` } }];
    const hit = pyModuleAt(dir, mod, files);
    pkgDir = mod === "" ? dir : joinPath(dir, mod.split(".").join("/"));
    target = hit ? { kind: "file", path: hit } : { kind: "unresolved", reason: `no file for "${imp.specifier}" among the files Atlas read` };
  } else {
    const top = mod.split(".")[0]!;
    const root = PYTHON_STDLIB.has(top) ? undefined : pyRoots(importer, files).find((r) => pyModuleAt(r, mod, files) !== null);
    if (root !== undefined) {
      const hit = pyModuleAt(root, mod, files)!;
      target = { kind: "file", path: hit };
      pkgDir = hit.endsWith("/__init__.py") || hit === "__init__.py" ? dirOf(hit) : hit.replace(/\.py$/, "");
    } else {
      target = { kind: "external", name: top };
      pkgDir = null;
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
export function buildCodeMap(files: ReadonlyArray<Pick<OutlineFile, "path" | "language" | "text">>, configs: ReadonlyArray<Pick<ConfigFile, "path" | "text">> = []): CodeMap {
  const sorted = [...files].sort((a, b) => cmp(a.path, b.path));
  const paths = new Set(sorted.map((f) => f.path));
  const byPath = new Map<string, Parsed>();
  const notes: string[] = [];
  if (sorted.some((f) => f.language === "py")) notes.push(`Python standard library: the module list of CPython ${PYTHON_STDLIB_VERSION}`);
  const aliases: PathAliases[] = [];
  for (const c of [...configs].sort((a, b) => cmp(a.path, b.path))) {
    const a = readPathAliases(c);
    notes.push(a ? `path aliases read from ${c.path} (${plural(a.paths.length, "pattern")}${a.baseDir !== null ? ", baseUrl" : ""}; "extends" is not followed)` : `${c.path} could not be read as JSON, so its path aliases are not used`);
    if (a) aliases.push(a);
  }

  for (const f of sorted) {
    const parsed = parseOne(f);
    const imports: CodeImport[] = parsed.imports.flatMap((imp) =>
      f.language === "py" ? resolvePy(f.path, imp, paths) : [{ line: imp.line, specifier: visibleText(imp.specifier), kind: imp.kind, names: imp.names, target: resolveJs(f.path, imp, paths, aliases) }],
    );
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

  type Found = { path: string; symbol?: string; note?: string };
  /** The file (and symbol) that defines `name` as exported by `path`, following re-exports. Cycle-safe. */
  const definer = (path: string, name: string, seen = new Set<string>()): Found => {
    const key = `${path}\u0000${name}`;
    const p = byPath.get(path);
    if (!p || seen.has(key) || seen.size > 50) return { path };
    seen.add(key);
    const exportedAs = p.parsed.exportedLocals.find((e) => e.exported === name);
    const local = exportedAs?.local ?? name;
    const own = name === "default" ? p.symbols.find((s) => s.parent === undefined && s.isDefault) : p.symbols.find((s) => s.parent === undefined && s.name === local);
    if (own) return { path, symbol: own.id };
    // A named re-export, or an import bound to that name. In JS/TS an imported name is reachable only when the file
    // exports it again (review minor 4); in Python every module-level name, imported ones included, is reachable.
    for (const imp of p.imports) {
      if (imp.target.kind !== "file") continue;
      const n = imp.names.find((x) => x.local === local && x.local !== "*");
      if (!n) continue;
      if (p.file.language !== "py" && imp.kind !== "re-export" && !exportedAs) continue;
      return n.imported === "*" ? { path: imp.target.path } : definer(imp.target.path, n.imported, seen);
    }
    // export * from "./x" / from .x import *: when several give the name, TypeScript calls it ambiguous; so does Atlas.
    const stars: Found[] = [];
    for (const imp of p.imports) {
      if (imp.target.kind !== "file" || !imp.names.some((x) => x.local === "*")) continue;
      const d = definer(imp.target.path, name, new Set(seen));
      if (d.symbol && !stars.some((s) => s.symbol === d.symbol)) stars.push(d);
    }
    if (stars.length === 1) return stars[0]!;
    if (stars.length > 1) {
      const where = stars.map((s) => s.path).sort(cmp);
      return { path, note: `"${visibleText(name)}" is exported by ${plural(where.length, "file")} through "export *" (${where.slice(0, 3).join(", ")}), so plain code does not pick one` };
    }
    return { path };
  };

  const edges = new Map<string, CodeEdge & { all: number[] }>();
  const addEdge = (e: Omit<CodeEdge, "id" | "line" | "lines" | "count">, line: number) => {
    if (e.from === e.to) return;
    const id = `${e.kind}:${e.from}->${e.to}:${e.what}${e.typeOnly ? "#type" : ""}`;
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
    for (const call of p.parsed.calls) {
      // The import that bound this local name (Python "pkg.mod" locals included).
      const imp = p.imports.find((i) => i.target.kind === "file" && i.kind !== "type-only" && i.names.some((n) => n.local === call.local));
      if (!imp || imp.target.kind !== "file") continue;
      const n = imp.names.find((x) => x.local === call.local)!;
      const wanted = n.imported === "*" ? call.member?.split(".")[0] : n.imported;
      const d: Found = wanted !== undefined ? definer(imp.target.path, wanted) : { path: imp.target.path };
      const shown = visibleText(`${call.form === "new" ? "new " : call.form === "jsx" ? "<" : ""}${call.member ? `${call.local}.${call.member}` : call.local}${call.form === "jsx" ? ">" : ""}`);
      addEdge({ kind: "calls", from, to: d.path, what: shown, ...(d.symbol ? { toSymbol: d.symbol } : {}), ...(d.note ? { note: d.note } : {}) }, call.line);
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
    edges: [...edges.values()]
      .sort((a, b) => cmp(a.id, b.id))
      .map(({ all, ...e }) => {
        const lines = [...new Set(all)].sort((x, y) => x - y);
        return { ...e, line: lines[0]!, lines: lines.slice(0, MAX_EDGE_LINES), count: all.length };
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
