// Copied from the day-5 review's probes (probes5/), local paths made relative. Run: npx tsx tests/evidence/D05-review/probes/p3-caps.ts
// Probe: per-session hourly cap bypass by minting a new x-atlas-session per run; and one actor exhausting the global quota.
import { createApp } from "../../../../server/app.ts";
import { createProofStore } from "../../../../server/evm-round.ts";
import { createRunGate } from "../../../../server/replay-limits.ts";
import { liveRunFor, PR } from "../../../../tests/tools/review-fixtures.ts";

const app = createApp({ fetchPr: async () => PR, evmRun: async (exp: any) => liveRunFor(exp), runGate: createRunGate(), proofs: createProofStore({ publish: false }) });
const ready = async (session: string) => {
  const h = { "content-type": "application/json", "x-atlas-session": session };
  const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) })).json() as Promise<any>;
  const t = await post("/targets", { kind: "github-pr", ref: PR.target.ref });
  const f = (await post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).finding;
  const e = await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id });
  await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
  return e.experiment.id as string;
};
const run = async (session: string, id: string) => (await app.request("/runs", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": session }, body: JSON.stringify({ experimentId: id }) })).status;

const statuses: number[] = [];
for (let i = 0; i < 22; i++) {
  const s = `attacker-${i}`;
  statuses.push(await run(s, await ready(s)));
}
console.log("one actor, new session per run:", statuses.join(","));
const legit = "judge-1";
console.log("a legit user afterwards:", await run(legit, await ready(legit)));
process.exit(0);
