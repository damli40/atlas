// R3 author (a): a code chart, from plain code's outline. Structure only: this takes no run, no bet and no model verdict.
//
// Plain words: each function or part is a ticket; a solid line means plain code found the call in the code; a dashed note
// means only Muse Wonder says so (never a thread, D55). Folders become regions. Pure; imports types only.

import type { FileOutline } from "../../src/file-outline";
import type { VerifiedOutline } from "../../src/outline/types";
import type { Pin, RenderSpec, SpecEdge, SpecNode, SpecRegion } from "../spec";

const PINS: Pin[] = ["ochre", "blue", "red"];

/** Lines of a part with comments cut: enough to spot a name being called, without a parser's cost. */
export function codeLines(source: string, lineStart: number, lineEnd: number, language: "js" | "ts" | "py"): string[] {
  const comment = language === "py" ? /(^|\s)#.*$/ : /(^|\s)\/\/.*$/;
  return source
    .split("\n")
    .slice(lineStart - 1, lineEnd)
    .map((l) => l.replace(comment, ""));
}

const called = (lines: string[], name: string) => {
  const re = new RegExp(`(^|[^\\w$.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`);
  return lines.some((l) => re.test(l));
};

export interface FileChartInput {
  fileName: string;
  outline: FileOutline;
  /** The file's text: lets the chart show a function calling itself, which the outline's joins leave out. */
  source?: string;
  language?: "js" | "ts" | "py";
  seed?: string;
  /** Set when this chart is shown before a bet: nothing from a run may be in it. It never is, by construction. */
  subtitle?: string;
}

/** The chart of one pasted file. */
export function fileChart(input: FileChartInput): RenderSpec {
  const { outline, fileName } = input;
  const nodes: SpecNode[] = outline.parts.map((p) => ({
    id: `part:${p.name}`,
    kind: "ticket",
    words: p.name,
    small: p.lineEnd > p.lineStart ? `lines ${p.lineStart}-${p.lineEnd}` : `line ${p.lineStart}`,
    sourceLines: [{ path: fileName, lineStart: p.lineStart, lineEnd: p.lineEnd }],
    provenance: "plain-code",
    pin: p.exported ? "red" : "ochre",
  }));
  const edges: SpecEdge[] = outline.joins.map((j) => ({ id: `join:${j.id}`, from: `part:${j.from}`, to: `part:${j.to}`, words: j.kind, kind: "thread", provenance: "plain-code" }));
  if (input.source && input.language) {
    for (const p of outline.parts) {
      // Skip the signature line: a definition's own name is not a call.
      if (p.lineEnd > p.lineStart && called(codeLines(input.source, p.lineStart + 1, p.lineEnd, input.language), p.name)) {
        edges.push({ id: `self:${p.name}`, from: `part:${p.name}`, to: `part:${p.name}`, words: "calls itself", kind: "thread", provenance: "plain-code" });
      }
    }
  }
  return {
    version: 1,
    stage: "pre-bet",
    seed: input.seed ?? `file:${fileName}`,
    kicker: "your code, read by plain code",
    title: fileName,
    subtitle: input.subtitle ?? "what calls what, before anything has run",
    nodes,
    edges,
    regions: [],
    marks: [],
    captions: outline.notes.map((words) => ({ words, provenance: "plain-code" })),
    steps: [],
    ...(nodes.length === 0 ? { notShown: outline.notes[0] ?? "plain code found no function or class in this file to draw" } : {}),
  };
}

export interface OutlineChartInput {
  /** What the code explorer is drawing: its name for the caption. */
  name: string;
  verified: VerifiedOutline | null;
  /** Why there is no outline, when `verified` is null. */
  failure?: string;
  seed?: string;
}

const folderOf = (path: string) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

/**
 * The chart of a whole folder, from the verified outline. Only confirmed parts are drawn. A part's existence and lines are
 * plain code's; its name is Muse Wonder's, so its node says so ("wonder-words"). Joins plain code found are threads; a
 * join only Wonder claims is a dashed note. A join to a part that is not drawn goes in a caption instead.
 */
export function outlineChart(input: OutlineChartInput): RenderSpec {
  const base: RenderSpec = { version: 1, stage: "pre-bet", seed: input.seed ?? `outline:${input.name}`, kicker: "a folder, read by plain code", title: input.name, subtitle: "names by Muse Wonder, lines and joins checked by plain code", nodes: [], edges: [], regions: [], marks: [], captions: [], steps: [] };
  const v = input.verified;
  if (!v) return { ...base, notShown: input.failure ?? "Muse Wonder gave no usable outline, so there is nothing plain code could check" };
  if (v.cantCheck) return { ...base, notShown: v.cantCheck };
  const parts = v.parts.filter((p) => p.status === "confirmed");
  const regions = new Map<string, SpecRegion>();
  const regionOf = (folder: string) => {
    if (folder === "") return undefined;
    const id = `folder:${folder}`;
    if (!regions.has(id)) regions.set(id, { id, words: `${folder}/`, kind: "folder" });
    return id;
  };
  const nodes: SpecNode[] = parts.map((p) => {
    const region = regionOf(folderOf(p.files[0] ?? ""));
    return {
      id: `part:${p.id}`,
      kind: "ticket",
      words: p.name.text,
      small: p.spans.length === 1 ? `${p.spans[0]!.path}${p.spans[0]!.wholeFile ? "" : `:${p.spans[0]!.lineStart}-${p.spans[0]!.lineEnd}`}` : `${p.spans.length} places`,
      sourceLines: p.spans.map((s) => ({ path: s.path, lineStart: s.lineStart, lineEnd: s.lineEnd })),
      provenance: "wonder-words",
      pin: PINS[Math.abs([...(p.files[0] ?? "")].reduce((a, c) => a + c.charCodeAt(0), 0)) % 3],
      ...(region ? { region } : {}),
    };
  });
  const drawn = new Set(parts.map((p) => p.id));
  const edges: SpecEdge[] = [];
  let leftOut = 0;
  for (const j of v.joins) {
    if (!drawn.has(j.from) || !drawn.has(j.to)) {
      leftOut++;
      continue;
    }
    if (j.status === "model-only") {
      edges.push({ id: `join:${j.id}`, from: `part:${j.from}`, to: `part:${j.to}`, words: "Wonder says so; plain code could not check it", kind: "dashed-note", provenance: "wonder-words" });
    } else {
      const words = j.typeOnly ? "types only" : j.kind === "data" ? "shares data" : j.kind;
      edges.push({ id: `join:${j.id}`, from: `part:${j.from}`, to: `part:${j.to}`, words, kind: "thread", provenance: "plain-code" });
    }
  }
  const unconfirmed = v.parts.length - parts.length;
  const captions = [
    ...(unconfirmed ? [{ words: `${unconfirmed} part${unconfirmed === 1 ? "" : "s"} Wonder proposed did not match the code, so ${unconfirmed === 1 ? "it is" : "they are"} not drawn.`, provenance: "plain-code" as const }] : []),
    ...(leftOut ? [{ words: `${leftOut} join${leftOut === 1 ? "" : "s"} touch a part that is not drawn, so ${leftOut === 1 ? "it is" : "they are"} left out.`, provenance: "plain-code" as const }] : []),
    { words: `"Confirmed" means these lines exist on whole definitions, never that the name or purpose is true. A dotted line is only ${v.model}'s word.`, provenance: "plain-code" as const },
  ];
  return { ...base, nodes, edges, regions: [...regions.values()], captions, ...(nodes.length === 0 ? { notShown: "plain code could not confirm any part of this outline" } : {}) };
}
