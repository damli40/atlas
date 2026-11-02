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
import { emptyCallFacts, type BodyFacts, type CallFacts, type ThrowSite } from "./types";
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
  form: "call" | "new" | "jsx" | "extends" | "ref" | "export";
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
  /** R3: calls with their names resolved by real scope. */
  callFacts?: CallFacts;
  /** D65 review R5: what each top-level function's own body holds. */
  bodies?: Record<string, BodyFacts>;
  throwsInFile?: ThrowSite[];
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
        const wrapped = wrappedFn(init);
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          addSymbol({ name, kind: "function", exported, lineStart: startLine(head), lineEnd: endLine(head), ...fnInfo(init, head) });
        } else if (wrapped) {
          // `export const f = memo((x) => ...)`: a call that wraps one function written right there. What you call is that function, as far as the file shows.
          addSymbol({ name, kind: "function", exported, lineStart: startLine(head), lineEnd: endLine(head), ...fnInfo(wrapped, head) });
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
  const inExportFooter = (id: ts.Node): boolean => {
    for (let p: ts.Node | undefined = id.parent; p && p !== bound; p = p.parent) {
      if (ts.isFunctionLike(p) || ts.isClassLike(p)) return false;
      if (ts.isExportAssignment(p)) return true;
      if (ts.isExpressionStatement(p) && p.parent === bound && ts.isBinaryExpression(p.expression) && p.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = p.expression.left.getText(bound).replace(/\s+/g, "");
        return lhs === "module.exports" || /^(?:module\.)?exports\.[A-Za-z_$][\w$]*$/.test(lhs);
      }
    }
    return false;
  };
  // Review round 3 (R3-B1): a loader plain code does not follow (createRequire, `require` used as a value, require of a
  // computed name) is recorded as a dynamic import, so Atlas never says it found no link.
  const loaderUse = (id: ts.Identifier): boolean => {
    const parent = id.parent;
    if (id.text === "createRequire" && parent && ts.isCallExpression(parent) && parent.expression === id) return true;
    if (id.text === "require" && !(parent && ts.isCallExpression(parent) && parent.expression === id && parent.arguments.length === 1 && strOf(parent.arguments[0]) !== undefined)) return true;
    return false;
  };
  const useOf = (id: ts.Identifier): void => {
    const parent = id.parent;
    if (!parent || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent) || ts.isExportSpecifier(parent)) return;
    if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && (parent as ts.PropertyAccessExpression).name === id) return;
    if (ts.isPropertyAssignment(parent) && parent.name === id) return;
    // The name a declaration declares (a variable, a parameter, a function, a property...) is not a use.
    if ((parent as { name?: ts.Node }).name === id) return;
    if (loaderUse(id)) {
      out.imports.push({ line: bline(id), specifier: "<computed>", kind: "dynamic", names: [], computed: true });
      return;
    }
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
    // Review round 3 (R3-B2): a name inside an export statement or footer (`export default x`, `export = x`,
    // `module.exports = …`, `exports.x = …`) is an export, like an import line: it links only a part holding the
    // whole file. A name inside a function written in that footer is that function's own use.
    if (inExportFooter(id)) form = "export";
    // `export const f = memo((x) => …)`: memo runs once, when the file loads. f never calls it, so the wrapper call is no join of f's.
    if (cp && ts.isCallExpression(cp) && wrappedFn(cp) !== null && ts.isVariableDeclaration(cp.parent) && cp.parent.initializer === cp) return;
    out.calls.push({ line: bline(id), local, ...(member ? { member } : {}), form, ...(imp !== undefined ? { imp } : {}), ...(own ? { own: true as const } : {}) });
  };
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) useOf(n);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(bound, walk);
  out.callFacts = callFactsOf(bound, checker);
  out.bodies = bodiesOf(bound);
  out.throwsInFile = throwsInFileJs(bound);
  return out;
}

