// X3 (D28): common-failure labels for an explorer part or a pasted function. Plain code only.
//
// Plain words. Some kinds of code tend to fail in known ways: a retry loop can hammer a provider that is down; a
// network call can wait forever; two tasks can overwrite each other's update. CURATED below is Atlas's short list:
// each kind of code, the failures it is known for, and for some of them a "marker", a concrete thing plain code can
// look for in the code's own lines.
//
// THE RULE (X3 review round 1): precision over coverage. A label may say "found in this code" or "reproduced" only
// when that is very likely true. Everything else stays "common pattern". Missing a real failure is acceptable; a false
// claim is not. A marker that could not be made precise was removed (its failure is always "common pattern").
//
// Every failure shown gets exactly one label, decided here and nowhere else:
// - "reproduced": the marker matched AND a sealed Atlas run of the function showed the failure through the stand-in
//   that was passed exactly where the marked loop makes its call. The label links to that run's proof card.
// - "inconclusive": the marker matched and such a run was tried, but it cannot show the failure: it came back
//   "can't check", Atlas stopped watching first ("still running at the watch limit" is never proof), another stand-in
//   could also be the cause, or the code hands the call an abort signal or timeout that Atlas's stand-ins ignore.
// - "found in this code": the marker matched in the code's own lines. The label links to those lines.
// - "common pattern": nothing above. Only the curated list says this kind of code often fails this way.
//
// Which kinds apply: plain code's own sign for the kind, or, for an explorer part, Muse Wonder's pattern tag (X1).
// Wonder may suggest a kind; it never decides a label.
//
// How the code is read: comments are blanked out first; for most checks, string contents too. It is a reading of
// text, not a parser. The scan is linear in the code's size (one pass to blank, one pass to pair brackets, counts per
// line kept as running totals) and capped (MAX_LOOPS loop heads, bodies over MAX_BODY_LINES are not read as retries),
// so a large or odd file costs milliseconds, and what the cap skips stays "common pattern".

import type { ArgSpec, ExperimentShape, Run, StandInStep } from "./types";
import { fileLines } from "./words";

export type FailureLabelKind = "common pattern" | "found in this code" | "reproduced" | "inconclusive";
export type Lang = "js" | "ts" | "py";

export interface LineRef {
  path: string;
  lineStart: number;
  lineEnd: number;
}

/** A run of a function, from a sealed round whose proof card exists. */
export interface RunEvidence {
  runId: string;
  params: Extract<ExperimentShape, { shape: "call-function" }>;
  run: Pick<Run, "id" | "controlPassed" | "result">;
  /** The file the run's code came from (explorer parts), when known. */
  path?: string;
}

/** A top-level function inside the lines read: where it is and its parameter names (null: not a plain name). */
export interface FunctionInfo {
  path: string;
  name: string;
  lineStart: number;
  lineEnd: number;
  params: (string | null)[];
}

/** Blanks comments (and, unless keepStrings, string contents) with spaces, keeping every line's length and line breaks. */
export function maskSource(text: string, lang: Lang, keepStrings = false): string {
  const out = text.split("");
  const blank = (i: number) => {
    if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (lang === "py") {
      if (c === "#") {
        while (i < n && text[i] !== "\n") blank(i++);
        continue;
      }
      // String prefixes (r, b, f, u, rb ...) are plain letters before the quote; the quote starts the string.
      if (c === '"' || c === "'") {
        const triple = text.startsWith(c.repeat(3), i);
        const q = triple ? c.repeat(3) : c;
        i += q.length;
        while (i < n && !text.startsWith(q, i)) {
          if (text[i] === "\\") {
            if (!keepStrings) blank(i);
            i++;
          }
          if (!triple && text[i] === "\n") break;
          if (i < n && !keepStrings) blank(i);
          i++;
        }
        i += q.length;
        continue;
      }
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") blank(i++);
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      blank(i++);
      blank(i++);
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) blank(i++);
      if (i < n) {
        blank(i++);
        blank(i++);
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < n && text[i] !== c) {
        if (text[i] === "\\") {
          if (!keepStrings) blank(i);
          i++;
        }
        if (c !== "`" && text[i] === "\n") break;
        if (i < n && !keepStrings) blank(i);
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}

// ---------- reading one span: linear passes ----------

/** Loop heads read per scan, and the largest loop body (lines) read as a possible retry. Past either: not a retry. */
export const MAX_LOOPS = 2_000;
export const MAX_BODY_LINES = 300;
/** A try block or catch block longer than this is not read for its call (not a retry). */
const MAX_BLOCK_LINES = 120;

interface Line {
  path: string;
  line: number;
  /** Comments and string contents blanked. */
  code: string;
  /** Comments blanked, strings kept. */
  ws: string;
  indent: number;
}

/** A loop plain code read as a retry: its catch / except path goes round to the same call again. */
export interface RetryLoop {
  at: LineRef;
  /** The call the try block makes (dotted name as written), its line, and its argument text (code view). */
  callee: string | null;
  calleeLine: number | null;
  calleeArgs: string;
  /** No sleep / setTimeout / delay / wait / backoff in the loop, and the catch path calls nothing but logging. */
  noWait: boolean;
}

interface SpanScan {
  path: string;
  lines: Line[];
  /** Joined code view (lines joined by "\n") and each line's offset in it. */
  text: string;
  starts: number[];
  /** close[i] = index of the bracket that closes the one opened at i (for "(", "{", "["), else -1. */
  close: Int32Array;
  retries: RetryLoop[];
  /** Loop heads past MAX_LOOPS (not read). */
  skippedLoops: number;
}

const lineIndexOf = (s: { starts: number[] }, offset: number): number => {
  let lo = 0;
  let hi = s.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

function pairBrackets(text: string): Int32Array {
  const close = new Int32Array(text.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 40 || c === 123 || c === 91) stack.push(i);
    else if (c === 41 || c === 125 || c === 93) {
      const o = stack.pop();
      if (o !== undefined) close[o] = i;
    }
  }
  return close;
}

/** Running totals of lines matching `re` (view), so "does any line in [a, b] match" costs O(1). */
function prefixOf(lines: Line[], re: RegExp, view: "code" | "ws" = "code"): Int32Array {
  const p = new Int32Array(lines.length + 1);
  for (let i = 0; i < lines.length; i++) p[i + 1] = p[i]! + (re.test(lines[i]![view]) ? 1 : 0);
  return p;
}
const countIn = (p: Int32Array, a: number, b: number) => (b < a ? 0 : p[b + 1]! - p[a]!);

const JS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "await", "typeof", "new", "do", "else", "try", "throw", "yield", "void", "delete", "in", "of", "super", "import"]);
const PY_KEYWORDS = new Set(["if", "for", "while", "return", "await", "not", "and", "or", "in", "with", "lambda", "yield", "elif", "else", "try", "except", "raise", "assert", "del", "print", "isinstance", "len", "str", "int", "float", "range", "list", "dict", "set", "tuple"]);
/** Calls that never wait: logging and collecting. A catch path that calls anything else may be waiting. */
const HARMLESS_CALL = /^(console\.\w+|print|log|logger\.\w+|logging\.\w+|log\.\w+|warn|\w+\.(push|append|add)|String|Number|str|repr|JSON\.stringify)$/;
/** A wait between tries. */
const WAIT = /\b(sleep|setTimeout|delay|wait|pause|backoff\w*|wait_exponential)\b|asyncio\.sleep\b|time\.sleep\b/;
/** A deadline or timeout anywhere: a timeout/deadline name or keyword argument, an abort signal, a race, a clock read. */
const DEADLINE = /\b(deadline\w*|timeout\w*|Timeout|timeouts|signal|AbortSignal|AbortController|wait_for|perf_counter|monotonic|elapsed\w*|expiresAt|expires_at|stop_after_delay|max_time)\b|Promise\.race\b|asyncio\.timeout\b|Date\.now\b|performance\.now\b|time\.time\b/;
const CATCH_JS = /\bcatch\b/;

