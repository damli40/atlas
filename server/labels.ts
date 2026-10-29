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
// X3 review round 1:
// - Round 2 (Dami's D50, replacing round 1's "after the seal" hold): labels are shown BEFORE betting, to every bettor
//   alike: the page draws them and the bettor text every betting model gets carries them (POST /experiments).
// - M3: the code-only scan is cached per source fingerprint and span (labels then only add the runs), and each client
//   may ask at most DEFAULT_LABELS_PER_CLIENT_PER_HOUR times an hour (per invite code when there is one).

import type { Context, Hono } from "hono";
import { z } from "zod";
import { labelFromScan, scanFailures, type FailureLabelKind, type FunctionInfo, type LabelledFailure, type LabelsAnswer, type Lang, type RunEvidence, type Scan } from "../src/failure-labels";
import type { AtlasFile } from "../src/types";
import type { BetStore, Round } from "./bets";
import type { Paste } from "./paste";
import { BAD_SESSION, sessionIdOf } from "./log/sse";
import { parseJsFile } from "../src/outline/parse-js";
import { parsePyFile } from "../src/outline/parse-py";
import type { OutlineSection } from "../src/outline/types";

/** Label requests one client may make an hour (env ATLAS_LABELS_PER_IP_PER_HOUR). */
export const DEFAULT_LABELS_PER_CLIENT_PER_HOUR = 600;
/** Code-only scans kept (least recently used dropped first). */
export const MAX_CACHED_SCANS = 300;

export interface LabelDeps {
  paste: Paste;
  betStore: BetStore;
  /** A round's proof card (its .atlas.json), or undefined when there is none. */
  proofOf: (runId: string) => AtlasFile | undefined;
  /** An outline job: its session and, when done, its section. */
  outlineJobOf: (id: string) => { sessionId: string; section?: OutlineSection } | undefined;
  /** Per-client hourly allowance for label requests. */
  takeLabels: (c: Context) => { ok: true } | { ok: false; reason: string };
}

const body = z.object({ target: z.object({ ref: z.string().min(1).max(200), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }), exportName: z.string().min(1).max(100) }).strict();

