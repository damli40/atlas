// R3 author (b): the bet view: the code chart plus a device for each stand-in and network fake, wired to the functions
// whose own lines call them, and the clock. Takes the test (what Atlas WILL do) and no run, so it cannot show a result.
//
// Plain words: a wire appears only where plain code sees the function's own lines call the thing. A stand-in is passed in as
// an argument, so it is looked for under that parameter's name. If no function's lines call it, it is drawn with no wire and
// a caption says so; nothing is wired on a guess.
// U3's call-site logic is not on main yet; this uses src/file-outline.ts and a text search, and phase 2 can swap in U3's.

import type { FileOutline } from "../../src/file-outline";
import { networkStepWords } from "../../src/network-fake";
import type { ExperimentShape, JsonValue, NetworkLibrary, StandInStep } from "../../src/types";
import type { RenderSpec, SpecCaption, SpecEdge, SpecNode } from "../spec";
import { codeLines, fileChart } from "./code-chart";

export type CallTest = Extract<ExperimentShape, { shape: "call-function" }>;

export interface BetViewInput {
  fileName: string;
  outline: FileOutline;
  source: string;
  language: "js" | "ts" | "py";
  test: CallTest;
  seed?: string;
}

export const deviceNodeId = (name: string) => `device:${name}`;
export const CLOCK_NODE = "clock";

/** How a network library's calls look in the code's own text. */
const NETWORK_CALL: Record<NetworkLibrary, RegExp> = {
  fetch: /(^|[^\w$.])fetch\s*\(/,
  requests: /(^|[^\w$.])requests\.\w+\s*\(/,
  urllib: /(^|[^\w$.])(urllib\.request\.)?urlopen\s*\(/,
  httpx: /(^|[^\w$.])httpx\.\w+\s*\(/,
};
/** How a wait looks in the code's own text. */
const WAIT_CALL: Record<"js" | "ts" | "py", RegExp> = {
  js: /(^|[^\w$.])setTimeout\s*\(/,
  ts: /(^|[^\w$.])setTimeout\s*\(/,
  py: /(^|[^\w$])(time\.|asyncio\.)?sleep\s*\(/,
};

const json = (v: JsonValue) => JSON.stringify(v);
const standInStep = (s: StandInStep) => (s.do === "return" ? `returns ${json(s.value)}${s.afterMs ? ` after ${s.afterMs} ms` : ""}` : s.do === "throw" ? `throws ${s.errorName}` : "never answers");
const scriptWords = (steps: string[], then: string) => {
  const shown = steps.length > 5 ? [...steps.slice(0, 4), `${steps.length - 4} more`] : steps;
  return `${shown.join(", then ")}${then === "repeat_last" ? "; later calls do the same as the last" : "; a later call throws"}`;
};

/** The parameter names in a signature, in order, without types or defaults. */
export function paramNames(signature: string | undefined): string[] {
  if (!signature) return [];
  const open = signature.indexOf("(");
  if (open < 0) return [];
  let depth = 0;
  let cur = "";
  const out: string[] = [];
  for (const ch of signature.slice(open + 1)) {
    if (ch === ")" && depth === 0) break;
    if ("([{<".includes(ch)) depth++;
    if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.replace(/^\s*(\.\.\.|\*+)?/, "").split(/[:=?]/)[0]!.trim());
}

export function betView(input: BetViewInput): RenderSpec {
  const chart = fileChart({ fileName: input.fileName, outline: input.outline, source: input.source, language: input.language, seed: input.seed ?? `bet:${input.fileName}:${input.test.exportName}` });
  const { outline, source, language, test } = input;
  const nodes: SpecNode[] = [...chart.nodes];
  const edges: SpecEdge[] = [...chart.edges];
  const captions: SpecCaption[] = [...chart.captions];
  const partLines = (p: FileOutline["parts"][number]) => codeLines(source, p.lineStart, p.lineEnd, language);
  const tested = outline.parts.find((p) => p.name === test.exportName);
  const notWired: string[] = [];

  const wire = (deviceId: string, device: string, match: (p: FileOutline["parts"][number]) => boolean, words: string) => {
    let any = false;
    for (const p of outline.parts) {
      if (!match(p)) continue;
      any = true;
      edges.push({ id: `wire:${p.name}->${device}`, from: `part:${p.name}`, to: deviceId, words, kind: "thread", provenance: "plain-code" });
    }
    return any;
  };

  // Stand-ins: passed in as arguments; called under the parameter's name.
  const params = paramNames(tested?.signature);
  test.args.forEach((a, i) => {
    if (a.kind !== "stand-in") return;
    const id = deviceNodeId(a.name);
    if (nodes.some((n) => n.id === id)) return;
    nodes.push({ id, kind: "device", words: a.name, provenance: "plain-code" });
    const param = params[i];
    const re = param ? new RegExp(`(^|[^\\w$.])${param.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`) : null;
    if (!(re && tested && partLines(tested).slice(1).some((l) => re.test(l)) && wire(id, a.name, (p) => p === tested, "calls"))) notWired.push(a.name);
    captions.push({ words: `Atlas's stand-in ${a.name}: ${scriptWords(a.calls.map(standInStep), a.then)}.`, provenance: "plain-code" });
  });

  // The network fake: called under the library's own name.
  if (test.network) {
    const nf = test.network;
    const id = deviceNodeId(nf.replaces);
    nodes.push({ id, kind: "device", words: `${nf.replaces}, faked`, provenance: "plain-code" });
    if (!wire(id, nf.replaces, (p) => partLines(p).some((l) => NETWORK_CALL[nf.replaces].test(l)), "calls")) notWired.push(nf.replaces);
    captions.push({ words: `Atlas's fake ${nf.replaces}: ${scriptWords(nf.calls.map((c) => networkStepWords(c, json)), nf.then)}. The real network stays blocked.`, provenance: "plain-code" });
  }

  // The clock: whoever's own lines start a wait. Atlas's clock is virtual; nothing waits for real.
  nodes.push({ id: CLOCK_NODE, kind: "clock", words: "Atlas's clock", provenance: "plain-code", sweep: 0.08 });
  wire(CLOCK_NODE, "clock", (p) => partLines(p).some((l) => WAIT_CALL[language].test(l)), "waits on");

  if (notWired.length) captions.push({ words: `No function's own lines were seen calling ${notWired.join(", ")}, so ${notWired.length === 1 ? "it has" : "they have"} no wire.`, provenance: "plain-code" });
  return { ...chart, title: test.exportName, kicker: input.fileName, subtitle: "the code, and what Atlas will plug in. Nothing has run.", nodes, edges, captions };
}
