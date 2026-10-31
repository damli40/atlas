// R3 author (c), and (d) the retry demo: the "what happened" path, from the measured trace only (D54).
//
// Plain words: read the run's trace in order. Each call of a stand-in or a network fake becomes a pinned ticket; what it
// answered is written beside the red thread leaving it; a gap on Atlas's virtual clock becomes a clock; the ending comes
// from the measured fields, not from a guess.
//
// What it refuses to do:
// - A run that may not be shown as fact (src/trust.ts) draws nothing; the spec carries the reason.
// - A trace Atlas cut stops where it was cut and says so; the ending still comes from the measured fields.
// - If the second run of the double run went differently, the path stops at the first difference and says so.
// - A wait whose time was not reported says "time not reported". A count not claimed says so in a caption.
// - A verdict of can't check gets a can't-check mark with the reason, never a place on the path.
// Loops: when there are many calls, runs of calls with the same answer collapse into one ticket with the exact count.
//
// Pure; imports types and the pure src/trust.ts rule only.

import type { Bet, Experiment, JsonValue, NetworkStep, Run, StandInStep, TraceEvent, Verdict } from "../../src/types";
import { notShownAsFact } from "../../src/trust";
import type { RenderSpec, SpecMark, SpecNode, SpecStep } from "../spec";

