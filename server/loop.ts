// L1 (D57): the Meta retry loop, on the server. Two routes, used by the Muse Code plugin. Atlas never judges correctness.
//
// POST /loop/choose {experimentId, typed}: the person's words "my answers are what I want". Their sealed answers become
//   the target. Nothing is re-sealed and no model is asked anything.
// POST /loop/rerun {experimentId, code}: the file as it is now. The SAME experiment runs with the SAME seed on this code,
//   and src/judge.ts judges the SAME sealed bets, the models' too. No model is asked to bet again.
//
// What only this file decides, so the coding agent cannot:
// - The count. A try is counted here, before any wait, and at most LOOP_MAX_TRIES are made per round.
// - The stop (src/loop.ts loopStopOf): every answer matched, the cap, money ran out, or a whole run of "can't check".
// - Whether the bets are still the ones sealed: each seal is recomputed before each try, and the set is compared with the
//   one recorded at the choice. If they differ nothing runs and the loop ends.
//
// A refusal that spends nothing and measures nothing does not use up a try: code already measured (same seed, same code,
// so the answer is known), an empty or oversized file, a sandbox gate that is full. A run that stops part way does use
// one: it may have cost money, and a loop that never ends is the thing the cap is for.
//
// Money: re-runs go through `runPasted`, so through the same metered executor and the same invite gate as POST /runs
// (G1). These routes are not in the gate's allow-list, so they need an invite wherever invites are required.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { judge } from "../src/judge";
import { type AtlasLoop, LOOP_MAX_TRIES, LOOP_PHRASE, type LoopTry, isBudgetReason, isLoopPhrase, lineChanges, loopFingerprint, loopStopOf, targetBetsOf, wholeRunCantCheck } from "../src/loop";
import { withLoop, callRunAgreesWithItsTrace } from "../src/atlasfile";
import { pastedLines } from "../src/paste-context";
import { PASTED_MAX_BYTES, makePastedTarget, utf8Bytes } from "../src/pasted-code";
import { verifySeal } from "../src/seal";
import type { AtlasFile, Bet, Experiment, Run } from "../src/types";
import { oneLine, type SessionEmitter } from "./log/agentlog";
import { roundLog } from "./log/round";
import { BAD_SESSION, sessionIdOf } from "./log/sse";
import type { BetStore, Round } from "./bets";
import { PASTED_MAX_LINES } from "./paste";
import type { ReplayGate } from "./replay-limits";
import { runFailureReason } from "./run-failure";

export interface LoopDeps {
  betStore: BetStore;
  sandboxGate: ReplayGate;
  clientOf: (c: Context) => string;
  runPasted: (exp: Experiment, seed?: string) => Promise<Run>;
  keepRun: (run: Run) => void;
  proofOf: (runId: string) => AtlasFile | undefined;
  putProof: (file: AtlasFile, run: Run) => { published: boolean; error?: string };
  log: (sessionId: string) => SessionEmitter;
  noteRoundChars: (sessionId: string, experimentId: string, chars: number) => void;
}

const experimentId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const chooseBody = z.object({ experimentId, typed: z.string().max(200) }).strict();
const rerunBody = z.object({ experimentId, code: z.string().max(PASTED_MAX_BYTES * 2, `this file is too long: Atlas reads one file of at most ${PASTED_MAX_BYTES / 1024} KB`) }).strict();

/** Changed lines an answer carries; the proof file keeps them all. */
export const LOOP_MAX_LINES_IN_ANSWER = 200;

async function bodyOf<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  // JSON only, as POST /paste: another website cannot send a "simple" request from a visitor's browser.
  if (!/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) return { ok: false, error: "send this as JSON (content-type: application/json)" };
  let raw: unknown;
  try {
    raw = await c.req.raw.json();
  } catch {
    return { ok: false, error: "the request body is not JSON" };
  }
  const p = schema.safeParse(raw);
  return p.success ? { ok: true, data: p.data } : { ok: false, error: p.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
}

const sealed = (l: NonNullable<Round["loop"]>): AtlasLoop => ({ ...l.state, fingerprint: loopFingerprint(l.state) });

/** Each try as the answer shows it: the facts and counts only (the code and all its lines stay in the proof file). */
function tryView(t: LoopTry, target: readonly { betId: string }[]) {
  const mine = target.map((x) => t.verdicts?.find((v) => v.betId === x.betId));
  const n = (o: string) => mine.filter((v) => v?.outcome === o).length;
  return {
    try: t.try,
    codeSha256: t.codeSha256,
    added: t.changes.added,
    removed: t.changes.removed,
    sinceBet: t.sinceBet,
    ...(t.run ? { runId: t.run.id, seed: t.run.seed, measured: t.run.result.measured, cantCheckWhy: wholeRunCantCheck(t.run), yours: { matched: n("matched"), notMatched: n("not_matched"), cantCheck: n("cant_check") } } : {}),
    ...(t.didNotFinish ? { didNotFinish: t.didNotFinish.reason } : {}),
  };
}

