// Day-2 adversarial probes against the in-process Hono app. chat() is MOCKED: no network, no key.
// Run from the repo root: npx tsx tests/evidence/D02-review/probes/server-probe.mts
const R = process.cwd(); // run from the repo root
const { createApp } = await import(`${R}/server/app.ts`);
const { createAgentLog } = await import(`${R}/server/log/agentlog.ts`);
const { createBetStore } = await import(`${R}/server/bets.ts`);

const usage = { promptTokens: 10, completionTokens: 10, usd: 0.001 };
const OPTIONS = ["returns", "throws", "pending"];
const S3 = { shape: "retry-scenario", failTimes: 5, failure: "error" };

function mkApp(replies: any[] = [], extra: any = {}) {
  let n = 0;
  const chat = async () => {
    const r = replies[n++];
    if (r === "HANG") return new Promise(() => {});
    if (r === undefined) return { ok: false, reason: "no more mocked replies" };
    return { ok: true, content: typeof r === "string" ? r : JSON.stringify(r), finishReason: "stop", usage };
  };
  const agentLog = createAgentLog();
  const app = createApp({ agentLog, ...(replies.length || extra.model ? { modelBets: { chat } } : {}), ...extra.opts });
  return { app, agentLog, calls: () => n };
}
async function post(app: any, path: string, body: unknown, session = "sessA") {
  const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": session }, body: JSON.stringify(body) });
  let json: any;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}
async function target(app: any, session = "sessA") {
  return (await post(app, "/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" }, session)).json;
}
const out = (k: string, v: unknown) => console.log(`\n### ${k}\n${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`);

// ---------- P1: one person, many bets on the same question (hedging) ----------
{
  const { app } = mkApp();
  const t = await target(app);
  const e = (await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: S3 })).json;
  const statuses: number[] = [];
  for (let v = 0; v <= 9; v++) statuses.push((await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "calls", answer: { kind: "integer", value: v } })).status);
  const run = await post(app, "/runs", { experimentId: e.experiment.id });
  out("P1 ten human bets on 'calls' (0..9): statuses", statuses);
  out("P1 run verdicts on calls", run.json.verdicts?.map((v: any) => v.outcome));
}

// ---------- P2: concurrent POST /bets and POST /runs ----------
{
  const { app } = mkApp();
  const t = await target(app);
  const e = (await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: S3 })).json;
  await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "outcome", answer: { kind: "enum", value: "throws" } });
  const ps: Promise<any>[] = [];
  for (let i = 0; i < 10; i++) ps.push(post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "calls", answer: { kind: "integer", value: i } }).then((r) => ({ kind: "bet", ...r })));
  ps.splice(5, 0, post(app, "/runs", { experimentId: e.experiment.id }).then((r) => ({ kind: "run", ...r })));
  const rs = await Promise.all(ps);
  const run = rs.find((r) => r.kind === "run");
  const accepted = rs.filter((r) => r.kind === "bet" && r.status === 200).map((r) => r.json.bet.id);
  const judged = new Set((run.json.bets ?? []).map((b: any) => b.id));
  out("P2 race: run status, accepted bets, accepted-but-not-judged", { run: run.status, accepted: accepted.length, rejected409: rs.filter((r) => r.kind === "bet" && r.status === 409).length, acceptedNotJudged: accepted.filter((id: string) => !judged.has(id)).length, allSealedBeforeStart: (run.json.bets ?? []).every((b: any) => Date.parse(b.sealedAt) < Date.parse(run.json.run.startedAt)) });
}

// ---------- P3: gate refusal with a long or multi-line reason -> 500, not 422 ----------
{
  const { app } = mkApp();
  const t = await target(app);
  const many: any = { ...S3 };
  for (let i = 0; i < 12; i++) many[`extraField${i}`] = 1;
  const r1 = await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: many });
  out("P3a 12 extra keys", { status: r1.status, error: r1.json?.error?.slice(0, 200) });
  const r2 = await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { ...S3, "a\nb": 1 } });
  out("P3b key with a newline", { status: r2.status, error: r2.json?.error?.slice(0, 200) });
}