const rec = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const own = (o: Record<string, unknown>, k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const grouped = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const clip = (s: string, n = 44) => {
  const c = Array.from(s);
  return c.length > n ? `${c.slice(0, n - 1).join("")}…` : s;
};
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

/** One thing on the path. */
export type PathItem =
  | { kind: "call"; name: string; n: number; t: number; answer: string; good: boolean }
  | { kind: "loop"; name: string; from: number; to: number; count: number; t: number; answer: string; waits: { min: number; max: number } | null; good: boolean }
  | { kind: "wait"; ms: number | null; t: number; cut?: boolean }
  | { kind: "end"; words: string; t: number | null; good: boolean }
  | { kind: "stop"; words: string }
  /** A sequence: Atlas makes call n of m. */
  | { kind: "turn"; n: number; of: number; fn: string; t: number }
  /** A sequence: how an earlier call ended. */
  | { kind: "turn-end"; n: number; words: string; t: number }
  /** A sequence: Atlas's own scripted wait between calls, not the code's. */
  | { kind: "atlas-wait"; ms: number; t: number };

export interface WhatHappenedInput {
  run: Pick<Run, "id" | "trace" | "result" | "controlPassed" | "twin" | "conditions" | "forkBlock">;
  /** The test that was run: gives the scripted answers (the trace says a call answered; the script says what with). */
  experiment?: Pick<Experiment, "params">;
  bets?: Pick<Bet, "id" | "who" | "measures" | "answer">[];
  verdicts?: Pick<Verdict, "betId" | "outcome" | "reason">[];
  title?: string;
  kicker?: string;
  seed?: string;
  /** A label the entry must show (PRE-EXISTING.md). */
  preExisting?: string;
  /** Collapse loops past this many calls. */
  collapseOver?: number;
}

/** What the n-th call was scripted to answer, in words; null when the script does not say. */
function scripted(input: WhatHappenedInput, name: string, n: number): { words: string; good: boolean } | null {
  const p = input.experiment?.params;
  if (!p || p.shape !== "call-function") return null;
  const pick = <T,>(calls: T[], then: string): T | undefined => (n <= calls.length ? calls[n - 1] : then === "repeat_last" ? calls[calls.length - 1] : undefined);
  if (p.network && p.network.replaces === name) {
    const s = pick<NetworkStep>(p.network.calls, p.network.then);
    if (s?.do === "respond") return { words: `answered ${s.status} (scripted)`, good: s.status < 400 };
    return null;
  }
  for (const a of p.args) {
    if (a.kind !== "stand-in" || a.name !== name) continue;
    const s = pick<StandInStep>(a.calls, a.then);
    if (s?.do === "return") return { words: `returned ${clip(JSON.stringify(s.value as JsonValue), 26)} (scripted)`, good: true };
  }
  return null;
}

/** Trace events compared across the two runs of the double run: what happened, when, to whom. */
const fingerprint = (e: TraceEvent) => {
  const d = rec(e.data);
  return `${e.t}|${e.event}|${str(d.name) ?? ""}|${num(d.n) ?? ""}|${str(d.errorName) ?? ""}`;
};
const BOOKKEEPING = new Set(["call_checks", "clock_moves", "conditions", "log", "control"]);

/** The path items, read in trace order. Exported for the tests. */
export function pathItems(input: WhatHappenedInput): { items: PathItem[]; notes: string[] } {
  const { run } = input;
  const measured = rec(run.result?.measured);
  const notMeasured = rec(run.result?.notMeasured);
  const trace = Array.isArray(run.trace) ? run.trace : [];
  const items: PathItem[] = [];
  const notes: string[] = [];
  let lastT = 0;
  let ended = false;
  const timeOk = !("virtualMs" in notMeasured) && !("totalWaitMs" in notMeasured);
  if (!timeOk) notes.push(`Time is not reported: ${str(own(notMeasured, "virtualMs")) ?? str(own(notMeasured, "totalWaitMs")) ?? "Atlas did not measure it"}.`);

  // Where the two runs of the double run part, if they do.
  let divergeAt = Infinity;
  const twin = run.twin?.trace;
  if (Array.isArray(twin)) {
    const a = trace.filter((e) => !BOOKKEEPING.has(e.event) && e.event !== "start");
    const b = twin.filter((e) => !BOOKKEEPING.has(e.event) && e.event !== "start");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (!a[i] || !b[i] || fingerprint(a[i]!) !== fingerprint(b[i]!)) {
        divergeAt = a[i] ? trace.indexOf(a[i]!) : Infinity;
        break;
      }
    }
  }

  const addGap = (t: number) => {
    if (t > lastT) {
      items.push({ kind: "wait", ms: timeOk ? t - lastT : null, t });
      lastT = t;
    }
  };
  // A sequence measures the last call's own time; the path's clock is the whole run's, so the ending adds where that call began.
  const lastStart = [...trace].reverse().find((e) => e.event === "call_start")?.t ?? 0;
  const startData = rec(trace.find((e) => e.event === "start")?.data);
  const seqCalls = input.experiment?.params.shape === "call-function" ? input.experiment.params.calls : undefined;
  const nCalls = num(startData.calls) ?? seqCalls?.length ?? 0;
  const endItem = (): PathItem => {
    const outcome = str(own(measured, "outcome"));
    const raw = num(own(measured, "virtualMs")) ?? num(own(measured, "settledAtMs"));
    const v = raw === null ? null : raw + lastStart;
    const at = v !== null ? ` at ${grouped(v)} ms` : "";
    if (outcome === "returned" || outcome === "returns") {
      const j = str(own(measured, "returnedJson")) ?? str(own(measured, "returned"));
      return { kind: "end", words: j !== null ? `returned ${clip(j, 40)}` : "returned", t: v, good: true };
    }
    if (outcome === "threw" || outcome === "throws") {
      const name = str(own(measured, "thrownName")) ?? str(own(measured, "thrown"))?.split(":")[0] ?? null;
      return { kind: "end", words: `threw${name ? ` ${clip(name, 36)}` : ""}${at}`, t: v, good: false };
    }
    if (outcome === "never_settled" || outcome === "pending") return { kind: "end", words: "still waiting when Atlas stopped: nothing was left to wake it", t: null, good: false };
    if (outcome === "still_running_at_watch_limit" || outcome === "stopped") return { kind: "end", words: "still running when Atlas stopped watching", t: null, good: false };
    return { kind: "stop", words: `Atlas can't say how it ended: ${str(own(notMeasured, "outcome")) ?? "the run recorded no ending"}` };
  };

  for (let idx = 0; idx < trace.length; idx++) {
    const e = trace[idx]!;
    if (idx >= divergeAt) {
      items.push({ kind: "stop", words: "the second run of this test went differently from here, so Atlas does not claim what came next" });
      break;
    }
    if (BOOKKEEPING.has(e.event) || e.event === "start") continue;
    const d = rec(e.data);
    if (e.event === "call_start" && nCalls > 1) {
      const n = num(d.n) ?? 1;
      const scriptedWait = seqCalls?.[n - 1]?.waitMs ?? 0;
      if (scriptedWait > 0 && e.t - lastT >= scriptedWait) {
        addGap(e.t - scriptedWait);
        items.push({ kind: "atlas-wait", ms: scriptedWait, t: e.t });
        lastT = e.t;
      } else addGap(e.t);
      items.push({ kind: "turn", n, of: nCalls, fn: str(d.exportName) ?? "the function", t: e.t });
      continue;
    }
    if (e.event === "call_returned" || e.event === "call_threw") {
      addGap(e.t);
      const json = str(d.json);
      const name = str(d.name) ?? str(d.type);
      items.push({ kind: "turn-end", n: num(d.n) ?? 1, t: e.t, words: e.event === "call_returned" ? (json !== null ? `call ${num(d.n) ?? 1} returned ${clip(json, 30)}` : `call ${num(d.n) ?? 1} returned`) : `call ${num(d.n) ?? 1} threw${name ? ` ${clip(name, 30)}` : ""}` });
      continue;
    }
    if (e.event === "trace_cut") {
      const kept = num(d.kept);
      const more = num(d.dropped) ?? num(d.eventsNotKept);
      items.push({ kind: "stop", words: `the run made more events than Atlas keeps${kept !== null ? ` (${grouped(kept)} kept${more !== null ? `, ${grouped(more)} more counted` : ""})` : ""}, so the path stops here` });
      break;
    }
    if (e.event === "stand_in_call" || e.event === "call") {
      const name = str(d.name) ?? "the RPC";
      const n = num(d.n) ?? 1;
      if (e.event === "stand_in_call" && d.afterSettle === true && !ended) {
        ended = true;
        items.push(endItem());
      }
      addGap(e.t);
      items.push({ kind: "call", name, n, t: e.t, answer: "no answer seen", good: false });
      continue;
    }
    if (e.event === "stand_in_returns" || e.event === "resolve" || e.event === "stand_in_throws" || e.event === "reject" || e.event === "stand_in_never_answers" || e.event === "no_answer") {
      const name = str(d.name) ?? "the RPC";
      const n = num(d.n) ?? 1;
      const call = [...items].reverse().find((x): x is Extract<PathItem, { kind: "call" }> => x.kind === "call" && x.name === name && x.n === n);
      if (!call) continue;
      if (e.event === "stand_in_never_answers" || e.event === "no_answer") {
        call.answer = "never answered";
      } else if (e.event === "stand_in_throws" || e.event === "reject") {
        const err = str(d.errorName) ?? str(d.error)?.split(":")[0] ?? "an error";
        call.answer = `threw ${clip(err, 30)}`;
      } else {
        const s = scripted(input, name, n);
        call.answer = s ? s.words : "answered";
        call.good = s ? s.good : true;
      }
      continue;
    }
    if (e.event === "sleep") {
      // Retry scenario: the code asked for this wait; the following "wake" finishes it.
      const ms = num(d.ms);
      const woke = trace.slice(idx + 1).some((x) => x.event === "wake");
      items.push({ kind: "wait", ms: timeOk ? ms : null, t: e.t + (ms ?? 0), ...(woke ? {} : { cut: true }) });
      lastT = e.t + (ms ?? 0);
      continue;
    }
    if (e.event === "wake") continue;
    if (e.event === "returned" || e.event === "threw" || e.event === "returns" || e.event === "throws") {
      if (!ended) {
        addGap(e.t);
        ended = true;
        items.push(endItem());
      }
      continue;
    }
    if (e.event === "pending" || e.event === "stopped_watching" || e.event === "never_settled" || e.event === "still_running") {
      if (!ended) {
        ended = true;
        items.push(endItem());
      }
    }
  }
  if (!ended && !items.some((i) => i.kind === "stop")) items.push(endItem());
  if (!ended && items[items.length - 1]?.kind === "stop" && items.filter((i) => i.kind === "stop").length === 1 && str(own(measured, "outcome"))) {
    const e = endItem();
    if (e.kind === "end") items.push(e);
  }
  for (const k of Object.keys(notMeasured)) if (k.startsWith("calls:")) notes.push(`Atlas does not claim a final count of ${k.slice(6)}: ${str(notMeasured[k]) ?? "not measured"}.`);
  return { items, notes };
}

