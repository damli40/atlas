// R3 (D55): the RenderSpec, the contract between Atlas and its renderer.
//
// Plain words: Atlas is the author. Plain code writes this plain data from what Atlas already knows (the code map, the
// test, the measured trace, the verdicts). The renderer draws only what is in here, and it imports nothing from Atlas's
// runs, models or server. So a line on the drawing is true exactly when the spec's author had a reason for it.
//
// Three honesty rules live in `specProblems`, so no author can get them wrong by accident:
// - a join only Muse Wonder claims ("wonder-words") is never drawn as a thread (a solid line means plain code found it);
// - a spec marked "pre-bet" holds nothing from a run (D47: before betting, the drawing never shows run results);
// - every edge, path, mark and step points at something that exists.
// No imports, no I/O, no clock, no model. Safe in the browser, a Worker and Node.

/** Who says this is so. "plain-code": Atlas's parsers read it. "run": measured. "wonder-words": Muse Wonder's words, unchecked. */
export type Provenance = "plain-code" | "run" | "wonder-words";
export type NodeKind = "ticket" | "device" | "clock" | "deck" | "note";
export type EdgeKind = "thread" | "dashed-note";
export type MarkKind = "matched" | "didnt-match" | "cant-check";
/** The three pin colours of the drawing's palette. */
export type Pin = "red" | "ochre" | "blue";

export interface SourceLines {
  path?: string;
  lineStart: number;
  lineEnd: number;
}

export interface SpecNode {
  id: string;
  kind: NodeKind;
  words: string;
  /** Tiny red words on the ticket's top rule ("step 3", "lines 3-23"). */
  small?: string;
  sourceLines?: SourceLines[];
  provenance: Provenance;
  /** The region (folder or parent state) it sits in. */
  region?: string;
  pin?: Pin;
  /** Drawn as a dashed outline: something the author says is NOT there. */
  missing?: boolean;
  /** A clock's dial: how far the hand sweeps, as a share of a full turn (0..1). */
  sweep?: number;
}

export interface SpecEdge {
  id: string;
  from: string;
  to: string;
  /** The words on clean paper beside the line. */
  words?: string;
  kind: EdgeKind;
  provenance: Provenance;
  /** How many links in the code this one line stands for: a thicker line is more links. */
  weight?: number;
}

export interface SpecRegion {
  id: string;
  words: string;
  parent?: string;
  kind: "folder" | "state";
}

/** The highlighted path: consecutive edges, drawn in red. `partsWaysAt`: the step where a bettor's answer and the run part ways. */
export interface SpecPath {
  edges: string[];
  provenance: Provenance;
  partsWaysAt?: string;
}

export interface SpecMark {
  on: string;
  kind: MarkKind;
  /** Who this is about ("you", "Muse Spark"). Meta model names stay visible (D10). */
  who: string;
  /** Short plain words beside the mark. */
  words?: string;
  /** A didn't-match with no step that honestly shows where: the words alone, no ring. */
  noStep?: boolean;
}

/** A note on a part drawn before or after a run (a failure label). Never run data before a bet. */
export interface SpecTag {
  on: string;
  words: string;
  provenance: Provenance;
}

export interface SpecCaption {
  words: string;
  provenance: Provenance;
}

/** One beat of the animation: what lights up, and what it says. */
export interface SpecStep {
  id: string;
  nodes: string[];
  edges: string[];
  words?: string;
  provenance: Provenance;
  /** What kind of moment this is, so the player can give it its beat. */
  beat?: "start" | "call" | "answer" | "wait" | "end" | "note";
  /** For hand-off to another drawing on the page: the device this step lights there. */
  device?: string;
  /** A wait's measured length in ms (sets how long the clock's hand sweeps, within limits). */
  ms?: number;
  /** For a helper step: which function of the file this step is in. */
  part?: string;
}

export interface RenderSpec {
  version: 1;
  /** "pre-bet": nothing from a run may appear. "after-run": it may. */
  stage: "pre-bet" | "after-run";
  /** Seeds the hand wobble: the same spec and seed draw the same picture. */
  seed: string;
  kicker?: string;
  title?: string;
  subtitle?: string;
  direction?: "TD" | "LR";
  nodes: SpecNode[];
  edges: SpecEdge[];
  regions: SpecRegion[];
  path?: SpecPath;
  marks: SpecMark[];
  /** Words on parts: failure labels. Optional. */
  tags?: SpecTag[];
  /** One line that says what the lines mean, so the words need not repeat on every line. */
  legend?: string;
  /** A dense chart: lines step back until a part is hovered, and lines into one part gather into a bundle. */
  quiet?: boolean;
  captions: SpecCaption[];
  steps: SpecStep[];
  /** Set when nothing may be drawn (a failed control, a whole-run can't check): the one sentence shown instead. */
  notShown?: string;
}

