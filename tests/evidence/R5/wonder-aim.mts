// D27's promise, measured once: is Muse Wonder's choice of tests moved by a person's weak spots? Two real calls without them, two with, on one file. A few cents.
//   pnpm exec tsx tests/evidence/R5/wonder-aim.mts <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { runProposer } from "../../../server/meta/roles/proposer";
const source = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
const weak = "In this person's earlier rounds, their sealed bets most often did not match what the code did on these kinds of question: timing (5 of 7 didn't match; guessed lower than the run 4, higher 1). Counted by plain code from their own bets; it says nothing about this code. Where it fits this function, prefer tests whose answers turn on those questions.";
const out: { weak: boolean; ok: boolean; says: string[]; waits: number[] }[] = [];
for (const w of [false, false, true, true]) {
  const r = await runProposer({ source, language: "ts", exportName: "fetchAllOrders", exportLine: 13, exportNames: ["fetchAllOrders"], ...(w ? { weakSpots: weak } : {}) });
  const ps = r.ok ? r.proposals : [];
  out.push({ weak: w, ok: r.ok, says: ps.map((p) => p.says), waits: ps.map((p) => (JSON.stringify(p.params).match(/"status":429/g) ?? []).length) });
  console.log(w ? "with" : "without", r.ok, ps.length);
}
writeFileSync(process.argv[2]!, JSON.stringify(out, null, 1));