/** Runs of 3+ calls with the same answer collapse, past `over` calls in all, keeping `keep` (a call number) on its own. */
export function collapse(items: PathItem[], over: number, keep: Set<string> = new Set()): PathItem[] {
  const calls = items.filter((i) => i.kind === "call").length;
  if (calls <= over) return items;
  const out: PathItem[] = [];
  let i = 0;
  while (i < items.length) {
    const a = items[i]!;
    if (a.kind !== "call" || keep.has(`${a.name}:${a.n}`)) {
      out.push(a);
      i++;
      continue;
    }
    let j = i;
    let last = a;
    let count = 1;
    const waits: number[] = [];
    let waitsKnown = true;
    while (j + 1 < items.length) {
      const w = items[j + 1]!;
      const c = w.kind === "wait" ? items[j + 2] : w;
      if (!c || c.kind !== "call" || c.name !== a.name || c.answer !== a.answer || keep.has(`${c.name}:${c.n}`)) break;
      if (w.kind === "wait") {
        if (w.ms === null) waitsKnown = false;
        else waits.push(w.ms);
      }
      j += w.kind === "wait" ? 2 : 1;
      last = c;
      count++;
    }
    if (count >= 3) {
      out.push({ kind: "loop", name: a.name, from: a.n, to: last.n, count, t: a.t, answer: a.answer, waits: waitsKnown && waits.length ? { min: Math.min(...waits), max: Math.max(...waits) } : null, good: a.good });
      i = j + 1;
    } else {
      out.push(a);
      i++;
    }
  }
  return out;
}

