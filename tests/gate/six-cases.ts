// Day-1 gate (D01-08): the six known withRpcRetry cases, end to end over HTTP.
//
// What it does, in plain words:
// 1. Registers the withRpcRetry fixture with POST /targets.
// 2. For each oracle row S1–S6: POST /experiments (the gate decides, plain code writes the questions),
//    then one POST /bets per human bet (calls, total wait, outcome) whose answers are the oracle
//    table's expected values. The SERVER seals each bet at its own time with its own nonce (D02-04).
//    Then POST /runs {experimentId}: the server freezes the bets, runs the control once, runs the
//    real function in the sandbox, judges, and reveals each bet in full; this script re-checks
//    every revealed seal and that every bet was sealed before the run started.
// 3. Changes or adds a few bets to show the other verdicts from real runs. One bet per question per
//    bettor (the server refuses a second one with 409), so an off bet REPLACES the oracle bet:
//    - S3 calls = 4 instead of 5 (the run makes 5 calls) → didn't match
//    - S3 settle time = 12000 ms (the run throws at 12000 ms of virtual time) → matched, judged on the real value
//    - S6 settle time (the run never settles, so there is no settle time) → can't check, with the runner's reason
// 4. Prints one line per bet, and the total real time.
//
// Run: `pnpm gate:day1` (starts the server on a free local port and talks to it over HTTP),
// or ATLAS_URL=http://localhost:8787 pnpm gate:day1 (a server you started with `pnpm server`).

import { pathToFileURL } from "node:url";
import { verifySeal } from "../../src/seal.ts";
import { OUTCOME_OPTIONS, SETTLE_FIELD } from "../../src/units.ts";
import { QUESTION_TEXT } from "../../src/gate.ts";
import type { Bet, BetAnswer, ExperimentShape, Outcome, Run, Target, Verdict } from "../../src/types.ts";

export type Requester = (path: string, init: RequestInit) => Promise<Response>;

const FIXTURE_REF = "tests/fixtures/with-rpc-retry.ts";
const OUTCOMES = [...OUTCOME_OPTIONS];

/** The question text lives in one place: src/gate.ts. */
export const QUESTIONS = QUESTION_TEXT;

interface CaseSpec {
  id: string;
  params: ExperimentShape;
  /** Hard-coded from tests/oracle/retry-oracle.json (the vitest test checks they still equal it). */
  expected: { calls: number; totalWaitMs: number; outcome: string };
  /** Bets that replace the oracle bet on the same question, or add a question (one bet per question). */
  extraBets?: { measures: keyof typeof QUESTIONS; answer: BetAnswer; note: string }[];
}

export const CASES: CaseSpec[] = [
  { id: "S1", params: { shape: "retry-scenario", failTimes: 0, failure: "error" }, expected: { calls: 1, totalWaitMs: 0, outcome: "returns" } },
  { id: "S2", params: { shape: "retry-scenario", failTimes: 1, failure: "error" }, expected: { calls: 2, totalWaitMs: 3000, outcome: "returns" } },
  {
    id: "S3",
    params: { shape: "retry-scenario", failTimes: 5, failure: "error" },
    expected: { calls: 5, totalWaitMs: 12000, outcome: "throws" },
    extraBets: [
      { measures: "calls", answer: { kind: "integer", value: 4 }, note: "deliberately off by one (replaces the bet of 5)" },
      { measures: SETTLE_FIELD, answer: { kind: "integer", value: 12000 }, note: "settle time of a run that settles" },
    ],
  },
  { id: "S4", params: { shape: "retry-scenario", failTimes: 1, failure: "error", errorKind: "429" }, expected: { calls: 2, totalWaitMs: 3000, outcome: "returns" } },
  { id: "S5", params: { shape: "retry-scenario", failTimes: 0, failure: "error", resolvesWith: { status: 429 } }, expected: { calls: 1, totalWaitMs: 0, outcome: "returns" } },
  {
    id: "S6",
    params: { shape: "retry-scenario", failTimes: "always", failure: "never_settles" },
    expected: { calls: 1, totalWaitMs: 0, outcome: "pending" },
    extraBets: [{ measures: SETTLE_FIELD, answer: { kind: "integer", value: 30000 }, note: "settle time of a run that never settles" }],
  },
];

export interface BetRow {
  caseId: string;
  measures: string;
  bet: string;
  observed: string;
  verdict: Outcome;
  reason?: string;
  note?: string;
}

export interface CaseResult {
  caseId: string;
  run: Run;
  verdicts: Verdict[];
  rows: BetRow[];
}

const SESSION_HEADER = "x-atlas-session";

/** Posts JSON and keeps the server's session id, so experiments, bets and runs share one session. */
function poster(request: Requester) {
  let session: string | null = null;
  return async function postJson<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session) headers[SESSION_HEADER] = session;
    const res = await request(path, { method: "POST", headers, body: JSON.stringify(body) });
    session ??= res.headers.get(SESSION_HEADER);
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(`${path} answered ${res.status}: ${json.error ?? "no reason given"}`);
    return json;
  };
}

function betText(a: BetAnswer): string {
  return a.kind === "declined" ? "declined" : String(a.value);
}

