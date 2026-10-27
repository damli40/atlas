// Builds proofs/refusals/INDEX.md from the files in this repo, so the index cannot drift from them
// (day-7 review S2). Plain code only: no model call, no network.
//
//   pnpm tsx tests/tools/refusal-index.ts           print the index
//   pnpm tsx tests/tools/refusal-index.ts --write   write proofs/refusals/INDEX.md
//
// tests/unit/refusal-index.test.ts fails when the committed INDEX.md differs from this script's output.
//
// What it reads (tracked files only, `git ls-files`):
// 1. Every .json / .jsonl under tests/evidence/ and proofs/refusals/, walked for judge verdicts with
//    `"outcome": "cant_check"` and a `betId` (the bet is looked up in the same file for its bettor and
//    the bettor's own reason). Files under NOT_COUNTED are skipped: they were built on purpose.
// 2. Evidence-script formats that hold a verdict without a bet id:
//    - `judged-runs.json` rows (`rows[].outcome`), matched to the `declined_bet` records in
//      proofs/refusals/ by model, measured field and the bettor's reason (that gives the bet id);
//    - `<name>-answers.jsonl` lines with `"verdict": "cant_check"`, whose run id is in `<name>-run.json`
//      and whose model is in `<name>-summary.json`.
// 3. proofs/refusals/*.json records (the live server's own refusal files).
// 4. TEXT_SOURCES: plain-text outputs with a can't-check or gate line, each found by an exact pattern
//    (the script fails if the pattern is no longer in the file).
// A model slot with "no usable answer" (no bet sealed, e.g. a network error) is NOT a decline: it is
// listed under "Not counted" with its reason, never as a can't-check verdict.
//
// What it does not do: read .txt / .md files other than TEXT_SOURCES. A new plain-text-only refusal
// must be added to TEXT_SOURCES by hand.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { modelDisplay } from "../../src/claimants";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const INDEX_PATH = join(ROOT, "proofs", "refusals", "INDEX.md");

/** Built on purpose (tests, probes, drawings): never counted. Each path must exist. */
export const NOT_COUNTED: { path: string; why: string }[] = [
  { path: "tests/evidence/D01-review/probes-after.txt", why: "6 can't-checks built on purpose by the day-1 review's probes" },
  { path: "tests/evidence/D02-review/probes", why: "review probes, constructed on purpose" },
  { path: "tests/evidence/D04-review/probes", why: "review probes, constructed on purpose" },
  { path: "tests/evidence/D05-review/probes", why: "review probes, constructed on purpose" },
  { path: "tests/evidence/D05-03/cases.json", why: "runs built for a drawing test (one with its control marked as not passed)" },
  { path: "tests/evidence/D03-05", why: "a spike whose control failed; no bet was judged" },
  { path: "tests/evidence/D04-02/run-output.txt", why: 'PASS-RULE rule 3 "can\'t check (no replay ran)": a rule line, not a bet (no change proposed yet)' },
  { path: "tests/evidence/D06-01/pass-rule-replay.txt", why: 'PASS-RULE rule 3 "can\'t check (no replay ran)": a rule line, not a bet (Muse Code gave no usable change)' },
  { path: "tests/evidence/D07-review", why: "the day-7 review's regression tests, constructed on purpose" },
];

/** Plain-text sources: each row is read from the file by its pattern. */
const TEXT_SOURCES = [
  {
    kind: "cant_check" as const,
    file: "tests/evidence/D01-08/six-cases.txt",
    pattern: /settledAtMs\s+(\d+)\s+-\s+can't check \(([^)]*(?:\([^)]*\))?[^)]*)\)/,
    row: (m: RegExpMatchArray) => ({
      date: "2026-10-27 05:32",
      runId: "not recorded",
      bet: `S6 settledAtMs (the gate script's own bet, ${m[1]})`,
      bettor: "none (plain code)",
      reason: m[2]!,
      own: null as string | null,
    }),
  },
];
const TEXT_GATE_SOURCES = [
  {
    file: "tests/evidence/D06-02/sweep-output.txt",
    pattern: /callers (\d+): 422 gate: rejected \((.*)\); nothing will run/,
    row: (m: RegExpMatchArray) => ({ date: "2026-10-27, about 08:42", experiment: `concurrency-sweep · callers ${m[1]}`, reason: m[2]!, by: "the D06-02 evidence script (a person's request; no model)" }),
  },
];

