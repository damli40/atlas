// R8 (Dami: "the machine is static?", then "Run plays the real trace"): during the run, the machine acts out what the code really did, one
// recorded step at a time. Pure. Every motion here comes from a field the run already recorded; a motion with no field behind it is not made.
//
// Where each motion comes from (the README in tests/evidence/R8 has the same table):
// - ink enters at "starts here": the run's trace has its `start` event and the tested function is drawn.
// - a call lights its pipe and its fake flashes once: one `stand_in_call` / `call` event in the trace (pathItems' "call" item). The pipe
//   is drawn only when one function's own lines call that fake (the true caller is known), as the resting drawing already rules.
// - a helper's lamp and pipe: one step of the third traced run (D61: names and order only). No traced run, no helper step.
// - the loop wheel turns once: passes are NOT recorded. It turns for a recorded call whose every call site sits inside that loop's lines,
//   and only for the earliest such call in the loop body, so a pass with three calls turns it once, not three times. Only a fake's call
//   counts (the sealed trace records it); a helper step of the third run does not (its caller is not certain on recursive code).
// - the clock dial sweeps, with "N ms" beside it: a gap in the virtual clock between two recorded events, under the same rule the resting
//   drawing uses (only the code moves the clock, and exactly one function that waits is known to have run).
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
  | { kind: "dial"; part: string; ms: number }
  | { kind: "chute"; part: string };

export interface ActStep {
  /** The caption under the machine, in plain words, from the same data. */
  words: string;
  /** Virtual time this step took (a wait's ms), which sets its share of the act's real time. 0 for an instant. */
  vms: number;
  motions: ActMotion[];
  /** The recorded field this step comes from. */
  field: string;
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
  outline: Pick<FileOutline, "joins" | "bodies">;
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

/** Per housing with a loop: the one name whose recorded calls turn its wheel, or null. */
function wheelMarks(o: Pick<ActInput, "parts" | "outline" | "tested" | "portSites">): Map<string, { part: string; line: number; loop: [number, number] }> {
  const out = new Map<string, { part: string; line: number; loop: [number, number] }>();
  for (const h of o.parts.housings) {
    const spans = o.outline.bodies?.[h.name]?.loopSpans ?? [];
    if (!spans.length) continue;
    const nested = o.outline.bodies?.[h.name]?.nested ?? [];
    const own = (l: number) => !nested.some(([a, z]) => a <= l && l <= z);
    // Candidates: a fake whose every call site is this function's own line.
    const cands: { name: string; lines: readonly number[] }[] = [];
    for (const q of o.parts.ports) {
      const sites = o.portSites.get(q.id) ?? [];
      if (sites.length === 1 && sites[0]!.part === h.id && sites[0]!.lines.length > 0) cands.push({ name: q.id, lines: sites[0]!.lines });
    }
    // Not the helpers of the third traced run: on a recursive file (orders.ts's fetchPage) its steps include calls the helper made to itself,
    // so who called is not certain enough to count a loop's passes by them. Only a fake's call, which the sealed trace itself records.
    let best: { name: string; line: number; loop: [number, number] } | null = null;
    for (const c of cands) {
      for (const span of spans) {
        // Every site inside this loop's lines and the function's own (not a nested callback's): every recorded call came from in there.
        if (!c.lines.every((l) => l > span[0] && l <= span[1] && own(l))) continue;
        const first = Math.min(...c.lines);
        if (!best || first < best.line) best = { name: c.name, line: first, loop: span };
      }
    }
    // Two names on the earliest line: which one marks a pass is not known, so neither does.
    if (best && cands.filter((c) => c.lines.every((l) => l > best!.loop[0] && l <= best!.loop[1]) && Math.min(...c.lines) === best!.line).length > 1) continue;
    if (best) out.set(best.name, { part: h.id, line: best.line, loop: best.loop });
  }
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
  const marks = wheelMarks(o);
  const turnFor = (name: string): ActMotion[] => {
    const m = marks.get(name);
    return m ? [{ kind: "turn", part: m.part }] : [];
  };
  const waiters = o.parts.housings.filter((h) => h.waits.length > 0 && o.ran.has(h.id));
  const dialPart = o.clockIsTheCodes && waiters.length === 1 ? waiters[0]!.id : null;
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
        if (ms !== null && dialPart) steps.push({ words: `waits ${grouped(ms)} ms`, vms: ms, motions: [{ kind: "dial", part: dialPart, ms }], field: "run.trace: event times on the virtual clock" });
        else {
          if (ms !== null) unwaitedDial = true;
          steps.push({ words: ms === null ? "time passes (not reported)" : `${grouped(ms)} ms pass`, vms: ms ?? 0, motions: [], field: "run.trace: event times on the virtual clock" });
        }
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
  if (unwaitedDial) quiet.push(dialPart === null && o.parts.housings.some((h) => h.waits.length > 0) ? (o.clockIsTheCodes ? "The dial stays still: more than one function that waits ran, or none is known to have run, so which one waited is not known." : "The dial stays still: the test itself scripts delays, so a wait in the code is not the only thing that moves the clock.") : "No dial: no function drawn here waits.");
  if (marks.size === 0 && o.parts.housings.some((h) => h.loops.length > 0)) quiet.push("The loop wheel stays still: passes are not recorded, and no recorded call sits only inside the loop's lines.");
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
    for (const s of chunk) {
      for (const m of s.motions) if (m.kind === "flash") calls.set(m.port.replace(/^stand-in /, ""), (calls.get(m.port.replace(/^stand-in /, "")) ?? 0) + 1);
      if (s.motions.some((m) => m.kind === "dial") || /^waits |ms pass$/.test(s.words)) {
        waits++;
        waited += s.vms;
      }
    }
    const parts = [...[...calls].map(([n, c]) => `${n} ${c === 1 ? "once" : `${c} times`}`), ...(waits ? [`${waits} ${waits === 1 ? "wait" : "waits"} (${grouped(waited)} ms)`] : [])];
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
    if (dials.length && dials.every((d) => d.part === dials[0]!.part)) motions.push({ kind: "dial", part: dials[0]!.part, ms: dials.reduce((n, d) => n + d.ms, 0) });
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
