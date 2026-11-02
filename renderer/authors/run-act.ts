// R8 (Dami: "the machine is static?", then "Run plays the real trace"): during the run, the machine acts out what the code really did, one
// recorded step at a time. Pure. Every motion here comes from a field the run already recorded; a motion with no field behind it is not made.
//
// Where each motion comes from (the README in tests/evidence/R8 has the same table):
// - ink enters at "starts here": the run's trace has its `start` event and the tested function is drawn.
// - a call lights its pipe and its fake flashes once: one `stand_in_call` / `call` event in the trace (pathItems' "call" item). The pipe
//   is drawn only when one function's own lines call that fake (the true caller is known), as the resting drawing already rules.
// - a helper's lamp and pipe: one step of the third traced run (D61: names and order only). No traced run, no helper step.
// - the loop wheel turns once: passes are NOT recorded. It turns for each recorded call to the one fake that is certain to be called once
//   per pass (see wheelMarks). A helper step of the third run never turns it (its caller is not certain on recursive code).
// - the clock dial sweeps, with "N ms" beside it: a gap in the virtual clock between two recorded events, given to the one drawn function
//   that waits only when the last helper step before the gap is that function (or a helper that called it), the clock moves only for the
//   code, and that function is the only waiter known to have run. Otherwise the caption says "N ms pass" and no dial moves.
// - the chute drops: the run threw and plain code placed the end on that chute (endOfRun), the same fact that makes it red.
import { certainPath } from "../../src/call-sites";
import type { FileOutline } from "../../src/file-outline";
import type { MachineEnd, MachineParts } from "./machine";
import { pathItems, type PathItem, type WhatHappenedInput } from "./what-happened";

export type ActMotion =
  | { kind: "enter"; part: string }
  | { kind: "pipe"; route: string }
  | { kind: "lamp"; part: string }
  | { kind: "flash"; port: string }
  | { kind: "turn"; part: string }
  | { kind: "dial"; part: string; ms: number; /** Beside the dial instead of "N ms" (a folded step's several waits). */ label?: string }
  | { kind: "chute"; part: string };

export interface ActStep {
  /** The caption under the machine, in plain words, from the same data. */
  words: string;
  /** Virtual time this step took (a wait's ms), which sets its share of the act's real time. 0 for an instant. */
  vms: number;
  motions: ActMotion[];
  /** The recorded field this step comes from. */
  field: string;
  /** A stretch of virtual time: its ms, or null when the run did not report time. */
  wait?: number | null;
}

export interface Act {
  steps: ActStep[];
  /** Motions that do not play for this run, and why, in plain words. */
  quiet: string[];
}

export interface ActInput {
  run: WhatHappenedInput["run"];
  experiment: NonNullable<WhatHappenedInput["experiment"]>;
  helpers: WhatHappenedInput["helpers"] | null;
  parts: MachineParts;
  outline: Pick<FileOutline, "joins" | "bodies" | "callFacts">;
  tested: string | null;
  end: MachineEnd | null;
  /** Each fake's call sites in the file, by port id (the bench model's `calledBy`). */
  portSites: ReadonlyMap<string, readonly { part: string; lines: readonly number[] }[]>;
  /** Parts known to have run (ranParts): the dial is used only when exactly one of them waits. */
  ran: ReadonlySet<string>;
  /** Nothing but the code moves the clock (no scripted delay or wait in the test). */
  clockIsTheCodes: boolean;
}

const grouped = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Per housing with a loop: the one fake whose recorded calls each mark one pass, or none. Passes are not recorded, so a call stands for a
 * pass only when that is certain from the code's text (after review R8 MAJOR-2): the fake has exactly one call site in the function, that
 * line holds exactly one call, the line sits inside exactly one loop's body (not its header, not a nested loop's body as well), and it is the
 * function's own line (not a nested callback's). Anything else: the wheel stays still. A call under an `if` in the body can still mark fewer
 * passes than ran, never more.
 */