/** The calls in a piece of code view, in order: dotted name, its "(" offset (in `text`), whether awaited. */
function callsIn(text: string, from: number, to: number, lang: Lang): { name: string; open: number; awaited: boolean }[] {
  const out: { name: string; open: number; awaited: boolean }[] = [];
  const re = /(await\s+)?(new\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
  re.lastIndex = from;
  const kw = lang === "py" ? PY_KEYWORDS : JS_KEYWORDS;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    const before = text[m.index - 1];
    if (before && /[\w$.]/.test(before)) continue;
    const name = m[3]!.replace(/\s+/g, "");
    if (m[2] || kw.has(name.split(".")[0]!)) continue;
    out.push({ name, open: m.index + m[0].length - 1, awaited: !!m[1] });
  }
  return out;
}

export function scanSpan(path: string, fileText: string, lang: Lang, lineStart: number, lineEnd: number, params: readonly string[] = []): SpanScan {
  const code = maskSource(fileText, lang).split("\n");
  const ws = maskSource(fileText, lang, true).split("\n");
  const lines: Line[] = [];
  for (let l = Math.max(1, lineStart); l <= Math.min(lineEnd, code.length); l++) {
    const c = (code[l - 1] ?? "").replace(/\r$/, "");
    lines.push({ path, line: l, code: c, ws: (ws[l - 1] ?? "").replace(/\r$/, ""), indent: c.length - c.trimStart().length });
  }
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.code.length + 1;
  }
  const text = lines.map((l) => l.code).join("\n");
  const close = pairBrackets(text);
  const s: SpanScan = { path, lines, text, starts, close, retries: [], skippedLoops: 0 };
  const waitP = prefixOf(lines, WAIT);
  const ref = (a: number, b: number): LineRef => ({ path, lineStart: lines[a]!.line, lineEnd: lines[b]!.line });
  const pickCall = (calls: ReturnType<typeof callsIn>) => calls.find((x) => params.includes(x.name)) ?? calls.find((x) => x.awaited) ?? calls[0];
  const argsOf = (open: number) => (close[open]! > open ? text.slice(open + 1, close[open]!) : "");
  const harmlessOnly = (calls: ReturnType<typeof callsIn>) => calls.every((x) => HARMLESS_CALL.test(x.name));
  let heads = 0;

  if (lang === "py") {
    // Block ends from indentation, in one pass with a stack of open blocks.
    const end = new Int32Array(lines.length).fill(-1);
    const stack: number[] = [];
    let lastNonBlank = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.code.trim() === "") continue;
      while (stack.length && lines[stack[stack.length - 1]!]!.indent >= lines[i]!.indent) end[stack.pop()!] = lastNonBlank;
      if (/:\s*$/.test(lines[i]!.code)) stack.push(i);
      lastNonBlank = i;
    }
    while (stack.length) end[stack.pop()!] = lastNonBlank;
    // The next "try:" line at or after each line (so a loop finds its try in O(1)).
    const nextTry = new Int32Array(lines.length + 1).fill(-1);
    for (let i = lines.length - 1; i >= 0; i--) nextTry[i] = /^\s*try\s*:/.test(lines[i]!.code) ? i : nextTry[i + 1]!;
    for (let i = 0; i < lines.length; i++) {
      const head = /^\s*(?:async\s+)?(while|for)\b(.*):\s*$/.exec(lines[i]!.code);
      if (!head) continue;
      if (++heads > MAX_LOOPS) {
        s.skippedLoops++;
        continue;
      }
      const e = end[i]!;
      if (e <= i || e - i > MAX_BODY_LINES) continue;
      let loopVar: string | null = null;
      if (head[1] === "for") {
        const f = /^\s*(\w+)\s+in\s+range\s*\((.*)\)\s*$/.exec(head[2]!);
        if (!f || /\blen\s*\(/.test(f[2]!)) continue; // a loop over items, not a retry
        loopVar = f[1]!;
      }
      const t = nextTry[i + 1]!;
      if (t < 0 || t > e) continue;
      const tEnd = end[t]!;
      if (tEnd <= t || tEnd - t > MAX_BLOCK_LINES) continue;
      const ex = tEnd + 1;
      if (ex > e || !/^\s*except\b/.test(lines[ex]!.code) || lines[ex]!.indent !== lines[t]!.indent) continue;
      const exEnd = end[ex]!;
      if (exEnd <= ex || exEnd - ex > MAX_BLOCK_LINES) continue;
      if (/^\s*(raise|return|break)\b/.test(lines[ex + 1]!.code)) continue; // the except path does not go round
      if (loopVar && new RegExp(`\\[\\s*${loopVar}\\s*\\]`).test(text.slice(starts[i]!, starts[e]! + lines[e]!.code.length))) continue;
      const tryCalls = callsIn(text, starts[t + 1]!, starts[tEnd]! + lines[tEnd]!.code.length, lang);
      const call = pickCall(tryCalls);
      if (!call) continue;
      const exCalls = callsIn(text, starts[ex + 1]!, starts[exEnd]! + lines[exEnd]!.code.length, lang);
      s.retries.push({ at: ref(i, e), callee: call.name, calleeLine: lines[lineIndexOf(s, call.open)]!.line, calleeArgs: argsOf(call.open), noWait: countIn(waitP, i, e) === 0 && harmlessOnly(exCalls) });
    }
    return s;
  }

  // JS / TS. The next line holding "try" / "catch" at or after each line.
  const nextOf = (re: RegExp) => {
    const n = new Int32Array(lines.length + 1).fill(-1);
    for (let i = lines.length - 1; i >= 0; i--) n[i] = re.test(lines[i]!.code) ? i : n[i + 1]!;
    return n;
  };
  const nextTry = nextOf(/\btry\b/);
  const nextCatch = nextOf(CATCH_JS);
  /** The first "{" within 300 characters from `from`, and its match. */
  const blockFrom = (from: number): [number, number] | null => {
    const lim = Math.min(text.length, from + 300);
    for (let k = from; k < lim; k++) if (text.charCodeAt(k) === 123) return close[k]! > k ? [k, close[k]!] : null;
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const m = /(?:^|[^\w$.])(for|while|do)\b/.exec(lines[i]!.code);
    if (!m) continue;
    if (++heads > MAX_LOOPS) {
      s.skippedLoops++;
      continue;
    }
    const kwAt = starts[i]! + m.index + m[0].length - m[1]!.length;
    let bodyFrom = kwAt + m[1]!.length;
    let loopVar: string | null = null;
    if (m[1] === "for" || m[1] === "while") {
      const p = text.indexOf("(", bodyFrom);
      if (p < 0 || p - bodyFrom > 4 || close[p]! < 0) continue;
      const header = text.slice(p + 1, close[p]!);
      if (m[1] === "for") {
        // Only a counting loop (init; test; step) can be a retry; for…of / for…in take a new item each time.
        if (!header.includes(";") || /\b(of|in)\b/.test(header) || /\.(length|size)\b|\blength\b/.test(header)) continue;
        loopVar = /^\s*(?:let|var|const)?\s*([A-Za-z_$][\w$]*)\s*=/.exec(header)?.[1] ?? null;
      }
      bodyFrom = close[p]! + 1;
    }
    const body = blockFrom(bodyFrom);
    if (!body) continue;
    const a = i;
    const b = lineIndexOf(s, body[1]);
    if (b - a > MAX_BODY_LINES) continue;
    const t = nextTry[a]!;
    if (t < 0 || t > b) continue;
    const tryAt = starts[t]! + lines[t]!.code.search(/\btry\b/);
    if (tryAt < body[0]) continue;
    const tb = blockFrom(tryAt + 3);
    if (!tb || tb[1] > body[1]) continue;
    const tLine = lineIndexOf(s, tb[1]);
    if (tLine - t > MAX_BLOCK_LINES) continue;
    const c = nextCatch[tLine]!;
    if (c < 0 || c > b) continue;
    const catchAt = starts[c]! + lines[c]!.code.slice(c === tLine ? tb[1] - starts[c]! : 0).search(CATCH_JS) + (c === tLine ? tb[1] - starts[c]! : 0);
    if (!/^\s*$/.test(text.slice(tb[1] + 1, catchAt))) continue; // the catch belongs to this try
    const cb = blockFrom(catchAt + 5);
    if (!cb || cb[1] > body[1] || lineIndexOf(s, cb[1]) - c > MAX_BLOCK_LINES) continue;
    if (/^\s*(throw|return|break)\b/.test(text.slice(cb[0] + 1, cb[1]))) continue; // the catch path does not go round
    if (loopVar && new RegExp(`\\[\\s*${loopVar.replace(/\$/g, "\\$")}\\s*\\]`).test(text.slice(body[0], body[1]))) continue;
    const call = pickCall(callsIn(text, tb[0] + 1, tb[1], lang));
    if (!call) continue;
    s.retries.push({ at: ref(a, b), callee: call.name, calleeLine: lines[lineIndexOf(s, call.open)]!.line, calleeArgs: argsOf(call.open), noWait: countIn(waitP, a, b) === 0 && harmlessOnly(callsIn(text, cb[0] + 1, cb[1], lang)) });
  }
  return s;
}

