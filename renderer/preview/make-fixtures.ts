// R3: records the fetch-with-retry run the preview and the hero use, with Atlas's own local runner. No model is asked.
// The code is the same file the U2 walkthrough used; the fake network is a test Atlas would offer (fails twice, then 200).
//   npx tsx renderer/preview/make-fixtures.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import type { Experiment } from "../../src/types";

const dir = join(import.meta.dirname, "..", "..", "tests", "fixtures", "r3");
const source = readFileSync(join(dir, "fetch-with-retry.source.ts.txt"), "utf8");
const codeSha256 = createHash("sha256").update(source).digest("hex");
const experiment = (id: string, calls: NonNullable<Extract<Experiment["params"], { shape: "call-function" }>["network"]>["calls"]): Experiment => ({
  id,
  target: { kind: "pasted", ref: `pasted:${codeSha256.slice(0, 12)}`, codeSha256, language: "ts", source },
  runner: "ts",
  params: { shape: "call-function", exportName: "fetchWithRetry", args: [{ kind: "json", value: "https://example.test/price" }], network: { replaces: "fetch", calls, then: "repeat_last" } },
  proposedBy: { role: "human" },
  gate: { allowed: true },
});
const ctl = (await runCallControl()).run;
const cases: [string, Experiment][] = [
  ["fails-twice-then-200", experiment("r3-fails-twice", [{ do: "respond", status: 503, body: { error: "busy" } }, { do: "respond", status: 503, body: { error: "busy" } }, { do: "respond", status: 200, body: { price: 42 } }])],
  ["always-500", experiment("r3-always-500", [{ do: "respond", status: 500, body: {} }])],
];
for (const [name, exp] of cases) {
  const run = await runCallExperiment(exp, ctl);
  writeFileSync(join(dir, `fetch-with-retry.${name}.run.json`), JSON.stringify({ experiment: exp, run }, null, 1) + "\n");
  console.log(name, JSON.stringify(run.result.measured), JSON.stringify(run.result.notMeasured), run.trace.map((e) => `${e.t}:${e.event}`).join(" "));
}

// ---- the specs the preview draws: Atlas's authors write them here, in Node. The page only ever sees specs. ----
const { betView } = await import("../authors/bet-view");
const { fileChart, outlineChart } = await import("../authors/code-chart");
const { moonwellFlow } = await import("../authors/moonwell");
const { retryDemo, whatHappened } = await import("../authors/what-happened");
const { fileOutline } = await import("../../src/file-outline");
const { quizQuestionsFor } = await import("../../src/quiz");
const { judge } = await import("../../src/judge");
const { assertSpec } = await import("../spec");
type Spec = import("../spec").RenderSpec;

const read = (rel: string) => JSON.parse(readFileSync(join(dir, "..", "..", "..", rel), "utf8"));
const twice = read("tests/fixtures/r3/fetch-with-retry.fails-twice-then-200.run.json");
const always = read("tests/fixtures/r3/fetch-with-retry.always-500.run.json");
const outline = fileOutline(source, "ts");
const bet: Spec = betView({ fileName: "fetchWithRetry.ts", outline, source, language: "ts", test: twice.experiment.params, seed: "hero-bet" });

const judged = (run: typeof twice.run, experimentId: string, measures: string, answer: object) => {
  const b = { id: "b1", experimentId, who: "human", question: "", measures, answer, nonce: "", sealedAt: "", sealedHash: "" };
  return { bet: b, verdict: judge(b as never, run) };
};
const quiz = quizQuestionsFor(twice.experiment.params, ["fetchWithRetry"], "ts");
const callsQ = quiz.find((q) => q.measures === "calls:fetch")!;
const byOption: Record<string, { spec: Spec; outcome: string; label: string }> = {};
for (const opt of [...callsQ.quiz!, { id: "cant", label: "can't tell", match: { kind: "word", value: "" } }]) {
  const answer = opt.id === "cant" ? { kind: "declined", reason: "can't tell" } : { kind: "quiz", choice: opt.id, options: callsQ.quiz };
  const { bet: b, verdict } = judged(twice.run, twice.experiment.id, "calls:fetch", answer);
  const spec = whatHappened({ run: twice.run, experiment: twice.experiment, bets: [b as never], verdicts: [verdict], seed: "hero-path" });
  byOption[opt.id] = { spec: { ...spec, title: undefined, kicker: undefined, subtitle: undefined }, outcome: verdict.outcome, label: opt.label };
}
const mismatch = judged(twice.run, twice.experiment.id, "calls:fetch", { kind: "integer", value: 2 });
const retryFile = read("tests/evidence/D04-04/fixture-eRopGsrp2a.atlas.json");
const moonFile = read("tests/evidence/D04-04/moonwell-level2-mwTaxvHFzB.atlas.json");
const metaOutline = read("tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json");
const specs: Record<string, Spec> = {
  path: whatHappened({ run: twice.run, experiment: twice.experiment, title: "fetchWithRetry", bets: [mismatch.bet as never], verdicts: [mismatch.verdict], seed: "path" }),
  always500: whatHappened({ run: always.run, experiment: always.experiment, title: "fetchWithRetry", kicker: "what happened when fetch always answers 500", seed: "always" }),
  bet: { ...bet, seed: "bet" },
  chart: fileChart({ fileName: "fetchWithRetry.ts", outline, source, language: "ts", seed: "chart" }),
  meta: outlineChart({ name: "server/meta", verified: metaOutline.verified, seed: "meta" }),
  retry: retryDemo({ run: retryFile.runs[0], experiment: retryFile.experiments[0], bets: retryFile.bets, verdicts: retryFile.verdicts, seed: "retry" }),
  moonwell: moonwellFlow({ run: moonFile.runs[0], bets: moonFile.bets, verdicts: moonFile.verdicts, fileCaptions: moonFile.captions, seed: "moonwell" }),
};
for (const [name, s] of Object.entries(specs)) assertSpec(s);
writeFileSync(
  join(dir, "specs.json"),
  JSON.stringify({ specs, hero: { bet: { ...bet, title: undefined, kicker: undefined, subtitle: undefined }, question: callsQ.text, options: callsQ.quiz!.map((o) => ({ id: o.id, label: o.label })), byOption, measuredCalls: twice.run.result.measured["calls:fetch"] } }) + "\n",
);
console.log("specs written", Object.keys(specs).join(" "), "| question:", callsQ.text, "|", callsQ.quiz!.map((o) => o.label).join(" / "), "|", Object.values(byOption).map((v) => v.outcome).join(","));
