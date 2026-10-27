// The browser's side of the HTTP routes (server/app.ts). One client per page: it keeps the
// session id the server hands back on the first answer, so experiments, bets and the run share it.
// In development, Vite forwards /api/* to the Hono server on port 8787 (vite.config.ts).

import type { Question } from "../src/gate";
import type { ChainFactsResult } from "../src/chain-facts";
import type { AtlasFile, Bet, Experiment, Finding, Run, Target, Verdict } from "../src/types";
import type { FalseAlarmRow } from "../runners/evm/level2";
import type { ModelSlotView, SealedOnly } from "../server/bets";
import type { ChangeAnswer } from "../server/changes";
import { CLAIMANT_HEADER, DEFAULT_CLAIMANT_MODE, type ClaimantMode, type ClaimantsInfo } from "../src/claimants";

export type { ClaimantMode, ClaimantsInfo };
import type { AdversaryAnswer } from "../server/app";

export type { ModelSlotView, SealedOnly, FalseAlarmRow, ChangeAnswer, AdversaryAnswer };

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
  /** D07-01: every model slot, in column order (two in "both" mode). */
  models?: ModelSlotView[];
  /** D22 (Moonwell rounds): the chain facts read at block 42194662 before any bet, or why there are none. */
  chainFacts?: ChainFactsResult;
}

export interface RunAnswer {
  run: Run;
  verdicts: Verdict[];
  /** Every bet in full, nonce included, revealed after the run. */
  bets: Bet[];
  betsFrozenAt: string;
  model?: ModelSlotView | null;
  /** D07-01: every model slot, in column order. */
  models?: ModelSlotView[];
  /** D04-04: the round's .atlas.json (kept, and written when publishing is on). */
  proof?: ProofInfo;
  /** D04-04, Level 2 only: one row per market the proposal touches. */
  falseAlarm?: FalseAlarmRow[];
}

export type HumanAnswer = { kind: "integer"; value: number } | { kind: "enum"; value: string } | { kind: "number"; value: number };

const SESSION_HEADER = "x-atlas-session";

/** A session id made by the page (12 letters and digits), used only when the server has not handed one back yet. */
function newSessionId(): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/** D06-02: what POST /sweeps answers. */
export interface SweepAnswer {
  experiment: Experiment;
  run: Run;
  control: { runId: string; passed: boolean };
}

/** D06-03: what GET /replay/:runId answers. */
export interface ReplayAnswer {
  runId: string;
  replayRunId: string;
  runner: "ts" | "evm";
  forkBlock?: number;
  replayForkBlock?: number;
  seed?: string;
  replaySeed?: string;
  measuredEqual: boolean;
  resultDiff: string[];
  controlPassed: boolean;
  sameOutcomes: boolean;
  /**
   * S2 (day-6 review): present when the card carries a change. The change replay re-run too (same seed /
   * same fork block), compared with the file's replay. `error` when it could not be re-run.
   */
  changeReplay?: { replayRunId: string; measuredEqual: boolean; resultDiff: string[]; controlPassed: boolean; sameOutcomes: boolean } | { error: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Final review S2: the server's 503 for a run that stopped before a result (the same experiment can run again). */
export const didNotFinish = (e: unknown): boolean => e instanceof ApiError && e.status === 503 && e.message.startsWith("the run did not finish: ");

/** D07-01: the slots an answer carries: `models` when present, else the single `model`. */
export const slotsOf = (a: { model?: ModelSlotView | null; models?: ModelSlotView[] }): ModelSlotView[] => (a.models && a.models.length > 0 ? a.models : a.model ? [a.model] : []);

export function createApi(fetchFn: FetchLike = (u, i) => fetch(u, i), base = "/api") {
  let session: string | null = null;
  /** D07-01: who places the model's bets on the next experiment (the x-atlas-claimant header). */
  let claimant: ClaimantMode = DEFAULT_CLAIMANT_MODE;
  async function post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session) headers[SESSION_HEADER] = session;
    if (claimant !== DEFAULT_CLAIMANT_MODE) headers[CLAIMANT_HEADER] = claimant;
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
  async function get<T>(path: string): Promise<T> {
    // The replay route counts EVM replays per session and needs the header, so the page always sends
    // one: the server's, once it handed one back, else one made here (the server accepts any well-formed id).
    session ??= newSessionId();
    const res = await fetchFn(`${base}${path}`, { method: "GET", headers: { [SESSION_HEADER]: session } });
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
    /** D06-02: many callers at once on the fixture; the gate allows only "concurrency-sweep" there. */
    sweep: (target: Target, params: unknown) => post<SweepAnswer>("/sweeps", { target: { ref: target.ref, codeSha256: target.codeSha256 }, params }),
    /** D06-03: a round's .atlas.json, as the server kept it. */
    proof: (runId: string) => get<AtlasFile>(`/proofs/${encodeURIComponent(runId)}`),
    /** D06-03: re-run a round from its .atlas.json (same seed, or same fork block) and compare `measured`. */
    replay: (runId: string) => get<ReplayAnswer>(`/replay/${encodeURIComponent(runId)}`),
    /** The session id the server handed back (null before the first answer). */
    session: () => session,
    /** D07-01: the claimant mode sent with the next experiment. */
    claimant: () => claimant,
    setClaimant: (mode: ClaimantMode) => {
      claimant = mode;
    },
    /** D07-01: whether this server can ask Muse Spark Open, and if not, why (no model call). */
    claimants: () => get<ClaimantsInfo>("/claimants"),
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
    /** D07-01: the same wait, for every model slot of the experiment. */
    modelSlots: (experimentId: string) =>
      post<{ model: ModelSlotView | null; models?: ModelSlotView[] }>(`/experiments/${encodeURIComponent(experimentId)}/model-bets`, {}).then(slotsOf),
    run: (experimentId: string) => post<RunAnswer>("/runs", { experimentId }),
    /** D06-01: Muse Code proposes a change toward the bets; the same experiment re-runs; the same bets are judged. */
    change: (runId: string) => post<ChangeAnswer>("/changes", { runId }),
    /** D07-02: "what else?": the Adversary proposes one more experiment; Atlas runs it with no click. */
    adversary: (runId: string) => post<AdversaryAnswer>("/adversary", { runId }),
  };
}

export type Api = ReturnType<typeof createApi>;
