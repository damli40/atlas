// X3 (D28): the common-failure label routes. Plain code decides every label (src/failure-labels.ts); no model is
// asked here, nothing is spent.
//
// - POST /paste/labels {target, exportName} → labels for one pasted function: its own lines (found by the X1
//   parsers: the TypeScript parser for JS/TS, the TS-written Python scanner), and the session's sealed runs of that
//   same function (same code fingerprint, same export) whose proof card exists.
// - GET /outline/jobs/:id/labels → labels for every confirmed part of an explorer outline: the part's confirmed
//   lines, Wonder's pattern tags for the part (a suggestion of which kinds apply; never a label), and the session's
//   sealed runs of a function inside those lines (the explorer hands a part's file to the paste flow unchanged, so a
//   round's code fingerprint equals the file's).
// Both belong to the session that pasted the code / started the job; any other session gets 404.

import type { Hono } from "hono";
import { z } from "zod";
import { labelFailures, type FailureLabelKind, type LabelledFailure, type LabelsAnswer, type Lang, type RunEvidence } from "../src/failure-labels";
import type { AtlasFile } from "../src/types";
import type { BetStore, Round } from "./bets";
import type { Paste } from "./paste";
import { BAD_SESSION, sessionIdOf } from "./log/sse";
import { parseJsFile } from "../src/outline/parse-js";
import { parsePyFile } from "../src/outline/parse-py";
import type { OutlineSection } from "../src/outline/types";

export interface LabelDeps {
  paste: Paste;
  betStore: BetStore;
  /** A round's proof card (its .atlas.json), or undefined when there is none. */
  proofOf: (runId: string) => AtlasFile | undefined;
  /** An outline job: its session and, when done, its section. */
  outlineJobOf: (id: string) => { sessionId: string; section?: OutlineSection } | undefined;
}

const body = z.object({ target: z.object({ ref: z.string().min(1).max(200), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }), exportName: z.string().min(1).max(100) }).strict();

