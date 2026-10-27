// The Atlas HTTP server (Hono).
//
// Routes today (D01-08):
// - POST /targets {kind: "ts-fixture", ref} → the Target: which file, and the SHA-256 of its exact bytes.
// - POST /runs {experiment, bets?} → runs the control (once per code SHA-256), then the experiment
//   in the sandbox, then lets src/judge.ts compare each sealed bet to what the run measured.
// - GET /events/:sessionId (D02-05) → SSE of the session's agent events (server/log/). The session
//   is the `x-atlas-session` header; the server makes one and returns it when absent.
//
// Plain words on trust:
// - Every bet must arrive sealed (src/seal.ts). If any bet's hash does not match its fields, the
//   whole request is refused with 409 BEFORE anything runs, and nothing is judged.
// - Only the server's own copy of a target is used (from POST /targets), so the code hash and the
//   "pre-existing" label come from the server, not from the request.
// - Runs and targets live in memory only. Nothing is written to proofs/ (that folder is public).
// - The experiment bounds below stand in for src/gate.ts until that exists.

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { z } from "zod";
import { judge } from "../src/judge";
import { verifySeal } from "../src/seal";
import type { Bet, Experiment, JsonValue, Run, Target, Verdict } from "../src/types";
import type { Executor } from "../runners/runner";
import { localExecutor } from "../runners/executor/local";
import { createAgentLog, sessionEmitter, type AgentLog } from "./log/agentlog";
import { roundLog } from "./log/round";
import { BAD_SESSION, registerEventRoutes, sessionIdOf } from "./log/sse";
import { control as runTsControl, readFixture, runExperiment } from "../runners/ts/control";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PRE_EXISTING_PATH = resolve(REPO_ROOT, "PRE-EXISTING.md");
export const PRE_EXISTING_LABEL = { label: "Pre-existing: written before the hackathon", listedIn: "PRE-EXISTING.md" } as const;

// ---------- request schemas ----------

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

const targetBody = z.object({ kind: z.literal("ts-fixture"), ref: z.string().min(1).max(200) });

const retryScenario = z
  .object({
    shape: z.literal("retry-scenario"),
    failTimes: z.union([z.number().int().min(0).max(20), z.literal("always")]),
    failure: z.enum(["error", "never_settles"]),
    attempts: z.number().int().min(1).max(20).optional(),
    delayMs: z.number().int().min(0).max(60_000).optional(),
    resolveAfterMs: z.number().int().min(0).max(120_000).optional(),
    errorKind: z.enum(["seeded", "429"]).optional(),
    resolvesWith: jsonValue.optional(),
  })
  .strict(); // a misspelt field is refused, not silently ignored

const experimentBody = z.object({
  id: z.string().min(1).max(64),
  target: z.object({ kind: z.literal("ts-fixture"), ref: z.string().min(1), codeSha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  runner: z.literal("ts"),
  params: retryScenario,
  proposedBy: z.object({ role: z.enum(["claimant", "adversary", "human"]), model: z.string().optional() }),
});

const betAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("integer"), value: z.number() }).strict(),
  z.object({ kind: z.literal("number"), value: z.number(), tolerancePct: z.number(), unit: z.string() }).strict(),
  z.object({ kind: z.literal("enum"), value: z.string(), options: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal("declined"), reason: z.string() }).strict(),
]);

const betBody = z.object({
  id: z.string().min(1).max(64),
  experimentId: z.string().min(1),
  who: z.union([z.literal("human"), z.string().regex(/^model:.+$/)]),
  question: z.string().min(1),
  measures: z.string().min(1),
  answer: betAnswer,
  nonce: z.string(),
  sealedAt: z.string(),
  sealedHash: z.string(),
  rationale: z.string().optional(),
});

const runBody = z.object({ experiment: experimentBody, bets: z.array(betBody).max(50).optional() });

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

// ---------- the app ----------

export function createApp(opts: { executor?: Executor; agentLog?: AgentLog } = {}) {
  const executor = opts.executor ?? localExecutor;
  const agentLog = opts.agentLog ?? createAgentLog(); // D02-05: per-session agent events
  const targets = new Map<string, Target>(); // by codeSha256
  const controls = new Map<string, Promise<Run>>(); // passed controls only, by codeSha256
  const runs = new Map<string, Run>(); // in memory today; not published

  const getControl = (target: Target): Promise<Run> => {
    const cached = controls.get(target.codeSha256);
    if (cached) return cached;
    const p = runTsControl(target, executor).then((run) => {
      runs.set(run.id, run);
      // A control that did not pass is not kept: the next request tries again (it may have been a timeout).
      if (run.controlPassed !== true) controls.delete(target.codeSha256);
      return run;
    });
    p.catch(() => controls.delete(target.codeSha256));
    controls.set(target.codeSha256, p);
    return p;
  };

  const app = new Hono();

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

  app.post("/runs", async (c) => {
    const sessionId = sessionIdOf(c); // D02-05
    if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
    const raw = await readJson(c.req.raw);
    if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
    const parsed = runBody.safeParse(raw.body);
    if (!parsed.success) return c.json({ error: plainReason(parsed.error) }, 400);
    const body = parsed.data;

    const target = targets.get(body.experiment.target.codeSha256);
    if (!target || target.ref !== body.experiment.target.ref) {
      return c.json({ error: "unknown target: register it with POST /targets first (same ref and codeSha256)" }, 400);
    }

    const bets = (body.bets ?? []) as Bet[];
    const experiment: Experiment = {
      id: body.experiment.id,
      target,
      runner: "ts",
      params: body.experiment.params,
      proposedBy: body.experiment.proposedBy,
      gate: { allowed: true }, // stand-in: the zod bounds above; src/gate.ts replaces this in D02
    };
    // D02-05: log order human → investigator stand-in → gate → seal → runner → judge.
    const log = roundLog(sessionEmitter(agentLog, sessionId));
    log.humanBets(bets);
    log.investigatorStub(experiment);
    log.gate(experiment);

    // Seals before anything runs: a bet whose hash does not match its fields is never judged, and nothing runs.
    const unsealed = bets.filter((b) => !verifySeal(b)).map((b) => b.id);
    log.seals(bets.length, unsealed);
    if (unsealed.length > 0) {
      return c.json(
        { error: `the seal did not verify for bet ${unsealed.join(", ")}: its fields do not hash to its sealedHash, so it was not judged and nothing ran`, betIds: unsealed },
        409,
      );
    }

    let run: Run;
    try {
      const ctl = await getControl(target);
      run = await runExperiment(experiment, ctl, { executor });
    } catch (e) {
      log.runnerStopped(experiment, (e as Error).message);
      throw e;
    }
    runs.set(run.id, run);
    log.runner(experiment, run);
    const verdicts: Verdict[] = bets.map((b) => judge(b, run));
    log.judge(verdicts, run);
    return c.json({ run, verdicts });
  });

  app.onError((err, c) => c.json({ error: `the server could not finish the request: ${err.message}` }, 500));

  return app;
}

export const app = createApp();