/** D65 review R5: each top-level function's own body, from the tree. A regex, a method called `.throw()`, a `{ throw: 1 }` and a callback's `return` are not this function's. */
function bodiesOf(sf: ts.SourceFile): Record<string, BodyFacts> {
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const endOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
  const out: Record<string, BodyFacts> = {};
  const read = (name: string, fn: ts.FunctionLikeDeclaration) => {
    const body = fn.body;
    if (!body) return;
    const facts: BodyFacts = { loops: [], throws: [], returns: [], nested: [] };
    if (!ts.isBlock(body)) facts.returns.push(lineOf(body));
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionLike(n) || ts.isClassLike(n)) {
        facts.nested.push([lineOf(n), endOf(n)]);
        return;
      }
      if (ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) facts.loops.push(lineOf(n));
      else if (ts.isReturnStatement(n)) facts.returns.push(lineOf(n));
      else if (ts.isThrowStatement(n)) facts.throws.push(throwSite(n, lineOf(n)));
      ts.forEachChild(n, visit);
    };
    // An arrow's body can be an expression, and that expression can be another function: then what is inside it is that function's, not this one's.
    if (ts.isBlock(body)) ts.forEachChild(body, visit);
    else visit(body);
    out[name] = facts;
  };
  const throwSite = (n: ts.ThrowStatement, line: number): ThrowSite => {
    const e = n.expression;
    if (!e || !ts.isNewExpression(e) || !ts.isIdentifier(e.expression)) return { line };
    const a = e.arguments?.[0];
    if (a && ts.isStringLiteralLike(a)) return { line, name: e.expression.text, message: a.text, exact: true };
    if (a && ts.isTemplateExpression(a)) return { line, name: e.expression.text, message: a.head.text, exact: false };
    return { line };
  };
  const isFnValue = (e: ts.Node | undefined): e is ts.ArrowFunction | ts.FunctionExpression => !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st)) read(st.name?.text ?? "default", st);
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && (isFnValue(d.initializer) || wrappedFn(d.initializer))) read(d.name.text, isFnValue(d.initializer) ? d.initializer : wrappedFn(d.initializer)!);
    }
    else if (ts.isExportAssignment(st) && isFnValue(st.expression)) read("default", st.expression);
  }
  return out;
}

/**
 * Every place in the file that could produce an error, with what it can be read to produce: each `throw` (nested functions and class methods too),
 * and each `new XError("text")` not thrown on the spot (it may be returned, rejected or thrown later). The rule for placing a run's end counts these.
 */
export function throwsInFileJs(sf: ts.SourceFile): ThrowSite[] {
  const out: ThrowSite[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const read = (e: ts.Expression | undefined, line: number): ThrowSite => {
    if (!e || !ts.isNewExpression(e) || !ts.isIdentifier(e.expression)) return { line };
    const a = e.arguments?.[0];
    if (a && ts.isStringLiteralLike(a)) return { line, name: e.expression.text, message: a.text, exact: true };
    if (a && ts.isTemplateExpression(a)) return { line, name: e.expression.text, message: a.head.text, exact: false };
    return { line, name: e.expression.text };
  };
  const visit = (n: ts.Node): void => {
    if (ts.isThrowStatement(n)) {
      out.push(read(n.expression, lineOf(n)));
      if (n.expression && ts.isNewExpression(n.expression)) {
        for (const a of n.expression.arguments ?? []) visit(a);
        return;
      }
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && /(?:Error|Exception)$/.test(n.expression.text)) out.push(read(n, lineOf(n)));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The libraries whose memo, debounce, forwardRef and friends are the ones the allow-list means. */
const KNOWN_SOURCES = /^(?:react|react-dom|preact(?:\/compat)?|lodash(?:-es)?(?:\/[\w.-]+)?|lodash\.[\w-]+|underscore|ramda|memoize-one|throttle-debounce)$/;
const bindings = new WeakMap<ts.SourceFile, Map<string, "local" | "known" | "elsewhere">>();
/** How the file binds a top-level name: declared in the file, imported from a known library, imported from elsewhere, or not at all (undefined). */
function bindingOf(sf: ts.SourceFile, name: string): "local" | "known" | "elsewhere" | undefined {
  let m = bindings.get(sf);
  if (!m) {
    m = new Map();
    const local = (n: ts.Node | undefined) => {
      if (!n) return;
      if (ts.isIdentifier(n)) m!.set(n.text, "local");
      else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const el of n.elements) if (!ts.isOmittedExpression(el)) local(el.name);
    };
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const how = KNOWN_SOURCES.test(st.moduleSpecifier.text) ? "known" : "elsewhere";
        const c = st.importClause;
        if (c?.name) m.set(c.name.text, how);
        const nb = c?.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) m.set(nb.name.text, how);
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) m.set(el.name.text, how);
      } else if (ts.isImportEqualsDeclaration(st)) m.set(st.name.text, "elsewhere");
      else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) local(st.name);
      else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
        // `const debounce = require("lodash.debounce")` counts as known; any other value is the file's own.
        const r = d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === "require" && d.initializer.arguments[0] && ts.isStringLiteral(d.initializer.arguments[0]) ? d.initializer.arguments[0].text : null;
        if (r !== null && ts.isIdentifier(d.name)) m.set(d.name.text, KNOWN_SOURCES.test(r) ? "known" : "elsewhere");
        else local(d.name);
      }
    }
    bindings.set(sf, m);
  }
  return m.get(name);
}