/** The session's sealed runs of `exportName` on code with this fingerprint, oldest first, each with a proof card. */
export function runsOf(betStore: BetStore, proofOf: LabelDeps["proofOf"], sessionId: string, codeSha256: string, exportName: string, path?: string): (RunEvidence & { at: string })[] {
  const out: (RunEvidence & { at: string; path?: string })[] = [];
  for (const r of betStore.peek(sessionId)?.values() ?? []) {
    const round = r as Round;
    const p = round.experiment.params;
    if (round.status !== "done" || !round.run || p.shape !== "call-function") continue;
    if (round.experiment.target.codeSha256 !== codeSha256 || p.exportName !== exportName) continue;
    if (!proofOf(round.run.id)) continue; // "reproduced" must link to a proof card
    out.push({ runId: round.run.id, params: p, run: round.run, at: round.run.finishedAt, ...(path ? { path } : {}) });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** A parameter's plain name ("fetchIt: () => …" → fetchIt, "n=3" → n, "*args" → args), or null (destructured). */
export const paramName = (p: string): string | null => /^\s*(?:\.\.\.|\*{1,2})?([A-Za-z_$][\w$]*)/.exec(p)?.[1] ?? null;

/** The lines and parameter names of a top-level function (or of the definition an `export { a as b }` names), or null. */
export function functionInfo(text: string, language: Lang, exportName: string, path = "pasted"): FunctionInfo | null {
  const parsed = language === "py" ? parsePyFile(text) : parseJsFile(language === "ts" ? "pasted.ts" : "pasted.js", text, language);
  const local = parsed.exportedLocals.find((e) => e.exported === exportName)?.local ?? exportName;
  const s = parsed.symbols.find((x) => x.name === local && !x.parent);
  return s ? { path, name: exportName, lineStart: s.lineStart, lineEnd: s.lineEnd, params: (s.params ?? []).map(paramName) } : null;
}

const RANK: Record<FailureLabelKind, number> = { reproduced: 3, inconclusive: 2, "found in this code": 1, "common pattern": 0 };
/** Labels from several calls (a part whose files are in more than one language): the strongest label per failure. */
function mergeLabels(answers: LabelsAnswer[]): LabelledFailure[] {
  const best = new Map<string, LabelledFailure>();
  for (const a of answers)
    for (const l of a.labels) {
      const k = `${l.kind}/${l.failure}`;
      const had = best.get(k);
      if (!had || RANK[l.label] > RANK[had.label]) best.set(k, l);
    }
  return [...best.values()];
}

/**
 * X3: the labeler. One scan cache, used by both label routes and by POST /experiments, which puts a pasted function's
 * labels into the bettor text (D50: labels are shown before betting, to every bettor alike).
 */
export function createLabeler(deps: LabelDeps) {
  const scans = new Map<string, Scan>();
  const scanOf = (key: string, make: () => Scan): Scan => {
    let v = scans.get(key);
    if (v) scans.delete(key);
    else v = make();
    scans.set(key, v);
    while (scans.size > MAX_CACHED_SCANS) scans.delete(scans.keys().next().value!);
    return v;
  };
  /** Labels for one pasted function: its own lines, plus this session's sealed runs of it. */
  const forPaste = (sessionId: string, target: { codeSha256: string; language?: string; source?: string }, name: string): LabelsAnswer => {
    const lang = (target.language ?? "js") as Lang;
    const text = target.source ?? "";
    const key = `${target.codeSha256}:${lang}:${name}`;
    const scan = scanOf(key, () => {
      let fn: FunctionInfo | null = null;
      try {
        fn = functionInfo(text, lang, name);
      } catch {
        fn = null;
      }
      const total = text.split("\n").length;
      const sc = scanFailures({ language: lang, spans: [{ path: "pasted", text, lineStart: fn?.lineStart ?? 1, lineEnd: fn?.lineEnd ?? total }], ...(fn ? { functions: [fn] } : {}) });
      return { ...sc, fn, ...(fn ? {} : { note: `plain code could not find where ${name} ends, so it read the whole file` }) } as Scan & { fn: FunctionInfo | null };
    }) as Scan & { fn: FunctionInfo | null };
    const runs = runsOf(deps.betStore, deps.proofOf, sessionId, target.codeSha256, name);
    return labelFromScan(scan, runs, scan.fn ? [scan.fn] : []);
  };
  return { forPaste, register: (app: Hono) => registerLabelRoutes(app, deps, scanOf, forPaste) };
}
export type Labeler = ReturnType<typeof createLabeler>;

function registerLabelRoutes(app: Hono, deps: LabelDeps, scanOf: (key: string, make: () => Scan) => Scan, forPaste: Labeler["forPaste"]) {
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
    const allowed = deps.takeLabels(c);
    if (!allowed.ok) return c.json({ error: `labels not read: ${allowed.reason}` }, 429);
    const answer = forPaste(sessionId, entry.target, name);
    return c.json({ ...answer, exportName: name });
  });

  app.get("/outline/jobs/:id/labels", (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const job = deps.outlineJobOf(c.req.param("id"));
    if (!job || job.sessionId !== sessionId) return c.json({ error: "no such outline job in this session" }, 404);
    const s = job.section;
    if (!s) return c.json({ error: "the job is not done yet" }, 409);
    const allowed = deps.takeLabels(c);
    if (!allowed.ok) return c.json({ error: `labels not read: ${allowed.reason}` }, 429);
    if (!s.verified) return c.json({ parts: {}, note: "there is no outline to label: Muse Wonder gave none" });
    const fileOf = new Map(s.files.map((f) => [f.path, f] as const));
    const mapOf = new Map(s.codeMap.files.map((f) => [f.path, f] as const));
    const parts: Record<string, LabelsAnswer> = {};
    for (const part of s.verified.parts) {
      if (part.status !== "confirmed") continue;
      const spans = part.spans.filter((sp) => sp.ok && fileOf.has(sp.path));
      const byLang = new Map<Lang, { path: string; text: string; lineStart: number; lineEnd: number; sha: string }[]>();
      const runs: (RunEvidence & { at: string })[] = [];
      const functions: FunctionInfo[] = [];
      for (const sp of spans) {
        const f = fileOf.get(sp.path)!;
        const lang = f.language as Lang;
        (byLang.get(lang) ?? byLang.set(lang, []).get(lang)!).push({ path: f.path, text: f.text, lineStart: sp.lineStart, lineEnd: sp.lineEnd, sha: f.sha256 });
        // Exported top-level functions inside these lines: a round may have run one of them.
        for (const sym of mapOf.get(sp.path)?.symbols ?? []) {
          if (!sym.exported || sym.parent || sym.kind !== "function" || sym.lineStart < sp.lineStart || sym.lineEnd > sp.lineEnd) continue;
          functions.push({ path: f.path, name: sym.name, lineStart: sym.lineStart, lineEnd: sym.lineEnd, params: (sym.params ?? []).map(paramName) });
          runs.push(...runsOf(deps.betStore, deps.proofOf, sessionId, f.sha256, sym.name, f.path));
        }
      }
      runs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const model = s.verified.model;
      const answers = [...byLang].map(([language, sps]) => {
        const key = `outline:${sps.map((x) => `${x.sha}:${x.lineStart}-${x.lineEnd}`).join(",")}:${language}:${part.patterns.map((p) => p.label).join(",")}:${functions.map((f) => `${f.path}#${f.name}`).join(",")}`;
        const scan = scanOf(key, () => scanFailures({ language, spans: sps, functions, wonderTags: part.patterns, wonderModel: model }));
        return labelFromScan(scan, runs, functions, model);
      });
      parts[part.id] = answers.length === 1 ? answers[0]! : { labels: mergeLabels(answers), checked: answers[0]?.checked ?? [], read: answers.map((a) => a.read).join("; ") };
    }
    return c.json({ parts });
  });
}
