// "Ask why" (D05-05): which sentences may be shown after a run, decided by plain code.
//
// Plain words: after a run, Atlas can show short "why" sentences. Some are written by plain code from
// the run's own trace (templates below); some are a Meta model's words (its bet rationale, the
// Investigator's claim). Either way, a sentence is shown ONLY if it points at run evidence that exists:
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

const TRACE_REF = /\btrace\s+(#\d+(?:\s*(?:,|and)\s*#\d+)*)/gi;
const LINES_REF = /(?:([\w./-]+\.[A-Za-z]{1,6})\s+)?\blines?\s+(\d+)(?:\s*[–-]\s*(\d+))?/gi;

/** Every reference the text makes. `ok: false` when one of them names no evidence. */
export function referencesOf(text: string, run: Pick<Run, "trace">, findings: readonly Finding[]): { links: WhyLink[]; bad: string[] } {
  const links: WhyLink[] = [];
  const bad: string[] = [];
  for (const m of text.matchAll(TRACE_REF)) {
    for (const n of m[1]!.matchAll(/#(\d+)/g)) {
      const index = Number(n[1]);
      const ev = Number.isSafeInteger(index) ? run.trace[index] : undefined;
      if (ev) links.push({ kind: "trace", index, event: ev.event });
      else bad.push(`trace #${n[1]} is not an event of this run (it has ${run.trace.length})`);
    }
  }
  for (const m of text.matchAll(LINES_REF)) {
    const file = m[1];
    const a = Number(m[2]);
    const b = m[3] === undefined ? a : Number(m[3]);
    const f = findings.find((x) => (file === undefined || x.file === file || x.file.endsWith(`/${file}`)) && x.verified && x.lineStart <= a && a <= b && b <= x.lineEnd);
    if (f) links.push({ kind: "lines", file: f.file, lineStart: a, lineEnd: b, findingId: f.id });
    else bad.push(`${file ? `${file} ` : ""}lines ${a}–${b} are not inside a checked finding of this round`);
  }
  return { links, bad };
}

/** Keep the sentences whose every reference resolves (at least one); drop and count the rest. */
export function linkSentences(sentences: readonly WhySentence[], run: Pick<Run, "trace">, findings: readonly Finding[]): LinkResult {
  const shown: LinkedSentence[] = [];
  const dropped: WhySentence[] = [];
  for (const s of sentences) {
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
  const sleeps = t.map((e, i) => ({ e, i })).filter((x) => x.e.event === "sleep");
  if (sleeps.length > 0) {
    const ms = sleeps.map((x) => Number(rec(x.e.data).ms));
    const same = ms.every((m) => m === ms[0]);
    const shownIx = sleeps.length <= 6 ? sleeps.map((x) => x.i) : [sleeps[0]!.i, sleeps.at(-1)!.i];
    out.push({ text: `it waited ${plural(sleeps.length, "time", "times")}${same ? `, ${ms[0]} ms each` : ""} (${refs(shownIx)})`, by: PLAIN });
  }
  const end = t.findIndex((e) => e.event === "throws" || e.event === "returns" || e.event === "pending");
  if (end >= 0) {
    const calls = t.slice(0, end).filter((e) => e.event === "call");
    const n = calls.length ? Number(rec(calls.at(-1)!.data).n) : 0;
    const callsAfter = t.slice(end + 1).some((e) => e.event === "call");
    const ev = t[end]!.event;
    if (ev === "throws" && n > 0 && !callsAfter) out.push({ text: `call ${n} threw; no more attempts (trace #${end})`, by: PLAIN });
    if (ev === "returns" && n > 0 && !callsAfter) out.push({ text: `call ${n} returned a value; no more attempts (trace #${end})`, by: PLAIN });
    if (ev === "pending") out.push({ text: `the call never settled: no timers were left and nothing was pending (trace #${end})`, by: PLAIN });
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
