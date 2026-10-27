// The page's seal() loop (web/App.tsx:72-82) copied as-is, driven through web/api.ts against the in-process app.
// Shows: a half-failed seal leaves an orphan bet on the server; resealing places a second bet on the same question.
const R = process.cwd(); // run from the repo root
const { createApp } = await import(`${R}/server/app.ts`);
const { createApi } = await import(`${R}/web/api.ts`);
const { checkSeals } = await import(`${R}/web/screens/Verdict.tsx`);
const app = createApp();
const api = createApi((u: string, i: any) => app.request(u.replace(/^\/api/, ""), i));
const t = await api.target("tests/fixtures/with-rpc-retry.ts");
const e = await api.experiment(t, { shape: "retry-scenario", failTimes: 5, failure: "error" });

async function seal(answers: Record<string, string>) {
  const out: any[] = [];
  for (const q of e.questions) {
    const raw = (answers[q.measures] ?? "").trim();
    const answer = q.kind === "enum" ? { kind: "enum", value: raw } : { kind: "integer", value: Number(raw) };
    out.push(await api.bet(e.experiment.id, q.measures, answer));
  }
  return out;
}
let shown: any[] = [];
try {
  shown = await seal({ calls: "4", totalWaitMs: "1.5", outcome: "throws" }); // person typed 1.5 by mistake
} catch (err) {
  console.log("first seal failed on screen:", (err as Error).message, "| page shows sealed:", shown.length);
}
try {
  shown = await seal({ calls: "5", totalWaitMs: "12000", outcome: "throws" }); // fixed and resealed
} catch (err) {
  console.log("OLD page loop, reseal refused by the server:", (err as Error).message);
  shown = [];
}
const r = await api.run(e.experiment.id);
console.log("page showed", shown.length, "bets; server judged", r.bets.length, "bets");
console.log("judged bets on calls:", r.bets.filter((b: any) => b.measures === "calls").map((b: any) => b.answer.value));
console.log("page seal checks cover", checkSeals(shown, r).length, "of", r.bets.length, "revealed bets");
// AFTER: the new page path (web/App.tsx seal) sends all answers in one request via api.bets.
{
  const e2 = await api.experiment(t, { shape: "retry-scenario", failTimes: 5, failure: "error" });
  const send = (calls: number, wait: number) => (api as any).bets(e2.experiment.id, [
    { measures: "calls", answer: { kind: "integer", value: calls } },
    { measures: "totalWaitMs", answer: { kind: "integer", value: wait } },
    { measures: "outcome", answer: { kind: "enum", value: "throws" } },
  ]);
  try { await send(4, 1.5); } catch (err) { console.log("NEW page path, first seal refused:", (err as Error).message); }
  const shown2 = await send(5, 12000);
  const r2 = await api.run(e2.experiment.id);
  console.log("NEW page path: page showed", shown2.length, "bets; server judged", r2.bets.length, "bets; calls bets judged:", r2.bets.filter((b: any) => b.measures === "calls").map((b: any) => b.answer.value), "; seal checks", checkSeals(shown2, r2).filter((c: any) => c.match).length, "of", r2.bets.length, "match");
}
process.exit(0);