/** Film candidates (Dami picks; nothing is staged). Each run id must be a row of the table. */
const CANDIDATES: { runIds: string[]; text: string }[] = [
  {
    runIds: ["mwTaxvHFzB"],
    text: 'Muse Spark declines Moonwell\'s cbETH price because it "depends on live oracle" data; the judge says can\'t check while the run reads $1.12 against a $2,206.68 reference. Verified `.atlas.json`, proof card (D06-03), replays to the same result. The same reason recurs across the D19 rows, so it is a pattern, not a fluke.',
  },
  {
    runIds: ["ytshhYe28r", "cu96dAM4Bf"],
    text: "The open-weights instance (D07-01): on Moonwell, Muse Spark Open (via Baseten) declines too. In `ytshhYe28r` both Muse Spark and Muse Spark Open decline the same question in the same round. Each round has a verified `.atlas.json` in `tests/evidence/D07-01/`.",
  },
  {
    runIds: ["6WcBUBJ1D0"],
    text: 'The same decline inside the autonomous "What else?" round, with the handoff on the log strip (`tests/evidence/D07-02/moonwell-strip-handoff.png`). Its `.atlas.json` was kept in memory only, so it cannot be replayed from a file.',
  },
  {
    runIds: ["not recorded"],
    text: "S6 settle time: plain code, no model, will not give a settle time to a call that never settles. Atlas's own voice, but the bet is the gate script's own and no run id was printed.",
  },
];

interface Row {
  date: string;
  runId: string;
  betKey: string;
  bet: string;
  bettor: string;
  reason: string;
  own: string | null;
  files: Set<string>;
  replay?: boolean;
  /** Orders rows inside one run (an evidence script's call number); else the bet id. */
  order?: string;
}

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: Json): string | undefined => (typeof v === "string" ? v : undefined);
const minute = (iso: string | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") : "not recorded");
const bettorOf = (who: string | undefined) => (who === undefined ? "unknown" : who === "human" ? "the person" : modelDisplay(who.replace(/^model:/, "")));
const cleanOwn = (r: string | undefined) => (r === undefined ? null : r.replace(/^unknown:\s*/, ""));

function tracked(): string[] {
  return execFileSync("git", ["ls-files", "-z", "tests/evidence", "proofs/refusals"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
}
const skipped = (f: string) => NOT_COUNTED.some((n) => f === n.path || f.startsWith(n.path + "/"));

function readDocs(f: string): Json[] {
  const text = readFileSync(join(ROOT, f), "utf8");
  if (f.endsWith(".jsonl")) {
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Json];
        } catch {
          return [];
        }
      });
  }
  try {
    return [JSON.parse(text) as Json];
  } catch {
    return [];
  }
}

function walk(v: Json, visit: (o: Record<string, Json>, parents: Record<string, Json>[]) => void, parents: Record<string, Json>[] = []) {
  if (Array.isArray(v)) for (const x of v) walk(x, visit, parents);
  else if (isObj(v)) {
    visit(v, parents);
    for (const x of Object.values(v)) walk(x, visit, [...parents, v]);
  }
}

export interface IndexData {
  rows: Row[];
  gates: { date: string; experiment: string; reason: string; by: string; file: string }[];
  slots: { model: string; runId: string; reason: string; files: Set<string> }[];
}

