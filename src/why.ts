// "Ask why" (D05-05): which sentences may be shown after a run, decided by plain code.
//
// Plain words: after a run, Atlas can show short "why" sentences written by plain code from the run's own
// trace (templates below). A Meta model's words (its bet rationale, the Investigator's claim) are never
// linked: the screen shows them whole, apart, as the model's words. A plain-code sentence is shown ONLY if
// it points at run evidence that exists:
// - a trace event, written "trace #N" (N = the event's position in run.trace, counting from 0), or
// - a finding's lines, written "lines A–B" (optionally after the file name), that sit inside the line
//   range of one of the round's findings.
// A sentence with no such reference, or with any reference that does not resolve (a trace number past
// the end, lines outside every finding), is dropped and counted: the log strip shows the count as
// "dropped: no run evidence". A model sentence is never reworded or repaired here: shown whole or not at all.
// No I/O, no clock, no model.

import { notShownAsFact } from "./trust";
import { formatUsd1e18 } from "./units";
import type { Finding, Run } from "./types";

export const DROPPED_LABEL = "dropped: no run evidence";

export type WhyAuthor = { kind: "plain-code" } | { kind: "model"; model: string; role: "claimant" | "investigator" };

export interface WhySentence {
  text: string;
  by: WhyAuthor;
}

export type WhyLink =
  | { kind: "trace"; index: number; event: string }
  | { kind: "lines"; file: string; lineStart: number; lineEnd: number; findingId: string };

export interface LinkedSentence extends WhySentence {
  links: WhyLink[];
}

export interface LinkResult {
  shown: LinkedSentence[];
  dropped: WhySentence[];
}

// S1 (day-5 review): EVERY evidence reference in a sentence is parsed, wherever it sits, and all of them
// must resolve. A reference is:
// - a trace number: any "#N" (also "traces #1 and #2", "#1 or #999", "trace#4", "Event #9"), "trace N" /
//   "event N" without the "#", and trace ranges "#3–#7" / "#3 to 7";
// - a line or line range: "line(s) A", "lines A–B" in any dash (- – —) or "to", lists ("lines 4, 9 and 12"),
//   and any bare "A–B" range left in the sentence;
// - a file name ("mip-x43.sol", "proposals/ChainlinkOracleConfigs.sol"), anywhere in the sentence.
// Line references are checked against the findings of the file the sentence names. A sentence that names
// two different files, names a file no finding is in, or gives lines that fit findings in more than one
// file, is ambiguous: dropped. A range written backwards (B < A) is dropped too.
const DASH = String.raw`\s*(?:–|—|-|to)\s*`;
const FILE_REF = /(?<![\w.\/-])((?:[\w-]+\/)*[\w-]*[A-Za-z_][\w-]*\.[A-Za-z][A-Za-z0-9]{0,5})(?![\w\/-])/g;
const HASH_REF = new RegExp(String.raw`#\s*(\d+)(?:${DASH}#?\s*(\d+))?`, "g");
const WORD_TRACE_REF = new RegExp(String.raw`\b(?:traces?|events?)\s+(\d+)(?:${DASH}(\d+))?`, "gi");
const LINE_ITEM = String.raw`\d+(?:${DASH}\d+)?`;
const LINES_REF = new RegExp(String.raw`\blines?\s+(${LINE_ITEM}(?:\s*(?:,|;|&|\band\b|\bor\b)\s*${LINE_ITEM})*)`, "gi");
const BARE_RANGE = new RegExp(String.raw`\b(\d+)${DASH}(\d+)\b`, "g");
const blank = (text: string, re: RegExp) => text.replace(re, (m) => " ".repeat(m.length));

