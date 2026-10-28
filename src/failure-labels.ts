// X3 (D28): common-failure labels for an explorer part or a pasted function. Plain code only.
//
// Plain words. Some kinds of code tend to fail in known ways: a retry loop can hammer a provider that is down; a
// network call can wait forever; two tasks can overwrite each other's update. CURATED below is Atlas's short list:
// each kind of code, the failures it is known for, and for some of them a "marker", a concrete thing plain code can
// look for in the code's own lines (for example "a loop that catches errors and tries again, and nowhere a deadline").
//
// Every failure shown gets exactly one label, decided here and nowhere else:
// - "reproduced": a sealed Atlas run of THIS function showed it (its measured facts), and its proof card exists. The
//   label links to that proof card.
// - "inconclusive": a run that set up this failure's condition was tried, but came back "can't check" (the known-case
//   check failed, the whole run was can't check, or the fact was not measured).
// - "found in this code": the marker matched in the part's own lines. The label links to those lines.
// - "common pattern": nothing above. Only the curated list says this kind of code often fails this way. It is NEVER
//   shown as present in this code.
// Order: reproduced, then inconclusive, then found, then common. An "inconclusive" failure whose marker also matched
// still names the lines (as a note), but its label stays "inconclusive".
//
// Which kinds apply: plain code's own sign for the kind (a call, a name, a loop shape; listed per kind), or, for an
// explorer part, Muse Wonder's pattern tag for the part (X1 outline). Wonder may suggest a kind; it never decides a
// label: a kind Wonder tagged with no marker found and no run stays "common pattern".
//
// How the code is read: comments are blanked out first; for most checks, string contents too (so a word in a
// comment or a log message never counts). It is a line-by-line reading of text, not a parser: it can miss a marker
// written in an unusual way, and the list says for each marker exactly what it looks for.

import type { ArgSpec, ExperimentShape, Run } from "./types";
import { fileLines } from "./words";

export type FailureLabelKind = "common pattern" | "found in this code" | "reproduced" | "inconclusive";
export type Lang = "js" | "ts" | "py";

/** One line of code as the checks read it. */
interface CodeLine {
  path: string;
  line: number;
  /** Comments and string contents blanked. */
  code: string;
  /** Comments blanked, strings kept (SQL in strings, "Retry-After" headers). */
  withStrings: string;
  indent: number;
}

export interface LineRef {
  path: string;
  lineStart: number;
  lineEnd: number;
}

interface MarkerHit {
  lines: LineRef[];
}

/** A run of this function, from a sealed round. */
export interface RunEvidence {
  runId: string;
  params: Extract<ExperimentShape, { shape: "call-function" }>;
  run: Pick<Run, "id" | "controlPassed" | "result">;
}

interface Reproduce {
  /** What a test must set up to try this failure, in plain words. */
  trigger: string;
  /** True when the test sets that up. */
  tries: (p: RunEvidence["params"]) => boolean;
  /**
   * From a trusted run (control passed, no whole-run can't check): "shown" with the fact in words, "not shown" (the
   * run measured it and it did not happen), or "not measured" with why.
   */
  judge: (e: RunEvidence) => { is: "shown"; fact: string } | { is: "not shown"; fact: string } | { is: "not measured"; why: string };
}

export interface FailureSpec {
  id: string;
  name: string;
  /** One sentence: what goes wrong. */
  says: string;
  /** The plain-code rule for "found in this code", in words; null = no marker (only common / reproduced / inconclusive). */
  marker: string | null;
  find?: (lines: CodeLine[], lang: Lang) => MarkerHit | null;
  reproduce?: Reproduce;
}

export interface KindSpec {
  id: "rpc-call" | "retry" | "concurrency" | "queue" | "db-write" | "time";
  name: string;
  /** The plain-code sign that this kind of code is present, in words. */
  sign: string;
  detect: (lines: CodeLine[], lang: Lang) => LineRef | null;
  /** Wonder's X1 pattern tags that name this kind. */
  wonderTags: readonly string[];
  failures: FailureSpec[];
}

// ---------- reading the text ----------

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

/** The lines of one span of a file, ready for the checks. Comments are blanked against the whole file, so a block
 *  comment or string that starts before the span is still read as one. */
