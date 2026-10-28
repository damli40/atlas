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
import type { OutlineAtlasFile } from "../src/outline/types";
import type { FileOutline } from "../src/file-outline";
import type { OutlineView } from "./machines/explorer/outline-data";
import type { TrackRecord } from "../src/track-record";
import type { LabelsAnswer } from "../src/failure-labels";

export type { TrackRecord, LabelsAnswer };
/** X3: what GET /track-record answers. `before` only when asked for (null: that round is not in this record). */
export interface TrackAnswer {
  person: "invite" | "browser" | "session";
  record: TrackRecord;
  before?: TrackRecord | null;
}
/** X3: labels for a pasted function (POST /paste/labels). */
export type PasteLabelsAnswer = LabelsAnswer & { exportName: string };

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
  /** E3 (pasted rounds): the bet screen's text; every betting model gets exactly this (D19). */
  seenContext?: string;
  /** E3 review r2 M2: this test repeats one already run in the session (that experiment's id). */
  repeatOf?: string;
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
  /** X3 (D27): the person's track record before and after this round (or why it could not be saved). */
  track?: { person: TrackAnswer["person"]; before: TrackRecord; after: TrackRecord } | { error: string };
}

export type HumanAnswer = { kind: "integer"; value: number } | { kind: "enum"; value: string } | { kind: "number"; value: number } | { kind: "json"; value: unknown } | { kind: "quiz"; choice: string } | { kind: "declined"; reason: string };

/** E3: what POST /paste answers. */
export interface PasteAnswer {
  target: Pick<Target, "kind" | "ref" | "codeSha256" | "language">;
  language: { chosen: "js" | "ts" | "py"; guessed: "js" | "ts" | "py"; why: string; chosenBy: "person" | "plain code" };
  languages: PasteLanguage[];
  runnable: boolean;
  reason?: string;
  exports: { name: string; line: number; declaredAs: string }[];
  cantCheck: string | null;
  lines: number;
  /** U1 (D47): the file's functions and joins by plain code. Absent on servers before U1. */
  outline?: FileOutline;
}
export interface PasteLanguage {
  language: "js" | "ts" | "py";
  name: string;
  runnable: boolean;
}
/** E3: one of Muse Wonder's proposed tests. `says` is plain code's description (allowed tests only). */
export interface ShownProposal {
  id: string;
  attempt: number;
  params: unknown;
  gate: { allowed: true } | { allowed: false; reason: string };
  says?: string;
}
export interface ProposalsAnswer {
  ok: boolean;
  model: string;
  display: string;
  setId?: string;
  reason?: string;
  proposals: ShownProposal[];
  claimHeld?: boolean;
  usage?: { promptTokens: number; completionTokens: number; usd: number } | null;
  /** X3: the weak-spot summary Muse Wonder was given (plain code's counts), or null. */
  aimedAt?: string | null;
}

/** X1/X2: an outline job's status (GET /outline/jobs/:id). */
export interface OutlineJob {
  jobId: string;
  status: "reading" | "mapping" | "asking-wonder" | "checking" | "done" | "failed";
  what: string;
  createdAt: string;
  error?: string;
  codeSha256?: string;
  files?: number;
  skipped?: number;
  counts?: { confirmedParts: number; unconfirmedParts: number; confirmedJoins: number; modelOnlyJoins: number; codeOnlyJoins: number } | null;
  wonderFailure?: string;
}
export type OutlineRequest = { repo: string; ref?: string; subfolder?: string } | { files: { path: string; text: string }[] };

const SESSION_HEADER = "x-atlas-session";
/** X3: names "this browser" for the track record when there is no invite code (server/app.ts BROWSER_HEADER). */
const BROWSER_HEADER = "x-atlas-browser";
const BROWSER_KEY = "atlas-browser-id";

/**
 * X3 (D27): one random id per browser, kept in localStorage, so a local track record follows this browser across tabs
 * and page loads. Not a secret and not a login: on a hosted server the invite code names the person instead. Without
 * storage (a private window) it lives as long as the page.
 */
let pageBrowserId: string | null = null;
export function browserId(): string {
  if (pageBrowserId) return pageBrowserId;
  try {
    const s = globalThis.localStorage?.getItem(BROWSER_KEY) ?? null;
    if (s && /^[A-Za-z0-9_-]{16,64}$/.test(s)) return (pageBrowserId = s);
  } catch {
    // no storage
  }
  pageBrowserId = `b${newSessionId()}${newSessionId()}`;
  try {
    globalThis.localStorage?.setItem(BROWSER_KEY, pageBrowserId);
  } catch {
    // no storage: this page only
  }
  return pageBrowserId;
}

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

/**
 * E3 review M4/B5: the paste flow's session is kept in this tab (sessionStorage), so the proof card it links to,
 * opened in the same tab, is read and re-run as the session that pasted the code (others never get the source).
 */
export const PASTE_SESSION_KEY = "atlas-paste-session";
export function storedSession(key: string): string | null {
  try {
    const s = globalThis.sessionStorage?.getItem(key) ?? null;
    return s && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
  } catch {
    return null;
  }
}
export function storeSession(key: string, s: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, s);
  } catch {
    // no storage (private window, tests): the session lives as long as the page
  }
}

