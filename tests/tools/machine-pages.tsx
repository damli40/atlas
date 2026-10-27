// Builds the evidence pages for the two machines (D05-01 scoreboard, D05-02 retry machine) from REAL
// runs: it starts Atlas's server in-process (no model is called), plays rounds through the same
// HTTP routes the page uses, and renders the real React components to static HTML. One more input
// is the real D04-04 round (person + Muse Spark on S3), read from its .atlas.json.
//
// Run: npx tsx tests/tools/machine-pages.tsx
// Writes: tests/evidence/D05-01/*.html, tests/evidence/D05-02/*.html and runs.json beside them.
// The pages are static: the end state (or one held moment), so scripts/lines.mjs and capture.mjs
// see exactly what the reader sees at that moment.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createApp } from "../../server/app.ts";
import type { AtlasFile, Bet, BetAnswer, ExperimentShape, Run, Verdict } from "../../src/types.ts";
import { OUTCOME_OPTIONS } from "../../src/units.ts";
import { scoreboardCases } from "./scoreboard-cases.ts";
import { Scoreboard } from "../../web/machines/scoreboard/Scoreboard.tsx";
import { RetryMachine } from "../../web/machines/retry/RetryMachine.tsx";
import { retryModel } from "../../web/machines/retry/model.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT1 = join(ROOT, "tests/evidence/D05-01");
const OUT2 = join(ROOT, "tests/evidence/D05-02");

export interface Round {
  id: string;
  run: Run;
  bets: Bet[];
  verdicts: Verdict[];
}

/** One round through the real routes: target → experiment → the person's bets (sealed) → run. */
export async function playRound(app: ReturnType<typeof createApp>, id: string, params: ExperimentShape, answers: Record<string, BetAnswer>): Promise<Round> {
  let session: string | null = null;
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session) headers["x-atlas-session"] = session;
    const res = await app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
    session ??= res.headers.get("x-atlas-session");
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(`${path} answered ${res.status}: ${json.error ?? "?"}`);
    return json;
  };
  const target = await post<{ ref: string; codeSha256: string }>("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" });
  const exp = await post<{ experiment: { id: string } }>("/experiments", { target: { ref: target.ref, codeSha256: target.codeSha256 }, params });
  await post("/bets", { experimentId: exp.experiment.id, who: "human", bets: Object.entries(answers).map(([measures, answer]) => ({ measures, answer })) });
  const out = await post<{ run: Run; bets: Bet[]; verdicts: Verdict[] }>("/runs", { experimentId: exp.experiment.id });
  return { id, ...out };
}

const OUTCOMES = [...OUTCOME_OPTIONS];
export const ROUNDS: { id: string; params: ExperimentShape; answers: Record<string, BetAnswer> }[] = [
  {
    id: "S3",
    params: { shape: "retry-scenario", failTimes: 5, failure: "error" },
    answers: { calls: { kind: "integer", value: 5 }, totalWaitMs: { kind: "integer", value: 12000 }, outcome: { kind: "enum", value: "throws", options: OUTCOMES } },
  },
  {
    id: "S6",
    params: { shape: "retry-scenario", failTimes: "always", failure: "never_settles" },
    answers: { calls: { kind: "integer", value: 5 }, totalWaitMs: { kind: "integer", value: 0 }, outcome: { kind: "enum", value: "pending", options: OUTCOMES } },
  },
  {
    id: "S2",
    params: { shape: "retry-scenario", failTimes: 1, failure: "error" },
    answers: { calls: { kind: "integer", value: 2 }, totalWaitMs: { kind: "integer", value: 3000 }, outcome: { kind: "enum", value: "returns", options: OUTCOMES } },
  },
];

/** The real D04-04 fixture round: person and Muse Spark 1.3 on S3. */
export function d0404Round(): Round {
  const f = JSON.parse(readFileSync(join(ROOT, "tests/evidence/D04-04/fixture-GFNRq1eJx7.atlas.json"), "utf8")) as AtlasFile;
  return { id: "S3-person-and-spark", run: f.runs[0]!, bets: f.bets, verdicts: f.verdicts };
}

