// The sentences Atlas shows when it will not report anything from a "call-function" run (whole-run can't check).
//
// Plain words: these few sentences are written in two places, by plain code: on the server, when Atlas reads
// pasted code before running it (src/pasted-code.ts), and inside the sandbox, when the code tries something at
// run time (runners/ts/call-harness.ts). Both read them from this one file, so the same cause always gets the
// same words. This file imports nothing: the sandbox copies it in next to the worker.

/** Node's built-in module names (as of Node 25), so "fs" is called a built-in module, not a package. */
const NODE_BUILTINS = [
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel", "dns",
  "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "sea", "sqlite", "stream", "string_decoder", "sys", "test", "timers", "tls", "trace_events", "tty",
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
];

/** What Atlas says when the module name is not a plain string in the code. */
export const NAMED_AT_RUN_TIME = "a module named at run time";

/** "lodash", or "Node's built-in module fs". Long or odd names are cut, never echoed whole. */
export function describeModule(specifier: string): string {
  if (specifier === NAMED_AT_RUN_TIME) return specifier;
  const s = specifier.length > 80 ? `${specifier.slice(0, 79)}…` : specifier;
  const bare = s.startsWith("node:") ? s.slice(5) : s;
  const head = bare.split("/")[0] ?? bare;
  return NODE_BUILTINS.indexOf(head) !== -1 ? `Node's built-in module ${bare}` : s;
}

/** D24: the code loads other code (import / require / dynamic import / process.getBuiltinModule). */
export const needsPackageReason = (specifier: string) =>
  `the code needs ${describeModule(specifier)}; Atlas runs one pasted file on its own, with no packages or other modules`;

export const COMMONJS_REASON = (line: number) =>
  `the code uses CommonJS exports (module.exports or exports.x, line ${line}); Atlas runs the file as an ES module, so write \`export function name(...)\``;

/** The sandbox refused a file, network or process access (Node's ERR_ACCESS_DENIED), or the code reached for one. */
export const ACCESS_REASON = (what: string) => `the code tried to use the network/files (${what}), which Atlas does not allow`;

export const CODEGEN_REASON = (what: string) => `the code tried to run code made from text (${what}), which Atlas does not allow`;

export const PROCESS_REASON = (what: string) => `the code tried to end or control the process (${what}), which Atlas does not allow`;

export const INTERNALS_REASON = (what: string) => `the code tried to reach Node's internals (${what}), which Atlas does not allow`;

export const BLOCKING_REASON = "the code blocked the thread with Atomics.wait, which waits in real time that Atlas's virtual clock does not control";

export const REAL_TIME_REASON = (what: string) =>
  `the code waits on ${what}, which finishes in real time that Atlas's virtual clock does not control`;

export const LOAD_TIMER_REASON =
  "the code starts a timer while it is being loaded; Atlas runs one call on a virtual clock and does not run timers started before the call, so how the call ends could differ from a real run";

export const UNCAUGHT_REASON = (what: string) =>
  `something the code started failed with nobody catching it (${what}); a real Node process stops there, so Atlas does not report how the call ended`;

export const missingExportReason = (name: string) => `the code has no export named "${name}"`;
export const notAFunctionReason = (name: string, type: string) => `"${name}" is exported but is not a function (it is ${type})`;
