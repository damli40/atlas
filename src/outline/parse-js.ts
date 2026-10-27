// X1: reads one JavaScript or TypeScript file with the TypeScript compiler's parser (no model, never runs the code).
//
// Plain words: the TypeScript compiler can turn source text into a tree of the code's pieces (a "syntax tree")
// without running anything. This module walks that tree once and writes down:
// - what the file defines at the top level: functions, classes (and their methods) and variables, with their
//   lines, whether they are exported, and for functions their written parameters and return type;
// - every place it loads other code: `import ... from`, `export ... from` (a re-export), `require("x")`,
//   `import("x")` (dynamic, never followed), `import type` (types only);
// - every place it CALLS a name it imported: `save()`, `db.save()`, `new Queue()`, `<Panel />`.
// Which file an import reaches is decided later (src/outline/codemap.ts), with the whole codebase in view.
//
// Why the TypeScript 5.9 parser (package alias `typescript-api`): the repo's own `typescript` is version 7, whose
// parser lives in a separate native program reached over a pipe (an unstable API). Version 5.9's parser is plain
// JavaScript, synchronous and in-process, so the proof-file check (src/atlasfile.ts) can re-read a codebase
// without starting anything. It only parses: no type checking, no module loading, no evaluation.
//
// Limits (said plainly in the evidence): a local variable that shadows an imported name is still counted as the
// import; calls through a value passed around (const f = save; f()) are not followed.

import ts from "typescript-api";
import type { CodeSymbol, ImportKind, ImportName, OutlineLanguage } from "./types";

export interface RawImport {
  line: number;
  specifier: string;
  kind: ImportKind;
  names: ImportName[];
  /** True when the specifier is not a plain string (require(x), import(`./${y}`)). */
  computed?: boolean;
}

/** A call of an imported name: `local` is the binding used; `member` the property read on it (ns.member()). */
export interface RawCall {
  line: number;
  local: string;
  member?: string;
  form: "call" | "new" | "jsx";
}

export interface ParsedFile {
  symbols: Omit<CodeSymbol, "id">[];
  imports: RawImport[];
  calls: RawCall[];
  /** `export { a as b }` (no `from`): exported name → local name. */
  exportedLocals: { exported: string; local: string }[];
  notes: string[];
}

const SIG_MAX = 200;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string, n = SIG_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const scriptKind = (path: string, language: OutlineLanguage): ts.ScriptKind =>
  path.endsWith(".tsx") ? ts.ScriptKind.TSX : language === "ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) => !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === kind));

