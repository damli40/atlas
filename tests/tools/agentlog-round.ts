// D02-05: one full retry round (oracle row S3) through the real routes, then print the session's
// agent events as JSON lines. The vitest test (tests/unit/agentlog.test.ts) uses runRound too.
//
// Run: `pnpm exec tsx tests/tools/agentlog-round.ts > tests/evidence/D02-05/events.jsonl`
//
// The round: register the withRpcRetry fixture, seal three human bets on S3 (5 failures in a row):
// calls = 5, outcome = throws, and calls = 4 (one off on purpose), then POST /runs.

import { pathToFileURL } from "node:url";
import { sealBet } from "../../src/seal.ts";
import { OUTCOME_OPTIONS } from "../../src/units.ts";
import type { Bet, BetAnswer, Run, Target, Verdict } from "../../src/types.ts";

type Requester = (path: string, init: RequestInit) => Response | Promise<Response>;

const SESSION_HEADER = "x-atlas-session";

export async function runRound(request: Requester): Promise<{ sessionId: string; run: Run; verdicts: Verdict[] }> {
  const first = await request("/targets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" }),
  });
  const sessionId = first.headers.get(SESSION_HEADER);
  if (!first.ok || !sessionId) throw new Error(`/targets answered ${first.status} with no session id`);
  const target = (await first.json()) as Target;

  const experimentId = "S3";
  const specs: { measures: string; question: string; answer: BetAnswer }[] = [
    { measures: "calls", question: "How many times will the function call the RPC?", answer: { kind: "integer", value: 5 } },
    { measures: "outcome", question: "How will it end: returns, throws, or pending (never settles)?", answer: { kind: "enum", value: "throws", options: [...OUTCOME_OPTIONS] } },
    { measures: "calls", question: "How many times will the function call the RPC?", answer: { kind: "integer", value: 4 } },
  ];
  const bets: Bet[] = specs.map((b) => sealBet({ experimentId, who: "human", ...b }));

  const res = await request("/runs", {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: sessionId },
    body: JSON.stringify({
      experiment: { id: experimentId, target, runner: "ts", params: { shape: "retry-scenario", failTimes: 5, failure: "error" }, proposedBy: { role: "human" } },
      bets,
    }),
  });
  const json = (await res.json()) as { run: Run; verdicts: Verdict[]; error?: string };
  if (!res.ok) throw new Error(`/runs answered ${res.status}: ${json.error ?? "no reason given"}`);
  return { sessionId, run: json.run, verdicts: json.verdicts };
}

async function main(): Promise<void> {
  const { createApp } = await import("../../server/app.ts");
  const { createAgentLog } = await import("../../server/log/agentlog.ts");
  const agentLog = createAgentLog();
  const app = createApp({ agentLog });
  const { sessionId } = await runRound((p, init) => app.request(p, init));
  for (const e of agentLog.history(sessionId)) console.log(JSON.stringify(e.event));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