/** Every reference the text makes. A sentence may be shown only when `bad` is empty and `links` is not. */
export function referencesOf(text: string, run: Pick<Run, "trace">, findings: readonly Finding[]): { links: WhyLink[]; bad: string[] } {
  const links: WhyLink[] = [];
  const bad: string[] = [];
  const checked = findings.filter((x) => x.verified);
  const fileMatches = (name: string, f: Finding) => f.file === name || f.file.endsWith(`/${name}`);

  // 1. File names, anywhere. Each must be a file one of the round's checked findings is in.
  const files = [...new Set([...text.matchAll(FILE_REF)].map((m) => m[1]!))];
  for (const name of files) if (!checked.some((f) => fileMatches(name, f))) bad.push(`${name} is not a file of a checked finding of this round`);
  let rest = blank(text, FILE_REF);

  // 2. Trace numbers and ranges.
  const traceRange = (aRaw: string, bRaw: string | undefined) => {
    const a = Number(aRaw);
    const b = bRaw === undefined ? a : Number(bRaw);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b < a) return void bad.push(`trace #${aRaw}${bRaw ? `–${bRaw}` : ""} is not a readable range`);
    for (const i of a === b ? [a] : [a, b]) {
      const ev = run.trace[i];
      if (ev) links.push({ kind: "trace", index: i, event: ev.event });
      else bad.push(`trace #${i} is not an event of this run (it has ${run.trace.length})`);
    }
  };
  for (const m of rest.matchAll(HASH_REF)) traceRange(m[1]!, m[2]);
  rest = blank(rest, HASH_REF);
  for (const m of rest.matchAll(WORD_TRACE_REF)) traceRange(m[1]!, m[2]);
  rest = blank(rest, WORD_TRACE_REF);

  // 3. Lines: after "line(s)", then any bare range left over.
  const ranges: [number, number][] = [];
  for (const m of rest.matchAll(LINES_REF)) {
    for (const item of m[1]!.matchAll(new RegExp(String.raw`(\d+)(?:${DASH}(\d+))?`, "g"))) ranges.push([Number(item[1]), item[2] === undefined ? Number(item[1]) : Number(item[2])]);
  }
  rest = blank(rest, LINES_REF);
  for (const m of rest.matchAll(BARE_RANGE)) ranges.push([Number(m[1]), Number(m[2])]);
  for (const [a, b] of ranges) {
    if (b < a) {
      bad.push(`lines ${a}–${b} run backwards`);
      continue;
    }
    if (files.length > 1) {
      bad.push(`lines ${a}–${b}: the sentence names ${files.length} files, so which one is unclear`);
      continue;
    }
    const pool = files.length === 1 ? checked.filter((f) => fileMatches(files[0]!, f)) : checked;
    const fits = pool.filter((x) => x.lineStart <= a && b <= x.lineEnd);
    const inFiles = new Set(fits.map((f) => f.file));
    if (inFiles.size === 1) links.push({ kind: "lines", file: fits[0]!.file, lineStart: a, lineEnd: b, findingId: fits[0]!.id });
    else if (inFiles.size === 0) bad.push(`${files[0] ? `${files[0]} ` : ""}lines ${a}–${b} are not inside a checked finding of this round`);
    else bad.push(`lines ${a}–${b} fit findings in ${inFiles.size} files, so which one is unclear`);
  }
  return { links, bad };
}

/** Keep the plain-code sentences whose every reference resolves (at least one); drop and count the rest (and every model sentence). */
export function linkSentences(sentences: readonly WhySentence[], run: Pick<Run, "trace">, findings: readonly Finding[]): LinkResult {
  const shown: LinkedSentence[] = [];
  const dropped: WhySentence[] = [];
  for (const s of sentences) {
    // S2: a model's words are never linked evidence (a bet rationale is sealed BEFORE the run, so any
    // "trace #N" in it is a guess about a trace that did not exist yet). Only plain code may link.
    if (s.by.kind !== "plain-code") {
      dropped.push(s);
      continue;
    }
    const r = referencesOf(s.text, run, findings);
    if (r.links.length > 0 && r.bad.length === 0) shown.push({ ...s, links: r.links });
    else dropped.push(s);
  }
  return { shown, dropped };
}

/** A model's text, one sentence per entry (split after . ! or ? followed by a space). Empty parts are skipped. */
export function modelSentences(text: string, by: Extract<WhyAuthor, { kind: "model" }>): WhySentence[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => ({ text: t, by }));
}

// ---------- sentences written by plain code from the run ----------

