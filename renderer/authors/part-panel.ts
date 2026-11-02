// R6: what the panel says about one part of the machine. Every sentence comes from the same facts the drawing is made of (renderer/authors/machine.ts),
// so the panel can't say what the machine doesn't. After a run, the ringed part also says what broke, in words the verdict already shows. Pure.

import { nameWords } from "./part-name";
import type { MachineParts, MachineRing } from "./machine";
import { span } from "./machine";

export interface PartPanel {
  id: string;
  /** The plain words for the part: its name split, a role word, or the name itself. */
  title: string;
  /** The exact name in the code, when it has one and the title isn't it already. */
  name: string | null;
  says: string[];
  /** The part's lines in the file, for the code under the words. Null for an outside call. */
  lines: [number, number] | null;
  /** Only on the ringed part after a run: what the run did there. */
  broke: string[] | null;
}

/** What the run measured, as the page already shows it: the verdict's words, the line it threw from, the test's call. */
export interface BrokeFacts {
  run: string;
  line: number | null;
  input: string | null;
}

const list = (l: readonly number[]) => (l.length === 1 ? `line ${l[0]}` : `lines ${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`);
const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** The panel for one part, or null when the id is no part of this machine. */
export function partPanel(p: MachineParts, id: string, o: { ring?: MachineRing | null; broke?: BrokeFacts | null; wontRun?: boolean } = {}): PartPanel | null {
  const ringed = o.ring && o.ring.on !== "words" && o.ring.part === id && o.broke ? brokeWords(o.broke) : null;
  const h = p.housings.find((x) => x.id === id);
  if (h) {
    const says: string[] = [];
    const kind = h.kind === "class" ? "A class" : "A function";
    says.push(`${kind}${h.exported ? " that can be called from outside the file" : ""}.${h.tested ? (o.wontRun ? " A call would start here, but Atlas can't run this file." : " Atlas calls this one.") : ""}`);
    if (h.loops.length) says.push(`Runs a loop (${list(h.loops)}).`);
    if (h.selfCalls.length) says.push(`Calls itself (${list(h.selfCalls)}).`);
    if (h.waits.length) says.push(`Waits (${list(h.waits)}).`);
    if (h.throws.length) says.push(`Can throw (${list(h.throws)}).`);
    if (h.returns.length) says.push(`Returns (${list(h.returns)}).`);
    const out = p.pipes.filter((e) => e.from === id);
    const calls = [...out.filter((e) => e.kind === "calls").map((e) => e.to), ...p.ports.filter((q) => q.from.includes(id)).map((q) => `${q.name} (${q.faked ? "faked by the test" : "outside this file"})`)];
    if (calls.length) says.push(`Calls: ${calls.join(", ")}.`);
    const uses = out.filter((e) => e.kind === "uses").map((e) => e.to);
    if (uses.length) says.push(`Uses: ${uses.join(", ")}.`);
    // A "wraps" join runs from the wrapped part to its decorator, as the drawing words it ("b wraps a").
    const wrappedBy = out.filter((e) => e.kind === "wraps").map((e) => e.to);
    if (wrappedBy.length) says.push(`Wrapped by: ${wrappedBy.join(", ")}.`);
    const wraps = p.pipes.filter((e) => e.to === id && e.kind === "wraps").map((e) => e.from);
    if (wraps.length) says.push(`Wraps: ${wraps.join(", ")}.`);
    const by = p.pipes.filter((e) => e.to === id && e.kind === "calls").map((e) => e.from);
    if (by.length) says.push(`Called by: ${by.join(", ")}.`);
    says.push(`${cap(span(h.lines[0], h.lines[1]))}.`);
    const words = h.role ?? nameWords(h.name);
    return { id, title: words ?? h.name, name: h.role ? null : words ? h.name : null, says, lines: h.lines, broke: ringed };
  }
  const q = p.ports.find((x) => x.id === id);
  if (q) {
    const says = [q.faked ? "An outside call. Atlas fakes it, so the real one never runs: the test scripts what it does." : "An outside call this code makes. Nothing has run."];
    says.push(`Called by: ${q.from.join(", ")}.`);
    return { id, title: q.name, name: null, says, lines: null, broke: ringed };
  }
  return null;
}

function brokeWords(b: BrokeFacts): string[] {
  // The verdict's own words, after "The run", as on the result. Then the line, then the call the test made, word for word.
  return [`The run ${b.run.replace(/\.$/, "")}.`, ...(b.line !== null ? [`It threw from line ${b.line}.`] : []), ...(b.input ? [b.input] : [])];
}