function wheelMarks(o: Pick<ActInput, "parts" | "outline" | "portSites">, quiet: string[]): Map<string, { part: string; line: number }> {
  const out = new Map<string, { part: string; line: number }>();
  const facts = o.outline.callFacts;
  for (const h of o.parts.housings) {
    const body = o.outline.bodies?.[h.name];
    const spans = (body?.loopSpans ?? []).filter(([a, z]) => a > 0 && a <= z);
    if (!h.loops.length) continue;
    const nested = body?.nested ?? [];
    const own = (l: number) => !nested.some(([a, z]) => a <= l && l <= z);
    const marks: { port: string; line: number }[] = [];
    for (const q of o.parts.ports) {
      const sites = o.portSites.get(q.id) ?? [];
      if (sites.length !== 1 || sites[0]!.part !== h.id || sites[0]!.lines.length !== 1) continue;
      const line = sites[0]!.lines[0]!;
      // How many calls of this fake that one line makes, as the parser counted them (a parameter's calls, or a library's).
      const calls = (facts?.paramCalls ?? []).filter((c) => c.fn === h.name && c.line === line).length + (facts?.freeCalls ?? []).filter((c) => c.name === q.name && c.line === line).length + (facts?.importCalls ?? []).filter((c) => c.line === line && (c.member === q.name || c.module === q.name)).length;
      if (calls !== 1 || !own(line)) continue;
      if (spans.filter(([a, z]) => a <= line && line <= z).length !== 1) continue;
      marks.push({ port: q.id, line });
    }
    // Two fakes that could each mark a pass: take the earlier line, so a pass that calls both turns the wheel once.
    marks.sort((a, b) => a.line - b.line);
    if (marks.length > 1 && marks[0]!.line === marks[1]!.line) continue;
    if (marks[0]) out.set(marks[0].port, { part: h.id, line: marks[0].line });
  }
  if (out.size === 0 && o.parts.housings.some((h) => h.loops.length > 0)) quiet.push("The loop wheel stays still: passes are not recorded, and no fake is called exactly once per pass, from one line inside exactly one loop's body.");
  return out;
}

