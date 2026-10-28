// G1: shared fixtures for the invite tests (mocked models; no network, no key, $0; every store in a temp folder).

import { mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createProofStore } from "../../server/evm-round";
import { createModelBudget, type ModelBudget } from "../../server/meta/budget";
import { costUsd, createMetaClient, type ChatArgs, type ChatResult } from "../../server/meta/client";
import { createReplayGate, createRunGate, createSandboxGate } from "../../server/replay-limits";
import { runAs, type Principal } from "../../server/access/context";
import { INVITE_COOKIE, INVITE_HEADER, NEEDS_INVITE, OPEN_ROUTES, isOpenRoute, requireInviteFromEnv, withInviteGate } from "../../server/access/gate";
import { MODAL_USD_PER_SECOND_AT_CAPS, modalWorstCaseUsd, openLedger, type Ledger } from "../../server/access/ledger";
import { meteredExecutor, meteredGate } from "../../server/access/metered";
import { accessFromEnv } from "../../server/access/setup";
import { hashCode, openInviteStore, type InviteStore } from "../../server/access/store";
import { localExecutor } from "../../runners/executor/local";
import type { Executor } from "../../runners/runner";
import { SPARK_OPEN_MODEL } from "../../src/claimants";
import type { Experiment, Run } from "../../src/types";
import { main as invitesCli } from "../../tools/invites";
import { RETRY_SRC, SPARK_ANSWER, WONDER_ANSWER, allowedA } from "./paste-fixtures";
import { PR } from "./review-fixtures";

export const PEPPER = "test-pepper-".padEnd(48, "x");
export const ENV = { ATLAS_INVITE_PEPPER: PEPPER };
export const tmp = () => mkdtempSync(join(tmpdir(), "atlas-g1-"));

export interface BuildOpts {
  dir?: string;
  require?: boolean;
  ceiling?: number;
  spentAtStart?: number;
  ownerReserve?: number;
  /** Pretend the sandbox is Modal (it still runs on this machine's local sandbox; the cost is Modal's estimate). */
  modal?: boolean;
  modalStartsPerDay?: number;
  evmRunsPerDay?: number;
  callsPerHour?: number;
  devCallsPerHour?: number;
  ledger?: Partial<Parameters<typeof openLedger>[0]>;
  runLimits?: Parameters<typeof createRunGate>[0];
  publicOrigin?: string;
  devDaily?: number;
  devMaxConcurrent?: number;
  usd?: number;
  slowMs?: number;
  trustProxy?: boolean;
  perClientModelLimits?: { modelRoundsPerHour?: number };
  chat?: (a: ChatArgs) => Promise<ChatResult>;
  evmRun?: (exp: Experiment, o: { forkBlock: number; onProgress: (s: string) => void }) => Promise<Run>;
}

