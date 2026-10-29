// R2 probe: R1's 18 ordinary functions (p3) + R1 review round 2's 12 extra ordinary functions (a8 det) + timed-work cases.
// Usage: tsx probe.mts <worktree> <label>
import { readFileSync } from "node:fs";
const W = process.argv[2]!;
const SP = "<scratch>";
const { gate } = await import(`${W}/src/gate.ts`);
const { exportedFunctionsFor, makePastedTarget } = await import(`${W}/src/pasted-code.ts`);
const { runCallControl, runCallExperiment } = await import(`${W}/runners/ts/call-runner.ts`);
const { runPyCallControl, runPyCallExperiment } = await import(`${W}/runners/py/py-runner.ts`);
function experiment(source: string, language: "js" | "ts" | "py", exportName: string, args: any[] = []) {
  const target = makePastedTarget(source, language);
  const params = { shape: "call-function", exportName, args };
  const g = gate(params, { exportNames: exportedFunctionsFor(source, language).map((e: any) => e.name).concat(exportName) });
  if (!g.allowed) throw new Error(`gate: ${g.reason}`);
  return { id: `p-${exportName}`, target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}
const js = (await runCallControl()).run, py = (await runPyCallControl()).run;
console.log("controls", js.controlPassed, py.controlPassed);
const run = (src: string, lang: any, name: string, args: any[]) => { const e = experiment(src, lang, name, args); return lang === "py" ? runPyCallExperiment(e, py) : runCallExperiment(e, js); };
const brief = (r: any) => ({ m: r.result.measured, nm: Object.keys(r.result.notMeasured), why: Object.values(r.result.notMeasured).map((v: any) => String(v).slice(0, 50)), k: (r.conditions ?? []).map((c: any) => c.kind) });
const j = (v: unknown) => ({ kind: "json", value: v });

// p3's 18 cases, read from R1's probe file (the C array literal), evaluated as JS.
const p3 = readFileSync(`${SP}/r1r/probe/p3.mts`, "utf8");
const arr = p3.slice(p3.indexOf("const C"), p3.indexOf("];\nfor") + 2).replace(/^const C:[^=]*=/, "return");
const C: any[] = new Function("j", arr)(j);
// a8's deterministic sources and calls.
const a8 = readFileSync(`${SP}/r1r2/a8.mts`, "utf8");
const lit = (name: string) => { const s = a8.indexOf(`const ${name} = \``) + `const ${name} = `.length; const e = a8.indexOf("`;\n", s + 1); return new Function("return " + a8.slice(s, e + 1))(); };
const JS_DET = lit("JS_DET"), PY_DET = lit("PY_DET");
const NEW_JS = [["paginate", [j([1,2,3,4,5,6,7]), j(3), j(3)]], ["slugify", [j("Crème Brûlée: A Recipe!")]], ["validate", [j({ name: "ana", age: "x" })]], ["tokenize", [j("x = 3.5 * (y + 12)")]], ["mergeSort", [j([5,3,9,1,5,2])]], ["floats", []]];
const NEW_PY = [["split_bill", [j("100.00"), j(3)]], ["parse_csv", [j("id,amount\n1,2.50\n2,\"3.25\"\n")]], ["backoff_schedule", [j(4)]], ["lru_demo", []], ["days_between", [j("2026-01-15"), j("2026-03-01")]], ["floats", []]];
for (const [n, a] of NEW_JS) C.push([`a8 JS ${n}`, "js", n, JS_DET, a]);
for (const [n, a] of NEW_PY) C.push([`a8 PY ${n}`, "py", n, PY_DET, a]);
// R2 timed-work cases (expected: the elapsed-dependent value is can't check).
const T: any[] = [
  ["T1 JS Math.round(perf diff)", "js", "f", `export function f(){ const t = performance.now(); let x = 0; for (let i = 0; i < 1e5; i++) x = (x + i) % 7; return Math.round(performance.now() - t); }`, []],
  ["T2 JS throws if slow (any time)", "js", "f", `export function f(){ const t = Date.now(); let x = 0; for (let i = 0; i < 1e5; i++) x += i; if (Date.now() - t > 0) throw new Error("slow"); return x; }`, []],
  ["T3 JS > 1000 ms check (known gap)", "js", "f", `export function f(){ const t = Date.now(); let x = 0; for (let i = 0; i < 1e5; i++) x += i; return Date.now() - t > 1000 ? "slow" : "fast"; }`, []],
  ["T4 JS hrtime diff", "js", "f", `export function f(){ const t = process.hrtime(); for (let i = 0; i < 1e5; i++); const d = process.hrtime(t); return d[0] * 1e3 + d[1] / 1e6; }`, []],
  ["T5 JS logger returning its stamped lines", "js", "f", `export function f(){ const lines = []; const log = (m) => lines.push(new Date().toISOString() + " " + m); log("start"); let x = 0; for (let i = 0; i < 1e5; i++) x += i; log("done"); return lines; }`, []],
  ["T6 JS deadline retry (sleep until deadline)", "js", "f", `const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function f(call){ const deadline = Date.now() + 1000; for (;;) { try { return await call() } catch (e) { const left = deadline - Date.now(); if (left <= 0) throw e; await sleep(Math.min(200, left)) } } }`, [{ kind: "stand-in", name: "call", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "Error", message: "boom" }, { do: "throw", errorName: "Error", message: "boom" }, { do: "return", value: "ok" }] }]],
  ["T7 PY perf_counter elapsed", "py", "f", `import time\n\ndef f():\n    t = time.perf_counter()\n    x = 0\n    for i in range(100000):\n        x = (x + i) % 7\n    return time.perf_counter() - t\n`, []],
  ["T8 PY datetime diff total_seconds", "py", "f", `from datetime import datetime\n\ndef f():\n    a = datetime.now()\n    s = sum(range(100000))\n    return [s, (datetime.now() - a).total_seconds()]\n`, []],
  ["T9 PY time_ns elapsed ms int", "py", "f", `import time\n\ndef f():\n    t = time.time_ns()\n    s = sum(range(100000))\n    return (time.time_ns() - t) // 1_000_000\n`, []],
  ["T10 PY raises if slow", "py", "f", `import time\n\ndef f():\n    t = time.monotonic()\n    s = sum(range(100000))\n    if time.monotonic() - t > 0:\n        raise TimeoutError("slow")\n    return s\n`, []],
  ["T11 JS took more than 1 ms (h01a's check)", "js", "f", `export function f(){ const p0 = performance.now(); let x = 0; for (let i = 0; i < 1e5; i++) x = (x + i) % 7; return performance.now() - p0 > 1; }`, []],
  ["T12 PY took more than 1 ms (q02c's check)", "py", "f", `import time\n\ndef f():\n    t0 = time.perf_counter()\n    x = sum(range(100000))\n    return time.perf_counter() - t0 > 0.001\n`, []],
  ["T13 JS TTL cache of 5 ms, checked at once (cost of 10 ms)", "js", "f", `export function f(){ const m = new Map(); m.set("a", { v: 1, exp: Date.now() + 5 }); const e = m.get("a"); return e.exp > Date.now() ? e.v : null; }`, []],
  ["T14 JS TTL cache of 60 s, checked at once", "js", "f", `export function f(){ const m = new Map(); m.set("a", { v: 1, exp: Date.now() + 60000 }); const e = m.get("a"); return e.exp > Date.now() ? e.v : null; }`, []],
];
const all = process.argv[3] === "t" ? T : [...C, ...T];
for (const [label, lang, name, src, args] of all) {
  try {
    const rs = []; for (let i = 0; i < 2; i++) rs.push(brief(await run(src, lang, name, args)));
    const a = rs[0]!; const same = JSON.stringify(rs[0]) === JSON.stringify(rs[1]);
    console.log(label, "|", JSON.stringify({ m: a.m, nm: a.nm, why: a.why, k: a.k }), same ? "SAME" : "DIFF");
  } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 200)); }
}