// ---------- the curated list ----------

export type KindId = "retry" | "rpc-call" | "concurrency" | "queue" | "db-write" | "time";

interface Hit {
  lines: LineRef[];
  /** Retry markers: the loops that matched (their call is where a stand-in must be passed for a run to count). */
  loops?: RetryLoop[];
}

interface Ctx {
  spans: SpanScan[];
  lang: Lang;
  /** Does any line of any span match (code view or with strings)? */
  any(re: RegExp, view?: "code" | "ws"): boolean;
  lines(): Line[];
}

export interface FailureSpec {
  id: string;
  name: string;
  /** One sentence: what can go wrong. */
  says: string;
  /** The plain-code rule for "found in this code", in words; null = no marker (only "common pattern"). */
  marker: string | null;
  find?: (c: Ctx) => Hit | null;
  /** Retry markers only: how a run can show it (see `judgeRun`). */
  run?: "never-answers" | "storm";
}

export interface KindSpec {
  id: KindId;
  name: string;
  sign: string;
  detect: (c: Ctx) => LineRef | null;
  wonderTags: readonly string[];
  failures: FailureSpec[];
}

const lineRef = (l: Line): LineRef => ({ path: l.path, lineStart: l.line, lineEnd: l.line });
const firstLine = (c: Ctx, re: RegExp, view: "code" | "ws" = "code") => c.lines().find((l) => re.test(l[view]));
const retries = (c: Ctx) => c.spans.flatMap((s) => s.retries);