export function parseJsFile(path: string, text: string, language: OutlineLanguage): ParsedFile {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path, language));
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const startLine = (n: ts.Node) => lineOf(n.getStart(sf));
  const endLine = (n: ts.Node) => lineOf(Math.max(n.getStart(sf), n.getEnd() - 1));

  const out: ParsedFile = { symbols: [], imports: [], calls: [], exportedLocals: [], notes: [] };
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diags.length > 0) {
    const d = diags[0]!;
    const where = d.start !== undefined ? `line ${lineOf(d.start)}: ` : "";
    out.notes.push(`the parser reported ${diags.length} syntax problem${diags.length === 1 ? "" : "s"} (first: ${where}${cap(squash(ts.flattenDiagnosticMessageText(d.messageText, " ")), 120)})`);
  }

  /** Header text of a function-like node: from its start to its body (or its end), squashed. */
  const signatureOf = (n: ts.Node, body: ts.Node | undefined): string => {
    const from = n.getStart(sf);
    const to = body ? body.getStart(sf) : n.getEnd();
    return cap(squash(text.slice(from, to)).replace(/\s*(=>|\{)?\s*$/, ""));
  };
  const fnInfo = (fn: ts.SignatureDeclarationBase & { body?: ts.Node }, head: ts.Node) => ({
    signature: signatureOf(head, fn.body),
    params: fn.parameters.map((p) => cap(squash(p.getText(sf)), 120)),
    ...(fn.type ? { returns: cap(squash(fn.type.getText(sf)), 120) } : {}),
  });

  const addSymbol = (s: Omit<CodeSymbol, "id">) => out.symbols.push(s);

  const addClass = (c: ts.ClassLikeDeclaration, name: string, exported: boolean, isDefault: boolean, head: ts.Node) => {
    const body = c.members.length > 0 ? c.members[0] : undefined;
    addSymbol({
      name,
      kind: "class",
      exported,
      ...(isDefault ? { isDefault: true } : {}),
      lineStart: startLine(head),
      lineEnd: endLine(head),
      signature: cap(squash(text.slice(head.getStart(sf), body ? body.getFullStart() : head.getEnd())).replace(/\s*\{\s*$/, "")),
    });
    for (const m of c.members) {
      if (!(ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) || !m.body) continue;
      const mname = ts.isConstructorDeclaration(m) ? "constructor" : m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : undefined;
      if (!mname) continue;
      addSymbol({ name: mname, kind: "function", exported, parent: name, lineStart: startLine(m), lineEnd: endLine(m), ...fnInfo(m, m) });
    }
  };

  const strOf = (e: ts.Expression | undefined): string | undefined =>
    e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined;

  // ---- top level: definitions, imports, exports ----
  for (const st of sf.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
    if (ts.isImportDeclaration(st)) {
      const spec = strOf(st.moduleSpecifier as ts.Expression);
      const names: ImportName[] = [];
      const clause = st.importClause;
      if (clause?.name) names.push({ imported: "default", local: clause.name.text });
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) names.push({ imported: "*", local: nb.name.text });
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) names.push({ imported: (el.propertyName ?? el.name).text, local: el.name.text });
      const typeOnly = !!clause?.isTypeOnly;
      out.imports.push({ line: startLine(st), specifier: spec ?? "<computed>", kind: typeOnly ? "type-only" : "static", names, ...(spec === undefined ? { computed: true } : {}) });
      continue;
    }
    if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
      const spec = strOf(st.moduleReference.expression);
      out.imports.push({ line: startLine(st), specifier: spec ?? "<computed>", kind: "require", names: [{ imported: "*", local: st.name.text }], ...(spec === undefined ? { computed: true } : {}) });
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier ? strOf(st.moduleSpecifier as ts.Expression) : undefined;
      const clause = st.exportClause;
      if (st.moduleSpecifier) {
        const names: ImportName[] = !clause
          ? [{ imported: "*", local: "*" }]
          : ts.isNamespaceExport(clause)
            ? [{ imported: "*", local: clause.name.text }]
            : clause.elements.map((el) => ({ imported: (el.propertyName ?? el.name).text, local: el.name.text }));
        out.imports.push({ line: startLine(st), specifier: spec ?? "<computed>", kind: st.isTypeOnly ? "type-only" : "re-export", names, ...(spec === undefined ? { computed: true } : {}) });
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) out.exportedLocals.push({ exported: el.name.text, local: (el.propertyName ?? el.name).text });
      }
      continue;
    }
    if (ts.isExportAssignment(st)) {
      // export default <expr>  (or TS `export = x`)
      const e = st.expression;
      if (ts.isIdentifier(e)) out.exportedLocals.push({ exported: "default", local: e.text });
      else if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) addSymbol({ name: "default", kind: "function", exported: true, isDefault: true, lineStart: startLine(st), lineEnd: endLine(st), ...fnInfo(e, st) });
      else if (ts.isClassExpression(e)) addClass(e, "default", true, true, st);
      else addSymbol({ name: "default", kind: "variable", exported: true, isDefault: true, lineStart: startLine(st), lineEnd: endLine(st) });
      continue;
    }
    if (ts.isFunctionDeclaration(st)) {
      if (!st.body) continue; // an overload signature
      const name = st.name?.text ?? "default";
      addSymbol({ name, kind: "function", exported: exported, ...(isDefault ? { isDefault: true } : {}), lineStart: startLine(st), lineEnd: endLine(st), ...fnInfo(st, st) });
      continue;
    }
    if (ts.isClassDeclaration(st)) {
      addClass(st, st.name?.text ?? "default", exported, isDefault, st);
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        // const x = require("./a") / const {a, b: c} = require("./a")
        const init = d.initializer;
        if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require" && init.arguments.length === 1) {
          const spec = strOf(init.arguments[0]);
          const names: ImportName[] = ts.isIdentifier(d.name)
            ? [{ imported: "*", local: d.name.text }]
            : ts.isObjectBindingPattern(d.name)
              ? d.name.elements.filter((el) => ts.isIdentifier(el.name)).map((el) => ({ imported: el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : (el.name as ts.Identifier).text, local: (el.name as ts.Identifier).text }))
              : [];
          out.imports.push({ line: startLine(st), specifier: spec ?? "<computed>", kind: "require", names, ...(spec === undefined ? { computed: true } : {}) });
          continue;
        }
        if (!ts.isIdentifier(d.name)) continue;
        const name = d.name.text;
        const head = st.declarationList.declarations.length === 1 ? st : d;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          addSymbol({ name, kind: "function", exported, lineStart: startLine(head), lineEnd: endLine(head), ...fnInfo(init, head) });
        } else if (init && ts.isClassExpression(init)) {
          addClass(init, name, exported, false, head);
        } else {
          addSymbol({ name, kind: "variable", exported, lineStart: startLine(head), lineEnd: endLine(head) });
        }
      }
      continue;
    }
    // CommonJS exports: module.exports = {...} / module.exports.x = ... / exports.x = ...
    if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const { left, right } = st.expression;
      const lhs = left.getText(sf).replace(/\s+/g, "");
      if (lhs === "module.exports") {
        if (ts.isObjectLiteralExpression(right)) {
          for (const p of right.properties) {
            if (ts.isShorthandPropertyAssignment(p)) out.exportedLocals.push({ exported: p.name.text, local: p.name.text });
            else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && ts.isIdentifier(p.initializer)) out.exportedLocals.push({ exported: p.name.text, local: p.initializer.text });
          }
        } else if (ts.isIdentifier(right)) out.exportedLocals.push({ exported: "default", local: right.text });
        else if (ts.isFunctionExpression(right) || ts.isArrowFunction(right)) addSymbol({ name: "default", kind: "function", exported: true, isDefault: true, lineStart: startLine(st), lineEnd: endLine(st), ...fnInfo(right, st) });
        continue;
      }
      const m = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(lhs);
      if (m) {
        const name = m[1]!;
        if (ts.isIdentifier(right)) out.exportedLocals.push({ exported: name, local: right.text });
        else if (ts.isFunctionExpression(right) || ts.isArrowFunction(right)) addSymbol({ name, kind: "function", exported: true, lineStart: startLine(st), lineEnd: endLine(st), ...fnInfo(right, st) });
        else addSymbol({ name, kind: "variable", exported: true, lineStart: startLine(st), lineEnd: endLine(st) });
      }
    }
  }

  // Names exported by `export { a as b }` / module.exports: mark the local definition exported.
  for (const e of out.exportedLocals) {
    for (const s of out.symbols) {
      if (s.parent === undefined && s.name === e.local) {
        s.exported = true;
        if (e.exported === "default") s.isDefault = true;
      }
    }
    // methods of an exported class are exported with it
  }
  for (const s of out.symbols) if (s.parent !== undefined) s.exported = out.symbols.some((c) => c.parent === undefined && c.name === s.parent && c.exported);

  // ---- everywhere: nested require()/import(), and calls of imported names ----
  const bindings = new Set<string>();
  for (const i of out.imports) for (const n of i.names) if (n.local !== "*" && i.kind !== "re-export") bindings.add(n.local);

  const topRequires = new Set(out.imports.filter((i) => i.kind === "require").map((i) => i.line));
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = strOf(n.arguments[0]);
        out.imports.push({ line: startLine(n), specifier: spec ?? "<computed>", kind: "dynamic", names: [], ...(spec === undefined ? { computed: true } : {}) });
      } else if (ts.isIdentifier(callee) && callee.text === "require" && n.arguments.length === 1 && !bindings.has("require")) {
        const line = startLine(n);
        // A top-level `const x = require(...)` was recorded above with its names.
        const parentDecl = n.parent && ts.isVariableDeclaration(n.parent) && n.parent.parent?.parent && ts.isVariableStatement(n.parent.parent.parent) && n.parent.parent.parent.parent === sf;
        if (!(parentDecl && topRequires.has(line))) {
          const spec = strOf(n.arguments[0]);
          out.imports.push({ line, specifier: spec ?? "<computed>", kind: "require", names: [], ...(spec === undefined ? { computed: true } : {}) });
        }
      } else {
        const c = calleeOf(callee);
        if (c && bindings.has(c.local)) out.calls.push({ line: startLine(n), ...c, form: "call" });
      }
    } else if (ts.isNewExpression(n)) {
      const c = calleeOf(n.expression);
      if (c && bindings.has(c.local)) out.calls.push({ line: startLine(n), ...c, form: "new" });
    } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const c = calleeOf(n.tagName as ts.Expression);
      if (c && bindings.has(c.local)) out.calls.push({ line: startLine(n), ...c, form: "jsx" });
    }
    ts.forEachChild(n, visit);
  };
  const calleeOf = (e: ts.Expression): { local: string; member?: string } | null => {
    if (ts.isIdentifier(e)) return { local: e.text };
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ts.isIdentifier(e.name)) return { local: e.expression.text, member: e.name.text };
    return null;
  };
  ts.forEachChild(sf, visit);
  return out;
}