/** What a bet expected, as a range of counts or times, when it was about one. */
function expectedRange(bet: Pick<Bet, "answer">): { min: number; max: number } | null {
  const a = bet.answer;
  if (a.kind === "integer") return { min: a.value, max: a.value };
  if (a.kind === "number") return { min: a.value * (1 - a.tolerancePct / 100), max: a.value * (1 + a.tolerancePct / 100) };
  if (a.kind === "quiz") {
    const o = a.options.find((x) => x.id === a.choice);
    if (o?.match.kind === "count" || o?.match.kind === "ms") return { min: o.match.min, max: o.match.max ?? Infinity };
  }
  return null;
}

/** What the bettor said, in their option's words. */
function expectedWords(bet: Pick<Bet, "answer" | "measures">): string {
  const a = bet.answer;
  if (a.kind === "quiz") return a.options.find((x) => x.id === a.choice)?.label ?? a.choice;
  if (a.kind === "integer" || a.kind === "number") return bet.measures.startsWith("calls") ? `${grouped(a.value)} call${a.value === 1 ? "" : "s"}` : bet.measures.endsWith("Ms") ? `${grouped(a.value)} ms` : grouped(a.value);
  if (a.kind === "enum") return a.value;
  if (a.kind === "json") return clip(JSON.stringify(a.value), 30);
  return "nothing";
}

/** What a question is about, in plain words. */
function measureWords(measures: string): string {
  if (measures.startsWith("calls:")) return `calls to ${measures.slice(6)}`;
  return ({ calls: "calls", outcome: "how it ends", returnedJson: "what it returns", virtualMs: "how long it takes", totalWaitMs: "the total wait" } as Record<string, string>)[measures] ?? measures;
}