/** Known network clients, called directly. */
const KNOWN_CLIENT_JS = /(?<![\w$.])(fetch|axios(?:\.(?:get|post|put|patch|delete|head|request))?)\s*\(/g;
const KNOWN_CLIENT_PY = /(?<![\w.])(requests\.(?:get|post|put|patch|delete|head|request)|urlopen|urllib\.request\.urlopen)\s*\(/g;
const LOCK = /\b(lock\w*|Lock|mutex\w*|Mutex|runExclusive|acquire|synchronized|Semaphore|semaphore)\b/;
const DB_RECEIVER = /(?:^|[^\w$])(db|conn|connection|client|prisma|knex|trx|tx|session|cursor|cur|repo|repository|pool|sql|orm|em|manager|database)\b/i;
const SQL_WRITE = /\b(INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM)\b/i;
const TRANSACTION = /\b(transaction\w*|BEGIN|beginTransaction|begin|commit|rollback|atomic|savepoint|withTransaction)\b|\$transaction\b|\.tx\s*\(|\bwith\s+(conn|connection|db)\b/i;
const DEDUPE = /\b(seen|processed\w*|dedup\w*|idempot\w*|messageId|message_id|eventId|event_id|already\w*|isDuplicate|is_duplicate)\b|ON\s+CONFLICT|\bNX\b|INSERT\s+OR\s+IGNORE|IF\s+NOT\s+EXISTS|upsert/i;
const TZ_GIVEN = /\b(timeZone|tz|tzinfo|timezone|utc|UTC|zoneinfo|ZoneInfo)\b/;

/** Known-client calls with no timeout or signal in their own arguments. */
function bareClientCalls(c: Ctx): Line[] {
  const out: Line[] = [];
  for (const s of c.spans) {
    const re = new RegExp((c.lang === "py" ? KNOWN_CLIENT_PY : KNOWN_CLIENT_JS).source, "g");
    for (let m = re.exec(s.text); m; m = re.exec(s.text)) {
      const open = m.index + m[0].length - 1;
      if (s.close[open]! < open) continue;
      if (/\b(timeout|signal)\b/.test(s.text.slice(open + 1, s.close[open]!))) continue;
      out.push(s.lines[lineIndexOf(s, m.index)]!);
    }
  }
  return out;
}

/** Real database write calls: a write method on a database-like receiver, or a call whose SQL is INSERT/UPDATE/DELETE. */
function dbWrites(c: Ctx): Line[] {
  const out: Line[] = [];
  for (const s of c.spans)
    for (const l of s.lines) {
      const m = /([A-Za-z_$][\w$]*(?:\([^()]*\))?(?:\s*\.\s*[A-Za-z_$][\w$]*(?:\([^()]*\))?)*)\s*\.\s*(insert\w*|update\w*|upsert\w*|delete\w*|create\w*|destroy\w*)\s*\(/.exec(l.code);
      if (m && DB_RECEIVER.test(m[1]!)) {
        out.push(l);
        continue;
      }
      if (/\.\s*(execute\w*|query\w*|run|none|exec)\s*\(/.test(l.code) && SQL_WRITE.test(l.ws)) out.push(l);
    }
  return out;
}

export const CURATED: readonly KindSpec[] = [
  {
    id: "retry",
    name: "retry",
    sign: "a retry loop: a while loop, or a counting for loop (not one that walks a list), whose catch / except path goes round to the same call again",
    detect: (c) => retries(c)[0]?.at ?? (firstLine(c, /\b(retry\w*|retries|backoff|tenacity)\b/i) ? lineRef(firstLine(c, /\b(retry\w*|retries|backoff|tenacity)\b/i)!) : null),
    wonderTags: ["retry"],
    failures: [
      {
        id: "retry-storm",
        name: "retry storm",
        says: "Tries again at once, with no wait, so a provider that is struggling gets hit harder.",
        marker: "a retry loop with no wait in it (no sleep, setTimeout, delay, wait, pause or backoff) whose catch / except path calls nothing but logging",
        find: (c) => {
          const loops = retries(c).filter((r) => r.noWait);
          return loops.length ? { lines: loops.map((r) => r.at), loops } : null;
        },
        run: "storm",
      },
      { id: "duplicate-side-effect", name: "duplicate side effect", says: "A call that already did its work (charged, sent, wrote) but then failed is done again on the retry.", marker: null },
      {
        id: "no-overall-timeout",
        name: "no overall timeout",
        says: "The retries have no deadline as a whole, so a call that never answers can hold the caller forever.",
        marker: "a retry loop, and nowhere in these lines a deadline: no timeout or deadline name or keyword, signal, AbortSignal or AbortController, Promise.race, wait_for, stop_after_delay, or clock read (Date.now, performance.now, time.time, time.monotonic)",
        find: (c) => {
          const loops = retries(c);
          if (loops.length === 0 || c.any(DEADLINE)) return null;
          return { lines: loops.map((r) => r.at), loops };
        },
        run: "never-answers",
      },
    ],
  },
  {
    id: "rpc-call",
    name: "network call",
    sign: "a call to a known network client (fetch, axios, requests, httpx, aiohttp, urlopen, got, ky) or to an rpc / provider object",
    detect: (c) => {
      const l = firstLine(c, /(?<![\w$.])(fetch|axios|requests|httpx|aiohttp|urlopen|got|ky|XMLHttpRequest)\s*[.(]|(?<![\w$.])(rpc|provider|jsonrpc)\s*\./);
      return l ? lineRef(l) : null;
    },
    wonderTags: ["rpc-call", "network"],
    failures: [
      {
        id: "timeout",
        name: "timeout",
        says: "The call sets no time limit, so a silent provider holds the caller (until the client's own default, if it has one).",
        marker: "a call to fetch, axios, requests.<method> or urlopen whose own arguments set no timeout or signal, and nowhere in these lines a deadline (same list as \"no overall timeout\"); httpx and aiohttp are not counted (they have default timeouts)",
        find: (c) => {
          if (c.any(DEADLINE) || c.any(/\b(function|const|let|var|def)\s+(fetch|axios|requests|urlopen)\b/)) return null;
          const calls = bareClientCalls(c);
          return calls.length ? { lines: calls.map(lineRef) } : null;
        },
      },
      { id: "rate-limit", name: "rate limit", says: "A \"too many requests\" answer (HTTP 429) is treated like any other error and retried.", marker: null },
      { id: "provider-outage", name: "provider outage", says: "Every call fails for a while; with no fallback, everything that depends on it fails too.", marker: null },
    ],
  },
  {
    id: "concurrency",
    name: "concurrency",
    sign: "Promise.all / allSettled / race / any, asyncio.gather / create_task / wait, threads, a worker pool, or a lock",
    detect: (c) => {
      const l = firstLine(c, /\bPromise\.(all|allSettled|race|any)\b|\basyncio\.(gather|create_task|wait|TaskGroup)\b|\bthreading\b|\bThread\s*\(|\bThreadPoolExecutor\b|\bconcurrent\.futures\b|\bnew Worker\s*\(|\bmultiprocessing\b|\bLock\s*\(|\bMutex\b/);
      return l ? lineRef(l) : null;
    },
    wonderTags: ["concurrency"],
    failures: [
      {
        id: "race",
        name: "race",
        says: "Two tasks read and write the same value, and which one wins depends on timing.",
        marker: "one line that writes this.x or self.x from an expression that waits (await) and reads that same value (`this.total = this.total + await f()`, `self.n += await g()`), and no lock, mutex, semaphore or acquire anywhere in these lines",
        find: (c) => {
          if (c.any(LOCK)) return null;
          const hits = c.lines().filter((l) => {
            const m = /((?:this|self)\.[A-Za-z_$][\w$]*)\s*(\+=|-=|\*=|\/=|=(?!=))\s*(.*)$/.exec(l.code);
            if (!m || !/\bawait\b/.test(m[3]!)) return false;
            return m[2] !== "=" || m[3]!.includes(m[1]!);
          });
          return hits.length ? { lines: hits.map(lineRef) } : null;
        },
      },
      {
        id: "lost-update",
        name: "lost update",
        says: "A value read before a wait is written back after it, erasing what another task wrote meanwhile.",
        marker: "a local set from this.x or self.x, then a later line with await, then a later assignment to that same this.x or self.x, and no lock, mutex, semaphore or acquire anywhere in these lines",
        find: (c) => {
          if (c.any(LOCK)) return null;
          const ls = c.lines();
          let reads = 0;
          for (let i = 0; i < ls.length && reads < 50; i++) {
            const read = /\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*(this|self)\.([A-Za-z_$][\w$]*)\b(?!\s*\()/.exec(ls[i]!.code);
            if (!read) continue;
            reads++;
            const waitAt = ls.findIndex((l, k) => k > i && /\bawait\b/.test(l.code));
            if (waitAt < 0) continue;
            const writeRe = new RegExp(`\\b${read[2]}\\.${read[3]}\\s*(\\+=|-=|=(?!=))`);
            const writeAt = ls.findIndex((l, k) => k > waitAt && writeRe.test(l.code));
            if (writeAt < 0) continue;
            return { lines: [lineRef(ls[i]!), lineRef(ls[waitAt]!), lineRef(ls[writeAt]!)] };
          }
          return null;
        },
      },
    ],
  },
  {
    id: "queue",
    name: "queue or message handler",
    sign: "a queue call: enqueue, dequeue, consume, subscribe, publish, ack / nack, receiveMessage, deleteMessage, basic_ack, commitOffsets",
    detect: (c) => {
      const l = firstLine(c, /\b(enqueue|dequeue|consume|subscribe|publish|ack|nack|receiveMessage|deleteMessage|basic_ack|commitOffsets?)\s*\(/);
      return l ? lineRef(l) : null;
    },
    wonderTags: ["queue", "events"],
    failures: [
      {
        id: "duplicate-delivery",
        name: "duplicate delivery",
        says: "Queues deliver a message more than once; a handler that is not safe to repeat does its work twice.",
        marker: "an acknowledgement (ack, deleteMessage, basic_ack, commitOffsets) after an awaited call that does the work, and nowhere in these lines (strings included) a duplicate check: seen, processed…, dedupe, idempot…, messageId, eventId, already…, ON CONFLICT, NX, INSERT OR IGNORE, upsert",
        find: (c) => {
          if (c.any(DEDUPE, "ws")) return null;
          const ls = c.lines();
          const ackAt = ls.findIndex((l) => /\b(ack|deleteMessage|basic_ack|commitOffsets?)\s*\(/.test(l.code));
          if (ackAt <= 0) return null;
          const NOT_WORK = /(receiveMessage|receive|poll|JSON\.parse|parse|ack|nack|log|print|console\.\w+)$/;
          const work = ls.slice(0, ackAt).some((l) => {
            const m = (c.lang === "py" ? /^\s*(?:await\s+)?([A-Za-z_][\w.]*)\s*\(/ : /\bawait\s+([A-Za-z_$][\w$.]*)\s*\(/).exec(l.code);
            return m !== null && !NOT_WORK.test(m[1]!);
          });
          return work ? { lines: [lineRef(ls[ackAt]!)] } : null;
        },
      },
    ],
  },
  {
    id: "db-write",
    name: "database write",
    sign: "a write call on a database-like object (db, conn, client, prisma, knex, session, cursor, …) or an INSERT / UPDATE / DELETE statement",
    detect: (c) => {
      const l = dbWrites(c)[0];
      return l ? lineRef(l) : null;
    },
    wonderTags: ["db-write"],
    failures: [
      {
        id: "partial-commit",
        name: "partial commit",
        says: "Some writes land and the rest fail, leaving the data half changed.",
        marker: "two or more real database writes (a write method on db, conn, client, prisma, knex, session, cursor, …, or an INSERT / UPDATE / DELETE statement) and no transaction anywhere in these lines: no transaction, BEGIN, begin(), commit, rollback, atomic, savepoint, .tx(, $transaction, with conn",
        find: (c) => {
          const w = dbWrites(c);
          if (w.length < 2 || c.any(TRANSACTION, "ws")) return null;
          return { lines: w.map(lineRef) };
        },
      },
    ],
  },
  {
    id: "time",
    name: "time and clocks",
    sign: "a clock read: Date.now, new Date, performance.now, time.time, time.monotonic, datetime.now / utcnow / today, date.today, time.localtime",
    detect: (c) => {
      const l = firstLine(c, /\bDate\.now\b|\bnew Date\b|\bperformance\.now\b|\btime\.(time|monotonic|localtime)\b|\bdatetime\.(now|utcnow|today)\b|\bdate\.today\b/);
      return l ? lineRef(l) : null;
    },
    wonderTags: ["time", "timer"],
    failures: [
      {
        id: "clock-skew",
        name: "clock skew",
        says: "A duration taken from the wall clock jumps when the machine's clock is corrected.",
        marker: "a duration made by subtracting wall-clock reads: `Date.now() - …`, `… - Date.now()`, `time.time() - …`, `new Date().getTime() - …` (performance.now and time.monotonic do not count)",
        find: (c) => {
          const hits = c.lines().filter((l) => /(Date\.now\(\)|time\.time\(\)|new Date\(\)\.getTime\(\))\s*-|-\s*(Date\.now\(\)|time\.time\(\)|new Date\(\)\.getTime\(\))/.test(l.code));
          return hits.length ? { lines: hits.map(lineRef) } : null;
        },
      },
      {
        id: "time-zone",
        name: "time zone",
        says: "Local-time methods give different answers on machines in different time zones.",
        marker: "a local-time method (getHours, getDate, getDay, getMonth, getFullYear, setHours, toLocaleString / DateString / TimeString, toDateString, getTimezoneOffset; in Python datetime.now(), datetime.fromtimestamp(x), date.today(), time.localtime(), time.mktime()), and nowhere in these lines a time zone named (timeZone, tz, tzinfo, timezone, UTC, ZoneInfo)",
        find: (c) => {
          if (c.any(TZ_GIVEN, "ws")) return null;
          const re =
            c.lang === "py"
              ? /\bdatetime\.now\(\s*\)|\bdatetime\.fromtimestamp\([^,()]*\)|\bdate\.today\(\s*\)|\btime\.localtime\(|\btime\.mktime\(/
              : /\.(getHours|getMinutes|getDate|getDay|getMonth|getFullYear|setHours|setDate|setMonth|setFullYear|toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|getTimezoneOffset)\s*\(/;
          const hits = c.lines().filter((l) => re.test(l.code));
          return hits.length ? { lines: hits.map(lineRef) } : null;
        },
      },
    ],
  },
];

// ---------- labelling ----------

export interface LabelledFailure {
  kind: KindId;
  kindName: string;
  /** Why this kind is listed: plain code's sign (with its lines) and/or Wonder's tag. */
  kindBy: { plainCode?: { sign: string; at: LineRef }; wonder?: { tag: string; model: string } };
  failure: string;
  name: string;
  says: string;
  label: FailureLabelKind;
  /** Plain words for the label, built from the evidence below. */
  why: string;
  /** A short sentence for the label's tooltip (why it is this label and not a stronger one). */
  tooltip: string;
  markerRule: string | null;
  /** The lines the marker matched (found, reproduced, inconclusive). */
  lines?: LineRef[];
  excerpt?: { path: string; line: number; text: string }[];
  /** "reproduced" / "inconclusive": the run, and the page link to its proof card ("?proof=<runId>"). */
  runId?: string;
  proofLink?: string;
  /** A run that set this up and measured that it did not happen (the label then comes from the code). */
  triedNotShown?: { runId: string; fact: string };
}

export interface LabelsAnswer {
  labels: LabelledFailure[];
  checked: string[];
  read: string;
  note?: string;
}

export interface LabelInput {
  language: Lang;
  spans: { path: string; text: string; lineStart: number; lineEnd: number }[];
  /** Top-level functions in the lines read, with their parameter names (needed for a run to count as evidence). */
  functions?: FunctionInfo[];
  wonderTags?: { label: string }[];
  wonderModel?: string;
  /** Runs from sealed rounds, each with a proof card (newest last). */
  runs?: RunEvidence[];
}

/** The code-only part of the labels: everything that does not depend on runs. Pure; cacheable per source. */
export interface Scan {
  kinds: { kind: KindSpec; sign: LineRef | null; tag: string | undefined; hits: Map<string, Hit | null> }[];
  raw: Map<string, string[]>;
  read: string;
  note?: string;
}

export function scanFailures(input: Omit<LabelInput, "runs">): Scan {
  const allParams = (input.functions ?? []).flatMap((f) => f.params.filter((p): p is string => p !== null));
  const spans = input.spans.map((s) => scanSpan(s.path, s.text, input.language, s.lineStart, s.lineEnd, allParams));
  const all = spans.flatMap((s) => s.lines);
  const memo = new Map<string, boolean>();
  const ctx: Ctx = {
    spans,
    lang: input.language,
    lines: () => all,
    any(re, view = "code") {
      const k = `${view}:${re.source}:${re.flags}`;
      let v = memo.get(k);
      if (v === undefined) memo.set(k, (v = all.some((l) => re.test(l[view]))));
      return v;
    },
  };
  const tags = new Set((input.wonderTags ?? []).map((t) => t.label.trim().toLowerCase()));
  const kinds: Scan["kinds"] = [];
  for (const kind of CURATED) {
    const sign = kind.detect(ctx);
    const tag = kind.wonderTags.find((t) => tags.has(t));
    const hits = new Map(kind.failures.map((f) => [f.id, f.find ? f.find(ctx) : null] as const));
    const anyHit = [...hits.values()].some((h) => h !== null);
    if (!sign && !tag && !anyHit) continue;
    kinds.push({ kind, sign: sign ?? (anyHit ? [...hits.values()].find((h) => h)!.lines[0]! : null), tag, hits });
  }
  const skipped = spans.reduce((n, s) => n + s.skippedLoops, 0);
  return {
    kinds,
    raw: new Map(input.spans.map((s) => [s.path, s.text.split("\n")] as const)),
    read: input.spans.map((s) => fileLines(s.path, s.lineStart, s.lineEnd)).join("; "),
    ...(skipped > 0 ? { note: `plain code read the first ${MAX_LOOPS} loops only (${skipped} more not read; what they hold stays "common pattern")` } : {}),
  };
}

const trusted = (r: RunEvidence["run"]): string | null => {
  if (r.controlPassed !== true) return r.result.notMeasured.control ? `the known-case check did not pass: ${r.result.notMeasured.control}` : "the known-case check did not pass";
  const whole = r.result.notMeasured.wholeRun;
  return typeof whole === "string" ? whole : null;
};

export const STORM_CALLS = 20;
export const STAND_IN_SIGNALS = "Atlas's stand-ins ignore abort signals and timeouts handed to them, so a run cannot show whether this code's own time limit works.";

/** The step a stand-in played on its n-th call (1-based), or null when it threw for running out of steps. */
function stepOn(a: Extract<ArgSpec, { kind: "stand-in" }>, n: number): StandInStep | null {
  if (n <= a.calls.length) return a.calls[n - 1]!;
  return a.then === "repeat_last" ? a.calls[a.calls.length - 1]! : null;
}

type RunVerdict = { is: "shown"; fact: string } | { is: "not shown"; fact: string } | { is: "inconclusive"; why: string; tooltip?: string } | null;

/**
 * What one run says about a retry marker, through the stand-in passed where the marked loop makes its call:
 * null when this run did not set the failure up there (it is no evidence either way).
 */
function judgeRun(kind: "never-answers" | "storm", loops: RetryLoop[], e: RunEvidence, functions: FunctionInfo[]): RunVerdict {
  const fn = functions.find((f) => f.name === e.params.exportName && (e.path === undefined || f.path === e.path));
  if (!fn) return null;
  for (const loop of loops) {
    if (loop.at.path !== fn.path || loop.at.lineStart < fn.lineStart || loop.at.lineEnd > fn.lineEnd) continue;
    if (!loop.callee || loop.callee.includes(".")) continue;
    const k = fn.params.indexOf(loop.callee);
    const arg = k >= 0 ? e.params.args[k] : undefined;
    if (!arg || arg.kind !== "stand-in") continue;
    const measured = e.run.result.measured;
    if (kind === "never-answers") {
      if (!arg.calls.some((s) => s.do === "never_settle")) continue;
      if (/\b(signal|timeout\w*)\b/i.test(loop.calleeArgs)) return { is: "inconclusive", why: `the code hands ${loop.callee} an abort signal or timeout, which Atlas's stand-in ignores`, tooltip: STAND_IN_SIGNALS };
      const bad = trusted(e.run);
      if (bad) return { is: "inconclusive", why: bad };
      const others = e.params.args.filter((x, i) => i !== k && x.kind === "stand-in" && x.calls.some((s) => s.do === "never_settle"));
      if (others.length) return { is: "inconclusive", why: `another stand-in (${others.map((x) => (x as { name: string }).name).join(", ")}) also never answers, so the run cannot say which one held the function` };
      const o = measured.outcome;
      const n = measured[`calls:${arg.name}`];
      if (typeof o !== "string" || typeof n !== "number") return { is: "inconclusive", why: e.run.result.notMeasured.outcome ?? `the run did not measure how the call ended or how often ${arg.name} was called` };
      if (o === "still_running_at_watch_limit") return { is: "inconclusive", why: "Atlas stopped watching at its own watch limit while the function was still running; the code may still have a deadline after that", tooltip: "\"Still running when Atlas stopped watching\" is Atlas's limit, not the code's, so it is never proof." };
      if (o !== "never_settled") return { is: "not shown", fact: `${arg.name} (passed where line ${loop.calleeLine} calls ${loop.callee}) was set to never answer, and the function still ended (outcome ${o})` };
      const step = n >= 1 ? stepOn(arg, n) : null;
      if (!step || step.do !== "never_settle") return { is: "inconclusive", why: `${arg.name}'s last call (call ${n}) was not the one set to never answer` };
      return { is: "shown", fact: `${arg.name}, passed where line ${loop.calleeLine} calls ${loop.callee}, never answered on its call ${n}, and the function never settled (outcome never_settled)` };
    }
    if (!(arg.calls.length > 0 && arg.calls.every((s) => s.do === "throw"))) continue;
    const bad = trusted(e.run);
    if (bad) return { is: "inconclusive", why: bad };
    const n = measured[`calls:${arg.name}`];
    if (typeof n !== "number") return { is: "inconclusive", why: e.run.result.notMeasured[`calls:${arg.name}`] ?? `the run did not count the calls to ${arg.name}` };
    if (n >= STORM_CALLS) return { is: "shown", fact: `${arg.name}, passed where line ${loop.calleeLine} calls ${loop.callee}, failed on every call and was called ${n} times in one call of the function, with no wait in the loop (Atlas's line is ${STORM_CALLS})` };
    return { is: "not shown", fact: `${arg.name} failed on every call and was called ${n} times (fewer than ${STORM_CALLS})` };
  }
  return null;
}

export const LABEL_WORDS = {
  common: "Only Atlas's list says this kind of code often fails this way. Plain code did not see its marker in these lines.",
  found: (rule: string) => `Plain code saw this failure's marker in these lines: ${rule}. A marker is a pattern in the text, not a run.`,
  reproduced: (runId: string, fact: string) => `A sealed Atlas run (${runId}) showed it: ${fact}.`,
  inconclusive: (runId: string, why: string) => `A run that set this up (${runId}) cannot show it: ${why}.`,
  tipCommon: "Atlas's list only: not a claim about this code.",
  tipFound: "The marker matched in this code. No run has shown the failure yet.",
  tipReproduced: "The marker matched, and a sealed run showed the failure through the stand-in passed at the marked call.",
  tipInconclusive: "A run was tried but cannot show this failure; the reason is below.",
} as const;

export const EXCERPT_MAX_LINES = 24;

/** Labels from a scan plus runs. Pure: same input, same answer. */
export function labelFromScan(scan: Scan, runs: readonly RunEvidence[] = [], functions: FunctionInfo[] = [], wonderModel?: string): LabelsAnswer {
  const excerptOf = (refs: LineRef[]) => {
    const out: { path: string; line: number; text: string }[] = [];
    const seen = new Set<string>();
    for (const r of refs)
      for (let l = r.lineStart; l <= r.lineEnd && out.length < EXCERPT_MAX_LINES; l++) {
        const k = `${r.path}:${l}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ path: r.path, line: l, text: (scan.raw.get(r.path)?.[l - 1] ?? "").replace(/\r$/, "") });
      }
    return out;
  };
  const labels: LabelledFailure[] = [];
  for (const { kind, sign, tag, hits } of scan.kinds) {
    const kindBy: LabelledFailure["kindBy"] = { ...(sign ? { plainCode: { sign: kind.sign, at: sign } } : {}), ...(tag ? { wonder: { tag, model: wonderModel ?? "Muse Wonder" } } : {}) };
    for (const f of kind.failures) {
      const hit = hits.get(f.id) ?? null;
      const base = { kind: kind.id, kindName: kind.name, kindBy, failure: f.id, name: f.name, says: f.says, markerRule: f.marker };
      if (!hit) {
        labels.push({ ...base, label: "common pattern", why: LABEL_WORDS.common, tooltip: LABEL_WORDS.tipCommon });
        continue;
      }
      const at = { lines: hit.lines, excerpt: excerptOf(hit.lines) };
      // Runs count only for a marker that matched, and only through the stand-in at the marked call.
      let reproduced: { runId: string; fact: string } | null = null;
      let newest: { runId: string; v: Exclude<RunVerdict, null> } | null = null;
      if (f.run && hit.loops) {
        for (const e of [...runs].reverse()) {
          const v = judgeRun(f.run, hit.loops, e, functions);
          if (!v) continue;
          if (v.is === "shown") {
            reproduced = { runId: e.runId, fact: v.fact };
            break;
          }
          newest ??= { runId: e.runId, v };
        }
      }
      if (reproduced) labels.push({ ...base, ...at, label: "reproduced", why: LABEL_WORDS.reproduced(reproduced.runId, reproduced.fact), tooltip: LABEL_WORDS.tipReproduced, runId: reproduced.runId, proofLink: `?proof=${encodeURIComponent(reproduced.runId)}` });
      else if (newest?.v.is === "inconclusive") labels.push({ ...base, ...at, label: "inconclusive", why: LABEL_WORDS.inconclusive(newest.runId, newest.v.why), tooltip: newest.v.tooltip ?? LABEL_WORDS.tipInconclusive, runId: newest.runId, proofLink: `?proof=${encodeURIComponent(newest.runId)}` });
      else labels.push({ ...base, ...at, label: "found in this code", why: LABEL_WORDS.found(f.marker!), tooltip: LABEL_WORDS.tipFound, ...(newest?.v.is === "not shown" ? { triedNotShown: { runId: newest.runId, fact: newest.v.fact } } : {}) });
    }
  }
  return { labels, checked: CURATED.map((k) => k.id), read: scan.read, ...(scan.note ? { note: scan.note } : {}) };
}

/** Scan, then label. */
export function labelFailures(input: LabelInput): LabelsAnswer {
  return labelFromScan(scanFailures(input), input.runs ?? [], input.functions ?? [], input.wonderModel);
}
