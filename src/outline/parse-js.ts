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
// Limits (said plainly in the evidence): calls through a value passed around (const f = save; f()), destructuring
// (const {save} = db), and member chains three names deep are not followed. A name a function declares itself
// (a parameter or a local) hides the import of the same name inside that function (review minor 1).

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

/**
 * A use of a name the file imports, or of one of the file's own top-level definitions (review round 2).
 * `local` is the name used; `member` the property read on it (ns.member(), Store.put()). `imp` is the index in
 * `imports` of the import that binds it (decided with the name's real scope); `own` marks a top-level definition of
 * this same file. form: a call, `new`, a JSX tag, a base class (`extends B`, `class A(B)`), or any other reference.
 */
export interface RawCall {
  line: number;
  local: string;
  member?: string;
  form: "call" | "new" | "jsx" | "extends" | "ref";
  imp?: number;
  own?: true;
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
  path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : language === "ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;

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

  // ---- everywhere: nested require()/import() ----
  const topRequires = new Set(out.imports.filter((i) => i.kind === "require").map((i) => i.line));
  const findImports = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = strOf(n.arguments[0]);
        out.imports.push({ line: startLine(n), specifier: spec ?? "<computed>", kind: "dynamic", names: [], ...(spec === undefined ? { computed: true } : {}) });
      } else if (ts.isIdentifier(callee) && callee.text === "require" && n.arguments.length === 1) {
        const line = startLine(n);
        // A top-level `const x = require(...)` was recorded above with its names.
        const parentDecl = n.parent && ts.isVariableDeclaration(n.parent) && n.parent.parent?.parent && ts.isVariableStatement(n.parent.parent.parent) && n.parent.parent.parent.parent === sf;
        if (!(parentDecl && topRequires.has(line))) {
          const spec = strOf(n.arguments[0]);
          out.imports.push({ line, specifier: spec ?? "<computed>", kind: "require", names: [], ...(spec === undefined ? { computed: true } : {}) });
        }
      }
    }
    ts.forEachChild(n, findImports);
  };
  ts.forEachChild(sf, findImports);

  // ---- every use of an imported name or of a top-level definition, with its real scope ----
  // Review round 2 (M3): the TypeScript binder decides what each name refers to (a parameter, a block-scoped
  // `for (const x of …)`, a local, the import, or the file's own top-level definition), so shadowing is exact.
  // A one-file program with no library and no module resolution: it only binds names; nothing is loaded or run.
  const fileName = `/atlas/${path}`;
  const bound = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(path, language));
  const host: ts.CompilerHost = {
    getSourceFile: (n) => (n === fileName ? bound : undefined),
    writeFile: () => {},
    getDefaultLibFileName: () => "/atlas/no-lib.d.ts",
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => "/atlas",
    getNewLine: () => "\n",
    fileExists: (n) => n === fileName,
    readFile: () => undefined,
  };
  const program = ts.createProgram({ rootNames: [fileName], options: { noLib: true, noResolve: true, allowJs: true, jsx: ts.JsxEmit.Preserve, types: [] }, host });
  const checker = program.getTypeChecker();
  const bline = (n: ts.Node) => bound.getLineAndCharacterOfPosition(n.getStart(bound)).line + 1;
  const importIndex = new Map<string, number>();
  out.imports.forEach((imp, i) => {
    if (imp.kind === "re-export" || imp.kind === "dynamic") return;
    for (const n of imp.names) if (n.local !== "*" && !importIndex.has(n.local)) importIndex.set(n.local, i);
  });
  const topLevel = (d: ts.Node): boolean => {
    if (ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d)) return d.parent === bound;
    if (ts.isVariableDeclaration(d)) return d.parent?.parent?.parent === bound;
    return false;
  };
  const isRequireBinding = (d: ts.Node): boolean => {
    let v: ts.Node | undefined = d;
    while (v && ts.isBindingElement(v)) v = v.parent?.parent;
    return !!v && ts.isVariableDeclaration(v) && !!v.initializer && ts.isCallExpression(v.initializer) && ts.isIdentifier(v.initializer.expression) && v.initializer.expression.text === "require" && v.parent?.parent?.parent === bound;
  };
  const inType = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isExpressionWithTypeArguments(p) && ts.isHeritageClause(p.parent)) return p.parent.token !== ts.SyntaxKind.ExtendsKeyword || !ts.isClassLike(p.parent.parent);
      if (ts.isTypeNode(p)) return true;
      if (ts.isStatement(p) || ts.isExpressionStatement(p)) return false;
    }
    return false;
  };
  const useOf = (id: ts.Identifier): void => {
    const parent = id.parent;
    if (!parent || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent) || ts.isExportSpecifier(parent)) return;
    if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && (parent as ts.PropertyAccessExpression).name === id) return;
    if (ts.isPropertyAssignment(parent) && parent.name === id) return;
    // The name a declaration declares (a variable, a parameter, a function, a property...) is not a use.
    if ((parent as { name?: ts.Node }).name === id) return;
    if (inType(id)) return;
    const sym = checker.getSymbolAtLocation(id);
    const decl = sym?.declarations?.[0];
    if (!decl) return;
    let local = id.text;
    let imp: number | undefined;
    let own = false;
    if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl) || ts.isImportEqualsDeclaration(decl) || isRequireBinding(decl)) {
      imp = importIndex.get(local);
      if (imp === undefined) return;
    } else if (topLevel(decl)) {
      own = true;
      if (ts.isVariableDeclaration(decl) && !(decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer) || ts.isClassExpression(decl.initializer)))) return;
    } else return;
    // What kind of use it is.
    let member: string | undefined;
    let form: RawCall["form"] = "ref";
    let callee: ts.Node = id;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === id) {
      member = parent.name.text;
      callee = parent;
    }
    const cp = callee.parent;
    if (cp && ts.isCallExpression(cp) && cp.expression === callee) form = "call";
    else if (cp && ts.isNewExpression(cp) && cp.expression === callee) form = "new";
    else if (cp && (ts.isJsxOpeningElement(cp) || ts.isJsxSelfClosingElement(cp) || ts.isJsxClosingElement(cp)) && cp.tagName === callee) {
      if (ts.isJsxClosingElement(cp)) return;
      form = "jsx";
    } else if (cp && ts.isExpressionWithTypeArguments(cp) && ts.isHeritageClause(cp.parent)) form = "extends";
    else if (cp && ts.isDecorator(cp)) form = "call";
    out.calls.push({ line: bline(id), local, ...(member ? { member } : {}), form, ...(imp !== undefined ? { imp } : {}), ...(own ? { own: true as const } : {}) });
  };
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) useOf(n);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(bound, walk);
  return out;
}