/** The session's sealed runs of `exportName` on code with this fingerprint, oldest first, each with a proof card. */
export function runsOf(betStore: BetStore, proofOf: LabelDeps["proofOf"], sessionId: string, codeSha256: string, exportName: string): RunEvidence[] {
  const out: (RunEvidence & { at: string })[] = [];
  for (const r of betStore.peek(sessionId)?.values() ?? []) {
    const round = r as Round;
    const p = round.experiment.params;
    if (round.status !== "done" || !round.run || p.shape !== "call-function") continue;
    if (round.experiment.target.codeSha256 !== codeSha256 || p.exportName !== exportName) continue;
    if (!proofOf(round.run.id)) continue; // "reproduced" must link to a proof card
    out.push({ runId: round.run.id, params: p, run: round.run, at: round.run.finishedAt });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(({ at: _a, ...e }) => e);
}

/** The lines of a top-level function (or of the definition an `export { a as b }` names), or null. */
export function functionLines(text: string, language: Lang, exportName: string): { lineStart: number; lineEnd: number } | null {
  const parsed = language === "py" ? parsePyFile(text) : parseJsFile(language === "ts" ? "pasted.ts" : "pasted.js", text, language);
  const local = parsed.exportedLocals.find((e) => e.exported === exportName)?.local ?? exportName;
  const s = parsed.symbols.find((x) => x.name === local && !x.parent);
  return s ? { lineStart: s.lineStart, lineEnd: s.lineEnd } : null;
}

const RANK: Record<FailureLabelKind, number> = { reproduced: 3, inconclusive: 2, "found in this code": 1, "common pattern": 0 };
/** Labels from several calls (a part whose files are in more than one language): the strongest label per failure. */
function mergeLabels(answers: LabelsAnswer[]): LabelledFailure[] {
  const best = new Map<string, LabelledFailure>();
  for (const a of answers)
    for (const l of a.labels) {
      const k = `${l.kind}/${l.failure}`;
      const had = best.get(k);
      if (!had || RANK[l.label] > RANK[had.label]) best.set(k, had && !l.lines && had.lines ? { ...l, lines: had.lines } : l);
      else if (had && RANK[l.label] === RANK[had.label] && l.lines) best.set(k, { ...had, lines: [...(had.lines ?? []), ...l.lines] });
    }
  return [...best.values()];
}

export function registerLabelRoutes(app: Hono, deps: LabelDeps) {
  app.post("/paste/labels", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "the request body is not JSON" }, 400);
    }
    const parsed = body.safeParse(raw);
    if (!parsed.success) return c.json({ error: "send {target: {ref, codeSha256}, exportName}" }, 400);
    const entry = deps.paste.entryOf(sessionId, parsed.data.target);
    if (!entry || typeof entry.target.source !== "string") return c.json({ error: "this session has no pasted file with that ref and fingerprint: paste it first (POST /paste)" }, 404);
    const name = parsed.data.exportName;
    if (!entry.exports.some((e) => e.name === name)) return c.json({ error: `the pasted file has no export named "${name}"` }, 400);
    const lang = (entry.target.language ?? "js") as Lang;
    const text = entry.target.source;
    let lines: { lineStart: number; lineEnd: number } | null = null;
    try {
      lines = functionLines(text, lang, name);
    } catch {
      lines = null;
    }
    const total = text.split("\n").length;
    const note = lines ? undefined : `plain code could not find where ${name} ends, so it read the whole file`;
    const span = { path: "pasted", text, lineStart: lines?.lineStart ?? 1, lineEnd: lines?.lineEnd ?? total };
    const runs = runsOf(deps.betStore, deps.proofOf, sessionId, entry.target.codeSha256, name);
    const answer = labelFailures({ language: lang, spans: [span], runs });
    return c.json({ ...answer, exportName: name, ...(note ? { note } : {}) });
  });

  app.get("/outline/jobs/:id/labels", (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const job = deps.outlineJobOf(c.req.param("id"));
    if (!job || job.sessionId !== sessionId) return c.json({ error: "no such outline job in this session" }, 404);
    const s = job.section;
    if (!s) return c.json({ error: "the job is not done yet" }, 409);
    if (!s.verified) return c.json({ parts: {}, note: "there is no outline to label: Muse Wonder gave none" });
    const fileOf = new Map(s.files.map((f) => [f.path, f] as const));
    const mapOf = new Map(s.codeMap.files.map((f) => [f.path, f] as const));
    const parts: Record<string, LabelsAnswer> = {};
    for (const part of s.verified.parts) {
      if (part.status !== "confirmed") continue;
      const spans = part.spans.filter((sp) => sp.ok && fileOf.has(sp.path));
      const byLang = new Map<Lang, { path: string; text: string; lineStart: number; lineEnd: number }[]>();
      const runs: RunEvidence[] = [];
      for (const sp of spans) {
        const f = fileOf.get(sp.path)!;
        const lang = f.language as Lang;
        (byLang.get(lang) ?? byLang.set(lang, []).get(lang)!).push({ path: f.path, text: f.text, lineStart: sp.lineStart, lineEnd: sp.lineEnd });
        // Functions inside these lines that a round may have run (exported, top level).
        for (const sym of mapOf.get(sp.path)?.symbols ?? []) {
          if (!sym.exported || sym.parent || sym.lineStart < sp.lineStart || sym.lineStart > sp.lineEnd) continue;
          runs.push(...runsOf(deps.betStore, deps.proofOf, sessionId, f.sha256, sym.name));
        }
      }
      const model = s.verified.model;
      const answers = [...byLang].map(([language, sps]) => labelFailures({ language, spans: sps, wonderTags: part.patterns, wonderModel: model, runs }));
      parts[part.id] = answers.length === 1 ? answers[0]! : { labels: mergeLabels(answers), checked: answers[0]?.checked ?? [], read: answers.map((a) => a.read).join("; ") };
    }
    return c.json({ parts });
  });
}
