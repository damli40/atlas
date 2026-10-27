// X1: the code map, built by plain code from a codebase's files (no model, never runs the code).
//
// Plain words: each file is read by its language's parser (src/outline/parse-js.ts with the TypeScript compiler
// for .js .mjs .cjs .ts .tsx; src/outline/parse-py.ts for .py). Then, with every file in view, this module decides
// where each import goes:
// - a file of the codebase (relative imports, Python packages, `index` files, "./a.js" written for a.ts);
// - an outside package, by name ("react", "@scope/pkg", "node:fs", "requests"): listed, never fetched;
// - "unresolved", with the reason (a dynamic import, a computed name, a path alias, a file Atlas did not read).
// It then turns each call of an imported name into an edge "file A calls file B at line N", following
// re-exports (index files, `from .sub import f` in a package's __init__.py) to the file that defines the name.
//
// The result is deterministic: files sorted by path, symbols by line, edges by id. The same files always give
// the same code map, byte for byte (the proof-file check rebuilds it and compares).

import { parseJsFile, type ParsedFile, type RawImport } from "./parse-js";
import { parsePyFile } from "./parse-py";
import type { CodeEdge, CodeImport, CodeMap, CodeMapFile, CodeSymbol, ImportTarget, OutlineFile, OutlineLanguage } from "./types";

/** Brackets nested deeper than this are not parsed (a hostile file must not exhaust the parser's stack). */
export const MAX_BRACKET_DEPTH = 400;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Language from the file name; null when Atlas does not read that kind of file. */
export function languageOf(path: string): OutlineLanguage | null {
  if (/\.(?:ts|tsx)$/.test(path) && !/\.d\.ts$/.test(path)) return "ts";
  if (/\.(?:js|mjs|cjs)$/.test(path)) return "js";
  if (/\.py$/.test(path)) return "py";
  return null;
}

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

const JS_EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
const JS_INDEX = JS_EXTS.map((e) => `/index${e}`);

/** Where a JS/TS import goes. */
export function resolveJs(importer: string, imp: Pick<RawImport, "specifier" | "kind" | "computed">, files: ReadonlySet<string>): ImportTarget {
  const spec = imp.specifier;
  if (imp.computed) return { kind: "unresolved", reason: "the module name is computed at run time, so plain code cannot follow it" };
  if (imp.kind === "dynamic") return { kind: "unresolved", reason: "a dynamic import(): plain code lists it but does not follow it" };
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    const base = joinPath(dirOf(importer), spec);
    if (base === null) return { kind: "unresolved", reason: `"${spec}" points outside the codebase` };
    const stripped = /\.(?:js|mjs|cjs|jsx)$/.test(base) ? base.replace(/\.(?:js|mjs|cjs|jsx)$/, "") : null;
    const candidates = [base, ...JS_EXTS.map((e) => base + e), ...(stripped !== null ? [`${stripped}.ts`, `${stripped}.tsx`] : []), ...JS_INDEX.map((e) => (base === "" ? e.slice(1) : base + e))];
    const hit = candidates.find((c) => files.has(c));
    return hit ? { kind: "file", path: hit } : { kind: "unresolved", reason: `no file for "${spec}" among the files Atlas read` };
  }
  if (spec.startsWith("/")) return { kind: "unresolved", reason: "an absolute path: plain code does not follow it" };
  if (spec.startsWith("@/") || spec.startsWith("~/") || spec.startsWith("#") || spec === "") {
    return { kind: "unresolved", reason: `"${spec}" looks like a path alias set in a config file, which plain code does not read` };
  }
  if (spec.startsWith("node:")) return { kind: "external", name: spec };
  const parts = spec.split("/");
  const name = spec.startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
  return { kind: "external", name };
}

/** Python module "a.b" → the codebase file for it, by exact path from `base`, else null. */
function pyModuleAt(base: string, mod: string, files: ReadonlySet<string>): string | null {
  const rel = mod === "" ? "" : mod.split(".").join("/");
  const p = rel === "" ? base : base === "" ? rel : `${base}/${rel}`;
  if (rel !== "" && files.has(`${p}.py`)) return `${p}.py`;
  const init = p === "" ? "__init__.py" : `${p}/__init__.py`;
  return files.has(init) ? init : null;
}

