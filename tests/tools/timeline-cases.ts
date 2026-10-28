// E3: the pasted rounds the call timeline is checked and drawn on. Each is real code run through the real routes
// (POST /paste, /experiments, /bets, /runs) on the local sandbox; no model is asked.

import { createApp } from "../../server/app.ts";
import type { Bet, ExperimentShape, Run, Verdict } from "../../src/types.ts";

export const RETRY = `export async function retryWithBackoff(fetchIt: () => Promise<unknown>, attempts: number = 3, baseMs: number = 100) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchIt();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}
`;
const PARSE = `export function parseAmount(text) {
  const n = Number(String(text).replace(",", "."));
  if (Number.isNaN(n)) throw new TypeError("not a number: " + text);
  return Math.round(n * 100) / 100;
}
`;
const POLL = `export async function pollUntilReady(check, everyMs = 1000) {
  while (!(await check())) await new Promise((r) => setTimeout(r, everyMs));
  return "ready";
}
`;
const RACE = `export async function firstOf(a, b) {
  return Promise.race([a(), b()]);
}
`;

const fetchIt = (calls: unknown[], then = "repeat_last") => ({ kind: "stand-in", name: "fetchIt", async: true, calls, then });
const timeout = { do: "throw", errorName: "TimeoutError", message: "slow" };

export interface TimelineCase {
  id: string;
  what: string;
  source: string;
  params: ExperimentShape;
}

export const TIMELINE_CASES: TimelineCase[] = [
  { id: "throws-then-returns", what: "fetchIt throws once, then returns: retryWithBackoff returns at 100 ms after 2 calls", source: RETRY, params: { shape: "call-function", exportName: "retryWithBackoff", args: [fetchIt([timeout, { do: "return", value: { ok: true } }]) as never, { kind: "json", value: 3 }, { kind: "json", value: 100 }] } },
  { id: "always-throws", what: "fetchIt always throws: retryWithBackoff throws after 3 calls and 3 waits (700 ms)", source: RETRY, params: { shape: "call-function", exportName: "retryWithBackoff", args: [fetchIt([timeout]) as never, { kind: "json", value: 3 }, { kind: "json", value: 100 }] } },
  { id: "never-answers", what: "fetchIt throws, then never answers: retryWithBackoff never settles", source: RETRY, params: { shape: "call-function", exportName: "retryWithBackoff", args: [fetchIt([timeout, { do: "never_settle" }]) as never, { kind: "json", value: 3 }, { kind: "json", value: 100 }] } },
  { id: "late-answer", what: "fetchIt answers 250 ms after it is called: a rib from the call to the answer", source: RETRY, params: { shape: "call-function", exportName: "retryWithBackoff", args: [fetchIt([{ do: "return", value: 7, afterMs: 250 }]) as never] } },
  { id: "still-running", what: "check never says ready: pollUntilReady is still running at the 5,000 ms watch limit", source: POLL, params: { shape: "call-function", exportName: "pollUntilReady", args: [{ kind: "stand-in", name: "check", async: true, calls: [{ do: "return", value: false }], then: "repeat_last" }], watchLimitMs: 5000 } },
  { id: "no-wait", what: "a plain parser with no stand-in: everything at 0 ms", source: PARSE, params: { shape: "call-function", exportName: "parseAmount", args: [{ kind: "json", value: "1,5" }] } },
  { id: "two-stand-ins", what: "two stand-ins race: a answers at 300 ms, b at 120 ms", source: RACE, params: { shape: "call-function", exportName: "firstOf", args: [{ kind: "stand-in", name: "a", async: true, calls: [{ do: "return", value: "a", afterMs: 300 }], then: "repeat_last" }, { kind: "stand-in", name: "b", async: true, calls: [{ do: "return", value: "b", afterMs: 120 }], then: "repeat_last" }] } },
];

export interface PlayedCase {
  id: string;
  what: string;
  run: Run;
  bets: Bet[];
  verdicts: Verdict[];
}

/** Plays one case through the real routes with a person's outcome bet (so the round has something to judge). */
export async function playCase(app: ReturnType<typeof createApp>, c: TimelineCase): Promise<PlayedCase> {
  let session: string | null = null;
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session) headers["x-atlas-session"] = session;
    const res = await app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
    session ??= res.headers.get("x-atlas-session");
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(`${path} answered ${res.status}: ${json.error ?? "?"}`);
    return json;
  };
  const p = await post<{ target: { ref: string; codeSha256: string } }>("/paste", { code: c.source });
  const exp = await post<{ experiment: { id: string } }>("/experiments", { target: p.target, params: c.params });
  await post("/bets", { experimentId: exp.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
  const out = await post<{ run: Run; bets: Bet[]; verdicts: Verdict[] }>("/runs", { experimentId: exp.experiment.id });
  return { id: c.id, what: c.what, ...out };
}