export function registerLoop(app: Hono, d: LoopDeps): void {
  const pastedRound = (c: Context, id: string): { sessionId: string; round: Round } | { error: string; status: 400 | 404 | 409 } => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return { error: BAD_SESSION, status: 400 };
    const round = d.betStore.peek(sessionId)?.get(id);
    if (!round) return { error: `this session has no experiment ${id}`, status: 404 };
    if (round.experiment.target.kind !== "pasted" || round.experiment.params.shape !== "call-function") return { error: `${id} is not a round on pasted code, so it has no retry loop`, status: 409 };
    return { sessionId, round };
  };

  app.post("/loop/choose", async (c) => {
    const body = await bodyOf(c, chooseBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const found = pastedRound(c, body.data.experimentId);
    if ("error" in found) return c.json({ error: found.error }, found.status);
    const { round, sessionId } = found;
    if (!isLoopPhrase(body.data.typed)) return c.json({ error: `only the person's own words "${LOOP_PHRASE}" choose this; nothing was chosen` }, 400);
    if (round.status !== "done" || !round.run || !round.verdicts) return c.json({ error: "this round has not run yet, so there is nothing to choose" }, 409);
    if (round.loop) return c.json({ loop: round.loop.state.choice, target: round.loop.state.targetBets, maxTries: LOOP_MAX_TRIES, triesLeft: LOOP_MAX_TRIES - round.loop.state.tries.length, again: true });
    const whole = wholeRunCantCheck(round.run);
    if (whole !== null) return c.json({ error: `this whole run is "can't check", so there is nothing to aim for (${whole})` }, 409);
    const target = targetBetsOf(round.bets);
    const verdicts = round.verdicts;
    if (!target.some((t) => verdicts.find((v) => v.betId === t.betId)?.outcome === "not_matched")) return c.json({ error: "none of your sealed answers didn't match, so there is nothing to aim for" }, 409);
    if (!d.proofOf(round.run.id)) return c.json({ error: "this round's proof file is gone (it expired or was never made), so a re-run could not be recorded" }, 409);
    round.loop = { running: false, state: { choice: { typed: body.data.typed.trim(), chosenAt: new Date().toISOString(), fromRunId: round.run.id }, targetBets: target, maxTries: LOOP_MAX_TRIES, tries: [] } };
    d.betStore.touch(sessionId);
    d.log(sessionId).emit({ role: "human", action: oneLine(`chooses their sealed answers as the target: "${LOOP_PHRASE}"`), ref: { kind: "experiment", id: round.experiment.id } });
    return c.json({ loop: round.loop.state.choice, target, maxTries: LOOP_MAX_TRIES, triesLeft: LOOP_MAX_TRIES });
  });

  app.post("/loop/rerun", async (c) => {
    const body = await bodyOf(c, rerunBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const found = pastedRound(c, body.data.experimentId);
    if ("error" in found) return c.json({ error: found.error }, found.status);
    const { round, sessionId } = found;
    const loop = round.loop;
    if (!loop) return c.json({ error: `the person has not chosen their sealed answers as the target (the words "${LOOP_PHRASE}"), so nothing re-runs` }, 409);
    const answerOf = (extra: Record<string, unknown> = {}) => ({
      tries: loop.state.tries.map((t) => tryView(t, loop.state.targetBets)),
      triesLeft: loop.state.stopped || loop.halted ? 0 : LOOP_MAX_TRIES - loop.state.tries.length,
      maxTries: LOOP_MAX_TRIES,
      ...(loop.state.stopped ? { stopped: loop.state.stopped } : loop.halted ? { stopped: { reason: "no_proof", says: loop.halted } } : {}),
      ...extra,
    });
    const over = loop.state.stopped?.says ?? loop.halted;
    if (over) return c.json({ error: over, ...answerOf() }, 409);
    if (loop.running) return c.json({ error: "a re-run of this round is already going; wait for it" }, 409);
    const run0 = round.run!;

    const { code } = body.data;
    if (code.trim() === "") return c.json({ error: "the file is empty now, so there is nothing to run. Nothing ran and no try was used" }, 400);
    const bytes = utf8Bytes(code);
    if (bytes > PASTED_MAX_BYTES) return c.json({ error: `the file is ${bytes} bytes now; Atlas reads at most ${PASTED_MAX_BYTES} (64 KB). Nothing ran and no try was used` }, 413);
    if (/\r(?!\n)/.test(code)) return c.json({ error: "the file uses a lone carriage return (CR) as a line ending; save it with LF or CRLF. Nothing ran and no try was used" }, 400);
    const lineCount = pastedLines(code).length;
    if (lineCount > PASTED_MAX_LINES) return c.json({ error: `the file has ${lineCount} lines now; Atlas reads at most ${PASTED_MAX_LINES.toLocaleString("en-US")}. Nothing ran and no try was used` }, 413);
    const language = round.experiment.target.language ?? "js";
    const target = makePastedTarget(code, language);
    const original = round.experiment.target.source ?? "";
    // Same seed and same code give the same run, so measuring it again would only spend money.
    const measured = [{ codeSha256: round.experiment.target.codeSha256, label: "the code you bet on" }, ...loop.state.tries.filter((t) => t.run).map((t) => ({ codeSha256: t.codeSha256, label: `re-run ${t.try}` }))];
    const seen = measured.find((m) => m.codeSha256 === target.codeSha256);
    if (seen) return c.json({ error: `the file is the same code as ${seen.label} (sha256 ${target.codeSha256.slice(0, 12)}…). The same test with the same seed would measure the same thing, so nothing ran and no try was used. Edit the file first`, unchanged: true, ...answerOf() }, 409);

    // The bets are the ones sealed: every seal recomputes, and the set is the one recorded at the choice.
    const bets: Bet[] = [...round.bets];
    const broken = bets.filter((b) => !verifySeal(b)).map((b) => b.id);
    const sameSet = JSON.stringify(targetBetsOf(bets)) === JSON.stringify(loop.state.targetBets);
    if (broken.length > 0 || !sameSet) {
      const why = broken.length > 0 ? `the seal did not verify for bet ${broken.join(", ")}` : "the sealed answers are not the ones recorded when the person chose them";
      return c.json({ error: `${why}, so nothing ran and the loop ends here: a sealed bet cannot change between tries`, sealBroken: true }, 409);
    }
    const proofNow = d.proofOf(run0.id);
    if (!proofNow) return c.json({ error: "this round's proof file is gone (it expired), so this re-run could not be recorded. Nothing ran and no try was used", ...answerOf() }, 409);
    const slot = d.sandboxGate.take(sessionId, d.clientOf(c));
    if (!slot.ok) return c.json({ error: `re-run not started: ${slot.reason}. No try was used`, ...answerOf() }, 429);

    // Counted from here, with no wait between this line and the check above.
    loop.running = true;
    const n = loop.state.tries.length + 1;
    const changes = lineChanges(loop.state.tries.at(-1)?.source ?? original, code);
    const sinceAll = lineChanges(original, code);
    const base: LoopTry = { try: n, codeSha256: target.codeSha256, source: code, changes, sinceBet: { added: sinceAll.added, removed: sinceAll.removed } };
    const experiment: Experiment = { ...round.experiment, target };
    const log = roundLog(d.log(sessionId));
    let entry: LoopTry;
    const startedAt = new Date().toISOString();
    try {
      const run = await d.runPasted(experiment, run0.seed);
      if (run.experimentId !== experiment.id || run.seed !== run0.seed || run.codeSha256 !== target.codeSha256) throw new Error("the runner did not run this test with this seed on this code");
      d.keepRun(run);
      log.runner(experiment, run);
      // E3 review r3 M1: a run whose own record does not hold together is judged by nobody, and it has no proof.
      const unsound = callRunAgreesWithItsTrace(run);
      if (unsound.length > 0) throw new Error(`the run's record does not hold together (${unsound.join("; ")})`);
      const verdicts = bets.map((b) => judge(b, run));
      log.judge(verdicts, run);
      entry = { ...base, run, verdicts };
    } catch (e) {
      const reason = runFailureReason(e);
      entry = { ...base, didNotFinish: { reason, startedAt, stoppedAt: new Date(Math.max(Date.now(), Date.parse(startedAt))).toISOString(), budget: isBudgetReason(reason) } };
    } finally {
      slot.release();
      loop.running = false;
    }
    loop.state.tries.push(entry);
    const stop = loopStopOf(loop.state.tries, loop.state.targetBets);
    if (stop) loop.state.stopped = stop;
    d.betStore.touch(sessionId);
    d.noteRoundChars(sessionId, experiment.id, code.length + JSON.stringify(entry.run ?? "").length);

    try {
      // Read again: the file may have been dropped, or may have a newer version, while the run went on.
      const latest = d.proofOf(run0.id);
      if (!latest) throw new Error("this round's proof file expired while the re-run went on");
      d.putProof(withLoop(latest, sealed(loop)), run0);
    } catch (e) {
      // A try that cannot be recorded cannot be defended: Atlas says nothing about it, and the loop ends here. The file
      // keeps what verified. (E3 review r3 M1: a run with no proof file is never judged silently.)
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      loop.state.tries.pop();
      delete loop.state.stopped;
      loop.halted = `Atlas stopped: it could not record re-run ${n} in the proof file, so it says nothing about that try (${reason}). The rest is yours`;
      return c.json(answerOf({ try: { try: n, codeSha256: target.codeSha256, added: changes.added, removed: changes.removed, sinceBet: base.sinceBet, unrecorded: reason, lines: changes.lines.slice(0, LOOP_MAX_LINES_IN_ANSWER), linesNotShown: Math.max(0, changes.lines.length - LOOP_MAX_LINES_IN_ANSWER) }, bets, proof: { ok: false, runId: run0.id, reason } }));
    }
    return c.json(
      answerOf({
        try: {
          ...tryView(entry, loop.state.targetBets),
          lines: changes.lines.slice(0, LOOP_MAX_LINES_IN_ANSWER),
          linesNotShown: Math.max(0, changes.lines.length - LOOP_MAX_LINES_IN_ANSWER),
          ...(entry.run ? { verdicts: entry.verdicts } : {}),
        },
        bets,
        proof: { ok: true, runId: run0.id },
      }),
    );
  });
}
