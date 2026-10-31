// R3 author (a): a folder's chart, from the code explorer's model. Structure only: no run, no bet, no model verdict.
// (The chart of one pasted file is author (b)'s `betView` with no test.)
//
// Plain words: each part is a ticket; a solid line means plain code found the link in the code; a dotted line means only Muse
// Wonder says so (never a thread, D55). Folders become regions. Pure; imports types only.
//
// A dense chart stops repeating itself:
// - one legend line says what a line means, and only a line of a different kind carries a word;
// - several links between the same two parts are one thicker line;
// - parts are grouped in their folders;
// - the lines step back until a part is hovered, which brings its own lines forward.

import type { ExplorerModel } from "../../web/machines/explorer/model";
import type { Pin, RenderSpec, SpecCaption, SpecEdge, SpecNode, SpecRegion, SpecTag } from "../spec";

const PINS: Pin[] = ["ochre", "blue", "red"];

const folderOf = (path: string) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

const joinWord = (kind: string, typeOnly: boolean) => (typeOnly ? "types only" : kind === "data" ? "shares data, direction not checked" : kind);

export function explorerSpec(model: ExplorerModel, o: { seed?: string; labels?: Record<string, string[]> } = {}): RenderSpec {
  const base: RenderSpec = { version: 1, stage: "pre-bet", seed: o.seed ?? `outline:${model.source}`, kicker: model.commit ? `at commit ${model.commit.slice(0, 7)}` : "uploaded files", title: model.source, subtitle: "names by Muse Wonder, lines and joins checked by plain code", nodes: [], edges: [], regions: [], marks: [], captions: [], steps: [], quiet: true };
  if (model.notShown !== null) return { ...base, notShown: model.notShown };
  const regions = new Map<string, SpecRegion>();
  const regionOf = (folder: string) => {
    if (folder === "") return undefined;
    const id = `folder:${folder}`;
    if (!regions.has(id)) regions.set(id, { id, words: `${folder}/`, kind: "folder" });
    return id;
  };
  const nodes: SpecNode[] = model.boxes.map((b) => {
    const first = b.spans[0];
    const region = regionOf(folderOf(first?.path ?? ""));
    const name = (first?.path ?? "").split("/").pop() ?? "";
    return {
      id: b.id,
      kind: "ticket",
      words: b.name.text,
      small: b.spans.length === 1 ? (first!.wholeFile ? name : `${name}:${first!.lineStart}-${first!.lineEnd}`) : `${b.spans.length} places`,
      sourceLines: b.spans.map((s) => ({ path: s.path, lineStart: s.lineStart, lineEnd: s.lineEnd })),
      provenance: "wonder-words",
      pin: PINS[Math.abs([...(first?.path ?? "")].reduce((a, c) => a + c.charCodeAt(0), 0)) % 3]!,
      ...(region ? { region } : {}),
    };
  });
  // Several links between the same two parts are one line, as thick as the links are many.
  const merged = new Map<string, { from: string; to: string; kinds: Map<string, number>; weight: number; ids: string[] }>();
  for (const l of model.lines) {
    const key = JSON.stringify([l.from, l.to]);
    const m = merged.get(key) ?? { from: l.from, to: l.to, kinds: new Map<string, number>(), weight: 0, ids: [] };
    const w = joinWord(l.kind, l.typeOnly);
    m.kinds.set(w, (m.kinds.get(w) ?? 0) + 1);
    m.weight += Math.max(1, l.codeEdges);
    m.ids.push(l.id);
    merged.set(key, m);
  }
  const counts = new Map<string, number>();
  for (const m of merged.values()) for (const [k, n] of m.kinds) counts.set(k, (counts.get(k) ?? 0) + n);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "imports";
  const edges: SpecEdge[] = [...merged.values()].map((m) => {
    const others = [...m.kinds.keys()].filter((k) => k !== common);
    return { id: m.ids.join("+"), from: m.from, to: m.to, ...(others.length ? { words: others.join(", ") } : {}), kind: "thread" as const, provenance: "plain-code" as const, weight: m.weight };
  });
  for (const c of model.chalk) {
    if (!nodes.some((n) => n.id === c.from) || !nodes.some((n) => n.id === c.to)) continue;
    edges.push({ id: `chalk:${c.id}`, from: c.from, to: c.to, kind: "dashed-note", provenance: "wonder-words" });
  }
  const tags: SpecTag[] = [];
  for (const [on, list] of Object.entries(o.labels ?? {})) if (nodes.some((n) => n.id === on)) for (const words of list) tags.push({ on, words, provenance: "plain-code" });
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const captions: SpecCaption[] = [
    ...(model.unconfirmed.length ? [{ words: `${n(model.unconfirmed.length, "part")} Wonder proposed did not match the code, so not drawn.`, provenance: "plain-code" as const }] : []),
    ...(model.notDrawn.length ? [{ words: `${n(model.notDrawn.length, "join")} found but not drawn: see the list.`, provenance: "plain-code" as const }] : []),
    { words: `"Confirmed" means these lines exist on whole definitions, never that the name or purpose is true.`, provenance: "plain-code" as const },
  ];
  const verb = common === "imports" ? "imports" : common === "calls" ? "calls" : `is joined by "${common}" to`;
  const legend = `A solid line: plain code found that one part ${verb} the other; thicker means more links. A dotted line is only ${model.model}'s word. Hover a part to bring its lines forward.`;
  return { ...base, nodes, edges, regions: [...regions.values()], tags, legend, captions };
}