/** The machines' CSS, with its @import lines inlined. */
function machinesCss(): string {
  const dir = join(ROOT, "web/machines");
  return readFileSync(join(dir, "machines.css"), "utf8").replace(/@import "\.\/([^"]+)";/g, (_, p: string) => readFileSync(join(dir, p), "utf8"));
}

function page(title: string, body: string, theme: "light" | "dark"): string {
  const bg = theme === "light" ? "#f2f2ef" : "#0b0b0b";
  const ink = theme === "light" ? "#1d1d1b" : "#ececea";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:${bg};color:${ink};font:15px/1.5 system-ui,sans-serif;--ink:${ink}}main{max-width:720px;margin:0 auto;padding:24px 16px}.muted{opacity:.7}.small{font-size:13px}h2{font-size:15px;margin:18px 0 6px}
${machinesCss()}</style></head><body><main>${body}</main></body></html>`;
}

async function main() {
  mkdirSync(OUT1, { recursive: true });
  mkdirSync(OUT2, { recursive: true });
  const app = createApp();
  const rounds: Round[] = [];
  for (const r of ROUNDS) rounds.push(await playRound(app, r.id, r.params, r.answers));
  rounds.push(d0404Round());
  writeFileSync(join(OUT2, "runs.json"), JSON.stringify(rounds.map((r) => ({ id: r.id, runId: r.run.id, trace: r.run.trace, measured: r.run.result.measured, bets: r.bets.map((b) => ({ who: b.who, measures: b.measures, answer: b.answer })), verdicts: r.verdicts.map((v) => ({ betId: v.betId, outcome: v.outcome, observed: v.observed })) })), null, 2) + "\n");

  const byId = (id: string) => rounds.find((r) => r.id === id)!;
  for (const theme of ["dark", "light"] as const) {
    const sfx = theme === "light" ? "-light" : "";
    // D05-02: the retry machine, end state, for each round; plus held moments of the S3 story.
    for (const r of rounds) {
      const html = renderToStaticMarkup(<RetryMachine run={r.run} bets={r.bets} verdicts={r.verdicts} still theme={theme} />);
      writeFileSync(join(OUT2, `retry-${r.id}${sfx}.html`), page(`Retry machine ${r.id}`, html, theme));
    }
    const s3 = byId("S3-person-and-spark");
    const m = retryModel(s3);
    for (const [name, at] of [["mid-send", 0.6], ["mid-back", 1.5], ["mid-wait", 2.8], ["mid-pull", 3.4]] as const) {
      const html = renderToStaticMarkup(<RetryMachine run={s3.run} bets={s3.bets} verdicts={s3.verdicts} still theme={theme} at={Math.min(at, m.total)} />);
      writeFileSync(join(OUT2, `retry-S3-${name}${sfx}.html`), page(`Retry machine S3 ${name}`, html, theme));
    }
    // D05-01: the scoreboard, from each real round, plus the two acceptance cases.
    const cases = scoreboardCases();
    const body = [
      ...cases.map((c) => `<h2>${c.title}</h2>${renderToStaticMarkup(<Scoreboard verdicts={c.verdicts} bets={c.bets} still />)}`),
      ...rounds.map((r) => `<h2>Real round ${r.id} (run ${r.run.id})</h2>${renderToStaticMarkup(<Scoreboard verdicts={r.verdicts} bets={r.bets} still />)}`),
    ].join("");
    writeFileSync(join(OUT1, `scoreboard${sfx}.html`), page("Scoreboard", `<div class="sb-page">${body}</div>`, theme));
  }
  console.log(`wrote pages for ${rounds.length} rounds: ${rounds.map((r) => `${r.id} (calls ${r.run.result.measured.calls ?? "-"}, outcome ${r.run.result.measured.outcome ?? "-"})`).join(", ")}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
