// The Atlas HTTP server (Hono).
//
// Routes:
// - POST /targets {kind: "ts-fixture", ref} → the Target: which file, and the SHA-256 of its exact bytes.
// - POST /experiments {target, params, id?} (D02-04) → src/gate.ts decides; plain code writes the
//   questions. Human-proposed for now. A refused experiment is kept (422) and can never run.
// - POST /bets {experimentId, measures, answer, who: "human"} (D02-04) → the server checks the answer
//   fits the question, seals it at SERVER time with a SERVER nonce (server/bets.ts), and returns the
//   sealed bet with its hash but without the nonce. Refused with 409 once the run has started.
// - POST /runs {experimentId} (D02-04) → freezes the bets, checks every bet was sealed before the run
//   started, runs the control (once per code SHA-256) and the experiment in the sandbox, lets
//   src/judge.ts judge each bet, and reveals every bet in full (with its nonce).
// - POST /experiments/:id/model-bets (D02-06) → waits for the model's bets on that SAME experiment
//   and returns its slot: status ("sealed", "no_usable_answer", "off") and the sealed hashes only.
//   The model is asked as soon as the experiment is created (when the server was built with
//   `modelBets`), from the experiment and the plain-code questions only: never the person's bets.
//   Its answers and rationale stay on the server until POST /runs reveals every bet.
// - GET /events/:sessionId (D02-05) → SSE of the session's agent events (server/log/). The session
//   is the `x-atlas-session` header; the server makes one and returns it when absent. Experiments
//   and bets belong to the session that made them.
//
// Plain words on trust:
// - The browser never seals and never writes a time. The server seals each bet when it arrives, so
//   "sealed before the run" is the server's own clock, checked again just before the run.
// - A stored bet whose hash no longer matches its fields stops the run with 409 before anything
//   runs, and nothing is judged.
// - Only the server's own copy of a target is used (from POST /targets), so the code hash and the
//   "pre-existing" label come from the server, not from the request.
// - Runs, targets and bets live in memory only. The one thing written to proofs/ (public) is a
//   refusal record, and only through the `refusals` writer the caller passes (server/index.ts passes
//   the file writer; tests pass an in-memory one or none): one for every gate refusal and every
//   can't-check verdict (S7). No key, URL or local path goes into a record.
// - One bet per bettor per question (S1): a second bet by the same person on the same question of
//   the same experiment is refused with 409. POST /bets answers with the person's whole sealed set,
//   which is exactly the set the run will judge.
// - Before the run, no log line, SSE event or API answer carries a model's answer values (S2).
// - Model calls are limited (server/meta/budget.ts, S5); when a limit is reached the model is not
//   asked and the person's round goes on.

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { z } from "zod";
import { judge } from "../src/judge";
import { verifySeal } from "../src/seal";
import { bodyLimit } from "hono/body-limit";
import { createModelBudget, type ModelBudget } from "./meta/budget";
import { cleanRecord, type RefusalWriter } from "./proofs/refusals";
import { checkAnswer, createBetStore, humanBetBody, humanBetsBody, MAX_BETS, MAX_EXPERIMENTS, modelSlotView, newExperimentId, newRound, publicBet, sealedAfter, sealHumanBet, type BetStore, type ModelSlot, type Round } from "./bets";
import type { ChatArgs, ChatResult } from "./meta/client";
import { CLAIMANT_MODEL } from "./meta/roles/claimant";
import { modelDisplay, runClaimantBets } from "./meta/roles/claimant-bets";
import { FIXTURE_FILE, fixtureFinding } from "./meta/roles/fixture-finding";
import { gate, type GateContext } from "../src/gate";
import type { Experiment, Run, Target, Verdict } from "../src/types";
import type { Executor } from "../runners/runner";
import { localExecutor } from "../runners/executor/local";
import { AgentEventError, createAgentLog, sessionEmitter, type AgentLog } from "./log/agentlog";
import { roundLog } from "./log/round";
import { BAD_SESSION, registerEventRoutes, sessionIdOf } from "./log/sse";
import { DEFAULT_WATCH_LIMIT_MS } from "../runners/ts/harness";
import { control as runTsControl, readFixture, runExperiment } from "../runners/ts/control";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRE_EXISTING_PATH = resolve(REPO_ROOT, "PRE-EXISTING.md");
export const PRE_EXISTING_LABEL = { label: "Pre-existing: written before the hackathon", listedIn: "PRE-EXISTING.md" } as const;

