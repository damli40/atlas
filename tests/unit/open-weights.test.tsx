// D07-01: open-weights mode (Muse Spark Open on Baseten). Everything here is offline: fetch and chat()
// are mocked, no key is read from disk, nothing is written to proofs/.
//
// What is checked:
// 1. The client sends Muse Spark Open to Baseten (inference.baseten.co/v1, "Api-Key" auth) and every
//    other Meta model to Meta's API ("Bearer"), with the same request body.
// 2. The auth header and the key never reach a usage line, a result or a reason.
// 3. The usage line names provider "baseten" and the model, and prices cached prompt tokens at Baseten's
//    cached rate.
// 4. Unavailable: no Baseten key → a plain reason and no request; a server without Baseten says
//    "not available (<reason>)" on GET /claimants and in the slot, and never seals a bet for it.
// 5. The x-atlas-claimant header: spark (default) | spark-open | both; anything else is refused. In
//    "both", each model gets the SAME prompt (D18, D19) and seals its own bets; the run judges both.
// 6. The page: the toggle's "not available" words, three columns (You · Muse Spark · Muse Spark Open)
//    with counts only, and no comparative words.

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { _resetResponseFormatFlag, BASETEN_BASE_URL, costUsd, createMetaClient, modelRefusal, providerFor, type ChatArgs, type ChatResult } from "../../server/meta/client";
import { modelsFor, parseClaimantMode, SPARK_MODEL, SPARK_OPEN_MODEL } from "../../src/claimants";
import { App } from "../../web/App";
import { createApi } from "../../web/api";
import { BettorCounts } from "../../web/screens/Claimant";

const FAKE_BASETEN_KEY = "bt-fake-test-key-0123456789abcdef"; // secret-scan: allow (an obviously fake key)
const FAKE_META_KEY = "sk-fake-meta-key-0123456789abcdef"; // secret-scan: allow (an obviously fake key)
const OPEN_DISPLAY = "Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten";
const BANNED = /more accurate|better|smarter|wins?\b|beats?\b|outperform/i;

beforeEach(() => _resetResponseFormatFlag());

// ---------- 1–3: the client ----------

