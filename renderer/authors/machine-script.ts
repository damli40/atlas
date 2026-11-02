// D65: the run, told through the machine's pipes. Only what the run's path says and plain code is certain of. A thread needs the true caller: a fake with more than one
// caller, or a route that isn't the only one, gets no thread on that step. A dial sweeps only for a wait in a function known to have run, only if it is the one such
// function, and only when the helper step just before the wait is that function (or a helper that called it). Helper steps come from the third traced run, with D61's limits and caption: names and order only, never its values. Pure.
import { certainPath } from "../../src/call-sites";
import type { RenderSpec } from "../spec";
import type { MachineParts } from "./machine";
import { esc } from "../machine/pencil";

export interface MachineBeat {
  routes: string[];
  lamps: string[];
  dial?: { part: string; sweep: number };
  words?: string;
}

export function machineScript(spec: Pick<RenderSpec, "steps" | "nodes">, parts: MachineParts, outline: { joins: readonly { id: string; from: string; to: string; kind: string }[] }, tested: string | null, within: ReadonlyMap<string, readonly string[]> = new Map(), clockIsTheCodes = false): MachineBeat[] {
  const ids = new Set(parts.housings.map((h) => h.id));
  const start = tested && ids.has(tested) ? tested : null;
  const ran = new Set<string>(start ? [start] : []);
  const pathFromStart = (target: string): { routes: string[]; lamps: string[] } | null => {
    if (!start) return null;
    if (start === target) return { routes: [], lamps: [] };
    const path = certainPath(outline as never, start, target);
    if (!path) return null;
    // Only the joins every way there goes through: parts certain to run need not be neighbours, and a thread between them would be a pipe the code doesn't have.
    return { routes: path.joins, lamps: path.parts.slice(1) };
  };
  const beats: MachineBeat[] = [];
  // R8 review MAJOR-1: the helper step just before a wait, if any. A dial claims a wait only after a step of its own part (or of a helper that called it).
  let lastPart: string | null = null;
  for (const step of spec.steps) {
    const beat: MachineBeat = { routes: [], lamps: [], ...(step.words ? { words: step.words } : {}) };
    if (step.part) lastPart = step.part;
    if (step.part && ids.has(step.part)) {
      // Helper steps are the functions the tested one called: every one starts from it.
      ran.add(step.part);
      const go = pathFromStart(step.part);
      if (go) {
        beat.routes = go.routes;
        for (const r of go.lamps) ran.add(r);
      }
      beat.lamps = [step.part];
      // The calls this helper made in turn, known from the same trace: lit, and threaded only where the way there is the only one.
      for (const n of within.get(step.part) ?? []) {
        if (!ids.has(n)) continue;
        ran.add(n);
        const way = pathFromStart(n);
        for (const r of way?.routes ?? []) if (!beat.routes.includes(r)) beat.routes.push(r);
        beat.lamps.push(n);
      }
    } else if (step.device === "clock") {
      const waiters = parts.housings.filter((h) => h.waits.length > 0 && ran.has(h.id));
      const node = spec.nodes.find((n) => n.id === step.nodes[0]);
      // Only when nothing else moves the clock: a fake's scripted delay, or the test's own wait, would also make time pass with this wait never reached.
      const w = waiters.length === 1 ? waiters[0]!.id : null;
      if (clockIsTheCodes && w && lastPart !== null && (lastPart === w || (within.get(lastPart) ?? []).includes(w))) beat.dial = { part: w, sweep: node?.sweep ?? 0.2 };
      lastPart = null;
    } else if (step.device) {
      const port = parts.ports.find((q) => q.name === step.device);
      if (port) {
        beat.lamps = [port.id];
        // The true caller is known only when one function's own lines call this fake.
        if (port.from.length === 1) {
          const caller = port.from[0]!;
          ran.add(caller);
          const go = pathFromStart(caller);
          beat.routes = [...(go?.routes ?? []), `${caller}->${port.id}`];
          for (const l of go?.lamps ?? []) ran.add(l);
          beat.lamps = [...(go?.lamps ?? []), port.id];
        }
      }
    }
    beats.push(beat);
  }
  return beats;
}

/** A drawing as the run left it, for a still picture: the threads and lamps the beats reach, in the SVG's own text. Only ids plain code made are matched. */
export function lightMachine(svg: string, beats: readonly MachineBeat[]): string {
  const attr = (v: string) => esc(v);
  let out = svg;
  for (const r of new Set(beats.flatMap((b) => b.routes))) out = out.replace(`data-route="${attr(r)}"`, `data-route="${attr(r)}" data-ran=""`);
  for (const l of new Set(beats.flatMap((b) => b.lamps))) out = out.replace(`data-lamp="${attr(l)}"`, `data-lamp="${attr(l)}" data-on=""`);
  return out;
}