// ---------- request schemas ----------

const targetBody = z.object({ kind: z.literal("ts-fixture"), ref: z.string().min(1).max(200) });

const experimentBody = z.object({
  /** Optional: a caller-chosen id (letters, digits, _ or -). The server makes one when absent. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  target: z.object({ ref: z.string().min(1), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  runner: z.literal("ts").optional(),
  // The params are checked by src/gate.ts below (not here), so a refusal carries the gate's plain reason.
  params: z.unknown(),
  // Human-proposed only, for now (the Claimant's model bets arrive through the server, not this route).
  proposedBy: z.object({ role: z.literal("human") }).optional(),
});

const runBody = z.object({ experimentId: z.string().min(1).max(64) }).strict();

function plainReason(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join(".") : "body"}: ${i.message}`)
    .join("; ");
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** True when PRE-EXISTING.md names this fixture path. The label is shown only then. */
function listedAsPreExisting(fixturePath: string): boolean {
  if (!existsSync(PRE_EXISTING_PATH)) return false;
  const text = readFileSync(PRE_EXISTING_PATH, "utf8");
  const escaped = fixturePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The path must stand alone: not part of a longer path such as "x.ts.bak" (a full stop ending a sentence is fine).
  return new RegExp(`(?<![\\w./-])${escaped}(?![\\w/-]|\\.\\w)`).test(text);
}

/** What the gate allows on a TS fixture today: only "retry-scenario" has a runner (no concurrency-sweep runner yet). */
export const TS_GATE_CONTEXT: GateContext = { shapes: ["retry-scenario"], watchLimitMs: DEFAULT_WATCH_LIMIT_MS };

// ---------- the app ----------

/**
 * Model bets (D02-06). When given, the server asks this model for its bets on every allowed
 * experiment, as soon as the experiment exists. Absent (the default, and in tests unless they pass a
 * mocked chat), no model is asked and the slot says so.
 */
export interface ModelBetsOptions {
  chat: (args: ChatArgs) => Promise<ChatResult>;
  model?: string;
  now?: () => Date;
  /**
   * The longest the server waits for the model's bets (default MODEL_BETS_DEADLINE_MS). POST /runs
   * waits for them, so a model that never answers must not hold a person's run for minutes.
   */
  deadlineMs?: number;
  /** Call and spend limits (S5). Default: createModelBudget() with its defaults (60 calls an hour, 10 experiments a session, $100). */
  budget?: ModelBudget;
}

/** How long the server waits for the model's bets before it gives up and the slot says so. */
export const MODEL_BETS_DEADLINE_MS = 60_000;

/** The largest JSON body any route reads (a whole round's bets fit in a few KB). */
export const MAX_BODY_BYTES = 64 * 1024;
/** Runs kept in memory (with their traces); the oldest are dropped first. */
export const MAX_RUNS = 1000;

export interface AppOptions {
  executor?: Executor;
  agentLog?: AgentLog;
  betStore?: BetStore;
  modelBets?: ModelBetsOptions;
  /** Receives a record for every gate refusal and every can't-check verdict (S7). Default: none (nothing is written). */
  refusals?: RefusalWriter;
}

export function createApp(opts: AppOptions = {}) {
  const executor = opts.executor ?? localExecutor;
  const betStore = opts.betStore ?? createBetStore(); // D02-04: experiments and server-sealed bets, per session
  const agentLog = opts.agentLog ?? createAgentLog(); // D02-05: per-session agent events
  const refusals: RefusalWriter = opts.refusals ?? (() => {});
  const budget = opts.modelBets ? (opts.modelBets.budget ?? createModelBudget()) : undefined;
  const modelChat = opts.modelBets && budget ? budget.wrap(opts.modelBets.chat) : undefined;
  const targets = new Map<string, Target>(); // by codeSha256
  const controls = new Map<string, Promise<Run>>(); // passed controls only, by codeSha256
  const runs = new Map<string, Run>(); // in memory today; not published
  const keepRun = (run: Run) => {
    runs.set(run.id, run);
    while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
  };
  /** A refusal record must never stop a round. It is scrubbed (no paths, URLs or keys) before any writer sees it. */
  const record = (r: Parameters<RefusalWriter>[0]) => {
    try {
      refusals(cleanRecord(r));
    } catch {
      // The writer failed; the round's answer still stands.
    }
  };

  const getControl = (target: Target): Promise<Run> => {
    const cached = controls.get(target.codeSha256);
    if (cached) return cached;
    const p = runTsControl(target, executor).then((run) => {
      keepRun(run);
      // A control that did not pass is not kept: the next request tries again (it may have been a timeout).
      if (run.controlPassed !== true) controls.delete(target.codeSha256);
      return run;
    });
    p.catch(() => controls.delete(target.codeSha256));
    controls.set(target.codeSha256, p);
    return p;
  };

  /** Ask the model for its bets on this round's experiment. Never throws; the slot records the outcome. */
  const startModelBets = (round: Round, sessionId: string): void => {
    const model = opts.modelBets?.model ?? CLAIMANT_MODEL;
    const slot: ModelSlot = { model, who: `model:${model}`, display: modelDisplay(model), status: "off" };
    round.model = slot;
    if (!opts.modelBets || !budget || !modelChat) {
      slot.reason = "this server asks no Meta model for bets";
      return;
    }
    const exp = round.experiment;
    if (exp.target.ref !== FIXTURE_FILE) {
      slot.reason = `no finding exists yet for ${exp.target.ref}`;
      return;
    }
    const allowed = budget.startExperiment(sessionId);
    if (!allowed.ok) {
      slot.reason = allowed.reason; // e.g. "call limit reached": the person's round goes on without the model
      return;
    }
    const fileText = readFixture(exp.target);
    const finding = fixtureFinding(fileText);
    slot.status = "thinking";
    const chat = modelChat;
    const { now } = opts.modelBets;
    const deadlineMs = opts.modelBets.deadlineMs ?? MODEL_BETS_DEADLINE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<{ ok: false; reason: string; detail: string }>((ok) => {
      const why = `the model did not answer within ${deadlineMs >= 1000 ? `${Math.round(deadlineMs / 1000)} s` : `${deadlineMs} ms`}`;
      timer = setTimeout(() => ok({ ok: false, reason: why, detail: why }), deadlineMs);
      (timer as { unref?: () => void }).unref?.();
    });
    slot.settled = Promise.race([
      runClaimantBets(
        { experiment: exp, questions: round.questions, finding, fileText, gateContext: TS_GATE_CONTEXT, model },
        { chat, log: sessionEmitter(agentLog, sessionId), ...(now ? { now } : {}) },
      ),
      late, // an answer after the deadline is never sealed into this round
    ]).finally(() => clearTimeout(timer)).then(
      (r) => {
        if (!r.ok) {
          slot.status = "no_usable_answer";
          slot.reason = r.reason; // names the kind of problem only (S2)
          if (r.detail !== r.reason) slot.detail = r.detail; // may quote the model's values: shown after the run
        } else if (round.betsFrozenAt !== undefined) {
          // Cannot happen while POST /runs waits for this promise; kept so a late answer is never judged.
          slot.status = "no_usable_answer";
          slot.reason = "the answer arrived after the bets were frozen";
        } else {
          round.bets.push(...r.bets);
          slot.status = "sealed";
        }
      },
      (e: unknown) => {
        slot.status = "no_usable_answer";
        slot.reason = `the server could not finish the model call: ${e instanceof Error ? e.message : String(e)}`;
      },
    );
  };

  const app = new Hono();

  // One large POST must not be read whole into memory.
  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: `the request body is larger than ${MAX_BODY_BYTES} bytes` }, 413) }));

  app.get("/health", (c) => c.json({ ok: true }));
  registerEventRoutes(app, agentLog); // D02-05: GET /events/:sessionId (SSE)

  app.post("/targets", async (c) => {
    if (sessionIdOf(c) === null) return c.json({ error: BAD_SESSION }, 400); // D02-05
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = targetBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const { kind, ref } = parsed.data;
    const inside = ref.startsWith("tests/fixtures/") ? ref.slice("tests/fixtures/".length) : ref;
    const fixturePath = relative(REPO_ROOT, resolve(REPO_ROOT, "tests/fixtures", inside)).split(sep).join("/");
    let code: string;
    try {
      code = readFixture({ kind, ref: fixturePath, codeSha256: "" });
    } catch (e) {
      const why = (e as NodeJS.ErrnoException).code === "ENOENT" ? `there is no file at ${fixturePath}` : (e as Error).message;
      return c.json({ error: why }, 400);
    }
    const target: Target = {
      kind,
      ref: fixturePath,
      codeSha256: sha256(code),
      ...(listedAsPreExisting(fixturePath) ? { preExisting: { ...PRE_EXISTING_LABEL } } : {}),
    };
    targets.set(target.codeSha256, target);
    return c.json(target);
  });

  app.post("/experiments", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = experimentBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const body = parsed.data;

    const target = targets.get(body.target.codeSha256);
    if (!target || target.ref !== body.target.ref) {
      return c.json({ error: "unknown target: register it with POST /targets first (same ref and codeSha256)" }, 400);
    }
    // The only route that creates a session (S4), and only after the request is otherwise valid.
    const opened = betStore.open(sessionId);
    if (!opened.ok) return c.json({ error: opened.reason }, 503);
    const rounds = opened.rounds;
    const id = body.id ?? newExperimentId();
    if (rounds.has(id)) return c.json({ error: `this session already has an experiment ${id}` }, 409);
    if (rounds.size >= MAX_EXPERIMENTS) return c.json({ error: `a session holds at most ${MAX_EXPERIMENTS} experiments; start a new session` }, 409);

    const log = roundLog(sessionEmitter(agentLog, sessionId));
    const decision = gate(body.params, TS_GATE_CONTEXT);
    const experiment = {
      id,
      target,
      runner: "ts" as const,
      params: decision.allowed ? decision.params : body.params,
      proposedBy: { role: "human" as const },
      gate: decision.allowed ? { allowed: true as const } : { allowed: false as const, reason: decision.reason },
    } as Experiment;
    const round = newRound(experiment, TS_GATE_CONTEXT);
    rounds.set(id, round); // a refused experiment is kept too (shown, never run)
    if (decision.allowed) log.investigatorStub(experiment);
    try {
      log.gate(experiment); // one flattened line; the 422 below keeps the full reason (S3)
    } catch (e) {
      if (!(e instanceof AgentEventError)) throw e; // a refused log line never hides the gate's answer
    }
    if (!decision.allowed) {
      record({
        kind: "gate_rejection",
        id,
        experimentId: id,
        time: new Date().toISOString(),
        role: "human",
        trigger: "POST /experiments: the gate refused the experiment, so it never ran",
        experiment: body.params,
        reason: decision.reason,
      });
      return c.json({ error: `gate: rejected (${decision.reason}); nothing will run`, experiment }, 422);
    }
    startModelBets(round, sessionId); // D02-06: the model bets on this SAME experiment, from the questions only
    return c.json({ experiment, questions: round.questions, extraQuestions: round.extraQuestions, model: modelSlotView(round) });
  });

  app.post("/experiments/:id/model-bets", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const id = c.req.param("id");
    const round = betStore.peek(sessionId)?.get(id); // a lookup never creates a session (S4)
    if (!round) return c.json({ error: `this session has no experiment ${id}: create it with POST /experiments first` }, 404);
    if (!round.experiment.gate.allowed) return c.json({ error: `the gate refused experiment ${id}, so no model bets on it` }, 422);
    betStore.touch(sessionId);
    await round.model?.settled;
    // Hashes only: the model's answers and rationale stay on the server until the run reveals every bet.
    return c.json({ model: modelSlotView(round) });
  });

  app.post("/bets", async (c) => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    // Two bodies: one bet {measures, answer}, or all of a person's answers at once {bets: [...]} (the page).
    const many = humanBetsBody.safeParse(raw.body);
    const one = many.success ? null : humanBetBody.safeParse(raw.body);
    if (!many.success && !one!.success) return c.json({ error: plainReason((raw.body as { bets?: unknown })?.bets !== undefined ? many.error : one!.error!) }, 400);
    const experimentId = many.success ? many.data.experimentId : one!.data!.experimentId;
    const wanted = many.success ? many.data.bets : [{ measures: one!.data!.measures, answer: one!.data!.answer }];

    const round = betStore.peek(sessionId)?.get(experimentId); // a lookup never creates a session (S4)
    if (!round) return c.json({ error: `this session has no experiment ${experimentId}: create it with POST /experiments first` }, 404);
    if (!round.experiment.gate.allowed) return c.json({ error: `the gate refused experiment ${experimentId}, so it takes no bets` }, 422);
    // Bets are frozen at run start. Checked with no await between here and the push below.
    if (round.status !== "open") {
      const when = round.betsFrozenAt ? `its run started at ${round.betsFrozenAt}` : "its run is starting";
      return c.json({ error: `bets on ${experimentId} are closed: ${when}, so this bet was not sealed` }, 409);
    }
    if (round.bets.length + wanted.length > MAX_BETS) return c.json({ error: `an experiment takes at most ${MAX_BETS} bets` }, 409);

    // Check EVERY answer before sealing any: one refused answer means nothing is sealed.
    const all = [...round.questions, ...round.extraQuestions];
    const seen = new Set<string>();
    const checked: { question: (typeof all)[number]; answer: Parameters<typeof sealHumanBet>[2] }[] = [];
    for (const w of wanted) {
      const question = all.find((q) => q.measures === w.measures);
      if (!question) {
        return c.json({ error: `no question on ${experimentId} measures "${w.measures}"; the questions measure ${all.map((q) => q.measures).join(", ")}` }, 400);
      }
      if (seen.has(w.measures)) return c.json({ error: `two answers to "${w.measures}" in one request; send one per question` }, 400);
      seen.add(w.measures);
      // One bet per bettor per question (S1): a sealed bet is never joined by a second one.
      if (round.bets.some((b) => b.who === "human" && b.measures === w.measures)) {
        return c.json({ error: `you already sealed a bet on "${w.measures}" for ${experimentId}; a sealed bet cannot be changed or joined by another`, bets: round.bets.filter((b) => b.who === "human").map(publicBet) }, 409);
      }
      const ok = checkAnswer(question, w.answer);
      if (!ok.ok) return c.json({ error: ok.reason }, 400);
      checked.push({ question, answer: ok.answer });
    }

    const sealedAt = new Date(); // one server time for the whole request
    const sealed = checked.map((x) => sealHumanBet(round, x.question, x.answer, sealedAt)); // server clock, server nonce
    round.bets.push(...sealed);
    betStore.touch(sessionId);
    roundLog(sessionEmitter(agentLog, sessionId)).humanBets(sealed);
    // The nonce stays here until the run: without it nobody can recompute the hash yet.
    // `bets` is this person's WHOLE sealed set on the experiment: exactly the set the run will judge.
    const mine = round.bets.filter((b) => b.who === "human").map(publicBet);
    return c.json({ ...(many.success ? {} : { bet: publicBet(sealed[0]!) }), bets: mine });
  });

  app.post("/runs", async (c) => {
    const sessionId = sessionIdOf(c); // D02-05
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = runBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);

    const round = betStore.peek(sessionId)?.get(parsed.data.experimentId); // a lookup never creates a session (S4)
    if (!round) return c.json({ error: `this session has no experiment ${parsed.data.experimentId}: create it with POST /experiments first` }, 404);
    const experiment = round.experiment;
    if (!experiment.gate.allowed) {
      return c.json({ error: `gate: rejected (${experiment.gate.reason}); nothing ran`, experiment }, 422);
    }
    if (round.status === "running") {
      const why = round.betsFrozenAt ? `its run started at ${round.betsFrozenAt}` : "its run is waiting for the model's bets";
      return c.json({ error: `experiment ${experiment.id} is already running: ${why}` }, 409);
    }
    if (round.status !== "open") return c.json({ error: `experiment ${experiment.id} already ran (started ${round.betsFrozenAt ?? "earlier"}); start a new experiment to run again` }, 409);
    if (round.bets.length === 0) return c.json({ error: "place at least one bet first: a run only happens after bets are sealed" }, 409);
    betStore.touch(sessionId);

    // Freeze the person's bets NOW, before any await: from here every POST /bets on this experiment gets 409.
    round.status = "running";
    // The model's bets are part of the round: wait until they are sealed (or it gave no usable answer).
    await round.model?.settled;
    const bets = [...round.bets];
    const log = roundLog(sessionEmitter(agentLog, sessionId));

    // The run must start strictly after the last seal. Two requests can land in the same
    // millisecond, so wait (a few ms at most) until the clock has moved past the last seal. A seal
    // further in the future than that is not waited for: the check below refuses it.
    const reach = Date.now() + 20;
    const lastSeal = Math.max(0, ...bets.map((b) => Date.parse(b.sealedAt)).filter((t) => t <= reach));
    while (Date.now() <= lastSeal) await new Promise((ok) => setTimeout(ok, 1));
    round.betsFrozenAt = new Date().toISOString();

    // Seals before anything runs: a bet whose hash does not match its fields is never judged, and nothing runs.
    const unsealed = bets.filter((b) => !verifySeal(b)).map((b) => b.id);
    log.seals(bets.length, unsealed);
    if (unsealed.length > 0) {
      round.status = "stopped";
      return c.json(
        { error: `the seal did not verify for bet ${unsealed.join(", ")}: its fields do not hash to its sealedHash, so it was not judged and nothing ran`, betIds: unsealed },
        409,
      );
    }
    // Every bet sealed strictly before the bets were frozen (server clock). Checked again against the run below.
    const late = sealedAfter(bets, round.betsFrozenAt);
    if (late.length > 0) {
      round.status = "stopped";
      return c.json({ error: `bet ${late.join(", ")} was not sealed before the run started, so nothing ran`, betIds: late }, 409);
    }

    let run: Run;
    try {
      const ctl = await getControl(experiment.target);
      run = await runExperiment(experiment, ctl, { executor });
    } catch (e) {
      round.status = "stopped";
      log.runnerStopped(experiment, (e as Error).message);
      throw e;
    }
    keepRun(run);
    log.runner(experiment, run);
    // The promise this route makes: every bet's sealedAt is earlier than run.startedAt.
    const lateForRun = sealedAfter(bets, run.startedAt);
    if (lateForRun.length > 0) {
      round.status = "stopped";
      return c.json({ error: `bet ${lateForRun.join(", ")} was not sealed before run ${run.id} started, so it was not judged`, betIds: lateForRun }, 409);
    }
    const verdicts: Verdict[] = bets.map((b) => judge(b, run));
    log.judge(verdicts, run);
    // S7: every can't-check verdict from a real run gets a public refusal record.
    for (const v of verdicts) {
      if (v.outcome !== "cant_check") continue;
      const b = bets.find((x) => x.id === v.betId)!;
      const model = b.who === "human" ? undefined : b.who.slice("model:".length);
      record({
        kind: "cant_check",
        id: b.id,
        betId: b.id,
        runId: run.id,
        experimentId: experiment.id,
        time: run.finishedAt,
        role: b.who === "human" ? "human" : "claimant",
        ...(model ? { model } : {}),
        trigger: `POST /runs: src/judge.ts could not check the bet on ${b.measures}`,
        experiment: experiment.params,
        reason: v.reason ?? "no reason given",
        measures: b.measures,
        question: b.question,
      });
    }
    round.status = "done";
    round.run = run;
    round.verdicts = verdicts;
    // Reveal every bet in full (with its nonce) so the browser can recompute each hash itself.
    return c.json({ run, verdicts, bets, betsFrozenAt: round.betsFrozenAt, model: modelSlotView(round) });
  });

  app.onError((err, c) => {
    // A log line the agent log refused is a bug in Atlas, not in the request: say so plainly (S3).
    if (err instanceof AgentEventError) return c.json({ error: `the server could not write its log line: ${err.message}` }, 500);
    return c.json({ error: `the server could not finish the request: ${err.message}` }, 500);
  });

  return app;
}

export const app = createApp();