/** The server as server/index.ts builds it, with mocks for the models and a counted sandbox. */
export function build(o: BuildOpts = {}) {
  const dir = o.dir ?? tmp();
  const store = openInviteStore(dir, { env: ENV });
  const dev = store.create({ label: "dev-ada", ...(o.devDaily !== undefined ? { dailyUsd: o.devDaily } : {}), ...(o.devMaxConcurrent ? { maxConcurrent: o.devMaxConcurrent } : {}) });
  const dev2 = store.create({ label: "dev-bo" });
  const owner = store.create({ label: "dami", role: "owner" });
  let budget: ModelBudget | undefined;
  const ledger = openLedger({
    dir,
    store,
    requireInvite: o.require ?? true,
    ceilingUsd: o.ceiling ?? 100,
    ownerReserveUsd: o.ownerReserve ?? 20,
    modelSpentUsd: () => budget!.spentUsd(),
    ...(o.modalStartsPerDay !== undefined ? { modalStartsPerDay: o.modalStartsPerDay } : {}),
    ...(o.evmRunsPerDay !== undefined ? { evmRunsPerDay: o.evmRunsPerDay } : {}),
    ...(o.ledger ?? {}),
  });
  budget = createModelBudget({ spendCeilingUsd: o.ceiling ?? 100, spentAtStartUsd: o.spentAtStart ?? 0, guard: ledger, callsPerHour: o.callsPerHour ?? 1000, ...(o.devCallsPerHour !== undefined ? { devCallsPerHour: o.devCallsPerHour } : {}), experimentsPerSession: 1000 });
  const spent = { calls: [] as ChatArgs[], execs: 0, evm: 0 };
  const usage = { promptTokens: 2100, completionTokens: 400, usd: o.usd ?? 0.0164 };
  const chat =
    o.chat ??
    (async (a: ChatArgs): Promise<ChatResult> => {
      spent.calls.push(a);
      if (o.slowMs) await new Promise((r) => setTimeout(r, o.slowMs));
      return { ok: true, finishReason: "stop", usage, content: a.role === "investigator" ? WONDER_ANSWER : SPARK_ANSWER };
    });
  const raw: Executor = o.modal
    ? { kind: "modal", fingerprint: "g1-test-modal", exec: (r) => (spent.execs++, localExecutor.exec(r)) }
    : { kind: "local", exec: (r) => (spent.execs++, localExecutor.exec(r)) };
  const evmRun =
    o.evmRun ??
    (async () => {
      spent.evm++;
      throw new Error("no fork in this test");
    });
  const inner = createApp({
    agentLog: createAgentLog(),
    proofs: createProofStore({ publish: false }),
    modelBets: { chat, budget, sparkOpen: { available: true } },
    investigator: { chat, budget },
    paste: { proposer: { chat, budget } },
    fixer: { chat, budget, museExec: null },
    adversary: { chat, budget },
    outline: { outliner: { chat, budget } },
    executor: meteredExecutor(raw, ledger),
    runGate: meteredGate(createRunGate(o.runLimits), ledger, "EVM run", { ownerGate: createRunGate(o.runLimits) }),
    replayGate: meteredGate(createReplayGate(), ledger, "EVM replay", { ownerGate: createReplayGate() }),
    sandboxGate: meteredGate(createSandboxGate(), ledger, "sandbox start", { ownerGate: createSandboxGate(), count: false }),
    fetchPr: async () => PR,
    evmRun,
    trustProxy: o.trustProxy ?? false,
    ...(o.perClientModelLimits ? { perClientModelLimits: o.perClientModelLimits } : {}),
  });
  const app = withInviteGate(inner, { store, require: o.require ?? true, ledger, secureCookie: false, trustProxy: o.trustProxy ?? false, ...(o.publicOrigin ? { publicOrigin: o.publicOrigin } : {}) });
  return { dir, store, ledger, budget, app, inner, spent, codes: { dev: dev.code, dev2: dev2.code, owner: owner.code }, ids: { dev: dev.invite.id, owner: owner.invite.id } };
}

export type App = ReturnType<typeof build>["app"];
export function client(app: App, code?: string, session?: string, extra: Record<string, string> = {}) {
  let s: string | null = session ?? null;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { "content-type": "application/json", ...extra, ...headers };
    if (code) h[INVITE_HEADER] = code;
    if (s) h["x-atlas-session"] = s;
    const res = await app.request(path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    s ??= res.headers.get("x-atlas-session");
    const text = await res.text();
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { text };
    }
    return { status: res.status, json, headers: res.headers };
  };
  return { post: (p: string, b?: unknown, h?: Record<string, string>) => call("POST", p, b ?? {}, h), get: (p: string, h?: Record<string, string>) => call("GET", p, undefined, h), raw: call, session: () => s };
}

/** A whole pasted round with a valid code: paste, Wonder's tests, an experiment both models bet on, a person's bet, the run. */
export async function pastedRound(c: ReturnType<typeof client>) {
  const p = await c.post("/paste", { code: RETRY_SRC });
  expect(p.status).toBe(200);
  const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
  const props = await c.post("/paste/proposals", { target, exportName: "retryWithBackoff" });
  const e = await c.post("/experiments", { target, params: allowedA }, { "x-atlas-claimant": "both" });
  expect(e.status).toBe(200);
  const id = e.json.experiment.id as string;
  await c.post(`/experiments/${id}/model-bets`);
  const b = await c.post("/bets", { experimentId: id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
  expect(b.status).toBe(200);
  const r = await c.post("/runs", { experimentId: id });
  return { target, props, e, id, r };
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const logLines = (dir: string) => readFileSync(join(dir, "spend-log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);