/** The act for one run: its steps in the order they happened, each with the motions its recorded field allows. */
export function runAct(o: ActInput): Act {
  const quiet: string[] = [];
  const ids = new Set(o.parts.housings.map((h) => h.id));
  const start = o.tested && ids.has(o.tested) ? o.tested : null;
  const joins = o.parts.pipes.map((e) => ({ id: `${e.from}->${e.to}`, from: e.from, to: e.to, kind: e.kind }));
  const way = (target: string): { routes: string[]; lamps: string[] } => {
    if (!start) return { routes: [], lamps: [] };
    if (start === target) return { routes: [], lamps: [] };
    const p = certainPath({ joins } as never, start, target);
    return p ? { routes: p.joins, lamps: p.parts.slice(1) } : { routes: [], lamps: [] };
  };
  const marks = wheelMarks(o, quiet);
  const turnFor = (name: string): ActMotion[] => {
    const m = marks.get(name);
    return m ? [{ kind: "turn", part: m.part }] : [];
  };
  const waiters = o.parts.housings.filter((h) => h.waits.length > 0 && o.ran.has(h.id));
  const dialPart = o.clockIsTheCodes && waiters.length === 1 ? waiters[0]!.id : null;
  // After review R8 MAJOR-1: a gap on the clock is that dial's only when the last helper step before it (D61 order) is that part, or a
  // helper whose own calls include it (a decorator's wrapper running the waiting function). One step accounts for one gap at most.
  let lastHelper: { name: string; within: readonly string[] } | null = null;
  let helperAt = 0;
  const steps: ActStep[] = [];
  const trace = Array.isArray(o.run.trace) ? o.run.trace : [];
  const startEvent = trace.find((e) => e.event === "start");
  if (start && startEvent) steps.push({ words: `Atlas calls ${start}`, vms: 0, motions: [{ kind: "enter", part: start }, { kind: "lamp", part: start }], field: "run.trace: the start event" });
  else quiet.push(start ? "No ink enters: the run's trace has no start event." : "No ink enters: the function Atlas called is not drawn on this machine.");

  const helperSteps = o.helpers && "steps" in o.helpers ? o.helpers.steps : null;
  if (!helperSteps) quiet.push(o.helpers && "none" in o.helpers ? `No helper lamps or pipes: ${o.helpers.none}` : "No helper lamps or pipes: the separate traced run is not here.");

  const callMotions = (name: string): ActMotion[] => {
    const port = o.parts.ports.find((q) => q.name === name);
    if (!port) return [];
    const m: ActMotion[] = [];
    if (port.from.length === 1) {
      const caller = port.from[0]!;
      const go = way(caller);
      for (const r of [...go.routes, `${caller}->${port.id}`]) m.push({ kind: "pipe", route: r });
      for (const l of [...go.lamps, caller]) m.push({ kind: "lamp", part: l });
    }
    m.push({ kind: "flash", port: port.id }, { kind: "lamp", part: port.id }, ...turnFor(port.id));
    return m;
  };

  const { items } = pathItems({ run: o.run, experiment: o.experiment, ...(helperSteps ? { helpers: { steps: helperSteps } } : {}) });
  let unwaitedDial = false;
  for (const it of items as PathItem[]) {
    switch (it.kind) {
      case "call":
        steps.push({ words: `call ${it.n} to ${it.name}: ${it.answer ?? "no answer yet"}`, vms: 0, motions: callMotions(it.name), field: `run.trace: ${it.name} call ${it.n}` });
        break;
      case "together":
        steps.push({ words: `${it.calls.length} calls at once: ${[...new Set(it.calls.map((c) => c.name))].join(", ")}`, vms: 0, motions: it.calls.flatMap((c) => callMotions(c.name)), field: "run.trace: calls begun at the same moment" });
        break;
      case "answer":
        steps.push({ words: `${it.name} ${it.words}`, vms: 0, motions: [], field: `run.trace: ${it.name}'s answer to call ${it.n}` });
        break;
      case "helper": {
        const step = helperSteps?.[helperAt++];
        lastHelper = { name: it.name, within: step && step.name === it.name ? (step.within ?? []) : [] };
        const m: ActMotion[] = [];
        if (ids.has(it.name)) {
          const go = way(it.name);
          for (const r of go.routes) m.push({ kind: "pipe", route: r });
          for (const l of [...go.lamps, it.name]) m.push({ kind: "lamp", part: l });
          m.push(...turnFor(it.name));
        }
        steps.push({ words: `${it.name} runs${it.threw ? " and throws" : ""}`, vms: 0, motions: m, field: "helpers.steps (the third traced run, D61: names and order only)" });
        break;
      }
      case "wait": {
        const ms = it.ms;
        const mine = dialPart !== null && lastHelper !== null && (lastHelper.name === dialPart || lastHelper.within.includes(dialPart));
        if (ms !== null && mine) steps.push({ words: `waits ${grouped(ms)} ms`, vms: ms, wait: ms, motions: [{ kind: "dial", part: dialPart!, ms }], field: "run.trace: event times on the virtual clock, after a helper step of that part" });
        else {
          if (ms !== null) unwaitedDial = true;
          steps.push({ words: ms === null ? "time passes (not reported)" : `${grouped(ms)} ms pass`, vms: ms ?? 0, wait: ms, motions: [], field: "run.trace: event times on the virtual clock" });
        }
        lastHelper = null;
        break;
      }
      case "atlas-wait":
        steps.push({ words: `Atlas waits ${grouped(it.ms)} ms before its next call`, vms: it.ms, motions: [], field: "the test's own scripted wait" });
        break;
      case "turn":
        steps.push({ words: `Atlas makes call ${it.n} of ${it.of}: ${it.fn}`, vms: 0, motions: start && it.fn === start ? [{ kind: "enter", part: start }] : [], field: "run.trace: call_start" });
        break;
      case "turn-end":
        steps.push({ words: it.words, vms: 0, motions: [], field: "run.trace: call_returned / call_threw" });
        break;
      case "end": {
        const chute = o.end?.on === "chute" && /^threw/.test(it.words) ? o.end : null;
        steps.push({ words: `${it.words}${chute?.line ? `, out of line ${chute.line}` : ""}`, vms: 0, motions: chute ? [{ kind: "chute", part: chute.part }] : [], field: chute ? "run.result.measured.outcome, placed on the chute by endOfRun" : "run.result.measured.outcome" });
        break;
      }
      case "stop":
      case "late":
        steps.push({ words: it.words, vms: 0, motions: [], field: it.kind === "late" ? "run.trace: after the code had ended" : "run.trace: where Atlas stops claiming" });
        break;
      default:
        break;
    }
  }
  if (unwaitedDial) quiet.push(!o.parts.housings.some((h) => h.waits.length > 0) ? "No dial: no function drawn here waits." : dialPart === null ? (o.clockIsTheCodes ? "The dial stays still: more than one function that waits ran, or none is known to have run, so which one waited is not known." : "The dial stays still: the test itself scripts delays, so a wait in the code is not the only thing that moves the clock.") : `Some time passed with no step of ${dialPart} just before it, so ${dialPart}'s dial does not claim it.`);
  if (o.end?.on !== "chute" && o.run.result?.measured && (o.run.result.measured as Record<string, unknown>).outcome === "threw") quiet.push("No chute drops: plain code could not place the throw on one chute.");
  return { steps, quiet };
}