interface Call { url: string; body: Record<string, unknown>; headers: Record<string, string> }
function setupClient(opts: { basetenKey?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "atlas-d07-"));
  const usagePath = join(dir, "usage.jsonl");
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}', role: "assistant", reasoning_content: "short thought" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 151, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 128 }, completion_tokens_details: { reasoning_tokens: 15 } },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const client = createMetaClient({
    apiKey: FAKE_META_KEY,
    ...(opts.basetenKey === null ? {} : { basetenApiKey: opts.basetenKey ?? FAKE_BASETEN_KEY }),
    fetchImpl,
    usagePath,
    now: () => new Date("2026-10-27T12:00:00Z"),
  });
  const lines = () => (existsSync(usagePath) ? readFileSync(usagePath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { client, calls, usagePath, lines };
}
const ask = (model: string): ChatArgs => ({ role: "claimant", model, messages: [{ role: "user", content: 'Return {"ok":true}' }], json: true });

describe("D07-01 client: provider routing", () => {
  it("Muse Spark Open goes to Baseten with Api-Key auth; Muse Spark goes to Meta with Bearer; same body", async () => {
    const { client, calls } = setupClient();
    const open = await client.chat(ask(SPARK_OPEN_MODEL));
    const spark = await client.chat(ask(SPARK_MODEL));
    expect(open.ok && spark.ok).toBe(true);
    expect(calls[0]!.url).toBe(`${BASETEN_BASE_URL}/chat/completions`);
    expect(calls[0]!.url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(calls[0]!.headers.authorization).toBe(`Api-Key ${FAKE_BASETEN_KEY}`);
    expect(calls[1]!.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(calls[1]!.headers.authorization).toBe(`Bearer ${FAKE_META_KEY}`);
    // Same request shape for both providers; only the model id differs.
    const { model: m0, ...b0 } = calls[0]!.body;
    const { model: m1, ...b1 } = calls[1]!.body;
    expect(m0).toBe(SPARK_OPEN_MODEL);
    expect(m1).toBe(SPARK_MODEL);
    expect(b0).toEqual(b1);
    expect(providerFor(SPARK_OPEN_MODEL)).toBe("baseten");
    expect(providerFor("muse-wonder-1.0")).toBe("meta");
  });

  it("the usage line names provider baseten and the model, prices cached tokens at the cached rate, and never holds the key or the auth header", async () => {
    const { client, lines, usagePath } = setupClient();
    const r = await client.chat(ask(SPARK_OPEN_MODEL));
    expect(r.ok).toBe(true);
    const l = lines();
    expect(l).toHaveLength(1);
    const want = (23 * 1.25 + 128 * 0.15 + 30 * 4.25) / 1_000_000;
    expect(l[0]).toEqual({
      ts: "2026-10-27T12:00:00.000Z",
      role: "claimant",
      provider: "baseten",
      model: SPARK_OPEN_MODEL,
      promptTokens: 151,
      completionTokens: 30,
      reasoningTokens: 15,
      cachedTokens: 128,
      usd: want,
      finishReason: "stop",
      priceVerified: true,
    });
    expect(costUsd(SPARK_OPEN_MODEL, 151, 30, 128)).toBeCloseTo(want, 12);
    // A model with no cached price bills every prompt token as input (an upper bound).
    expect(costUsd(SPARK_MODEL, 151, 30, 128)).toBe(costUsd(SPARK_MODEL, 151, 30));
    const raw = readFileSync(usagePath, "utf8");
    for (const secret of [FAKE_BASETEN_KEY, FAKE_META_KEY, "Api-Key", "authorization", "Bearer"]) {
      expect(raw.toLowerCase()).not.toContain(secret.toLowerCase());
      expect(JSON.stringify(r).toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("an error body that echoes the key comes back redacted", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ error: { message: `bad key Api-Key ${FAKE_BASETEN_KEY}` } }), { status: 401 });
    }) as unknown as typeof fetch;
    const client = createMetaClient({ basetenApiKey: FAKE_BASETEN_KEY, fetchImpl, usagePath: join(mkdtempSync(join(tmpdir(), "atlas-d07-")), "u.jsonl") });
    const r = await client.chat(ask(SPARK_OPEN_MODEL));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("HTTP 401");
    expect(r.reason).not.toContain(FAKE_BASETEN_KEY);
    expect(r.reason).toContain("[redacted]");
  });

  it("unavailable: no Baseten key → a plain reason and no request at all", async () => {
    const saved = process.env.BASETEN_API_KEY;
    const savedHome = process.env.HOME;
    process.env.BASETEN_API_KEY = "";
    process.env.HOME = mkdtempSync(join(tmpdir(), "atlas-d07-home-")); // no ~/.config/baseten/env here
    try {
      const { client, calls, lines } = setupClient({ basetenKey: null });
      const r = await client.chat(ask(SPARK_OPEN_MODEL));
      expect(r).toEqual({ ok: false, notSent: true, reason: "no Baseten API key: set BASETEN_API_KEY or ~/.config/baseten/env" });
      expect(calls).toHaveLength(0);
      expect(lines()).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.BASETEN_API_KEY;
      else process.env.BASETEN_API_KEY = saved;
      process.env.HOME = savedHome;
    }
  });

  it("the allow-list knows the id; the contributor guard is unchanged", () => {
    expect(modelRefusal(SPARK_OPEN_MODEL, {})).toBeNull();
    expect(modelRefusal("meta-models/muse-spark-open", {})).toMatch(/is not a Meta model id Atlas knows/);
    expect(modelRefusal("meta-models/muse-spark-open-1026-contributor", {})).toMatch(/contributor model/);
    expect(modelRefusal("muse-spark-1.3-contributor", {})).toMatch(/contributor model/);
  });
});

// ---------- 4–5: the server ----------

const usage = { promptTokens: 1500, completionTokens: 300, usd: 0.012 };
const OPTIONS = ["returns", "throws", "pending"];
const S3 = { shape: "retry-scenario", failTimes: 5, failure: "error" };
const betsJson = (calls: number, wait: number, outcome: string, why: string) =>
  JSON.stringify({
    bets: [
      { measures: "calls", answer: { kind: "integer", value: calls }, rationale: why },
      { measures: "totalWaitMs", answer: { kind: "integer", value: wait }, rationale: why },
      { measures: "outcome", answer: { kind: "enum", value: outcome, options: OPTIONS }, rationale: why },
    ],
  });
const SPARK_REPLY = betsJson(6, 15017, "throws", "Spark-otter rationale.");
const OPEN_REPLY = betsJson(5, 12000, "throws", "Open-heron rationale.");

function serverWith(opts: { sparkOpen?: { available: true } | { available: false; reason: string } } = {}) {
  const calls: ChatArgs[] = [];
  const chat = async (args: ChatArgs): Promise<ChatResult> => {
    calls.push(JSON.parse(JSON.stringify(args)));
    return { ok: true, content: args.model === SPARK_OPEN_MODEL ? OPEN_REPLY : SPARK_REPLY, finishReason: "stop", usage };
  };
  const app = createApp({ modelBets: { chat, ...(opts.sparkOpen ? { sparkOpen: opts.sparkOpen } : {}) } });
  return { app, calls };
}

async function startRound(app: ReturnType<typeof createApp>, session: string, claimant?: string) {
  const headers = { "content-type": "application/json", "x-atlas-session": session };
  const t = (await (await app.request("/targets", { method: "POST", headers, body: JSON.stringify({ kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" }) })).json()) as { ref: string; codeSha256: string };
  const res = await app.request("/experiments", {
    method: "POST",
    headers: { ...headers, ...(claimant !== undefined ? { "x-atlas-claimant": claimant } : {}) },
    body: JSON.stringify({ target: { ref: t.ref, codeSha256: t.codeSha256 }, params: S3 }),
  });
  return { res, headers };
}

describe("D07-01 server: x-atlas-claimant", () => {
  it("the header parses to spark (default), spark-open or both; anything else is refused", async () => {
    expect(parseClaimantMode(undefined)).toEqual({ ok: true, mode: "spark" });
    expect(parseClaimantMode("BOTH")).toEqual({ ok: true, mode: "both" });
    expect(parseClaimantMode("llama")).toEqual({ ok: false, reason: "x-atlas-claimant must be one of spark, spark-open, both" });
    expect(modelsFor("both")).toEqual([SPARK_MODEL, SPARK_OPEN_MODEL]);
    const { app, calls } = serverWith({ sparkOpen: { available: true } });
    const { res } = await startRound(app, "sessD07bad", "llama");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("x-atlas-claimant must be one of spark, spark-open, both");
    expect(calls).toHaveLength(0);
  });

  it("both: each model seals its own bets from the SAME prompt; hashes only before the run; the run judges both", async () => {
    const { app, calls } = serverWith({ sparkOpen: { available: true } });
    const { res, headers } = await startRound(app, "sessD07both", "both");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { experiment: { id: string }; models: { who: string; display: string; status: string }[]; claimant: string };
    expect(out.claimant).toBe("both");
    expect(out.models.map((m) => m.who)).toEqual([`model:${SPARK_MODEL}`, `model:${SPARK_OPEN_MODEL}`]);
    expect(out.models[1]!.display).toBe(OPEN_DISPLAY);
    const waited = await app.request(`/experiments/${out.experiment.id}/model-bets`, { method: "POST", headers, body: "{}" });
    const slots = (await waited.json()) as { models: { who: string; status: string; sealed: { sealedHash: string }[] }[] };
    expect(slots.models.map((m) => m.status)).toEqual(["sealed", "sealed"]);
    expect(slots.models.every((m) => m.sealed.length === 3)).toBe(true);
    const before = JSON.stringify(slots);
    expect(before).not.toMatch(/Spark-otter|Open-heron|15017/);
    // D18/D19: the two models got exactly the same messages; only the model id differs.
    expect(calls.map((c) => c.model).sort()).toEqual([SPARK_MODEL, SPARK_OPEN_MODEL].sort());
    expect(calls[0]!.messages).toEqual(calls[1]!.messages);
    expect(JSON.stringify(calls[0]!.messages)).not.toMatch(/Spark-otter|Open-heron/); // neither sees the other's bets

    await app.request("/bets", { method: "POST", headers, body: JSON.stringify({ experimentId: out.experiment.id, who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }] }) });
    const run = (await (await app.request("/runs", { method: "POST", headers, body: JSON.stringify({ experimentId: out.experiment.id }) })).json()) as {
      bets: { id: string; who: string; measures: string }[];
      verdicts: { betId: string; outcome: string; judgedBy: string }[];
      models: { who: string }[];
    };
    expect(run.models).toHaveLength(2);
    const whoOf = (id: string) => run.bets.find((b) => b.id === id)!.who;
    const judged = (who: string) => run.verdicts.filter((v) => whoOf(v.betId) === who);
    expect(judged(`model:${SPARK_MODEL}`)).toHaveLength(3);
    expect(judged(`model:${SPARK_OPEN_MODEL}`)).toHaveLength(3);
    expect(run.verdicts.every((v) => v.judgedBy === "src/judge.ts")).toBe(true);
  }, 30000);

  it("spark-open alone: the slot and every bet carry meta-models/muse-spark-open-1026", async () => {
    const { app, calls } = serverWith({ sparkOpen: { available: true } });
    const { res, headers } = await startRound(app, "sessD07open", "spark-open");
    const out = (await res.json()) as { experiment: { id: string }; model: { who: string } };
    expect(out.model.who).toBe(`model:${SPARK_OPEN_MODEL}`);
    await app.request(`/experiments/${out.experiment.id}/model-bets`, { method: "POST", headers, body: "{}" });
    expect(calls.map((c) => c.model)).toEqual([SPARK_OPEN_MODEL]);
  });

  it("unavailable: GET /claimants and the slot say 'not available (<reason>)'; no call, no bet, Spark still bets in 'both'", async () => {
    const { app, calls } = serverWith({ sparkOpen: { available: false, reason: "no Baseten access on this server" } });
    const info = (await (await app.request("/claimants")).json()) as { sparkOpen: { available: boolean; reason?: string; model: string } };
    expect(info.sparkOpen).toEqual({ model: SPARK_OPEN_MODEL, display: OPEN_DISPLAY, available: false, reason: "no Baseten access on this server" });
    const { res, headers } = await startRound(app, "sessD07off", "both");
    const out = (await res.json()) as { experiment: { id: string }; models: { who: string; status: string; reason?: string }[] };
    expect(out.models[1]).toMatchObject({ who: `model:${SPARK_OPEN_MODEL}`, status: "off", reason: "not available: no Baseten access on this server" });
    const waited = (await (await app.request(`/experiments/${out.experiment.id}/model-bets`, { method: "POST", headers, body: "{}" })).json()) as { models: { status: string; sealed: unknown[] }[] };
    expect(waited.models.map((m) => m.status)).toEqual(["sealed", "off"]);
    expect(waited.models[1]!.sealed).toEqual([]);
    expect(calls.map((c) => c.model)).toEqual([SPARK_MODEL]);
  });

  it("a server built without the sparkOpen option treats Muse Spark Open as not available", async () => {
    const { app } = serverWith();
    const info = (await (await app.request("/claimants")).json()) as { sparkOpen: { available: boolean; reason?: string } };
    expect(info.sparkOpen.available).toBe(false);
    expect(info.sparkOpen.reason).toBe("this server was not set up for Baseten");
  });
});

// ---------- 6: the page ----------

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
const $ = (sel: string) => host!.querySelector(sel) as HTMLElement | null;
const byText = (tag: string, text: string) => [...host!.querySelectorAll(tag)].find((e) => e.textContent?.trim() === text) as HTMLElement | undefined;
async function until(check: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 10));
    });
  }
}
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  const PageEvent = el.ownerDocument.defaultView!.Event;
  el.dispatchEvent(new PageEvent(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
function mount(sparkOpen: { available: true } | { available: false; reason: string }) {
  const { app } = serverWith({ sparkOpen });
  const api = createApi((url, init) => Promise.resolve(app.request(url.replace(/^\/api/, ""), init)));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<App api={api} start="fixture" />));
}

