// D65: the run, told through the machine's pipes. Only from what the run's path already says (renderer/authors/what-happened.ts) and the
// calls plain code is certain of: a pipe lights only if the path between the two parts has one possible route. Helper steps come from the
// third traced run, with D61's limits and caption: names and order only, never its values. Pure.
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
  let at = tested && ids.has(tested) ? tested : null;
  const portOf = (name: string) => parts.ports.find((q) => q.name === name);
  const toPart = (target: string): { routes: string[]; lamps: string[] } => {
    if (!at || at === target) return { routes: [], lamps: [target] };
    const path = certainPath(outline as never, at, target);
    if (!path) return { routes: [], lamps: [target] };
    const routes = path.parts.slice(1).map((p, i) => `${path.parts[i]}->${p}`);
    return { routes, lamps: path.parts.slice(1) };
  };
  const beats: MachineBeat[] = [];
  for (const step of spec.steps) {
    const beat: MachineBeat = { routes: [], lamps: [], ...(step.words ? { words: step.words } : {}) };
    if (step.part && ids.has(step.part)) {
      const go = toPart(step.part);
      beat.routes = go.routes;
      beat.lamps = go.lamps;
      at = step.part;
    } else if (step.device === "clock") {
      const waiter = parts.housings.find((h) => h.id === at && h.waits.length > 0) ?? (parts.housings.filter((h) => h.waits.length > 0).length === 1 ? parts.housings.find((h) => h.waits.length > 0) : undefined);
      const node = spec.nodes.find((n) => n.id === step.nodes[0]);
      if (waiter) beat.dial = { part: waiter.id, sweep: node?.sweep ?? 0.2 };
    } else if (step.device) {
      const port = portOf(step.device);
      if (port) {
        const callers = port.from;
        // The caller the path can be sure of: the one we are in, else the only one.
        const caller = at && callers.includes(at) ? at : callers.length === 1 ? callers[0]! : null;
        if (caller) {
          const go = caller === at ? { routes: [], lamps: [] } : toPart(caller);
          beat.routes = [...go.routes, `${caller}->${port.id}`];
          beat.lamps = [...go.lamps, port.id];
          at = caller;
        } else beat.lamps = [port.id];
      }
    }
    beats.push(beat);
  }
  return beats;
}