/** Folds the middle of a long act so each step stays readable: at most `max` steps, the first and last kept as they were. */
export function fitAct(steps: readonly ActStep[], max = 24): ActStep[] {
  if (steps.length <= max) return [...steps];
  const head = steps.slice(0, 2);
  const tail = steps.slice(-2);
  const mid = steps.slice(2, -2);
  const room = max - head.length - tail.length;
  const k = Math.ceil(mid.length / room);
  const out: ActStep[] = [...head];
  for (let i = 0; i < mid.length; i += k) {
    const chunk = mid.slice(i, i + k);
    if (chunk.length === 1) {
      out.push(chunk[0]!);
      continue;
    }
    const calls = new Map<string, number>();
    let waits = 0;
    let waited = 0;
    let unreported = 0;
    for (const s of chunk) {
      for (const m of s.motions) if (m.kind === "flash") calls.set(m.port.replace(/^stand-in /, ""), (calls.get(m.port.replace(/^stand-in /, "")) ?? 0) + 1);
      if (s.wait === null) unreported++;
      else if (s.wait !== undefined) {
        waits++;
        waited += s.wait;
      }
    }
    const parts = [...[...calls].map(([n, c]) => `${n} ${c === 1 ? "once" : `${c} times`}`), ...(waits ? [waits === 1 ? `1 wait, ${grouped(waited)} ms` : `${waits} waits, ${grouped(waited)} ms in all`] : []), ...(unreported ? [`time passes ${unreported === 1 ? "once" : `${unreported} times`} (not reported)`] : [])];
    // One flash per fake and one turn per wheel in a folded step: the caption carries the exact counts.
    const seen = new Set<string>();
    const motions: ActMotion[] = [];
    const dials: Extract<ActMotion, { kind: "dial" }>[] = [];
    for (const s of chunk)
      for (const m of s.motions) {
        if (m.kind === "dial") {
          dials.push(m);
          continue;
        }
        const key = JSON.stringify(m);
        if (!seen.has(key)) {
          seen.add(key);
          motions.push(m);
        }
      }
    // One sweep for the folded waits, their virtual ms added up, on the one dial they were all on.
    if (dials.length && dials.every((d) => d.part === dials[0]!.part)) motions.push({ kind: "dial", part: dials[0]!.part, ms: dials.reduce((n, d) => n + d.ms, 0), ...(dials.length > 1 ? { label: `${dials.length} waits` } : {}) });
    out.push({ words: `steps ${i + 3}–${i + 2 + chunk.length}: ${parts.length ? parts.join(", ") : `${chunk.length} steps`}`, vms: chunk.reduce((n, s) => n + s.vms, 0), motions, field: chunk[0]!.field === chunk[chunk.length - 1]!.field ? chunk[0]!.field : "several recorded steps, folded" });
  }
  out.push(...tail);
  return out;
}

/** Real time for each step: about 3 to 6 s in all whatever the virtual time, no step under `min` ms; waits get more in proportion to their virtual ms. */
export function actTimes(steps: readonly Pick<ActStep, "vms">[], o: { min?: number; per?: number; lo?: number; hi?: number } = {}): { at: number; ms: number }[] {
  const min = o.min ?? 250;
  const n = steps.length;
  if (n === 0) return [];
  const total = Math.max(o.lo ?? 3000, Math.min(o.hi ?? 6000, n * (o.per ?? 330)));
  const extra = Math.max(0, total - n * min);
  const virtual = steps.reduce((s, x) => s + Math.max(0, x.vms), 0);
  // Half the spare time evenly, half by virtual time (all of it evenly when nothing waited).
  const even = virtual > 0 ? extra / 2 : extra;
  const byTime = virtual > 0 ? extra / 2 : 0;
  let at = 0;
  return steps.map((s) => {
    const ms = min + even / n + (virtual > 0 ? (byTime * Math.max(0, s.vms)) / virtual : 0);
    const out = { at: Math.round(at), ms: Math.round(ms) };
    at += ms;
    return out;
  });
}