export function collect(): IndexData {
  const files = tracked();
  const rows = new Map<string, Row>();
  const add = (r: Omit<Row, "files">, file: string) => {
    const key = `${r.runId}|${r.betKey}`;
    const have = rows.get(key);
    if (have) {
      have.files.add(file);
      if (have.date === "not recorded" && r.date !== "not recorded") have.date = r.date;
      if (have.own === null && r.own !== null) have.own = r.own;
    } else rows.set(key, { ...r, files: new Set([file]) });
  };
  const slots = new Map<string, { model: string; runId: string; reason: string; files: Set<string> }>();
  const gates: IndexData["gates"] = [];

  const records = files.filter((f) => f.startsWith("proofs/refusals/") && f.endsWith(".json")).map((f) => ({ f, r: readDocs(f)[0] as Record<string, Json> }));
  const declined = records.filter((x) => x.r.kind === "declined_bet");

  for (const f of files) {
    if (!/\.(json|jsonl)$/.test(f) || skipped(f)) continue;
    const docs = readDocs(f);
    for (const doc of docs) {
      // Bets and runs anywhere in the file, by id.
      const bets = new Map<string, Record<string, Json>>();
      const runs = new Map<string, Record<string, Json>>();
      walk(doc, (o) => {
        if (str(o.id) && isObj(o.answer) && str(o.who)) bets.set(o.id as string, o);
        if (str(o.id) && str(o.startedAt)) runs.set(o.id as string, o);
      });
      walk(doc, (o, parents) => {
        // 1. A judge verdict.
        if (o.outcome === "cant_check" && str(o.betId) && str(o.runId) && o.judgedBy === "src/judge.ts") {
          const bet = bets.get(o.betId as string);
          const answer = bet && isObj(bet.answer) ? bet.answer : undefined;
          add(
            {
              date: minute(str(runs.get(o.runId as string)?.startedAt) ?? str((doc as Record<string, Json>).createdAt)),
              runId: o.runId as string,
              betKey: o.betId as string,
              bet: `\`${o.betId}\`${bet ? ` (${str(bet.measures)})` : ""}`,
              bettor: bettorOf(str(bet?.who)),
              reason: str(o.reason) ?? "no reason recorded",
              own: answer?.kind === "declined" ? cleanOwn(str(answer.reason)) : null,
            },
            f,
          );
        }
        // 2a. judged-runs.json rows: { runId, rows: [{ outcome, measures, bet }] }.
        if (basename(f) === "judged-runs.json" && str(o.runId) && Array.isArray(o.rows)) {
          for (const row of o.rows) {
            if (!isObj(row) || row.outcome !== "cant_check") continue;
            const own = isObj(row.bet) ? str(row.bet.reason) : undefined;
            const rec = declined.find((d) => d.r.measures === row.measures && d.r.reason === own);
            add(
              {
                date: minute(str(rec?.r.time)),
                runId: o.runId as string,
                betKey: str(rec?.r.id) ?? `${row.measures}`,
                bet: rec ? `\`${rec.r.id}\` (${row.measures})` : `${row.measures} (no bet id recorded)`,
                bettor: rec && str(rec.r.model) ? modelDisplay(rec.r.model as string) : "unknown",
                reason: str(row.reason) ?? "no reason recorded",
                own: cleanOwn(own),
              },
              f,
            );
            if (rec) rows.get(`${o.runId}|${rec.r.id}`)!.files.add(rec.f);
          }
        }
        // 2b. <name>-answers.jsonl lines.
        if (f.endsWith("-answers.jsonl") && o.verdict === "cant_check" && str(o.sealedHash) && parents.length === 0) {
          const stem = f.replace(/-answers\.jsonl$/, "");
          const run = existsSync(join(ROOT, `${stem}-run.json`)) ? (readDocs(`${stem}-run.json`)[0] as Record<string, Json>) : undefined;
          const summary = existsSync(join(ROOT, `${stem}-summary.json`)) ? (readDocs(`${stem}-summary.json`)[0] as Record<string, Json>) : undefined;
          const answer = isObj(o.answer) ? o.answer : undefined;
          const runId = str(run?.id) ?? "not recorded";
          add(
            {
              date: minute(str(o.at)),
              runId,
              betKey: o.sealedHash as string,
              order: String(o.call).padStart(4, "0"),
              bet: `call ${o.call}, seal \`${(o.sealedHash as string).slice(0, 12)}…\``,
              bettor: str(summary?.model) ? modelDisplay(summary!.model as string) : "unknown",
              reason: str(o.verdictReason) ?? "no reason recorded",
              own: answer?.kind === "declined" ? cleanOwn(str(answer.reason)) : null,
            },
            f,
          );
          if (run) rows.get(`${runId}|${o.sealedHash}`)!.files.add(`${stem}-run.json`);
        }
        // A model slot with no usable answer: no bet was sealed. Not a decline.
        if (o.status === "no_usable_answer" && str(o.reason)) {
          const holder = [...parents].reverse().find((p) => str(p.runId) || (isObj(p.run) && str(p.run.id)));
          const runId = holder ? (str(holder.runId) ?? str((holder.run as Record<string, Json>).id)!) : "not recorded";
          const model = str(o.model) ?? (str(o.who) ?? "unknown").replace(/^model:/, "");
          const key = `${runId}|${model}|${o.reason}`;
          const have = slots.get(key);
          if (have) have.files.add(f);
          else slots.set(key, { model, runId, reason: o.reason as string, files: new Set([f]) });
        }
        // An experiment the gate refused.
        if (isObj(o.gate) && o.gate.allowed === false) gates.push({ date: minute(str(o.createdAt)), experiment: str(o.id) ?? "unknown", reason: str(o.gate.reason) ?? "no reason recorded", by: str(isObj(o.proposedBy) ? o.proposedBy.role : undefined) ?? "unknown", file: f });
      });
    }
  }

  // 3. The live server's own records.
  for (const { f, r } of records) {
    if (r.kind === "cant_check" && str(r.runId) && str(r.betId)) {
      add({ date: minute(str(r.time)), runId: r.runId as string, betKey: r.betId as string, bet: `\`${r.betId}\` (${str(r.measures)})`, bettor: str(r.model) ? modelDisplay(r.model as string) : "the person", reason: str(r.reason) ?? "", own: null }, f);
    }
    if (r.kind === "gate_rejection") gates.push({ date: minute(str(r.time)), experiment: JSON.stringify(r.experiment), reason: str(r.reason) ?? "", by: `${str(r.role)}${str(r.model) ? ` (${r.model})` : ""}`, file: f });
  }

  // 4. Plain-text sources.
  for (const s of TEXT_SOURCES) {
    const m = readFileSync(join(ROOT, s.file), "utf8").match(s.pattern);
    if (!m) throw new Error(`refusal-index: ${s.file} no longer holds its can't-check line; update TEXT_SOURCES`);
    const r = s.row(m);
    add({ date: r.date, runId: r.runId, betKey: "S6", bet: r.bet, bettor: r.bettor, reason: r.reason, own: r.own }, s.file);
  }
  for (const s of TEXT_GATE_SOURCES) {
    const m = readFileSync(join(ROOT, s.file), "utf8").match(s.pattern);
    if (!m) throw new Error(`refusal-index: ${s.file} no longer holds its gate line; update TEXT_GATE_SOURCES`);
    gates.push({ ...s.row(m), file: s.file });
  }
  for (const n of NOT_COUNTED) if (!existsSync(join(ROOT, n.path))) throw new Error(`refusal-index: NOT_COUNTED path ${n.path} does not exist`);

  // The same sealed bet judged again on a later run (a replay).
  const list = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.runId.localeCompare(b.runId) || (a.order ?? a.betKey).localeCompare(b.order ?? b.betKey));
  const seen = new Set<string>();
  for (const r of list) {
    if (seen.has(r.betKey)) r.replay = true;
    seen.add(r.betKey);
  }
  return { rows: list, gates, slots: [...slots.values()].sort((a, b) => a.runId.localeCompare(b.runId) || a.model.localeCompare(b.model)) };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const fileLink = (f: string) => (f.startsWith("proofs/refusals/") ? `[\`${basename(f)}\`](${basename(f)})` : `\`${f}\``);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildRefusalIndex(data: IndexData = collect()): string {
  const { rows, gates, slots } = data;
  const byBettor = new Map<string, number>();
  for (const r of rows) if (!r.replay) byBettor.set(r.bettor, (byBettor.get(r.bettor) ?? 0) + 1);
  const replays = rows.filter((r) => r.replay).length;
  const parts = [...byBettor].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([who, n]) => (who.startsWith("none") ? `${n} from plain code that had nothing to measure` : `${n} on bets ${who} declined`));
  if (replays) parts.push(`${plural(replays, "replay")} of a declined bet`);
  const modelGates = gates.filter((g) => /claimant|adversary/.test(g.by));
  for (const c of CANDIDATES) for (const id of c.runIds) if (!rows.some((r) => r.runId === id)) throw new Error(`refusal-index: film candidate run ${id} is not a row`);

  const out: string[] = [];
  out.push("# Refusal index (D9)", "");
  out.push(
    "<!-- Generated by tests/tools/refusal-index.ts from the files in this repo. Do not edit by hand: run",
    "     `pnpm tsx tests/tools/refusal-index.ts --write`. tests/unit/refusal-index.test.ts fails if this file drifts. -->",
    "",
  );
  out.push(
    'Every real "can\'t check" verdict and every real gate rejection recorded in this repo, each traceable to a file. Nothing here was made for this index: plain code reads it from the run files (how: the comment at the top of `tests/tools/refusal-index.ts`).',
    "",
  );
  out.push(
    `**Counts:** ${plural(rows.length, "can't-check verdict")} (${parts.join(", ")}) · ${plural(gates.length, "gate rejection")} · **${plural(modelGates.length, "gate rejection")} of a model's proposal** · ${plural(slots.length, "model slot")} with no usable answer (not declines, not counted).`,
    "",
  );
  out.push("## Can't-check verdicts (src/judge.ts)", "");
  out.push("| # | Date (UTC) | Run id | Bet | Bettor | Reason (plain code) · bettor's own reason | Files |", "|---|---|---|---|---|---|---|");
  rows.forEach((r, i) => {
    const reason = `${r.reason}${r.replay ? " (the same sealed bet, judged again on a replay)" : ""}${r.own ? ` · "${r.own}"` : ""}`;
    out.push(`| ${i + 1} | ${r.date} | ${r.runId === "not recorded" ? "not recorded" : `\`${r.runId}\``} | ${cell(r.bet)} | ${cell(r.bettor)} | ${cell(reason)} | ${[...r.files].sort().map(fileLink).join(", ")} |`);
  });
  out.push("");
  out.push("## Gate rejections (src/gate.ts)", "");
  if (gates.length === 0) out.push("None recorded.", "");
  else {
    out.push("| # | Date (UTC) | Experiment | Reason | Proposed by | File |", "|---|---|---|---|---|---|");
    gates.forEach((g, i) => out.push(`| ${i + 1} | ${g.date} | \`${cell(g.experiment)}\` | ${cell(g.reason)} | ${cell(g.by)} | ${fileLink(g.file)} |`));
    out.push("");
  }
  out.push(
    modelGates.length === 0
      ? "No model proposal has been refused by the gate in any recorded run. When one is, the live server writes it to this folder as `<date>-<experimentId>.json` (role `claimant` or `adversary`) and it appears above."
      : `${plural(modelGates.length, "model proposal")} refused by the gate (above).`,
    "",
  );
  out.push("## Not counted", "");
  out.push("Model slots with no usable answer. The model sealed no bet, so there is nothing to judge: these are not declines.", "");
  if (slots.length === 0) out.push("- none", "");
  for (const s of slots) out.push(`- run ${s.runId === "not recorded" ? "not recorded" : `\`${s.runId}\``}, ${s.model}: ${s.reason} (${[...s.files].sort().map(fileLink).join(", ")})`);
  out.push("", "Built on purpose, so never counted:", "");
  for (const n of NOT_COUNTED) out.push(`- \`${n.path}\`: ${n.why}`);
  out.push("");
  out.push("## Candidates for the film's \"can't check\" beat", "", "Dami picks; nothing is staged.", "");
  CANDIDATES.forEach((c, i) => out.push(`${i + 1}. **Run ${c.runIds.map((id) => (id === "not recorded" ? "not recorded" : `\`${id}\``)).join(", ")}**: ${c.text}`));
  out.push(
    "",
    "Caution for the narration: in every model row the model chose to decline; Atlas did not refuse to run. The judge's words are \"the bettor declined\". Say \"Muse Spark wouldn't guess, so Atlas can't check its bet\", never \"Atlas couldn't run it\".",
    "",
  );
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = buildRefusalIndex();
  if (process.argv.includes("--write")) {
    writeFileSync(INDEX_PATH, text);
    console.log(`wrote ${INDEX_PATH.slice(ROOT.length + 1)}`);
  } else process.stdout.write(text);
}