const whoWords = (who: string) => (who === "human" ? "you" : who.replace(/^model:/, "").replace(/^meta-models\//, ""));

/**
 * The call the bettor's answer and the run part at. A count that was too low parts at the first call past it; one too high,
 * at the ending ("it stopped sooner"). A time parts at the first moment past the range, else at the ending. Anything else
 * (how it ended, what it returned) parts at the ending. Exported for the tests.
 */
export function partingKey(items: PathItem[], bet: Pick<Bet, "measures" | "answer">): string {
  const range = expectedRange(bet);
  if (range) {
    if (bet.measures.startsWith("calls")) {
      const name = bet.measures.startsWith("calls:") ? bet.measures.slice(6) : null;
      const past = items.find((i) => i.kind === "call" && (name === null || i.name === name) && i.n > range.max);
      if (past && past.kind === "call") return `${past.name}:${past.n}`;
    } else if (bet.measures === "virtualMs" || bet.measures === "totalWaitMs") {
      const past = items.find((i) => (i.kind === "call" || i.kind === "wait") && i.t > range.max);
      if (past && past.kind === "call") return `${past.name}:${past.n}`;
      if (past && past.kind === "wait") return `wait:${past.t}`;
    }
  }
  return "end";
}

const keyOf = (i: PathItem): string | null => (i.kind === "call" ? `${i.name}:${i.n}` : i.kind === "wait" ? `wait:${i.t}` : i.kind === "end" ? "end" : null);

export function whatHappened(input: WhatHappenedInput): RenderSpec {
  const base: RenderSpec = {
    version: 1,
    stage: "after-run",
    seed: input.seed ?? `run:${input.run.id}`,
    kicker: input.kicker ?? "what happened",
    title: input.title ?? "The run",
    subtitle: "from the measured trace, step by step",
    nodes: [],
    edges: [],
    regions: [],
    marks: [],
    captions: [],
    steps: [],
  };
  const why = notShownAsFact(input.run);
  if (why !== null) return { ...base, notShown: why };

  const { items: raw, notes } = pathItems(input);
  const bets = input.bets ?? [];
  const verdicts = input.verdicts ?? [];
  const verdictOf = (id: string) => verdicts.find((v) => v.betId === id);
  const parting = new Map<string, string>();
  for (const b of bets) if (verdictOf(b.id)?.outcome === "not_matched") parting.set(b.id, partingKey(raw, b));
  const keep = new Set([...parting.values()]);
  const items = collapse(raw, input.collapseOver ?? 6, keep);

  const nodes: SpecNode[] = [];
  const edges: RenderSpec["edges"] = [];
  const steps: SpecStep[] = [];
  const keyToNode = new Map<string, string>();
  let prev: string | null = null;
  let pendingWords: string | undefined;
  let callNo = 0;
  const add = (node: SpecNode, step: Omit<SpecStep, "id" | "nodes" | "edges" | "provenance">) => {
    nodes.push(node);
    const edgeIds: string[] = [];
    if (prev) {
      const id = `e${edges.length}`;
      edges.push({ id, from: prev, to: node.id, ...(pendingWords ? { words: pendingWords } : {}), kind: "thread", provenance: "run" });
      edgeIds.push(id);
    }
    steps.push({ id: `s${steps.length}`, nodes: [node.id], edges: edgeIds, provenance: "run", ...step });
    prev = node.id;
    pendingWords = undefined;
  };
  for (const it of items) {
    const id = `p${nodes.length}`;
    const key = keyOf(it);
    if (key) keyToNode.set(key, id);
    if (it.kind === "call") {
      callNo++;
      add({ id, kind: "ticket", words: `called ${clip(it.name, 30)}`, small: `${ordinal(it.n)} call`, provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "call", device: it.name, words: `called ${it.name}, ${it.answer}` });
      pendingWords = it.answer;
    } else if (it.kind === "loop") {
      callNo += it.count;
      add({ id, kind: "ticket", words: `called ${clip(it.name, 24)} ${grouped(it.count)} times`, small: `calls ${grouped(it.from)} to ${grouped(it.to)}`, provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "call", device: it.name, words: `called ${it.name} ${it.count} times` });
      pendingWords = it.waits ? `each ${it.answer}, waits ${it.waits.min === it.waits.max ? `${grouped(it.waits.min)} ms` : `${grouped(it.waits.min)} to ${grouped(it.waits.max)} ms`}` : `each ${it.answer}`;
    } else if (it.kind === "wait") {
      const ms = it.ms;
      const words = ms === null ? "waited (time not reported)" : it.cut ? `was waiting ${grouped(ms)} ms when Atlas stopped` : `waited ${grouped(ms)} ms`;
      // The sweep is on a log scale: enough to feel longer waits without any one filling the dial.
      add({ id, kind: "clock", words, provenance: "run", sweep: ms === null ? 0.05 : Math.max(0.06, Math.min(0.92, Math.log10(1 + ms) / 5)) }, { beat: "wait", device: "clock", words, ...(ms === null ? {} : { ms }) });
    } else if (it.kind === "turn") {
      add({ id, kind: "ticket", words: `${clip(it.fn, 26)}`, small: `Atlas's call ${it.n} of ${it.of}`, provenance: "run", pin: "ochre" }, { beat: "start", words: `Atlas makes call ${it.n} of ${it.of}: ${it.fn}` });
    } else if (it.kind === "turn-end") {
      add({ id, kind: "ticket", words: it.words, small: `end of call ${it.n}`, provenance: "run", pin: "blue" }, { beat: "end", words: it.words });
    } else if (it.kind === "atlas-wait") {
      const words = `Atlas waited ${grouped(it.ms)} ms, as the test says`;
      add({ id, kind: "clock", words, provenance: "plain-code", sweep: Math.max(0.06, Math.min(0.92, Math.log10(1 + it.ms) / 5)) }, { beat: "wait", device: "clock", words, ms: it.ms });
    } else if (it.kind === "end") {
      add({ id, kind: "ticket", words: it.words, small: "the end", provenance: "run", pin: it.good ? "blue" : "red" }, { beat: "end", words: it.words });
    } else {
      add({ id, kind: "note", words: it.words, provenance: "run" }, { beat: "note", words: it.words });
    }
  }
  void callNo;

  // ---- marks, from the verdicts only ----
  const marks: SpecMark[] = [];
  const lastNode = nodes[nodes.length - 1]?.id;
  let partsWaysAt: string | undefined;
  for (const b of bets) {
    const v = verdictOf(b.id);
    if (!v || !lastNode) continue;
    if (b.answer.kind === "declined" && b.who === "human") continue; // no answer, nothing to mark
    const who = whoWords(b.who);
    if (v.outcome === "cant_check") {
      marks.push({ on: lastNode, kind: "cant-check", who, words: `can't check ${measureWords(b.measures)}, ${clip(v.reason ?? "not measured", 80)}` });
    } else if (v.outcome === "matched") {
      const name = b.measures.startsWith("calls:") ? b.measures.slice(6) : null;
      const lastCall = [...items].reverse().find((i) => (i.kind === "call" || i.kind === "loop") && (name === null || i.name === name));
      const on = bets.length === 1 && lastCall && b.measures.startsWith("calls") ? nodes[items.indexOf(lastCall)]!.id : lastNode;
      marks.push({ on, kind: "matched", who, words: `said ${expectedWords(b)} for ${measureWords(b.measures)}, and it matched` });
    } else {
      const key = parting.get(b.id)!;
      const on = keyToNode.get(key) ?? lastNode;
      partsWaysAt ??= on;
      marks.push({ on, kind: "didnt-match", who, words: `said ${expectedWords(b)} for ${measureWords(b.measures)}. The run parts ways here.` });
    }
  }

  // Several bettors on one step share one mark: fewer words, on clean paper.
  const merged: SpecMark[] = [];
  for (const m of marks) {
    const same = merged.find((x) => x.on === m.on && x.kind === m.kind);
    if (!same) merged.push({ ...m });
    else same.words = `${(same.words ?? "").replace(/\.$/, "")}; ${m.who} ${m.words}`;
  }
  const conditions = (input.run.conditions ?? []).map((c) => ({ words: c.says, provenance: "run" as const }));
  const captions = [
    { words: `Every step comes from run ${clip(input.run.id, 24)}'s trace. Atlas's clock is virtual: nothing waited for real.`, provenance: "run" as const },
    ...notes.map((words) => ({ words, provenance: "run" as const })),
    ...conditions,
    ...(input.preExisting ? [{ words: input.preExisting, provenance: "plain-code" as const }] : []),
  ];
  return { ...base, nodes, edges, steps, marks: merged, captions, path: { edges: edges.map((e) => e.id), provenance: "run", ...(partsWaysAt ? { partsWaysAt } : {}) }, ...(nodes.length === 0 ? { notShown: "the run recorded no step that can be drawn" } : {}) };
}

/** Author (d): the retry demo. The code is pre-existing, so the drawing says so (PRE-EXISTING.md). */
export function retryDemo(input: Omit<WhatHappenedInput, "preExisting" | "title" | "kicker"> & { preExisting?: string }): RenderSpec {
  return whatHappened({
    ...input,
    title: "withRpcRetry",
    kicker: "the retry demo",
    preExisting: `${input.preExisting ?? "Pre-existing: withRpcRetry was written before the hackathon (listed in PRE-EXISTING.md). Atlas checks it; it is not part of Atlas. This run replays from a saved file."}${input.run.result?.measured?.outcome === "pending" || input.run.result?.measured?.outcome === "never_settled" ? " In production, viem's 10 s default caps this at about 62 s." : ""}`,
  });
}
