// The Atlas tools Muse Code can call. Each one is a thin, honest bridge to the Atlas server.
//
// The one rule (AI proposes; plain code decides) as it applies here:
// - These tools never decide what code does. The Atlas server's runner measures it and its judge (src/judge.ts)
//   says matched / didn't match / can't check. This file only reshapes the server's JSON into sentences.
// - The person's bet comes from the person's own typed words (bet-parse.ts), never from the coding agent.
// - What every bettor sees (D19) is the server's text, returned byte for byte, so the person reads exactly what the
//   betting models read.
// - Muse Wonder's one sentence about the code (D18) is only fetched after the run, and labelled as its words.
//
// Where code goes: atlas_read_file_function sends the ONE file it is asked about, and only if it sits inside the
// folder Muse Code is working in, to the Atlas server at ATLAS_URL. Nothing else leaves this machine from here.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AtlasAnswer, AtlasClient } from "./atlas-client.ts";
import { BUDGET_WORDS } from "./atlas-client.ts";
import type { AtlasConfig } from "./config.ts";
import { parseTypedAnswer, toServerAnswer, type QuestionView } from "./bet-parse.ts";

export const MAX_FILE_BYTES = 64 * 1024; // the server's limit (src/pasted-code.ts PASTED_MAX_BYTES)

/** The file kinds Atlas can run (D24: JavaScript / TypeScript and Python). */
export const LANGUAGE_OF_EXTENSION: Record<string, "js" | "ts" | "py"> = {
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".py": "py",
};

const LANGUAGE_NAME = { js: "JavaScript", ts: "TypeScript", py: "Python" } as const;

/** Product name AND id for every bettor (D10: Meta's model names stay visible). */
const BETTOR_NAME: Record<string, string> = {
  human: "You",
  "model:muse-spark-1.3": "Muse Spark 1.3 (muse-spark-1.3)",
  "model:meta-models/muse-spark-open-1026": "Muse Spark Open (meta-models/muse-spark-open-1026)",
};
export const bettorName = (who: string) => BETTOR_NAME[who] ?? who.replace(/^model:/, "");

const OUTCOME_WORDS: Record<string, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };

export interface ToolText {
  text: string;
  isError?: boolean;
}

interface FileEntry {
  path: string;
  target: { kind: string; ref: string; codeSha256: string; language: string };
  exports: { name: string; line: number }[];
  cantCheck: string | null;
}
interface RoundEntry {
  path: string;
  exportName: string;
  questions: QuestionView[];
  says: string | null;
}

export interface ToolDeps {
  client: AtlasClient;
  config: AtlasConfig;
  /** The folder Muse Code works in. Files outside it are never read. Default: this process's working folder. */
  workspace?: string;
}

const fail = (text: string): ToolText => ({ text, isError: true });
const failFrom = (a: Extract<AtlasAnswer<unknown>, { ok: false }>, what: string): ToolText => fail(`${what}: ${a.reason}`);

/** A server sentence (or a reason we print) shown on its own line, with nothing that could pass as markup. */
const quoteLine = (s: string) => s.replace(/\r?\n/g, " ").trim();