export function createApi(fetchFn: FetchLike = (u, i) => fetch(u, i), base = "/api", opts: { session?: string | null; onSession?: (s: string) => void } = {}) {
  let session: string | null = opts.session ?? null;
  /** D07-01: who places the model's bets on the next experiment (the x-atlas-claimant header). */
  let claimant: ClaimantMode = DEFAULT_CLAIMANT_MODE;
  async function post<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", [BROWSER_HEADER]: browserId() };
    if (session) headers[SESSION_HEADER] = session;
    if (claimant !== DEFAULT_CLAIMANT_MODE) headers[CLAIMANT_HEADER] = claimant;
    const res = await fetchFn(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (session === null) {
      session = res.headers.get(SESSION_HEADER);
      if (session) opts.onSession?.(session);
    }
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
    if (session === null) {
      session = newSessionId();
      opts.onSession?.(session);
    }
    const res = await fetchFn(`${base}${path}`, { method: "GET", headers: { [SESSION_HEADER]: session, [BROWSER_HEADER]: browserId() } });
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
    experiment: (target: Pick<Target, "ref" | "codeSha256">, params: unknown, findingId?: string, editedFrom?: string, opts: { quiz?: true } = {}) =>
      post<ExperimentAnswer>("/experiments", { target: { ref: target.ref, codeSha256: target.codeSha256 }, params, ...(findingId ? { findingId } : {}), ...(editedFrom ? { editedFrom } : {}), ...(opts.quiz ? { quiz: true } : {}) }),
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
    /** E3: which languages this server runs (a language with no runner shows as "coming"). */
    pasteLanguages: () => get<{ languages: PasteLanguage[]; maxBytes: number; executor: "local" | "modal"; privacy: string }>("/paste/languages"),
    /** E3: one pasted file, kept in this session's memory on the server. */
    paste: (code: string, language?: "js" | "ts" | "py") => post<PasteAnswer>("/paste", { code, ...(language ? { language } : {}) }),
    /** E3: Muse Wonder proposes up to 3 tests for one export; the gate checks each. */
    proposals: (target: Pick<Target, "ref" | "codeSha256">, exportName: string) => post<ProposalsAnswer>("/paste/proposals", { target: { ref: target.ref, codeSha256: target.codeSha256 }, exportName }),
    /** E3: a test Muse Wonder proposed, used as proposed. */
    experimentFromProposal: (target: Pick<Target, "ref" | "codeSha256">, proposalId: string, opts: { quiz?: true } = {}) =>
      post<ExperimentAnswer>("/experiments", { target: { ref: target.ref, codeSha256: target.codeSha256 }, proposalId, ...(opts.quiz ? { quiz: true } : {}) }),
    /** E3: Muse Wonder's sentence, once the person's bets on this experiment are sealed. */
    claim: (experimentId: string) => post<{ model: string; display: string; claim: string }>("/paste/claim", { experimentId }),
    /** X1/X2: start an outline job on a GitHub folder or uploaded files (202, then poll outlineJob). */
    startOutline: (req: OutlineRequest) => post<OutlineJob>("/outline/jobs", req),
    outlineJob: (jobId: string) => get<OutlineJob>(`/outline/jobs/${encodeURIComponent(jobId)}`),
    /** X2: the verified outline, the code map and the file list (no code text). */
    outline: (jobId: string) => get<OutlineView>(`/outline/jobs/${encodeURIComponent(jobId)}/outline`),
    /** X2: the outline-only .atlas.json, which holds the files' text (the "Bet on this part" hand-off reads one file from it). */
    outlineAtlas: (jobId: string) => get<OutlineAtlasFile>(`/outline/jobs/${encodeURIComponent(jobId)}/atlas`),
    /** X3 (D27): this person's track record; with `before`, also their record before that round. */
    trackRecord: (before?: string) => get<TrackAnswer>(`/track-record${before ? `?before=${encodeURIComponent(before)}` : ""}`),
    /** X3 (D28): common-failure labels for one pasted function (plain code). */
    pasteLabels: (target: Pick<Target, "ref" | "codeSha256">, exportName: string) => post<PasteLabelsAnswer>("/paste/labels", { target: { ref: target.ref, codeSha256: target.codeSha256 }, exportName }),
    /** X3 (D28): common-failure labels for every confirmed part of an outline job (plain code). */
    outlineLabels: (jobId: string) => get<{ parts: Record<string, LabelsAnswer>; note?: string }>(`/outline/jobs/${encodeURIComponent(jobId)}/labels`),
    /** D06-01: Muse Code proposes a change toward the bets; the same experiment re-runs; the same bets are judged. */
    change: (runId: string) => post<ChangeAnswer>("/changes", { runId }),
    /** D07-02: "what else?": the Adversary proposes one more experiment; Atlas runs it with no click. */
    adversary: (runId: string) => post<AdversaryAnswer>("/adversary", { runId }),
  };
}

export type Api = ReturnType<typeof createApi>;