/** Calls known to give back a function: memoizing, rate-limiting and once-only wrappers, and React's own. */
const FN_WRAPPERS = new Set(["memo", "memoize", "debounce", "throttle", "once", "cache", "useCallback", "forwardRef", "React.memo", "React.forwardRef", "React.useCallback", "_.memoize", "_.debounce", "_.throttle", "_.once"]);

/** The one function written inline as an argument of a call, for a const made by wrapping it. More than one, or none: null. */
function wrappedFn(e: ts.Node | undefined): ts.ArrowFunction | ts.FunctionExpression | null {
  if (!e || !ts.isCallExpression(e)) return null;
  // Only wrappers known to give back a function. Any other call (`run(() => 42)`, `nums.map(...)`, a timer) may give back anything: no part is drawn.
  // A miss is fine; a false part is not.
  const callee = e.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? `${callee.expression.text}.${callee.name.text}` : null;
  if (name === null || !(FN_WRAPPERS.has(name) || /^with[A-Z]\w*$/.test(name))) return null;
  // The list is of names as the usual libraries mean them. The file's own `memo` could do anything: a name the file declares, or imports from
  // anywhere but those libraries, is not trusted.
  const bound = bindingOf(e.getSourceFile(), name.split(".")[0]!);
  if (bound === "local" || bound === "elsewhere") return null;
  const fns = e.arguments.filter((a): a is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
  return fns.length === 1 ? fns[0]! : null;
}

/** R3: the file's calls, resolved by the binder. See CallFacts. A name a function binds for itself is never the outside thing. */
function callFactsOf(sf: ts.SourceFile, checker: ts.TypeChecker): CallFacts {
  const facts = emptyCallFacts();
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
  /** A part-level function: top-level, a top-level const's function, or a top-level class's method. Its name is the part's. */
  const partNameOf = (f: ts.Node): string | null => {
    if (ts.isFunctionDeclaration(f) && f.parent === sf) return f.name?.text ?? "default";
    if ((ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && ts.isVariableDeclaration(f.parent) && f.parent.parent?.parent?.parent === sf && ts.isIdentifier(f.parent.name)) return f.parent.name.text;
    if ((ts.isMethodDeclaration(f) || ts.isConstructorDeclaration(f) || ts.isGetAccessorDeclaration(f) || ts.isSetAccessorDeclaration(f)) && ts.isClassDeclaration(f.parent) && f.parent.parent === sf) return f.parent.name?.text ?? "default";
    return null;
  };
  const enclosingFn = (n: ts.Node): ts.Node | null => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (isFn(p)) return p;
    return null;
  };
  // Which names are ever used (a nested function nobody refers to never runs), and which parameters are ever assigned.
  const used = new Map<ts.Symbol, number>();
  const assigned = new Set<ts.Symbol>();
  // Any way a name is written makes it unsure: `x = …`, `[x] = …`, `({x} = …)`, `for (x of …)`. A name nothing binds counts too.
  const rewrittenFree = new Set<string>();
  const writesTo = (t: ts.Node): void => {
    if (ts.isIdentifier(t)) {
      const s = checker.getSymbolAtLocation(t);
      if (s) assigned.add(s);
      else rewrittenFree.add(t.text);
    } else if (ts.isArrayLiteralExpression(t)) t.elements.forEach(writesTo);
    else if (ts.isObjectLiteralExpression(t)) {
      for (const p of t.properties) {
        if (ts.isShorthandPropertyAssignment(p)) {
          const v = checker.getShorthandAssignmentValueSymbol(p);
          if (v) assigned.add(v);
          else rewrittenFree.add(p.name.text);
        }
        else if (ts.isPropertyAssignment(p)) writesTo(p.initializer);
        else if (ts.isSpreadAssignment(p)) writesTo(p.expression);
      }
    } else if (ts.isSpreadElement(t)) writesTo(t.expression);
    else if (ts.isParenthesizedExpression(t)) writesTo(t.expression);
    else if (ts.isBinaryExpression(t) && t.operatorToken.kind === ts.SyntaxKind.EqualsToken) writesTo(t.left);
  };
  const count = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const s = checker.getSymbolAtLocation(n);
      const isDeclName = (n.parent as { name?: ts.Node } | undefined)?.name === n && !ts.isPropertyAccessExpression(n.parent);
      if (s && !isDeclName) used.set(s, (used.get(s) ?? 0) + 1);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) writesTo(n.left);
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) writesTo(n.initializer);
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
      const s = checker.getSymbolAtLocation(n.operand);
      if (s) assigned.add(s);
    }
    ts.forEachChild(n, count);
  };
  count(sf);
  /** False when the call sits in a nested named function nothing refers to, so it can never run from here. */
  const reachable = (n: ts.Node): boolean => {
    for (let f = enclosingFn(n); f; f = enclosingFn(f)) {
      if (partNameOf(f) !== null) return true;
      const nameNode = ts.isFunctionDeclaration(f) ? f.name : (ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && ts.isVariableDeclaration(f.parent) ? f.parent.name : undefined;
      if (nameNode && ts.isIdentifier(nameNode)) {
        const s = checker.getSymbolAtLocation(nameNode);
        if (s && !used.get(s)) return false;
      }
    }
    return true;
  };
  const paramOf = (id: ts.Identifier): { fn: string; index: number } | null => {
    const s = checker.getSymbolAtLocation(id);
    const d = s?.declarations?.[0];
    if (!s || !d || !ts.isParameter(d) || assigned.has(s) || !ts.isIdentifier(d.name)) return null;
    const fn = partNameOf(d.parent);
    if (fn === null) return null;
    const list = d.parent.parameters.filter((p) => !(ts.isIdentifier(p.name) && p.name.text === "this"));
    return { fn, index: list.indexOf(d) };
  };
  const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);
  const unbound = (id: ts.Identifier) => !checker.getSymbolAtLocation(id)?.declarations?.length;
  const ownFunction = (id: ts.Identifier): string | null => {
    const d = checker.getSymbolAtLocation(id)?.declarations?.[0];
    if (!d) return null;
    if (ts.isFunctionDeclaration(d) && d.parent === sf) return id.text;
    if (ts.isVariableDeclaration(d) && d.parent?.parent?.parent === sf && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return id.text;
    return null;
  };
  /** Through brackets and type assertions, to what a value really flows into. */
  const outer = (n: ts.Node): ts.Node => {
    let p = n.parent;
    while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isSatisfiesExpression(p))) p = p.parent;
    return p;
  };
  const timerResolves = (fn: ts.Node, resolver: ts.Symbol): boolean => {
    let found = false;
    const look = (n: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "setTimeout" && unbound(n.expression)) {
        const a = n.arguments[0];
        if (a && ts.isIdentifier(a) && checker.getSymbolAtLocation(a) === resolver) found = true;
        if (a && (ts.isArrowFunction(a) || ts.isFunctionExpression(a))) {
          const calls = (m: ts.Node): void => {
            if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && checker.getSymbolAtLocation(m.expression) === resolver) found = true;
            ts.forEachChild(m, calls);
          };
          calls(a.body);
        }
      }
      ts.forEachChild(n, look);
    };
    look(fn);
    return found;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      let callee: ts.Expression = n.expression;
      // `f.call(…)`, `f.apply(…)` are calls of f.
      if (ts.isPropertyAccessExpression(callee) && (callee.name.text === "call" || callee.name.text === "apply") && ts.isIdentifier(callee.expression)) callee = callee.expression;
      if (ts.isIdentifier(callee)) {
        const line = lineOf(n);
        if (unbound(callee)) {
          if (reachable(n) && !rewrittenFree.has(callee.text)) facts.freeCalls.push({ name: callee.text, line });
        } else {
          const p = paramOf(callee);
          if (p && p.index >= 0 && reachable(n)) facts.paramCalls.push({ ...p, line });
          const to = ownFunction(callee);
          if (to && reachable(n)) {
            n.arguments.forEach((a, toIndex) => {
              if (!ts.isIdentifier(a)) return;
              const q = paramOf(a);
              if (q && q.index >= 0) facts.handoffs.push({ ...q, to, toIndex, line });
            });
          }
        }
      } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && GLOBAL_OBJECTS.has(callee.expression.text)) {
        const d = checker.getSymbolAtLocation(callee.expression)?.declarations?.[0];
        if ((!d || d.getSourceFile() !== sf) && reachable(n)) facts.freeCalls.push({ name: callee.name.text, line: lineOf(n) });
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Promise" && unbound(n.expression)) {
      const cb = n.arguments?.[0];
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters[0] && ts.isIdentifier(cb.parameters[0].name)) {
        const resolver = checker.getSymbolAtLocation(cb.parameters[0].name);
        const host = enclosingFn(n);
        const flows = outer(n);
        // The promise is waited on, or handed back to whoever waits; and it is the part's own function doing it.
        const awaited = !!flows && (ts.isAwaitExpression(flows) || ts.isReturnStatement(flows) || (ts.isArrowFunction(flows) && flows.body !== undefined && flows === host));
        if (resolver && host && partNameOf(host) !== null && awaited && timerResolves(cb, resolver)) facts.waits.push({ line: lineOf(n) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return facts;
}
