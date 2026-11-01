// R3 author (b): the code's chart, and once a test is chosen, the bet view: a device for each stand-in and network fake and
// Atlas's clock. It reads the bench model (web/machines/bench/model.ts), which holds U3's call sites (src/call-sites.ts): a
// wire appears only where plain code found the part's OWN lines calling the thing, with comments and strings removed. So a
// string that says `fetch(` draws nothing. No run goes in, so no run can come out.
//
// The clock gets a wire only where plain code can tell the part really waits (src/call-sites.ts `waitingPartsOf`): a Promise a
// timer resolves, awaited or returned; a Python sleep. A timer that only starts something later (fetchWithRetry's abort timer),
// or one nobody waits on, draws no wire.

import { waitingPartsOf } from "../../src/call-sites";
import type { FileOutline } from "../../src/file-outline";
import { benchModel, CLOCK_ID, type BenchModel, type CallTest } from "../../web/machines/bench/model";
import type { Pin, RenderSpec, SpecCaption, SpecEdge, SpecNode, SpecTag } from "../spec";

export { CLOCK_ID as CLOCK_NODE };
export const deviceNodeId = (name: string) => `stand-in ${name}`;

export interface BetViewInput {
  fileName: string;
  outline: FileOutline;
  source: string;
  language: "js" | "ts" | "py";
  /** The chosen test, or null before one is chosen. */
  test: CallTest | null;
  /** The function drawn as the one under test. */
  tested?: string | null;
  /** Plain code's failure labels, on the parts they are about. */
  labels?: { anchor: string; text: string }[];
  seed?: string;
}

/** The bench model as a spec. Node ids are the model's box ids, so a part card and a lamp find their part directly. */
export function benchSpec(model: BenchModel, input: Pick<BetViewInput, "fileName" | "outline" | "source" | "language" | "seed" | "labels">): RenderSpec {
  const tested = model.tested;
  const nodes: SpecNode[] = [];
  const edges: SpecEdge[] = [];
  const captions: SpecCaption[] = input.outline.notes.map((words) => ({ words, provenance: "plain-code" }));
  const joinKinds = new Map(input.outline.joins.map((j) => [j.id, j.kind]));
  const lineSpan = (a: number, b: number) => (b > a ? `lines ${a}-${b}` : `line ${a}`);
  for (const b of model.boxes) {
    const part = model.parts[b.id];
    if (!part) continue;
    if (part.kind === "code") {
      const pin: Pin = b.id === tested ? "red" : part.part.exported ? "blue" : "ochre";
      nodes.push({ id: b.id, kind: "ticket", words: part.part.name, small: lineSpan(part.part.lineStart, part.part.lineEnd), sourceLines: [{ path: input.fileName, lineStart: part.part.lineStart, lineEnd: part.part.lineEnd }], provenance: "plain-code", pin });
      if (part.selfCalls?.length) edges.push({ id: `self:${b.id}`, from: b.id, to: b.id, words: "calls itself", kind: "thread", provenance: "plain-code" });
    } else if (part.kind === "device") {
      nodes.push({ id: b.id, kind: "device", words: part.network ? `${part.name}, faked` : part.name, provenance: "plain-code" });
      captions.push({ words: `Atlas's ${part.network ? "fake" : "stand-in"} ${part.name}: ${part.steps.join(", then ")}; after that, ${part.then}.${part.network ? " The real network stays blocked." : ""}`, provenance: "plain-code" });
      if (part.noCable) captions.push({ words: part.noCable, provenance: "plain-code" });
    } else {
      nodes.push({ id: b.id, kind: "clock", words: "Atlas's clock", provenance: "plain-code", sweep: 0.08 });
    }
  }
  const seen = new Set(nodes.map((n) => n.id));
  for (const l of model.lines) {
    if (!seen.has(l.from) || !seen.has(l.to)) continue;
    const kind = joinKinds.get(l.id);
    edges.push({ id: l.id, from: l.from, to: l.to, words: kind ?? (l.kind === "calls" ? "calls" : "uses"), kind: "thread", provenance: "plain-code" });
  }
  if (seen.has(CLOCK_ID)) {
    for (const name of waitingPartsOf(input.outline)) {
      if (seen.has(name)) edges.push({ id: `wait:${name}`, from: name, to: CLOCK_ID, words: "waits on", kind: "thread", provenance: "plain-code" });
    }
  }
  const tags: SpecTag[] = (input.labels ?? []).filter((x) => seen.has(x.anchor)).map((x) => ({ on: x.anchor, words: x.text, provenance: "plain-code" }));
  const hasTest = seen.has(CLOCK_ID);
  return {
    version: 1,
    stage: "pre-bet",
    seed: input.seed ?? `bet:${input.fileName}`,
    kicker: input.fileName,
    title: tested ?? input.fileName,
    subtitle: hasTest ? "the code, and what Atlas will plug in. Nothing has run." : "what calls what, before anything has run",
    nodes,
    edges,
    regions: [],
    marks: [],
    tags,
    captions,
    steps: [],
    ...(model.notShown !== null ? { notShown: model.notShown } : {}),
  };
}

export function betView(input: BetViewInput): RenderSpec {
  const model = benchModel({ fileName: input.fileName, outline: input.outline, test: input.test, source: input.source, language: input.language });
  const shown = input.tested && !model.tested ? { ...model, tested: input.tested } : model;
  return benchSpec(shown, input);
}