const PLAIN: WhyAuthor = { kind: "plain-code" };
const rec = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const refs = (ix: number[]) => `trace ${ix.map((i) => `#${i}`).join(", ")}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The TS runner (withRpcRetry): how it ended, and how it waited. Each sentence names its trace events. */
function tsSentences(run: Run): WhySentence[] {
  const out: WhySentence[] = [];
  const t = run.trace;
  // m1: a wait counts as waited only when its "wake" is in the trace; a wait the watch limit cut off is said apart.
  const all = t.map((e, i) => ({ e, i })).filter((x) => x.e.event === "sleep");
  const woke = (i: number) => {
    for (let j = i + 1; j < t.length; j++) {
      if (t[j]!.event === "wake") return true;
      if (t[j]!.event === "sleep") return false;
    }
    return false;
  };
  const sleeps = all.filter((x) => woke(x.i));
  const cut = all.filter((x) => !woke(x.i));
  if (sleeps.length > 0) {
    const ms = sleeps.map((x) => Number(rec(x.e.data).ms));
    const same = ms.every((m) => m === ms[0]);
    const shownIx = sleeps.length <= 6 ? sleeps.map((x) => x.i) : [sleeps[0]!.i, sleeps.at(-1)!.i];
    out.push({ text: `it waited ${plural(sleeps.length, "time", "times")}${same ? `, ${ms[0]} ms each` : ""} (${refs(shownIx)})`, by: PLAIN });
  }
  for (const c of cut) {
    const stop = t.findIndex((e, j) => j > c.i && e.event === "stopped_watching");
    if (stop >= 0) out.push({ text: `it asked to wait ${Number(rec(c.e.data).ms)} ms more, and Atlas's watch limit ended the run during that wait (trace #${c.i}, #${stop})`, by: PLAIN });
  }
  const end = t.findIndex((e) => e.event === "throws" || e.event === "returns" || e.event === "pending");
  if (end >= 0) {
    const calls = t.slice(0, end).filter((e) => e.event === "call");
    const n = calls.length ? Number(rec(calls.at(-1)!.data).n) : 0;
    const callsAfter = t.slice(end + 1).some((e) => e.event === "call");
    const ev = t[end]!.event;
    if (ev === "throws" && n > 0 && !callsAfter) out.push({ text: `call ${n} threw; no more attempts (trace #${end})`, by: PLAIN });
    if (ev === "returns" && n > 0 && !callsAfter) out.push({ text: `call ${n} returned a value; no more attempts (trace #${end})`, by: PLAIN });
    if (ev === "pending") out.push({ text: `the call never settled: no timers were left and nothing outside it was left to run (trace #${end})`, by: PLAIN });
  }
  return out;
}

/** The EVM runner (Moonwell): the control, the cbETH feed change, the cbETH read and its price sources. */
function evmSentences(run: Run): WhySentence[] {
  const out: WhySentence[] = [];
  const t = run.trace;
  const at = (pred: (d: Record<string, unknown>, event: string) => boolean) => t.findIndex((e) => pred(rec(e.data), e.event));
  const ctl = at((_, ev) => ev === "control_matched");
  if (ctl >= 0) out.push({ text: `the known-case control matched before anything was judged (trace #${ctl})`, by: PLAIN });
  const set = at((d, ev) => ev === "feed_set" && d.symbol === "cbETH");
  if (set >= 0) out.push({ text: `Atlas set cbETH's oracle feed as the governor, as the proposal does (trace #${set})`, by: PLAIN });
  const level2 = t.some((e) => e.event === "feed_set");
  const read = at((d, ev) => ev === "price_read" && d.symbol === "cbETH" && (level2 ? d.phase === "post-apply" : d.phase !== "pre-apply"));
  if (read >= 0) {
    const p = rec(t[read]!.data).priceUsd1e18;
    if (typeof p === "string" && /^\d+$/.test(p)) out.push({ text: `cbETH's price read${level2 ? " after the change" : ""} was ${formatUsd1e18(BigInt(p))} (trace #${read})`, by: PLAIN });
  }
  for (const [i, e] of t.entries()) {
    if (e.event !== "call_trace") continue;
    const d = rec(e.data);
    if (d.ok !== true || typeof d.count !== "number") continue;
    const when = d.phase === "pre-apply" ? "before the change, " : level2 ? "after the change, " : "";
    out.push({ text: `${when}cbETH's price read touched ${plural(d.count, "price source", "price sources")} (trace #${i})`, by: PLAIN });
  }
  return out;
}

/** The round's finding, said by plain code: who chose which lines. Links to the finding itself. */
function findingSentence(f: Finding): WhySentence {
  // A model id starting "none:" is not a model: the finding was written by hand (the fixture finding).
  if (f.proposedBy.role !== "human" && f.proposedBy.model.startsWith("none:")) return { text: `${f.file} lines ${f.lineStart}–${f.lineEnd} were chosen for this round by hand (a fixture finding written by hand, not a model)`, by: PLAIN };
  const who = f.proposedBy.role === "human" ? "a person" : f.proposedBy.model;
  return { text: `${who} chose ${f.file} lines ${f.lineStart}–${f.lineEnd} for this round`, by: PLAIN };
}

/**
 * Every templated sentence for this run (and the round's finding first, when there is one).
 * None at all when the run may not be shown as fact (src/trust.ts): the page shows the reason instead.
 */
export function templatedSentences(run: Run, finding?: Finding): WhySentence[] {
  if (notShownAsFact(run) !== null) return [];
  return [...(finding ? [findingSentence(finding)] : []), ...(run.runner === "evm" ? evmSentences(run) : tsSentences(run))];
}