export function codeLinesOf(path: string, fileText: string, lang: Lang, lineStart: number, lineEnd: number): CodeLine[] {
  const code = maskSource(fileText, lang).split("\n");
  const withStrings = maskSource(fileText, lang, true).split("\n");
  const out: CodeLine[] = [];
  for (let l = Math.max(1, lineStart); l <= Math.min(lineEnd, code.length); l++) {
    const c = (code[l - 1] ?? "").replace(/\r$/, "");
    out.push({ path, line: l, code: c, withStrings: (withStrings[l - 1] ?? "").replace(/\r$/, ""), indent: c.length - c.trimStart().length });
  }
  return out;
}

const ref = (l: CodeLine, end: CodeLine = l): LineRef => ({ path: l.path, lineStart: l.line, lineEnd: end.line });
const firstMatch = (lines: CodeLine[], re: RegExp, view: "code" | "withStrings" = "code"): CodeLine | undefined => lines.find((l) => re.test(l[view]));
const anyMatch = (lines: CodeLine[], re: RegExp, view: "code" | "withStrings" = "code") => lines.some((l) => re.test(l[view]));

interface Loop {
  start: CodeLine;
  end: CodeLine;
  body: CodeLine[];
}

const LOOP_HEAD = { js: /(^|[^\w$.])(for|while|do)\b/, py: /^\s*(async\s+)?(for|while)\b/ };

/** Loops in the lines: a JS/TS loop's body is its braces; a Python loop's body is the lines indented under it. */
export function loopsIn(lines: CodeLine[], lang: Lang): Loop[] {
  const loops: Loop[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!;
    if (lang === "py") {
      if (!LOOP_HEAD.py.test(head.code)) continue;
      let j = i + 1;
      while (j < lines.length && (lines[j]!.code.trim() === "" || lines[j]!.indent > head.indent)) j++;
      const body = lines.slice(i + 1, j);
      loops.push({ start: head, end: lines[Math.max(i, j - 1)]!, body });
      continue;
    }
    const m = LOOP_HEAD.js.exec(head.code);
    if (!m) continue;
    // From the loop keyword, find the first "{" and its matching "}" (strings and comments are already blanked).
    let depth = 0;
    let opened = false;
    let endIdx = -1;
    for (let j = i; j < lines.length && endIdx < 0; j++) {
      const text = j === i ? lines[j]!.code.slice(m.index) : lines[j]!.code;
      for (const ch of text) {
        if (ch === "{") {
          depth++;
          opened = true;
        } else if (ch === "}") {
          depth--;
          if (opened && depth === 0) {
            endIdx = j;
            break;
          }
        }
      }
    }
    if (endIdx < 0) continue;
    loops.push({ start: head, end: lines[endIdx]!, body: lines.slice(i, endIdx + 1) });
  }
  return loops;
}

const CATCH = { js: /\bcatch\b/, py: /^\s*except\b/ } as const;
/** Loops whose body catches an error (and so goes round again): "retry loops". */
const retryLoops = (lines: CodeLine[], lang: Lang) => loopsIn(lines, lang).filter((lp) => anyMatch(lp.body, lang === "py" ? CATCH.py : CATCH.js));

