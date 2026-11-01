// R3 journey item 1: from a third run's probes to the steps the drawing shows (`subtotal → 5500`). Pure.
//
// Rules, in plain words:
// - Measured facts stay unprobed: nothing here feeds a verdict or a proof file. These steps are for the drawing only.
// - Only the helpers the tested function called directly are steps. What they call in turn is counted, not drawn, so a
//   recursive function shows its top calls and a number, not a wall.
// - A value is shown only if it is plain JSON and short. A promise, a generator, an object with getters: the name alone.
// - The names come from Atlas's own table or are checked against the file's text; values go through the drawing's cleaning.

export interface ProbeEvent {
  /** 0 entered; 1 returned; 2 threw; 3 entered, and nothing stacks on it (async, generator): its step waits for its end. */
  k: number;
  /** Where the name is: an id into Atlas's table (JS), or the name itself (Python). */
  id?: number;
  name?: string;
  t: number;
  /** How many trace events came before this one. */
  at: number;
  json?: string;
  /** A value was given. */
  v?: boolean;
}

export interface HelperStep {
  name: string;
  t: number;
  /** The position among the run's non-bookkeeping trace events: this step came before that event. */
  at: number;
  /** The value as JSON text, when plain and short. */
  value?: string;
  threw?: boolean;
  /** Calls made inside this one, not drawn. */
  inner: number;
}

const BOOKKEEPING = new Set(["call_checks", "clock_moves", "conditions", "log", "control", "python", "start"]);

export const HELPER_LIMITS = { steps: 400, name: 60, value: 60 } as const;

/** A probe event's `at` counts every trace event; steps are placed among the ones the drawing reads. */
const placeAmong = (trace: readonly { event: string }[]) => {
  const before: number[] = [0];
  for (const e of trace) before.push(before[before.length - 1]! + (BOOKKEEPING.has(e.event) ? 0 : 1));
  return (at: number) => before[Math.min(Math.max(0, at), trace.length)]!;
};

export function helperSteps(probes: readonly ProbeEvent[], o: { names?: readonly string[]; tested: readonly string[]; trace: readonly { event: string }[]; allowed?: (name: string) => boolean }): { steps: HelperStep[]; more: number } {
  const place = placeAmong(o.trace);
  const nameOf = (p: ProbeEvent): string | null => {
    const n = p.id !== undefined ? o.names?.[p.id] : p.name;
    if (typeof n !== "string" || n.length === 0 || n.length > HELPER_LIMITS.name) return null;
    if (o.allowed && !o.allowed(n)) return null;
    return n;
  };
  const testedSet = new Set(o.tested);
  const stack: { name: string; inner: number }[] = [];
  const steps: HelperStep[] = [];
  const open: HelperStep[] = [];
  let more = 0;
  /** Real helper frames above the tested function. The tested function's first frame does not count. */
  const depth = () => {
    let n = stack.length;
    const first = stack[0];
    if (first && testedSet.has(first.name)) n--;
    return n;
  };
  const add = (s: HelperStep) => {
    if (steps.length >= HELPER_LIMITS.steps) more++;
    else steps.push(s);
  };
  for (const p of probes) {
    const name = nameOf(p);
    if (name === null) continue;
    if (p.k === 0) {
      if (depth() > 0) stack[stack.length - 1]!.inner++;
      stack.push({ name, inner: 0 });
      continue;
    }
    if (p.k === 3) {
      if (testedSet.has(name)) continue;
      if (depth() > 0) stack[stack.length - 1]!.inner++;
      else open.push({ name, t: p.t, at: place(p.at), inner: 0 });
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
      // An async function's end: its step goes here, when its value really came (review B1: never before it arrived).
      const i = open.findIndex((x) => x.name === name);
      if (i >= 0) {
        const value = p.k === 1 && p.json !== undefined && p.json.length <= HELPER_LIMITS.value ? p.json : undefined;
        add({ name, t: p.t, at: place(p.at), ...(value !== undefined ? { value } : {}), ...(p.k === 2 ? { threw: true } : {}), inner: 0 });
        open.splice(i, 1);
      }
      continue;
    }
    const f = stack[frame]!;
    stack.length = frame; // Frames above it ended without saying so (a throw through a concise arrow).
    if (stack.length === 0 && testedSet.has(name)) continue; // the tested function's own end is the run's ending
    if (depth() > 0) {
      stack[stack.length - 1]!.inner += f.inner;
      continue;
    }
    const value = p.k === 1 && p.json !== undefined && p.json.length <= HELPER_LIMITS.value ? p.json : undefined;
    add({ name, t: p.t, at: place(p.at), ...(value !== undefined ? { value } : {}), ...(p.k === 2 ? { threw: true } : {}), inner: f.inner });
  }
  // Begun and never ended, or with no end to report (Python's coroutines): the name, at the moment it began.
  for (const o2 of open) add(o2);
  steps.sort((x, y) => x.at - y.at || x.t - y.t);
  return { steps, more };
}