// ---------- P4: model's first (unusable) answer leaks into the agent log before the person bets ----------
{
  const first = { bets: [
    { measures: "calls", answer: { kind: "integer", value: 5 }, rationale: "r" },
    { measures: "totalWaitMs", answer: { kind: "integer", value: 12000 }, rationale: "r" },
    { measures: "outcome", answer: { kind: "enum", value: "throw", options: OPTIONS }, rationale: "r" },
  ] };
  const second = { bets: first.bets.map((b) => (b.measures === "outcome" ? { ...b, answer: { ...b.answer, value: "throws" } } : b)) };
  const { app, agentLog } = mkApp([first, second]);
  const t = await target(app);
  const e = (await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: S3 })).json;
  await post(app, `/experiments/${e.experiment.id}/model-bets`, {}); // model settled; person has NOT bet yet
  const lines = agentLog.history("sessA").map((x: any) => `${x.event.role}: ${x.event.action}`);
  out("P4 agent log visible over SSE before the person bets", lines);
  const third = { bets: first.bets.map((b) => (b.measures === "calls" ? { ...b, answer: { kind: "integer", value: 5.5 } } : b.measures === "outcome" ? { ...b, answer: { ...b.answer, value: "throws" } } : b)) };
  const m2 = mkApp([third, second]);
  const t2 = await target(m2.app);
  const e2 = (await post(m2.app, "/experiments", { target: { ref: t2.ref, codeSha256: t2.codeSha256 }, params: S3 })).json;
  await post(m2.app, `/experiments/${e2.experiment.id}/model-bets`, {});
  out("P4b numeric leak", m2.agentLog.history("sessA").map((x: any) => x.event.action).filter((a: string) => a.includes("not usable")));
}

// ---------- P5: session eviction: 500 cheap 404 requests drop another person's round ----------
{
  const { app } = mkApp();
  const t = await target(app, "victim");
  const e = (await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: S3 }, "victim")).json;
  await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "calls", answer: { kind: "integer", value: 5 } }, "victim");
  for (let i = 0; i < 500; i++) await post(app, "/bets", { experimentId: "x", who: "human", measures: "calls", answer: { kind: "integer", value: 1 } }, `attacker${i}`);
  const r = await post(app, "/runs", { experimentId: e.experiment.id }, "victim");
  out("P5 victim's run after 500 bogus POST /bets from other session ids", { status: r.status, error: r.json?.error });
}

// ---------- P6: model call that never answers: the run waits, bets stay frozen ----------
{
  const { app } = mkApp(["HANG"]);
  const t = await target(app);
  const e = (await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: S3 })).json;
  await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "calls", answer: { kind: "integer", value: 5 } });
  const runP = post(app, "/runs", { experimentId: e.experiment.id });
  const winner = await Promise.race([runP.then(() => "run answered"), new Promise((ok) => setTimeout(() => ok("run still waiting after 2 s"), 2000))]);
  const late = await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "outcome", answer: { kind: "enum", value: "throws" } });
  const again = await post(app, "/runs", { experimentId: e.experiment.id });
  out("P6 hung model (mock never resolves; real client caps at 2 x 120 s)", { winner, betAfter: late.status, runAgain: again.status, runAgainErr: again.json?.error });
}

// ---------- P7: every new experiment triggers a paid model call; no per-session or global cap besides 50/session ----------
{
  const replies = Array.from({ length: 200 }, () => "not json");
  const { app, calls } = mkApp(replies);
  const t = await target(app, "s0");
  for (let s = 0; s < 4; s++) for (let i = 0; i < 25; i++) await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: S3 }, `spend${s}`);
  await new Promise((ok) => setTimeout(ok, 200));
  out("P7 model calls made for 100 POST /experiments across 4 sessions", calls());
}

// ---------- P8: settleTime extra question: always can't check, but offered as a bet ----------
{
  const { app } = mkApp();
  const t = await target(app);
  const e = (await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: 0, failure: "error" } })).json;
  await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "settledAtMs", answer: { kind: "integer", value: 0 } });
  const r = await post(app, "/runs", { experimentId: e.experiment.id });
  out("P8 settledAtMs (was settleTime) on S1 (code returns at t=0)", { verdict: r.json.verdicts?.[0], measuredKeys: Object.keys(r.json.run?.result?.measured ?? {}) });
}

// ---------- P9: gate passes a scenario that is cut off by the watch limit ----------
{
  const { app } = mkApp();
  const t = await target(app);
  const e = (await post(app, "/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: 0, failure: "error", resolveAfterMs: 60000 } })).json;
  out("P9 gate status", e.experiment?.gate);
  await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "outcome", answer: { kind: "enum", value: "returns" } });
  await post(app, "/bets", { experimentId: e.experiment.id, who: "human", measures: "calls", answer: { kind: "integer", value: 1 } });
  const r = await post(app, "/runs", { experimentId: e.experiment.id });
  out("P9 verdicts", r.json.verdicts?.map((v: any) => ({ o: v.outcome, obs: v.observed, why: v.reason })));
}
process.exit(0);