/** Every problem with a spec, in plain words. Empty means it may be drawn. */
export function specProblems(spec: RenderSpec): string[] {
  const out: string[] = [];
  const dupes = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) out.push(`two ${kind} share the id ${JSON.stringify(id)}`);
      seen.add(id);
    }
  };
  dupes("nodes", spec.nodes.map((n) => n.id));
  dupes("edges", spec.edges.map((e) => e.id));
  dupes("regions", spec.regions.map((r) => r.id));
  const nodes = new Set(spec.nodes.map((n) => n.id));
  const edges = new Map(spec.edges.map((e) => [e.id, e]));
  const regions = new Map(spec.regions.map((r) => [r.id, r]));

  for (const e of spec.edges) {
    if (!nodes.has(e.from)) out.push(`edge ${JSON.stringify(e.id)} starts at a node that does not exist: ${JSON.stringify(e.from)}`);
    if (!nodes.has(e.to)) out.push(`edge ${JSON.stringify(e.id)} ends at a node that does not exist: ${JSON.stringify(e.to)}`);
    if (e.provenance === "wonder-words" && e.kind === "thread") out.push(`edge ${JSON.stringify(e.id)} is only Muse Wonder's words, so it may not be drawn as a thread`);
  }
  for (const n of spec.nodes) if (n.region !== undefined && !regions.has(n.region)) out.push(`node ${JSON.stringify(n.id)} sits in a region that does not exist: ${JSON.stringify(n.region)}`);
  for (const r of spec.regions) {
    const seen = new Set([r.id]);
    let p = r.parent;
    while (p !== undefined) {
      if (seen.has(p)) {
        out.push(`region ${JSON.stringify(r.id)} is its own parent`);
        break;
      }
      seen.add(p);
      const parent = regions.get(p);
      if (!parent) {
        out.push(`region ${JSON.stringify(r.id)} has a parent that does not exist: ${JSON.stringify(p)}`);
        break;
      }
      p = parent.parent;
    }
  }
  if (spec.path) {
    let last: string | null = null;
    for (const id of spec.path.edges) {
      const e = edges.get(id);
      if (!e) {
        out.push(`the highlighted path uses an edge that does not exist: ${JSON.stringify(id)}`);
        continue;
      }
      if (e.kind !== "thread") out.push(`the highlighted path uses ${JSON.stringify(id)}, which is not a thread`);
      if (last !== null && last !== e.from) out.push(`the highlighted path breaks at ${JSON.stringify(id)}: it does not start where the last edge ended`);
      last = e.to;
    }
    if (spec.path.partsWaysAt !== undefined && !nodes.has(spec.path.partsWaysAt)) out.push(`the path parts ways at a node that does not exist: ${JSON.stringify(spec.path.partsWaysAt)}`);
  }
  for (const m of spec.marks) if (!nodes.has(m.on)) out.push(`a mark sits on a node that does not exist: ${JSON.stringify(m.on)}`);
  for (const t of spec.tags ?? []) if (!nodes.has(t.on)) out.push(`a tag sits on a node that does not exist: ${JSON.stringify(t.on)}`);
  for (const s of spec.steps) {
    for (const id of s.nodes) if (!nodes.has(id)) out.push(`step ${JSON.stringify(s.id)} lights a node that does not exist: ${JSON.stringify(id)}`);
    for (const id of s.edges) if (!edges.has(id)) out.push(`step ${JSON.stringify(s.id)} lights an edge that does not exist: ${JSON.stringify(id)}`);
  }

  // D47: before betting, the drawing never shows run results.
  if (spec.stage === "pre-bet") {
    const ran = (what: string) => out.push(`this spec is marked pre-bet but holds run data: ${what}`);
    for (const n of spec.nodes) if (n.provenance === "run") ran(`node ${JSON.stringify(n.id)}`);
    for (const e of spec.edges) if (e.provenance === "run") ran(`edge ${JSON.stringify(e.id)}`);
    if (spec.path?.provenance === "run") ran("the highlighted path");
    if (spec.path?.partsWaysAt !== undefined) ran("the step where a bettor and the run part ways");
    for (const c of spec.captions) if (c.provenance === "run") ran(`caption ${JSON.stringify(c.words)}`);
    for (const s of spec.steps) if (s.provenance === "run") ran(`step ${JSON.stringify(s.id)}`);
    if (spec.marks.length > 0) ran("matched / didn't match marks");
    for (const t of spec.tags ?? []) if (t.provenance === "run") ran(`tag ${JSON.stringify(t.words)}`);
  }
  return out;
}

export class SpecRefused extends Error {
  constructor(public problems: string[]) {
    super(`this spec may not be drawn: ${problems.join("; ")}`);
    this.name = "SpecRefused";
  }
}

/** Throws SpecRefused if the spec breaks a rule. */
export function assertSpec(spec: RenderSpec): void {
  const p = specProblems(spec);
  if (p.length > 0) throw new SpecRefused(p);
}
