// R3 journey item 1, narrowed by D61: from a third run's probes to the steps the drawing shows: helper names and their order, never a
// value. The third run is untrusted by design, so this is a strict reader: anything out of shape is dropped.
//
// Rules, in plain words:
// - Measured facts stay unprobed: nothing here feeds a verdict or a proof file. These steps are for the drawing only.
// - Only the helpers the tested function called directly are steps. What they call in turn is counted, not drawn, so a
//   recursive function shows its top calls and a number, not a wall.
// - The names come from Atlas's own table (JS), or must be words of the file (Python).
// - When the list was cut, it says so. A count is then "at least", never a guess at the rest.

export interface HelperStep {
  name: string;
  t: number;
  /** The position among the run's non-bookkeeping trace events: this step came before that event. */
  at: number;
  threw?: boolean;
  /** Calls made inside this one, not drawn. */
  inner: number;
  /** The names of the functions those calls started (each once), for the machine's lamps. Never a value, never an order. */
  within?: string[];
}

const BOOKKEEPING = new Set(["call_checks", "clock_moves", "conditions", "log", "control", "python", "start"]);

export const HELPER_LIMITS = { steps: 400, events: 5000, name: 60 } as const;

/** A probe event's `at` counts every trace event; steps are placed among the ones the drawing reads. */
const placeAmong = (trace: readonly { event: string }[]) => {
  const before: number[] = [0];
  for (const e of trace) before.push(before[before.length - 1]! + (BOOKKEEPING.has(e.event) ? 0 : 1));
  return (at: number) => before[Math.min(Math.max(0, at), trace.length)]!;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `probes` comes from the untrusted run: it is checked here, item by item. */
export function helperSteps(probes: unknown, o: { names?: readonly string[]; tested: readonly string[]; trace: readonly { event: string }[]; allowed?: (name: string) => boolean; cut?: unknown }): { steps: HelperStep[]; cut: boolean } {
  const place = placeAmong(o.trace);
  const list = Array.isArray(probes) ? probes.slice(0, HELPER_LIMITS.events) : [];
  const nameOf = (p: { id?: unknown; name?: unknown }): string | null => {
    const n = typeof p.id === "number" ? o.names?.[p.id] : p.name;
    if (typeof n !== "string" || n.length === 0 || n.length > HELPER_LIMITS.name) return null;
    if (o.allowed && !o.allowed(n)) return null;
    return n;
  };
  const testedSet = new Set(o.tested);
  const stack: { name: string; inner: number; within: Set<string>; t: number; at: number }[] = [];
  const within = (s: Set<string>) => (s.size > 0 ? { within: [...s].slice(0, 40) } : {});
  const steps: HelperStep[] = [];
  const open: HelperStep[] = [];
  let cut = (Array.isArray(probes) && probes.length > HELPER_LIMITS.events) || (finite(o.cut) && o.cut > 0);
  /** Real helper frames above the tested function. The tested function's first frame does not count. */
  const depth = () => {
    let n = stack.length;
    const first = stack[0];
    if (first && testedSet.has(first.name)) n--;
    return n;
  };
  const add = (s: HelperStep) => {
    if (steps.length >= HELPER_LIMITS.steps) cut = true;
    else steps.push(s);
  };
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { k?: unknown; t?: unknown; at?: unknown; id?: unknown; name?: unknown };
    if (!finite(p.t) || !finite(p.at) || !finite(p.k)) continue;
    const name = nameOf(p);
    if (name === null) continue;
    const at = place(p.at);
    if (p.k === 0) {
      if (depth() > 0) {
        stack[stack.length - 1]!.inner++;
        stack[stack.length - 1]!.within.add(name);
      }
      stack.push({ name, inner: 0, within: new Set(), t: p.t, at });
      continue;
    }
    if (p.k === 3) {
      if (testedSet.has(name)) continue;
      if (depth() > 0) {
        stack[stack.length - 1]!.inner++;
        stack[stack.length - 1]!.within.add(name);
      } else open.push({ name, t: p.t, at, inner: 0 });
      continue;
    }
    if (p.k !== 1 && p.k !== 2) continue;
    let frame = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.name === name) {
        frame = i;
        break;
      }
    }
    if (frame < 0) {
      // An async function's end: its step goes here, when it really ended (never before).
      const i = open.findIndex((x) => x.name === name);
      if (i >= 0) {
        add({ name, t: p.t, at, ...(p.k === 2 ? { threw: true } : {}), inner: 0 });
        open.splice(i, 1);
      } else if (p.k === 2) {
        // A `finally` that throws, after the return was reported.
        const last = [...steps].reverse().find((s) => s.name === name);
        if (last) last.threw = true;
      }
      continue;
    }
    const f = stack[frame]!;
    stack.length = frame;
    if (stack.length === 0 && testedSet.has(name)) continue; // the tested function's own end is the run's ending
    if (depth() > 0) {
      stack[stack.length - 1]!.inner += f.inner;
      for (const n of f.within) stack[stack.length - 1]!.within.add(n);
      continue;
    }
    // Placed where it STARTED, so the list reads in call order, not in the order calls finished.
    add({ name, t: f.t, at: f.at, ...(p.k === 2 ? { threw: true } : {}), inner: f.inner, ...within(f.within) });
  }
  // Begun with no end to report (Python's coroutines): the name, at the moment it began.
  for (const o2 of open) add(o2);
  steps.sort((x, y) => x.at - y.at || x.t - y.t);
  return { steps, cut };
}
