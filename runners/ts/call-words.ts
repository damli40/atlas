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

// ---- R1 (D36): results that depend on something outside the code ----
// Shared by the JavaScript harness and (through request.json) the Python harness, so the same cause gets the
// same words in both languages.

/** Callbacks whose order real Node leaves open (a 0 ms timer and setImmediate; process.nextTick and promises). */
export const TIMER_ORDER_REASON =
  "the code queued callbacks whose order Node leaves open (a 0 ms timer next to setImmediate, or process.nextTick next to promise callbacks, whose order depends on how the call is started), so the order Atlas ran them in is Atlas's choice, not a fact about the code";

/** The call waits only on unref'd timers: a plain Node script would exit first; a program that stays up would not. */
export const UNREF_REASON =
  "the call was waiting only on an unref'd timer, which does not keep a Node process alive: called from a plain script the process would exit before the timer fires, called inside a program that stays up it fires; that depends on the caller, not on the code";

/** The call settled; only unref'd timers were left (whether they run depends on the caller). */
export const UNREF_AFTER_SETTLE_REASON =
  "only unref'd timers were left after the call settled, and they do not keep a Node process alive, so whether they ever run depends on the caller, not on the code";

/** Randomness Atlas cannot pin to its seed (crypto.subtle key generation and randomized signatures). */
export const UNSEEDED_RANDOM_REASON = (what: string) =>
  `the code used ${what}, whose randomness Atlas cannot pin to its seed, so values made from it change on every run`;

/** The sandbox did not have the time zone, locale or seed Atlas pins. */
export const PIN_FAILED_REASON = (what: string) =>
  `Atlas could not pin ${what} in this sandbox, so results that depend on it would be this machine's, not Atlas's pinned ones`;