/** A deadline anywhere in the lines: a whole-word timeout or deadline name, an abort signal, a race, a clock read. */
const DEADLINE = /\b(deadline\w*|timeout|timeoutMs|timeout_ms|timeouts|timeoutSeconds|AbortSignal|AbortController|signal|wait_for|perf_counter|monotonic|elapsed\w*|expiresAt|expires_at)\b|Promise\.race\b|asyncio\.timeout\b|Date\.now\b|performance\.now\b|time\.time\b/;
/** A wait between tries. */
const WAIT = /\b(sleep|setTimeout|delay|wait|backoff\w*|wait_exponential)\b|asyncio\.sleep\b|time\.sleep\b/;
/** A call to a network-ish name: fetch(...), rpc.send(...), provider.getBlock(...), requests.get(...). */
const RPC_CALL = /\b(fetch\w*|axios|rpc\w*|jsonrpc|provider|urlopen|requests|httpx|aiohttp|session\.(get|post)|XMLHttpRequest|callRpc|sendRequest|eth_\w+|getBlock\w*|sendTransaction)\s*[.(]/i;
const RATE_LIMIT = /\b429\b|rate.?limit|retry.?after|too.?many/i;

// ---------- the curated list ----------

const NEVER_ANSWERS: Reproduce = {
  trigger: "a test where a stand-in never answers (never_settle)",
  tries: (p) => p.args.some((a) => a.kind === "stand-in" && a.calls.some((s) => s.do === "never_settle")),
  judge: (e) => {
    const o = e.run.result.measured.outcome;
    if (typeof o !== "string") return { is: "not measured", why: e.run.result.notMeasured.outcome ?? "the run did not measure how the call ended" };
    if (o === "never_settled" || o === "still_running_at_watch_limit") return { is: "shown", fact: `a stand-in never answered and the function ${o === "never_settled" ? "never settled" : "was still running when Atlas stopped watching"} (outcome ${o})` };
    return { is: "not shown", fact: `a stand-in never answered and the function still ended (outcome ${o})` };
  },
};

/** A stand-in that throws on every call (every step throws; after the last it repeats or throws). */
const alwaysFailing = (a: ArgSpec): a is Extract<ArgSpec, { kind: "stand-in" }> => a.kind === "stand-in" && a.calls.length > 0 && a.calls.every((s) => s.do === "throw");
export const STORM_CALLS = 20;
const STORM: Reproduce = {
  trigger: `a test where a stand-in fails on every call`,
  tries: (p) => p.args.some(alwaysFailing),
  judge: (e) => {
    const failing = e.params.args.filter(alwaysFailing);
    let notMeasured: string | null = null;
    for (const a of failing) {
      const n = e.run.result.measured[`calls:${a.name}`];
      if (typeof n !== "number") {
        notMeasured = e.run.result.notMeasured[`calls:${a.name}`] ?? `the run did not count the calls to ${a.name}`;
        continue;
      }
      if (n >= STORM_CALLS) return { is: "shown", fact: `${a.name} failed on every call and was called ${n} times in one call of the function (Atlas's line is ${STORM_CALLS})` };
    }
    if (notMeasured !== null) return { is: "not measured", why: notMeasured };
    const counts = failing.map((a) => `${a.name} ${String(e.run.result.measured[`calls:${a.name}`])}`).join(", ");
    return { is: "not shown", fact: `a stand-in failed on every call and was called fewer than ${STORM_CALLS} times (${counts})` };
  },
};

export const CURATED: readonly KindSpec[] = [
  {
    id: "retry",
    name: "retry",
    sign: "a loop whose body catches an error (catch / except), so it goes round again after a failure",
    detect: (lines, lang) => {
      const lp = retryLoops(lines, lang)[0];
      return lp ? ref(lp.start, lp.end) : null;
    },
    wonderTags: ["retry"],
    failures: [
      {
        id: "retry-storm",
        name: "retry storm",
        says: "Tries again at once, or without a cap, so a provider that is struggling gets hit harder.",
        marker: "a loop that catches an error and goes round again with no wait in the loop: no sleep, setTimeout, delay, wait or backoff call between the catch and the next try",
        find: (lines, lang) => {
          const hits = retryLoops(lines, lang).filter((lp) => !anyMatch(lp.body, WAIT));
          return hits.length ? { lines: hits.map((lp) => ref(lp.start, lp.end)) } : null;
        },
        reproduce: STORM,
      },
      {
        id: "duplicate-side-effect",
        name: "duplicate side effect",
        says: "A call that already did its work (charged, sent, wrote) but then failed is done again on the retry.",
        marker: null,
      },
      {
        id: "no-overall-timeout",
        name: "no overall timeout",
        says: "The retries have no deadline as a whole, so a call that never answers holds the caller forever.",
        marker: "a loop that catches an error and goes round again, and nowhere in these lines a deadline: no timeout or deadline name, AbortSignal or AbortController, Promise.race, asyncio.wait_for, or clock read (Date.now, performance.now, time.time, time.monotonic)",
        find: (lines, lang) => {
          const loops = retryLoops(lines, lang);
          if (loops.length === 0 || anyMatch(lines, DEADLINE)) return null;
          return { lines: loops.map((lp) => ref(lp.start, lp.end)) };
        },
        reproduce: NEVER_ANSWERS,
      },
    ],
  },
  {
    id: "rpc-call",
    name: "RPC or network call",
    sign: "a call to a network-style name: fetch, axios, an rpc… or provider… object, urlopen, requests, httpx, aiohttp, eth_…, getBlock…",
    detect: (lines) => {
      const l = firstMatch(lines, RPC_CALL);
      return l ? ref(l) : null;
    },
    wonderTags: ["rpc-call", "network"],
    failures: [
      {
        id: "timeout",
        name: "timeout",
        says: "A slow or silent provider is waited on with no time limit.",
        marker: "a network-style call, and nowhere in these lines a deadline (the same deadline list as \"no overall timeout\")",
        find: (lines) => {
          const calls = lines.filter((l) => RPC_CALL.test(l.code));
          if (calls.length === 0 || anyMatch(lines, DEADLINE)) return null;
          return { lines: calls.map((l) => ref(l)) };
        },
        reproduce: NEVER_ANSWERS,
      },
      {
        id: "rate-limit",
        name: "rate limit",
        says: "A \"too many requests\" answer (HTTP 429) is treated like any other error and retried at once.",
        marker: "a network-style call inside a loop that catches errors, and nowhere in these lines (strings included) 429, rate limit, Retry-After or too many",
        find: (lines, lang) => {
          if (anyMatch(lines, RATE_LIMIT, "withStrings")) return null;
          const hits = retryLoops(lines, lang).filter((lp) => anyMatch(lp.body, RPC_CALL));
          return hits.length ? { lines: hits.map((lp) => ref(lp.start, lp.end)) } : null;
        },
      },
      {
        id: "provider-outage",
        name: "provider outage",
        says: "Every call fails for a while; with no fallback, everything that depends on it fails too.",
        marker: null,
      },
    ],
  },
  {
    id: "concurrency",
    name: "concurrency",
    sign: "Promise.all / allSettled / race / any, asyncio.gather / create_task / wait, threads, a worker pool, or a lock",
    detect: (lines) => {
      const l = firstMatch(lines, /\bPromise\.(all|allSettled|race|any)\b|\basyncio\.(gather|create_task|wait|TaskGroup)\b|\bthreading\b|\bThread\s*\(|\bThreadPoolExecutor\b|\bconcurrent\.futures\b|\bnew Worker\s*\(|\bmultiprocessing\b|\bLock\s*\(|\bMutex\b/);
      return l ? ref(l) : null;
    },
    wonderTags: ["concurrency"],
    failures: [
      {
        id: "race",
        name: "race",
        says: "Two tasks read and write the same value, and which one wins depends on timing.",
        marker: "one line that writes a shared value (this.x or self.x) from an expression that waits (await) and reads that same value, e.g. `this.total = this.total + await f()` or `self.n += await g()`",
        find: (lines) => {
          const hits = lines.filter((l) => {
            const m = /((?:this|self)\.[A-Za-z_$][\w$]*)\s*(\+=|-=|\*=|\/=|=(?!=))\s*(.*)$/.exec(l.code);
            if (!m || !/\bawait\b/.test(m[3]!)) return false;
            return m[2] !== "=" || m[3]!.includes(m[1]!);
          });
          return hits.length ? { lines: hits.map((l) => ref(l)) } : null;
        },
      },
      {
        id: "lost-update",
        name: "lost update",
        says: "A value read before a wait is written back after it, erasing what another task wrote meanwhile.",
        marker: "a local name set from this.x or self.x, then a later line with await, then a later line that assigns this.x or self.x again",
        find: (lines) => {
          for (let i = 0; i < lines.length; i++) {
            const read = /\b(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*(this|self)\.([A-Za-z_$][\w$]*)\b(?!\s*\()/.exec(lines[i]!.code);
            if (!read) continue;
            const prop = `${read[2]}.${read[3]}`;
            const waitAt = lines.findIndex((l, k) => k > i && /\bawait\b/.test(l.code));
            if (waitAt < 0) continue;
            const writeRe = new RegExp(`${prop.replace(".", "\\.")}\\s*(\\+=|-=|=(?!=))`);
            const writeAt = lines.findIndex((l, k) => k > waitAt && writeRe.test(l.code));
            if (writeAt < 0) continue;
            return { lines: [ref(lines[i]!), ref(lines[waitAt]!), ref(lines[writeAt]!)] };
          }
          return null;
        },
      },
    ],
  },
  {
    id: "queue",
    name: "queue or message handler",
    sign: "a queue-style name: queue, enqueue, dequeue, consume(r), ack / nack, publish, subscribe, SQS, Kafka, AMQP, receiveMessage, deleteMessage",
    detect: (lines) => {
      const l = firstMatch(lines, /\b(queue\w*|enqueue|dequeue|consumer|consume|ack|nack|publish|subscribe|sqs|kafka\w*|amqp\w*|receiveMessage|deleteMessage|basic_ack|commitOffsets?)\b/i);
      return l ? ref(l) : null;
    },
    wonderTags: ["queue", "events"],
    failures: [
      {
        id: "duplicate-delivery",
        name: "duplicate delivery",
        says: "Queues deliver a message more than once; a handler that is not safe to repeat does its work twice.",
        marker: "an acknowledgement call (ack, deleteMessage, basic_ack, commitOffsets) on a line after other calls, and nowhere in these lines a duplicate check: no name like seen, processed, dedupe, idempotent, messageId, already, isDuplicate",
        find: (lines) => {
          if (anyMatch(lines, /\b(seen\w*|processed\w*|dedupe\w*|dedup\w*|idempot\w*|messageId|message_id|already\w*|isDuplicate|is_duplicate)\b/i)) return null;
          const ackAt = lines.findIndex((l) => /\b(ack|deleteMessage|basic_ack|commitOffsets?)\s*\(/.test(l.code));
          if (ackAt <= 0) return null;
          const workBefore = lines.slice(0, ackAt).some((l) => /[A-Za-z_$][\w$]*\s*\(/.test(l.code) && !/^\s*(async\s+)?(function|def|export|class)\b/.test(l.code));
          return workBefore ? { lines: [ref(lines[ackAt]!)] } : null;
        },
      },
    ],
  },
  {
    id: "db-write",
    name: "database write",
    sign: "a write method call (.insert…, .update…, .upsert…, .save…, .execute…, .delete…) or an INSERT / UPDATE / DELETE statement in a string",
    detect: (lines) => {
      const l = firstMatch(lines, /\.(insert\w*|update\w*|upsert\w*|save\w*|execute\w*|delete\w*)\s*\(/) ?? firstMatch(lines, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/, "withStrings");
      return l ? ref(l) : null;
    },
    wonderTags: ["db-write"],
    failures: [
      {
        id: "partial-commit",
        name: "partial commit",
        says: "Some writes land and the rest fail, leaving the data half changed.",
        marker: "two or more write calls (or INSERT / UPDATE / DELETE statements) in these lines, and no transaction: no transaction, BEGIN, commit, rollback, atomic or savepoint",
        find: (lines) => {
          const writes = lines.filter((l) => /\.(insert\w*|update\w*|upsert\w*|save\w*|execute\w*|delete\w*)\s*\(/.test(l.code) || /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/.test(l.withStrings));
          if (writes.length < 2) return null;
          if (anyMatch(lines, /\b(transaction\w*|beginTransaction|BEGIN|commit|rollback|atomic|savepoint)\b|\$transaction\b/i, "withStrings")) return null;
          return { lines: writes.map((l) => ref(l)) };
        },
      },
    ],
  },
  {
    id: "time",
    name: "time and clocks",
    sign: "a clock read: Date.now, new Date, performance.now, time.time, time.monotonic, datetime.now / utcnow / today, date.today, time.localtime",
    detect: (lines) => {
      const l = firstMatch(lines, /\bDate\.now\b|\bnew Date\b|\bperformance\.now\b|\btime\.(time|monotonic|localtime)\b|\bdatetime\.(now|utcnow|today)\b|\bdate\.today\b/);
      return l ? ref(l) : null;
    },
    wonderTags: ["time", "timer"],
    failures: [
      {
        id: "clock-skew",
        name: "clock skew",
        says: "Durations taken from the wall clock jump when the machine's clock is corrected, and two machines' clocks disagree.",
        marker: "a duration made by subtracting wall-clock reads: `Date.now() - …`, `… - Date.now()`, `time.time() - …`, `new Date().getTime() - …` (a monotonic clock, performance.now or time.monotonic, does not count)",
        find: (lines) => {
          const hits = lines.filter((l) => /(Date\.now\(\)|time\.time\(\)|new Date\(\)\.getTime\(\))\s*-|-\s*(Date\.now\(\)|time\.time\(\)|new Date\(\)\.getTime\(\))/.test(l.code));
          return hits.length ? { lines: hits.map((l) => ref(l)) } : null;
        },
      },
      {
        id: "time-zone",
        name: "time zone",
        says: "Local-time methods give different answers on machines in different time zones.",
        marker: "a local-time method: getHours, getDate, getDay, getMonth, getFullYear, setHours, setDate, toLocaleString / DateString / TimeString, toDateString, toTimeString, getTimezoneOffset; or in Python datetime.now() with no time zone, datetime.fromtimestamp(x) with no time zone, date.today(), time.localtime(), time.mktime()",
        find: (lines, lang) => {
          const re =
            lang === "py"
              ? /\bdatetime\.now\(\s*\)|\bdatetime\.fromtimestamp\([^,()]*\)|\bdate\.today\(\s*\)|\btime\.localtime\(|\btime\.mktime\(/
              : /\.(getHours|getMinutes|getDate|getDay|getMonth|getFullYear|setHours|setDate|setMonth|setFullYear|toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|getTimezoneOffset)\s*\(/;
          const hits = lines.filter((l) => re.test(l.code));
          return hits.length ? { lines: hits.map((l) => ref(l)) } : null;
        },
      },
    ],
  },
];

// ---------- labelling ----------

export interface LabelledFailure {
  kind: KindSpec["id"];
  kindName: string;
  /** Why this kind is listed: plain code's sign (with its lines) and/or Wonder's tag. */
  kindBy: { plainCode?: { sign: string; at: LineRef }; wonder?: { tag: string; model: string } };
  failure: string;
  name: string;
  says: string;
  label: FailureLabelKind;
  /** Plain words for the label, built from the evidence below. */
  why: string;
  /** The marker's rule (null when this failure has none). */
  markerRule: string | null;
  /** "found in this code" (and an inconclusive one whose marker also matched): the lines the marker matched. */
  lines?: LineRef[];
  /** The matched lines as written (at most EXCERPT_MAX_LINES), so the page can show them where the label links. */
  excerpt?: { path: string; line: number; text: string }[];
  /** "reproduced" / "inconclusive": the run (its proof card is ?proof=<runId>). */
  runId?: string;
  /** A run that tried this failure and measured that it did not happen (the label then comes from the code). */
  triedNotShown?: { runId: string; fact: string };
}

export interface LabelsAnswer {
  /** The kinds of code plain code or Wonder saw, in CURATED order; empty means none on Atlas's list. */
  labels: LabelledFailure[];
  /** Kinds checked (all of CURATED), for "none found" wording. */
  checked: string[];
  /** Plain words about what was read (e.g. "lines 3–19 of a.ts"). */
  read: string;
  note?: string;
}

export interface LabelInput {
  language: Lang;
  /** The part's or function's own lines, per file. */
  spans: { path: string; text: string; lineStart: number; lineEnd: number }[];
  /** Explorer only: Wonder's pattern tags for the part (X1), and its model id. */
  wonderTags?: { label: string }[];
  wonderModel?: string;
  /** Runs of this function from sealed rounds, each with a proof card (newest last). */
  runs?: RunEvidence[];
}

const trusted = (r: RunEvidence["run"]): string | null => {
  if (r.controlPassed !== true) return r.result.notMeasured.control ? `the known-case check did not pass: ${r.result.notMeasured.control}` : "the known-case check did not pass";
  const whole = r.result.notMeasured.wholeRun;
  return typeof whole === "string" ? whole : null;
};

export const LABEL_WORDS = {
  common: "Only Atlas's list says this kind of code often fails this way. Plain code did not see it in these lines.",
  found: (rule: string) => `Plain code saw it in these lines: ${rule}.`,
  reproduced: (runId: string, fact: string) => `A sealed Atlas run (${runId}) showed it: ${fact}.`,
  inconclusive: (runId: string, why: string) => `A run that set this up (${runId}) came back can't check: ${why}.`,
  triedNotShown: (runId: string, fact: string) => `Run ${runId} set this up and did not show it: ${fact}.`,
} as const;

export const EXCERPT_MAX_LINES = 24;

/** Labels every failure of every kind that applies. Pure: same input, same answer. */
export function labelFailures(input: LabelInput): LabelsAnswer {
  const all: CodeLine[] = input.spans.flatMap((s) => codeLinesOf(s.path, s.text, input.language, s.lineStart, s.lineEnd));
  const raw = new Map(input.spans.map((s) => [s.path, s.text.split("\n")] as const));
  const excerptOf = (refs: LineRef[]) => {
    const out: { path: string; line: number; text: string }[] = [];
    const seen = new Set<string>();
    for (const r of refs)
      for (let l = r.lineStart; l <= r.lineEnd && out.length < EXCERPT_MAX_LINES; l++) {
        const k = `${r.path}:${l}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ path: r.path, line: l, text: (raw.get(r.path)?.[l - 1] ?? "").replace(/\r$/, "") });
      }
    return out;
  };
  const tags = new Set((input.wonderTags ?? []).map((t) => t.label.trim().toLowerCase()));
  const runs = input.runs ?? [];
  const labels: LabelledFailure[] = [];
  for (const kind of CURATED) {
    const sign = kind.detect(all, input.language);
    const tag = kind.wonderTags.find((t) => tags.has(t));
    const hits = new Map(kind.failures.map((f) => [f.id, f.find ? f.find(all, input.language) : null] as const));
    const anyHit = [...hits.values()].some((h) => h !== null);
    if (!sign && !tag && !anyHit) continue;
    const kindBy: LabelledFailure["kindBy"] = {
      ...(sign ? { plainCode: { sign: kind.sign, at: sign } } : anyHit ? { plainCode: { sign: "a marker below matched", at: [...hits.values()].find((h) => h)!.lines[0]! } } : {}),
      ...(tag ? { wonder: { tag, model: input.wonderModel ?? "Muse Wonder" } } : {}),
    };
    for (const f of kind.failures) {
      const hit = hits.get(f.id) ?? null;
      const base = { kind: kind.id, kindName: kind.name, kindBy, failure: f.id, name: f.name, says: f.says, markerRule: f.marker };
      // Any run that showed it makes it "reproduced". Otherwise the NEWEST run that set it up decides between
      // "inconclusive" (it came back can't check) and a note that it did not show it (the label then comes from the code).
      let reproduced: { runId: string; fact: string } | null = null;
      let newest: { is: "inconclusive"; runId: string; why: string } | { is: "not shown"; runId: string; fact: string } | null = null;
      if (f.reproduce) {
        for (const e of [...runs].reverse()) {
          if (!f.reproduce.tries(e.params)) continue;
          const bad = trusted(e.run);
          if (bad !== null) {
            newest ??= { is: "inconclusive", runId: e.runId, why: bad };
            continue;
          }
          const j = f.reproduce.judge(e);
          if (j.is === "shown") {
            reproduced = { runId: e.runId, fact: j.fact };
            break;
          }
          newest ??= j.is === "not measured" ? { is: "inconclusive", runId: e.runId, why: j.why } : { is: "not shown", runId: e.runId, fact: j.fact };
        }
      }
      const inconclusive = newest?.is === "inconclusive" ? newest : null;
      const notShown = newest?.is === "not shown" ? { runId: newest.runId, fact: newest.fact } : null;
      if (reproduced) {
        labels.push({ ...base, label: "reproduced", why: LABEL_WORDS.reproduced(reproduced.runId, reproduced.fact), runId: reproduced.runId, ...(hit ? { lines: hit.lines, excerpt: excerptOf(hit.lines) } : {}) });
      } else if (inconclusive) {
        labels.push({ ...base, label: "inconclusive", why: LABEL_WORDS.inconclusive(inconclusive.runId, inconclusive.why), runId: inconclusive.runId, ...(hit ? { lines: hit.lines, excerpt: excerptOf(hit.lines) } : {}) });
      } else if (hit) {
        labels.push({ ...base, label: "found in this code", why: LABEL_WORDS.found(f.marker!), lines: hit.lines, excerpt: excerptOf(hit.lines), ...(notShown ? { triedNotShown: notShown } : {}) });
      } else {
        labels.push({ ...base, label: "common pattern", why: LABEL_WORDS.common, ...(notShown ? { triedNotShown: notShown } : {}) });
      }
    }
  }
  const read = input.spans.map((s) => fileLines(s.path, s.lineStart, s.lineEnd)).join("; ");
  return { labels, checked: CURATED.map((k) => k.id), read };
}