describe("D07-01 page", () => {
  it("unavailable: the toggle says 'Muse Spark Open: not available (<reason>)' and offers only Muse Spark", async () => {
    mount({ available: false, reason: "no Baseten access on this server" });
    await until(() => $('[data-testid="spark-open-unavailable"]') !== null, "the toggle's reason");
    expect($('[data-testid="spark-open-unavailable"]')!.textContent).toBe("Muse Spark Open: not available (no Baseten access on this server)");
    expect(($('[data-testid="claimant-spark-open"]') as HTMLInputElement).disabled).toBe(true);
    expect(($('[data-testid="claimant-both"]') as HTMLInputElement).disabled).toBe(true);
    expect(($('[data-testid="claimant-spark"]') as HTMLInputElement).checked).toBe(true);
  });

  it("both: three columns You · Muse Spark · Muse Spark Open, counts only, every seal checked", async () => {
    mount({ available: true });
    await until(() => $('[data-testid="claimant-both"]') !== null && !($('[data-testid="claimant-both"]') as HTMLInputElement).disabled, "the toggle");
    await act(async () => ($('[data-testid="claimant-both"]') as HTMLInputElement).click());
    await until(() => $('[data-testid="pre-existing"]') !== null, "the target card");
    await act(async () => byText("button", "Show the questions")!.click());
    await until(() => $('[data-testid="bet-calls"]') !== null, "the questions");
    act(() => setValue($('[data-testid="bet-calls"]') as HTMLInputElement, "5"));
    act(() => setValue($('[data-testid="bet-totalWaitMs"]') as HTMLInputElement, "12000"));
    act(() => setValue($('[data-testid="bet-outcome"]') as HTMLSelectElement, "throws"));
    await act(async () => byText("button", "Seal my bets")!.click());
    await until(() => host!.querySelectorAll('[data-testid="model-sealed-note"]').length === 2, "both models' seals");
    expect(host!.textContent).toContain(`${OPEN_DISPLAY} has sealed 3 bets`);
    await act(async () => byText("button", "Break it")!.click());
    await until(() => $('[data-testid="seal-check-model2-outcome"]') !== null, "the verdicts", 15000);
    const headers = [...host!.querySelectorAll(".verdicts th")].map((t) => t.textContent);
    expect(headers).toEqual(["question", "You", "Muse Spark 1.3 (muse-spark-1.3)", OPEN_DISPLAY, "observed"]);
    expect($('[data-testid="verdict-model-calls"]')!.textContent).toMatch(/^6 · didn't match/);
    expect($('[data-testid="verdict-model2-calls"]')!.textContent).toMatch(/^5 · matched/);
    const counts = $('[data-testid="bettor-counts"]')!;
    expect([...counts.querySelectorAll("th")].map((t) => t.textContent)).toEqual(["bets", "You", "Muse Spark 1.3 (muse-spark-1.3)", OPEN_DISPLAY]);
    expect($(`[data-testid="count-total-model:${SPARK_OPEN_MODEL}"]`)!.textContent).toBe("3");
    for (const id of ["seal-check-model-calls", "seal-check-model2-calls", "seal-check-model2-outcome"]) expect($(`[data-testid="${id}"]`)!.getAttribute("data-match")).toBe("yes");
    expect(host!.querySelector(".verdicts")!.parentElement!.textContent).not.toMatch(BANNED);
  }, 30000);

  it("BettorCounts prints counts and no comparative word", () => {
    const html = renderToStaticMarkup(
      <BettorCounts
        verdicts={[
          { betId: "a", outcome: "matched", judgedBy: "src/judge.ts" },
          { betId: "b", outcome: "not_matched", judgedBy: "src/judge.ts" },
          { betId: "c", outcome: "cant_check", judgedBy: "src/judge.ts" },
        ] as never}
        bets={[
          { id: "a", who: "human" },
          { id: "b", who: `model:${SPARK_MODEL}` },
          { id: "c", who: `model:${SPARK_OPEN_MODEL}` },
        ]}
        names={{ [`model:${SPARK_OPEN_MODEL}`]: OPEN_DISPLAY }}
      />,
    );
    expect(html).toContain(OPEN_DISPLAY.replace("·", "·"));
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(BANNED);
  });
});
