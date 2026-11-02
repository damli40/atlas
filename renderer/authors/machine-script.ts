// D65: the run, told through the machine's pipes. Only what the run's path says and plain code is certain of. A thread needs the true caller: a fake with more than one
// caller, or a route that isn't the only one, gets no thread on that step. A dial sweeps only for a wait in a function known to have run, and only if it is the one such
// function. Helper steps come from the third traced run, with D61's limits and caption: names and order only, never its values. Pure.
import { certainPath } from "../../src/call-sites";
import type { RenderSpec } from "../spec";
import type { MachineParts } from "./machine";

export interface MachineBeat {
  routes: string[];
  lamps: string[];
  dial?: { part: string; sweep: number };
  words?: string;
}

export function machineScript(spec: Pick<RenderSpec, "steps" | "nodes">, parts: MachineParts, outline: { joins: readonly { id: string; from: string; to: string; kind: string }[] }, tested: string | null): MachineBeat[] {
  const ids = new Set(parts.housings.map((h) => h.id));
  const start = tested && ids.has(tested) ? tested : null;
  const ran = new Set<string>(start ? [start] : []);
  const pathFromStart = (target: string): { routes: string[]; lamps: string[] } | null => {
    if (!start) return null;
    if (start === target) return { routes: [], lamps: [] };
    const path = certainPath(outline as never, start, target);
    if (!path) return null;
    return { routes: path.parts.slice(1).map((p, i) => `${path.parts[i]}->${p}`), lamps: path.parts.slice(1) };
  };
  const beats: MachineBeat[] = [];
  for (const step of spec.steps) {
    const beat: MachineBeat = { routes: [], lamps: [], ...(step.words ? { words: step.words } : {}) };
    if (step.part && ids.has(step.part)) {
      // Helper steps are the functions the tested one called: every one starts from it.
      ran.add(step.part);
      const go = pathFromStart(step.part);
      if (go) {
        beat.routes = go.routes;
        for (const r of go.lamps) ran.add(r);
      }
      beat.lamps = [step.part];
    } else if (step.device === "clock") {
      const waiters = parts.housings.filter((h) => h.waits.length > 0 && ran.has(h.id));
      const node = spec.nodes.find((n) => n.id === step.nodes[0]);
      if (waiters.length === 1) beat.dial = { part: waiters[0]!.id, sweep: node?.sweep ?? 0.2 };
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