export function createTools(deps: ToolDeps) {
  const { client, config } = deps;
  const files = new Map<string, FileEntry>();
  const rounds = new Map<string, RoundEntry>();

  function workspaceRoot(): string {
    return realpathSync(deps.workspace ?? process.cwd());
  }

  /** Reads one file the agent names, only inside the workspace, only a kind Atlas runs, at most 64 KB. */
  function readWorkspaceFile(pathArg: string): { ok: true; rel: string; code: string; language: "js" | "ts" | "py" } | { ok: false; reason: string } {
    if (typeof pathArg !== "string" || pathArg.trim() === "") return { ok: false, reason: "give the path of the file Muse Code just edited" };
    const root = workspaceRoot();
    const asked = isAbsolute(pathArg) ? pathArg : resolve(root, pathArg);
    let real: string;
    try {
      real = realpathSync(asked);
    } catch {
      return { ok: false, reason: `there is no file at ${pathArg} in this workspace` };
    }
    const rel = relative(root, real);
    if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
      return { ok: false, reason: `${pathArg} is outside the folder Muse Code is working in, so Atlas will not read it (it only sends files from this workspace)` };
    }
    const ext = extname(real).toLowerCase();
    const language = LANGUAGE_OF_EXTENSION[ext];
    if (!language) {
      return { ok: false, reason: `Atlas runs JavaScript, TypeScript and Python files (.js .mjs .cjs .ts .mts .cts .py); ${rel} is ${ext ? `a ${ext} file` : "a file with no extension"}, so there is nothing Atlas can bet on here. Nothing was sent.` };
    }
    const st = statSync(real);
    if (!st.isFile()) return { ok: false, reason: `${rel} is not a file` };
    if (st.size > MAX_FILE_BYTES) return { ok: false, reason: `${rel} is ${st.size} bytes; Atlas reads one file of at most ${MAX_FILE_BYTES} bytes (64 KB). Nothing was sent.` };
    return { ok: true, rel, code: readFileSync(real, "utf8"), language };
  }

  /** The file Atlas already read, named the way the agent names it (relative or absolute, inside the workspace). */
  function fileEntry(pathArg: unknown): FileEntry | undefined {
    const p = String(pathArg ?? "");
    if (files.has(p)) return files.get(p);
    try {
      const root = workspaceRoot();
      return files.get(relative(root, realpathSync(isAbsolute(p) ? p : resolve(root, p))));
    } catch {
      return undefined;
    }
  }

  /** atlas_read_file_function: the exported functions of one file, as Atlas's plain code reads them. */
  async function readFileFunction(args: { path?: unknown }): Promise<ToolText> {
    const f = readWorkspaceFile(String(args.path ?? ""));
    if (!f.ok) return fail(f.reason);
    type PasteAns = { target: FileEntry["target"]; runnable: boolean; reason?: string; exports: { name: string; line: number; declaredAs?: string }[]; cantCheck: string | null; language: { chosen: string; chosenBy: string; why: string } };
    const r = await client.post<PasteAns>("/paste", { code: f.code, language: f.language });
    if (!r.ok) return failFrom(r, `Atlas could not read ${f.rel}`);
    const p = r.json;
    if (!p.runnable) return fail(`Atlas read ${f.rel} as ${LANGUAGE_NAME[f.language]}, but this Atlas server cannot run ${LANGUAGE_NAME[f.language]} yet: ${quoteLine(p.reason ?? "no runner")}.`);
    files.set(f.rel, { path: f.rel, target: p.target, exports: p.exports.map((e) => ({ name: e.name, line: e.line })), cantCheck: p.cantCheck });
    const lines = [
      `Atlas read ${f.rel} (${LANGUAGE_NAME[f.language]}, from the file's extension; sent to the Atlas server at ${config.url}).`,
      p.exports.length === 0
        ? `It found no exported function. Atlas calls one exported function, so the file needs ${f.language === "py" ? "a top-level `def name(...)`" : "`export function name(...)`"}.`
        : `Exported functions (found by Atlas's plain code):\n${p.exports.map((e, i) => `  ${i + 1}) ${e.name} (line ${e.line}${e.declaredAs ? `, ${e.declaredAs}` : ""})`).join("\n")}`,
    ];
    if (p.cantCheck) {
      lines.push(`Can't check: ${quoteLine(p.cantCheck)}. Every run of this file would say "can't check" with this reason, so Atlas will not ask a model for tests on it.`);
    }
    lines.push("Next: ask the person which function to bet on, then call atlas_propose_tests.");
    return { text: lines.join("\n") };
  }

  /** atlas_propose_tests: Muse Wonder proposes tests; Atlas's gate checks each one. */
  async function proposeTests(args: { path?: unknown; function?: unknown }): Promise<ToolText> {
    const entry = fileEntry(args.path);
    if (!entry) return fail(`call atlas_read_file_function on ${String(args.path ?? "the file")} first (Atlas needs to read the file before it can propose tests)`);
    const fn = String(args.function ?? "");
    if (!entry.exports.some((e) => e.name === fn)) return fail(`${entry.path} has no exported function named "${fn}"; it exports ${entry.exports.map((e) => e.name).join(", ") || "nothing"}`);
    if (entry.cantCheck) return fail(`Can't check: ${quoteLine(entry.cantCheck)}. Atlas does not ask a model for tests on a file it already knows it cannot run.`);
    type Props = { ok: boolean; model: string; display: string; reason?: string; proposals: { id: string; gate: { allowed: boolean; reason?: string }; says?: string }[]; claimHeld?: boolean };
    const r = await client.post<Props>("/paste/proposals", { target: entry.target, exportName: fn });
    if (!r.ok) return failFrom(r, "Atlas could not get tests");
    const p = r.json;
    if (!p.ok || p.proposals.length === 0) {
      const why = quoteLine(p.reason ?? "no tests came back");
      if (BUDGET_WORDS.test(why)) return fail(`Muse Wonder was not asked, because your invite's budget is used up: ${why}. You can still write your own test on the Atlas web page.`);
      return fail(`${p.display} proposed no test: ${why}.`);
    }
    const lines = [`${p.display} proposed ${p.proposals.length} test${p.proposals.length === 1 ? "" : "s"} for ${fn}. Atlas's gate (plain code) checked each one:`];
    p.proposals.forEach((x, i) => {
      lines.push(x.gate.allowed ? `  ${i + 1}) [${x.id}] allowed: ${quoteLine(x.says ?? "a call of the function")}` : `  ${i + 1}) [${x.id}] refused by the gate, so it will never run: ${quoteLine(x.gate.reason ?? "")}`);
    });
    if (p.claimHeld) lines.push("Muse Wonder also wrote one sentence about the code. Atlas keeps it back until the run, so every bettor bets on the same information.");
    lines.push("Next: show these to the person, let them pick an allowed test, then call atlas_start_round with its id.");
    return { text: lines.join("\n") };
  }

  /** atlas_start_round: makes the experiment; returns the questions and what every bettor sees (D19), verbatim. */
  async function startRound(args: { path?: unknown; proposal_id?: unknown }): Promise<ToolText> {
    const entry = fileEntry(args.path);
    if (!entry) return fail(`call atlas_read_file_function on ${String(args.path ?? "the file")} first`);
    const proposalId = String(args.proposal_id ?? "");
    type Exp = { experiment: { id: string; params?: { exportName?: string } }; questions: QuestionView[]; seenContext?: string; models?: { display: string; status: string; reason?: string }[]; repeatOf?: string };
    const r = await client.post<Exp>("/experiments", { target: entry.target, proposalId });
    if (!r.ok) return failFrom(r, "Atlas did not start the round");
    const e = r.json;
    const id = e.experiment.id;
    rounds.set(id, { path: entry.path, exportName: e.experiment.params?.exportName ?? "", questions: e.questions, says: null });
    const lines = [
      `Round ${id} is open. Every bettor (the person and the Meta models) sees exactly this text, written by Atlas's server:`,
      "----- what every bettor sees (show it to the person exactly as it is) -----",
      e.seenContext ?? "(the server sent no bettor text)",
      "----- end -----",
      "",
      "The questions (ask the person each one and pass their words, exactly as typed, to atlas_seal_bet):",
    ];
    e.questions.forEach((q, i) => {
      const how = q.kind === "enum" ? `one of: ${(q.options ?? []).map((o, j) => `${j + 1}) ${o}`).join(", ")}` : q.kind === "json" ? "a JSON value (true, 3, \"text\", {\"ok\": true})" : `a ${q.kind === "integer" ? "whole number" : "number"}${q.unit ? ` in ${q.unit}` : ""}${q.tolerancePct ? ` (counts as matched within ${q.tolerancePct}%)` : ""}`;
      lines.push(`  ${i + 1}) [${q.measures}] ${quoteLine(q.text)} Answer: ${how}; or "skip".`);
    });
    const models = (e.models ?? []).filter((m) => m.status !== "not_asked");
    if (models.length > 0) lines.push("", `Betting on their own, from the same text: ${models.map((m) => m.display).join(", ")}. Their bets stay sealed until the run.`);
    if (e.repeatOf) lines.push(`Note: this test repeats ${e.repeatOf}, which already ran in this session, so its bets are marked as a repeat.`);
    return { text: lines.join("\n") };
  }

  /** atlas_seal_bet: seals the PERSON's bets, read from their typed words by plain code. */
  async function sealBet(args: { experiment_id?: unknown; answers?: unknown }): Promise<ToolText> {
    const id = String(args.experiment_id ?? "");
    const round = rounds.get(id);
    if (!round) return fail(`there is no open round ${id}; call atlas_start_round first`);
    if (!Array.isArray(args.answers) || args.answers.length === 0) return fail("answers: one entry per question, each {measures, typed} with the person's words exactly as they typed them");
    const bets: { measures: string; answer: Record<string, unknown> }[] = [];
    const echoes: string[] = [];
    for (const raw of args.answers as { measures?: unknown; typed?: unknown }[]) {
      const q = round.questions.find((x) => x.measures === raw?.measures);
      if (!q) return fail(`round ${id} has no question "${String(raw?.measures)}"; its questions are ${round.questions.map((x) => x.measures).join(", ")}`);
      if (typeof raw.typed !== "string") return fail(`answers[].typed must be the person's words as a string (for "${q.measures}")`);
      const parsed = parseTypedAnswer(q, raw.typed);
      if (!parsed.ok) return fail(`Nothing was sealed. ${parsed.reason}. Ask the person again.`);
      bets.push({ measures: q.measures, answer: toServerAnswer(q, parsed.answer) });
      echoes.push(`  [${q.measures}] they typed "${raw.typed.trim()}" → sealed as ${parsed.answer.kind === "declined" ? "no bet (judged as can't check)" : JSON.stringify(parsed.answer.value)}`);
    }
    type Sealed = { bets: { measures: string; sealedHash: string; sealedAt: string }[] };
    const r = await client.post<Sealed>("/bets", { experimentId: id, who: "human", bets });
    if (!r.ok) return failFrom(r, "Atlas did not seal the bet");
    return {
      text: [
        `Sealed by Atlas's server (its clock and its random nonce; the hash is shown before the run):`,
        ...echoes,
        ...r.json.bets.map((b) => `  ${b.measures}: sealed ${b.sealedAt}, hash ${b.sealedHash.slice(0, 16)}…`),
        "Next: call atlas_run to run the code.",
      ].join("\n"),
    };
  }

  /** atlas_run: Atlas runs the code; its judge compares each sealed bet with what the run measured. */
  async function run(args: { experiment_id?: unknown }): Promise<ToolText> {
    const id = String(args.experiment_id ?? "");
    const round = rounds.get(id);
    if (!round) return fail(`there is no round ${id} in this Muse session`);
    // The model bets were started when the round opened; wait for them so their status can be reported.
    await client.post(`/experiments/${encodeURIComponent(id)}/model-bets`, {});
    type RunAns = {
      run: { id: string; controlPassed: boolean; result: { measured: Record<string, unknown>; notMeasured: Record<string, string> }; executor?: string };
      verdicts: { betId: string; outcome: string; observed?: unknown; reason?: string }[];
      bets: { id: string; who: string; measures: string; question: string; answer: { kind: string; value?: unknown; reason?: string }; rationale?: string }[];
      models?: { display: string; status: string; reason?: string }[];
      proof?: { ok: boolean; runId: string };
    };
    const r = await client.post<RunAns>("/runs", { experimentId: id });
    if (!r.ok) return failFrom(r, "The run did not happen");
    const { run: theRun, verdicts, bets } = r.json;
    const lines: string[] = [];
    lines.push(`Atlas ran ${round.exportName || "the function"} from ${round.path} (run ${theRun.id}, ${theRun.executor ?? "sandbox"} executor).`);
    const whole = theRun.result.notMeasured?.wholeRun;
    if (!theRun.controlPassed) lines.push("Can't check this whole run: Atlas's own known-case check did not match first, so no bet is judged.");
    else if (whole) lines.push(`Can't check this whole run: ${quoteLine(whole)}`);
    else {
      const facts = Object.entries(theRun.result.measured).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
      lines.push(`What the run measured (facts, not opinions): ${facts.join("; ") || "nothing"}`);
    }
    lines.push("", "Who bet what, and what the code did (judged by Atlas's plain-code judge, src/judge.ts):");
    for (const q of round.questions) {
      // The person first, then the models, as the page shows them.
      const onQ = bets.filter((b) => b.measures === q.measures).sort((a, b) => Number(b.who === "human") - Number(a.who === "human"));
      if (onQ.length === 0) continue;
      lines.push(`  ${quoteLine(q.text)}`);
      for (const b of onQ) {
        const v = verdicts.find((x) => x.betId === b.id);
        const said = b.answer.kind === "declined" ? "no bet" : JSON.stringify(b.answer.value);
        const outcome = v ? OUTCOME_WORDS[v.outcome] ?? v.outcome : "not judged";
        // returnedJson is stored as the JSON text of the value; shown as that text, not quoted again.
        const observed = v && v.observed !== undefined ? `; the code did ${typeof v.observed === "string" && b.measures === "returnedJson" ? v.observed : JSON.stringify(v.observed)}` : "";
        lines.push(`    ${bettorName(b.who)} bet ${said}${observed} → ${outcome}${v?.outcome === "cant_check" && v.reason ? ` (${quoteLine(v.reason)})` : ""}`);
      }
    }
    for (const m of r.json.models ?? []) if (m.status !== "sealed" && m.status !== "not_asked") lines.push(`  ${m.display}: sealed no bet (${quoteLine(m.reason ?? m.status)})`);
    // D18: Muse Wonder's sentence only now, after every bet was frozen, labelled as its own words.
    const claim = await client.post<{ claim?: string; display?: string }>("/paste/claim", { experimentId: id });
    if (claim.ok && claim.json.claim) lines.push("", `${claim.json.display ?? "Muse Wonder"} had said (its own words, not a verdict): ${quoteLine(claim.json.claim)}`);
    const runId = r.json.proof?.runId ?? theRun.id;
    lines.push("", `Proof card: ${config.webUrl ? `${config.webUrl}/?proof=${encodeURIComponent(runId)}` : `${config.url}/proofs/${encodeURIComponent(runId)} (the .atlas.json; set ATLAS_WEB_URL for the page)`}`);
    lines.push("Show this to the person as it is. The words matched / didn't match / can't check are Atlas's, not yours: never restate them as right or wrong.");
    return { text: lines.join("\n") };
  }

  /** atlas_status: where Atlas is, whether it answers, and whether an invite is set (never the invite itself). */
  async function status(): Promise<ToolText> {
    const h = await client.get<{ ok: boolean }>("/health");
    const langs = await client.get<{ languages: { language: string; name: string; runnable: boolean }[]; executor: string; privacy: string }>("/paste/languages");
    const lines = [`Atlas server: ${config.url} (from ${config.from.url}). Invite code: ${config.invite ? `set (from ${config.from.invite})` : "not set"}. Bettors besides you: ${config.claimant ?? "the server's default (Muse Spark 1.3)"}.`];
    if (!h.ok) return fail([...lines, `It does not answer: ${h.reason}`].join("\n"));
    if (langs.ok) {
      lines.push(`It runs: ${langs.json.languages.map((l) => `${l.name}${l.runnable ? "" : " (not yet)"}`).join(", ")} on the ${langs.json.executor} executor.`);
      lines.push(`Where your code goes (the server's own words): ${quoteLine(langs.json.privacy)}`);
    }
    return { text: lines.join("\n") };
  }

  return { readFileFunction, proposeTests, startRound, sealBet, run, status, _state: { files, rounds } };
}

export type AtlasTools = ReturnType<typeof createTools>;