/** Runs the whole gate through `request` (app.request in-process, or fetch against a server). */
export async function runSixCases(request: Requester): Promise<{ target: Target; results: CaseResult[]; totalMs: number }> {
  const started = performance.now();
  const postJson = poster(request);
  const target = await postJson<Target>("/targets", { kind: "ts-fixture", ref: FIXTURE_REF });
  const results: CaseResult[] = [];

  for (const c of CASES) {
    const experimentId = `gate-${c.id}`;
    const specs: { measures: string; answer: BetAnswer; note?: string }[] = [
      { measures: "calls", answer: { kind: "integer", value: c.expected.calls } },
      { measures: "totalWaitMs", answer: { kind: "integer", value: c.expected.totalWaitMs } },
      { measures: "outcome", answer: { kind: "enum", value: c.expected.outcome, options: OUTCOMES } },
    ];
    for (const x of c.extraBets ?? []) {
      const i = specs.findIndex((s) => s.measures === x.measures);
      if (i >= 0) specs[i] = x;
      else specs.push(x);
    }
    await postJson("/experiments", { id: experimentId, target: { ref: target.ref, codeSha256: target.codeSha256 }, params: c.params });
    const shown: Omit<Bet, "nonce">[] = [];
    for (const s of specs) {
      const { bet } = await postJson<{ bet: Omit<Bet, "nonce"> }>("/bets", { experimentId, who: "human", measures: s.measures, answer: s.answer });
      if (bet.question !== QUESTIONS[s.measures as keyof typeof QUESTIONS]) throw new Error(`the server asked "${bet.question}" for ${s.measures}`);
      shown.push(bet);
    }
    const { run, verdicts, bets } = await postJson<{ run: Run; verdicts: Verdict[]; bets: Bet[] }>("/runs", { experimentId });
    // The revealed bets must be the ones whose hashes were shown, each sealed before the run started.
    bets.forEach((b, i) => {
      if (b.sealedHash !== shown[i]!.sealedHash || !verifySeal(b)) throw new Error(`the revealed bet ${b.id} does not hash to the hash shown before the run`);
      if (!(Date.parse(b.sealedAt) < Date.parse(run.startedAt))) throw new Error(`bet ${b.id} was sealed at ${b.sealedAt}, not before the run started at ${run.startedAt}`);
    });
    const rows: BetRow[] = verdicts.map((v, i) => {
      const s = specs[i]!;
      return {
        caseId: c.id,
        measures: s.measures,
        bet: betText(s.answer),
        observed: v.observed === undefined ? "-" : String(v.observed),
        verdict: v.outcome,
        ...(v.reason ? { reason: v.reason } : {}),
        ...(s.note ? { note: s.note } : {}),
      };
    });
    results.push({ caseId: c.id, run, verdicts, rows });
  }
  return { target, results, totalMs: Math.round(performance.now() - started) };
}

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };

export function formatTable(out: Awaited<ReturnType<typeof runSixCases>>): string {
  const lines: string[] = [];
  const pre = out.target.preExisting ? ` (${out.target.preExisting.label}, listed in ${out.target.preExisting.listedIn})` : "";
  lines.push(`target: ${out.target.ref}${pre}`);
  lines.push(`sha256: ${out.target.codeSha256}`);
  lines.push("");
  const head = ["case", "measured calls / wait ms / outcome", "bet on", "bet", "observed", "verdict"];
  const body: string[][] = [];
  for (const r of out.results) {
    const m = r.run.result.measured;
    const measured = `${m.calls ?? "-"} / ${m.totalWaitMs ?? "-"} / ${m.outcome ?? "-"}`;
    r.rows.forEach((row, i) => {
      const verdict = SAY[row.verdict] + (row.reason ? ` (${row.reason})` : "") + (row.note ? `  <- ${row.note}` : "");
      body.push([i === 0 ? r.caseId : "", i === 0 ? measured : "", row.measures, row.bet, row.observed, verdict]);
    });
  }
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const fmt = (cells: string[]) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ");
  lines.push(fmt(head));
  lines.push(fmt(widths.map((w) => "-".repeat(w))));
  for (const b of body) lines.push(fmt(b));
  lines.push("");
  const all = out.results.flatMap((r) => r.rows);
  const count = (o: Outcome) => all.filter((x) => x.verdict === o).length;
  lines.push(`verdicts: ${count("matched")} matched, ${count("not_matched")} didn't match, ${count("cant_check")} can't check`);
  const s4 = out.results.find((r) => r.caseId === "S4")?.run.trace.find((t) => t.event === "reject")?.data?.error;
  const s5 = out.results.find((r) => r.caseId === "S5")?.run.result.measured.returned;
  lines.push(`new shape fields reached the sandbox: S4 call 1 rejected with ${JSON.stringify(s4 ?? "-")}; S5 returned ${s5 ?? "-"}`);
  const controlIds = new Set(out.results.map((r) => r.run.controlRunId));
  const reused = controlIds.size === 1 ? `one control run (${[...controlIds][0]}) reused for all six` : `${controlIds.size} different control runs`;
  lines.push(`control passed on every run: ${out.results.every((r) => r.run.controlPassed) ? "yes" : "no"}; ${reused}`);
  lines.push(`total real time: ${out.totalMs} ms (limit 5000 ms)`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  let base = process.env.ATLAS_URL;
  let close = () => {};
  let mode = `HTTP against a running server at ${base}`;
  if (!base) {
    // Start the real server on a free local port, so the requests below go over real HTTP.
    const { createApp } = await import("../../server/app.ts");
    const { serve } = await import("@hono/node-server");
    const app = createApp();
    const port = await new Promise<number>((ok) => {
      const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => ok(info.port));
      close = () => server.close();
    });
    base = `http://127.0.0.1:${port}`;
    mode = "HTTP against an in-process server on 127.0.0.1 (started by this script)";
  }
  const request: Requester = (path, init) => fetch(new URL(path, base), init);
  try {
    const out = await runSixCases(request);
    console.log(`mode: ${mode}`);
    console.log(formatTable(out));
    const expectedOk = out.results.every((r) => r.rows.every((row) => (row.note ? true : row.verdict === "matched")));
    if (!expectedOk || out.totalMs >= 5000) process.exitCode = 1;
  } finally {
    close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
