// The browser's side of the HTTP routes (server/app.ts). One client per page: it keeps the
// session id the server hands back on the first answer, so experiments, bets and the run share it.
// In development, Vite forwards /api/* to the Hono server on port 8787 (vite.config.ts).

import type { Question } from "../src/gate";
import type { Bet, Experiment, Finding, Run, Target, Verdict } from "../src/types";
import type { FalseAlarmRow } from "../runners/evm/level2";
import type { ModelSlotView, SealedOnly } from "../server/bets";

export type { ModelSlotView, SealedOnly, FalseAlarmRow };

/** A pull request target as the server registered it, with its files (D04-04). */
export type PrTarget = Target & { title: string; files: { path: string; text: string }[] };

export interface InvestigateAnswer {
  ok: boolean;
  reason?: string;
  model: string;
  findings: Finding[];
  dropped: { file: string; lineStart: number; lineEnd: number; reason: string }[];
  fellBack?: boolean;
  usage?: { promptTokens: number; completionTokens: number; usd: number } | null;
}

/** The round's .atlas.json, as the server reports it after the run (D04-04). */
export type ProofInfo = { ok: true; runId: string; captions: string[]; published: boolean; error?: string } | { ok: false; runId: string; reason: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A sealed bet as shown before the run: the server keeps the nonce until the run. */
export type ShownBet = Omit<Bet, "nonce">;

export interface ExperimentAnswer {
  experiment: Experiment;
  questions: Question[];
  /** The model's slot on this same experiment: status and, once sealed, hashes only (D02-06). */
  model: ModelSlotView | null;
}

export interface RunAnswer {
  run: Run;
  verdicts: Verdict[];
  /** Every bet in full, nonce included, revealed after the run. */
  bets: Bet[];
  betsFrozenAt: string;
  model?: ModelSlotView | null;
  /** D04-04: the round's .atlas.json (kept, and written when publishing is on). */
  proof?: ProofInfo;
  /** D04-04, Level 2 only: one row per market the proposal touches. */
  falseAlarm?: FalseAlarmRow[];
}

export type HumanAnswer = { kind: "integer"; value: number } | { kind: "enum"; value: string } | { kind: "number"; value: number };

const SESSION_HEADER = "x-atlas-session";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createApi(fetchFn: FetchLike = (u, i) => fetch(u, i), base = "/api") {
  let session: string | null = null;
  async function post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session) headers[SESSION_HEADER] = session;
    const res = await fetchFn(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    session ??= res.headers.get(SESSION_HEADER);
    let json: (T & { error?: string }) | undefined;
    try {
      json = (await res.json()) as T & { error?: string };
    } catch {
      json = undefined;
    }
    if (!res.ok || json === undefined) throw new ApiError(json?.error ?? `the server answered ${res.status}`, res.status);
    return json;
  }
  return {
    /** The session id the server handed back (null before the first answer). */
    session: () => session,
    target: (ref: string) => post<Target>("/targets", { kind: "ts-fixture", ref }),
    /** D04-04: a pull request, read by the server at its merge commit. */
    prTarget: (ref: string) => post<PrTarget>("/targets", { kind: "github-pr", ref }),
    investigate: (target: Target) => post<InvestigateAnswer>("/investigate", { target: { ref: target.ref, codeSha256: target.codeSha256 } }),
    /** D04-04: lines a person picked themselves. */
    pickLines: (target: Target, file: string, lineStart: number, lineEnd: number) =>
      post<{ finding: Finding }>("/findings", { target: { ref: target.ref, codeSha256: target.codeSha256 }, file, lineStart, lineEnd }).then((r) => r.finding),
    experiment: (target: Target, params: unknown, findingId?: string) =>
      post<ExperimentAnswer>("/experiments", { target: { ref: target.ref, codeSha256: target.codeSha256 }, params, ...(findingId ? { findingId } : {}) }),
    bet: (experimentId: string, measures: string, answer: HumanAnswer) =>
      post<{ bet: ShownBet }>("/bets", { experimentId, who: "human", measures, answer }).then((r) => r.bet),
    /**
     * Seals ALL of the person's answers in one request: if the server refuses any answer, none is
     * sealed. Returns the person's whole sealed set on this experiment, which is exactly what the
     * run will judge, so the page shows (and later checks) that set and nothing else.
     */
    bets: (experimentId: string, answers: { measures: string; answer: HumanAnswer }[]) =>
      post<{ bets: ShownBet[] }>("/bets", { experimentId, who: "human", bets: answers }).then((r) => r.bets),
    /** Waits for the model's bets on this experiment; returns its status and sealed hashes (never its answers). */
    modelBets: (experimentId: string) =>
      post<{ model: ModelSlotView | null }>(`/experiments/${encodeURIComponent(experimentId)}/model-bets`, {}).then((r) => r.model),
    run: (experimentId: string) => post<RunAnswer>("/runs", { experimentId }),
  };
}

export type Api = ReturnType<typeof createApi>;
