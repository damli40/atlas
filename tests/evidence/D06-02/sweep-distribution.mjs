// D06-02 evidence: real sweeps through the running server (POST /sweeps → gate → control → sandbox).
// Usage: node sweep-distribution.mjs <out.json>   (server on localhost:8787)
// Writes every run's measured call times, the share of calls at 0 / 3,000 / 6,000 / 9,000 ms, and real time.
import { writeFileSync } from "node:fs";
const base = "http://localhost:8787";
const h = { "content-type": "application/json", "x-atlas-session": "d06-02-evidence" };
const post = async (p, b) => {
  const r = await fetch(base + p, { method: "POST", headers: h, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};
const t = (await post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).body;
const target = { ref: t.ref, codeSha256: t.codeSha256 };
const FOUR = [0, 3000, 6000, 9000];
const rows = [];
for (const failTimes of [3, "always"]) {
  for (const callers of [1, 10, 50, 100, 150, 200]) {
    const t0 = performance.now();
    const { status, body } = await post("/sweeps", { target, params: { shape: "concurrency-sweep", callers, failTimes, failure: "error" } });
    const realMs = Math.round(performance.now() - t0);
    const m = body.run?.result?.measured ?? {};
    const inst = String(m.callTimesMs ?? "").split(",").filter(Boolean).map((p) => p.split(":").map(Number));
    const total = inst.reduce((a, [, c]) => a + c, 0);
    const inFour = inst.filter(([x]) => FOUR.includes(x)).reduce((a, [, c]) => a + c, 0);
    rows.push({ failTimes, callers, status, runId: body.run?.id, seed: body.run?.seed, controlPassed: body.run?.controlPassed, realMs, measured: m, shareAt0_3000_6000_9000: total ? inFour / total : null });
    console.log(`failTimes ${failTimes} callers ${callers}: ${status} control ${body.run?.controlPassed} calls ${m.calls} at ${m.callTimesMs} · share in 0/3000/6000/9000 ${total ? ((100 * inFour) / total).toFixed(1) : "-"}% · ${realMs} ms real`);
  }
}
const refused = await post("/sweeps", { target, params: { shape: "concurrency-sweep", callers: 201, failTimes: 3, failure: "error" } });
console.log(`callers 201: ${refused.status} ${refused.body.error}`);
writeFileSync(process.argv[2], JSON.stringify({ made: new Date().toISOString(), target, runs: rows, refused201: refused }, null, 2) + "\n");
