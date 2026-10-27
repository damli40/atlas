// Added for the after-run (S5): p3 again, but each client sends an address (X-Forwarded-For, trustProxy on).
// In p3 every in-process request has no socket, so all of them count as one "unknown" client.
import { createApp } from "../../../../server/app.ts";
import { createProofStore } from "../../../../server/evm-round.ts";
import { createRunGate } from "../../../../server/replay-limits.ts";
import { liveRunFor, PR } from "../../../../tests/tools/review-fixtures.ts";

const app = createApp({ fetchPr: async () => PR, evmRun: async (exp: any) => liveRunFor(exp), runGate: createRunGate(), proofs: createProofStore({ publish: false }), trustProxy: true });
const h = (session: string, ip: string) => ({ "content-type": "application/json", "x-atlas-session": session, "x-forwarded-for": ip });
const run = async (session: string, ip: string) => {
  const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: h(session, ip), body: JSON.stringify(body) })).json() as Promise<any>;
  const t = await post("/targets", { kind: "github-pr", ref: PR.target.ref });
  const f = (await post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).finding;
  const e = await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id });
  await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
  return (await app.request("/runs", { method: "POST", headers: h(session, ip), body: JSON.stringify({ experimentId: e.experiment.id }) })).status;
};
const statuses: number[] = [];
for (let i = 0; i < 22; i++) statuses.push(await run(`attacker-${i}`, "198.51.100.7"));
console.log("one address, new session per run:", statuses.join(","));
console.log("a legit user from another address afterwards:", await run("judge-1", "203.0.113.9"));
process.exit(0);
