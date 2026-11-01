// R3 journey item 1: the third run's source. Adds probes to a JS or TS file so a run can report which of the file's own named
// functions ran and what they returned. Only that third run sees this text; the two sealed runs run the file untouched.
//
// Plain words: parse the file, and add text inside each named function, on the lines it already has (so line numbers hold):
//   function f(a) { body; return x; }  becomes  function f(a) { P(0,id);try{ body; return P(1,id,(x)); P(1,id);}catch(e$){P(2,id);throw e$} }
// P is a global only the third run's harness defines. P(1, id, x) gives back x, so the code gets exactly what it would have.
// Skipped, and why:
// - generators: their body runs in pieces, so "what it returned" is not one thing;
// - getters and setters: reading a property is not a step a reader expects to see;
// - unnamed callbacks: `.map((x) => x * 2)` would bury the story.
// Any behaviour this changes is caught afterwards: the third run must match the sealed runs exactly, or no helper is shown.
// Server only (uses the TypeScript parser).

import ts from "typescript-api";

export interface Instrumented {
  source: string;
  /** Probe id to the function's name. The name comes from here, never from what the run sends back. */
  names: string[];
}

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) => (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []).some((m) => m.kind === kind) : false);

function nameOf(fn: ts.FunctionLikeDeclaration): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null;
  if (ts.isFunctionExpression(fn) && fn.name) return fn.name.text;
  const p = fn.parent;
  if (ts.isMethodDeclaration(fn) || ts.isConstructorDeclaration(fn)) {
    const owner = p && (ts.isClassDeclaration(p) || ts.isClassExpression(p)) ? p.name?.text : null;
    const own = ts.isConstructorDeclaration(fn) ? "constructor" : ts.isIdentifier(fn.name) ? fn.name.text : null;
    return own === null ? null : owner ? `${owner}.${own}` : own;
  }
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (ts.isPropertyDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

const isGenerator = (fn: ts.FunctionLikeDeclaration) => fn.asteriskToken !== undefined;
const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);

/** Null when the file does not parse cleanly: no probes, no third run. */
export function instrumentJs(source: string, language: "js" | "ts", probe: string): Instrumented | null {
  const sf = ts.createSourceFile(language === "ts" ? "f.ts" : "f.js", source, ts.ScriptTarget.ESNext, true, language === "ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const diagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) return null;
  const splices: { at: number; text: string }[] = [];
  const names: string[] = [];
  const P = probe;
  const instrument = (fn: ts.FunctionLikeDeclaration) => {
    if (!fn.body || isGenerator(fn) || ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) return;
    const name = nameOf(fn);
    if (name === null) return;
    const id = names.length;
    names.push(name);
    const isAsync = hasModifier(fn, ts.SyntaxKind.AsyncKeyword);
    const enter = isAsync ? 3 : 0;
    if (!ts.isBlock(fn.body)) {
      // A concise arrow: the value is the whole body.
      splices.push({ at: fn.body.getStart(sf), text: `${P}(1,${id},(${P}(${enter},${id}),(` });
      splices.push({ at: fn.body.getEnd(), text: `)))` });
      return;
    }
    const stmts = fn.body.statements;
    let firstAfterDirectives = 0;
    while (firstAfterDirectives < stmts.length && ts.isExpressionStatement(stmts[firstAfterDirectives]!) && ts.isStringLiteral((stmts[firstAfterDirectives] as ts.ExpressionStatement).expression)) firstAfterDirectives++;
    const start = firstAfterDirectives > 0 ? stmts[firstAfterDirectives - 1]!.getEnd() : fn.body.getStart(sf) + 1;
    splices.push({ at: start, text: `${P}(${enter},${id});try{` });
    splices.push({ at: fn.body.getEnd() - 1, text: `${P}(1,${id});}catch(e$${id}){${P}(2,${id});throw e$${id}}` });
    const returns = (n: ts.Node): void => {
      if (isFunctionLike(n) || ts.isClassLike(n)) return;
      if (ts.isReturnStatement(n)) {
        if (n.expression) {
          splices.push({ at: n.expression.getStart(sf), text: `${P}(1,${id},(` });
          splices.push({ at: n.expression.getEnd(), text: `))` });
        } else {
          splices.push({ at: n.getStart(sf) + "return".length, text: ` ${P}(1,${id})` });
        }
        return;
      }
      ts.forEachChild(n, returns);
    };
    // A return's own expression can hold a nested function, which instrument reaches on its own: nothing to do here.
    ts.forEachChild(fn.body, returns);
  };
  const walk = (n: ts.Node): void => {
    if (isFunctionLike(n)) instrument(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  // Later text first, so earlier positions stay right. At one position, the closing text goes before the opening text.
  const order = splices.map((s, i) => ({ ...s, i })).sort((a, b) => b.at - a.at || b.i - a.i);
  let out = source;
  for (const s of order) out = out.slice(0, s.at) + s.text + out.slice(s.at);
  return { source: out, names };
}