/** Absolute Python module "a.b": at the codebase root first, else the one file whose path ends with it. */
function pyAbsolute(mod: string, files: ReadonlySet<string>): { path: string } | { ambiguous: string[] } | null {
  const atRoot = pyModuleAt("", mod, files);
  if (atRoot) return { path: atRoot };
  const rel = mod.split(".").join("/");
  const hits = [...files].filter((f) => f.endsWith(`/${rel}.py`) || f.endsWith(`/${rel}/__init__.py`)).sort(cmp);
  if (hits.length === 1) return { path: hits[0]! };
  if (hits.length > 1) return { ambiguous: hits };
  return null;
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
    const hit = pyAbsolute(mod, files);
    if (hit && "path" in hit) {
      target = { kind: "file", path: hit.path };
      pkgDir = hit.path.endsWith("/__init__.py") || hit.path === "__init__.py" ? dirOf(hit.path) : hit.path.replace(/\.py$/, "");
    } else if (hit && "ambiguous" in hit) {
      target = { kind: "unresolved", reason: `"${mod}" matches ${hit.ambiguous.length} files (${hit.ambiguous.slice(0, 3).join(", ")}), so plain code does not pick one` };
      pkgDir = null;
    } else {
      target = { kind: "external", name: mod.split(".")[0]! };
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
export function buildCodeMap(files: ReadonlyArray<Pick<OutlineFile, "path" | "language" | "text">>): CodeMap {
  const sorted = [...files].sort((a, b) => cmp(a.path, b.path));
  const paths = new Set(sorted.map((f) => f.path));
  const byPath = new Map<string, Parsed>();

  for (const f of sorted) {
    const parsed = parseOne(f);
    const imports: CodeImport[] = parsed.imports.flatMap((imp) =>
      f.language === "py" ? resolvePy(f.path, imp, paths) : [{ line: imp.line, specifier: imp.specifier, kind: imp.kind, names: imp.names, target: resolveJs(f.path, imp, paths) }],
    );
    imports.sort((a, b) => a.line - b.line || cmp(a.specifier, b.specifier) || cmp(a.kind, b.kind) || cmp(JSON.stringify(a.names), JSON.stringify(b.names)));
    const seen = new Map<string, number>();
    const symbols: CodeSymbol[] = [...parsed.symbols]
      .sort((a, b) => a.lineStart - b.lineStart || cmp(a.parent ?? "", b.parent ?? "") || cmp(a.name, b.name))
      .map((s) => {
        const key = `${f.path}#${s.parent ? `${s.parent}.` : ""}${s.name}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        return { id: n === 0 ? key : `${key}@${s.lineStart}`, ...s };
      });
    byPath.set(f.path, { file: f, parsed, imports, symbols });
  }

  /** The file (and symbol) that defines `name` as exported by `path`, following re-exports. Cycle-safe. */
  const definer = (path: string, name: string, seen = new Set<string>()): { path: string; symbol?: string } => {
    const key = `${path}\u0000${name}`;
    const p = byPath.get(path);
    if (!p || seen.has(key) || seen.size > 50) return { path };
    seen.add(key);
    const local = p.parsed.exportedLocals.find((e) => e.exported === name)?.local ?? name;
    const own = name === "default" ? p.symbols.find((s) => s.parent === undefined && s.isDefault) : p.symbols.find((s) => s.parent === undefined && s.name === local);
    if (own) return { path, symbol: own.id };
    // Named re-export or an import bound to that local name (JS `import {x}; export {x}`, Python `from .sub import f`).
    for (const imp of p.imports) {
      if (imp.target.kind !== "file") continue;
      const n = imp.names.find((x) => x.local === local && x.local !== "*");
      if (n) return n.imported === "*" ? { path: imp.target.path } : definer(imp.target.path, n.imported, seen);
    }
    // export * from "./x" / from .x import *
    for (const imp of p.imports) {
      if (imp.target.kind !== "file" || !imp.names.some((x) => x.local === "*")) continue;
      const d = definer(imp.target.path, name, seen);
      if (d.symbol) return d;
    }
    return { path };
  };

  const edges = new Map<string, CodeEdge>();
  const addEdge = (e: Omit<CodeEdge, "id">) => {
    if (e.from === e.to) return;
    const id = `${e.kind}:${e.from}->${e.to}@${e.line}:${e.what}`;
    if (!edges.has(id)) edges.set(id, { id, ...e });
  };

  for (const p of byPath.values()) {
    const from = p.file.path;
    for (const imp of p.imports) if (imp.target.kind === "file") addEdge({ kind: "imports", from, to: imp.target.path, line: imp.line, what: imp.specifier });
    for (const call of p.parsed.calls) {
      // The import that bound this local name (Python "pkg.mod" locals included).
      const imp = p.imports.find((i) => i.target.kind === "file" && i.kind !== "type-only" && i.names.some((n) => n.local === call.local));
      if (!imp || imp.target.kind !== "file") continue;
      const n = imp.names.find((x) => x.local === call.local)!;
      const wanted = n.imported === "*" ? call.member?.split(".")[0] : n.imported;
      const d = wanted !== undefined ? definer(imp.target.path, wanted) : { path: imp.target.path };
      const shown = `${call.form === "new" ? "new " : call.form === "jsx" ? "<" : ""}${call.member ? `${call.local}.${call.member}` : call.local}${call.form === "jsx" ? ">" : ""}`;
      addEdge({ kind: "calls", from, to: d.path, line: call.line, what: shown, ...(d.symbol ? { toSymbol: d.symbol } : {}) });
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
    parseNotes: p.parsed.notes,
  }));
  return {
    version: 1,
    files: mapFiles,
    edges: [...edges.values()].sort((a, b) => cmp(a.id, b.id)),
    externals: [...externals.entries()].sort((a, b) => cmp(a[0], b[0])).map(([name, by]) => ({ name, importedBy: [...by].sort(cmp) })),
  };
}
