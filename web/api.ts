// The browser's side of the HTTP routes (server/app.ts). One client per page: it keeps the
// session id the server hands back on the first answer, so experiments, bets and the run share it.
// In development, Vite forwards /api/* to the Hono server on port 8787 (vite.config.ts).

import type { Question } from "../src/gate";
import type { Bet, Experiment, Run, Target, Verdict } from "../src/types";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A sealed bet as shown before the run: the server keeps the nonce until the run. */
export type ShownBet = Omit<Bet, "nonce">;

export interface ExperimentAnswer {
  experiment: Experiment;
  questions: Question[];
}

export interface RunAnswer {
  run: Run;
  verdicts: Verdict[];
  /** Every bet in full, nonce included, revealed after the run. */
  bets: Bet[];
  betsFrozenAt: string;
}

export type HumanAnswer = { kind: "integer"; value: number } | { kind: "enum"; value: string };

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
    target: (ref: string) => post<Target>("/targets", { kind: "ts-fixture", ref }),
    experiment: (target: Target, params: unknown) =>
      post<ExperimentAnswer>("/experiments", { target: { ref: target.ref, codeSha256: target.codeSha256 }, params }),
    bet: (experimentId: string, measures: string, answer: HumanAnswer) =>
      post<{ bet: ShownBet }>("/bets", { experimentId, who: "human", measures, answer }).then((r) => r.bet),
    run: (experimentId: string) => post<RunAnswer>("/runs", { experimentId }),
  };
}

export type Api = ReturnType<typeof createApi>;
