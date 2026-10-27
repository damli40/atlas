// Meta API client: one function, chat(), used by every Meta role.
//
// What it does, in order:
// 0. D07-01: picks the provider from the model id (providerFor). Meta's own models go to Meta's API
//    with `Authorization: Bearer <META_API_KEY>`. Muse Spark Open (meta-models/muse-spark-open-1026),
//    Meta's open-weights model, goes to Baseten's OpenAI-compatible Model API
//    (https://inference.baseten.co/v1, `Authorization: Api-Key <BASETEN_API_KEY>`; docs:
//    https://docs.baseten.co/reference/inference-api/chat-completions). Same request, same answer shape.
// 1. POSTs an OpenAI-style request to <provider base URL>/chat/completions.
// 2. If the model ran out of room (empty content, finish_reason "length"), it retries ONCE
//    with max_tokens 32000. Muse models are reasoning models: hidden thinking spends max_tokens.
// 3. After every HTTP call that returned usage, it appends one JSON line to usage.jsonl
//    (provider, model, tokens, dollars, finish reason) so every cent spent is on file, even when the response
//    then turns out to be unusable (for example a 200 with usage but no choices).
// 4. It never throws for API trouble. It returns { ok: false, reason } instead, and the reason
//    never contains the API key or any request header.
// 5. It never throws because the usage file could not be written (a read-only disk when hosted):
//    the call was already billed, so the result and its usage come back with a `warning`.

import { redactSecret } from "./redact-secret";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../../src/types";
import { SPARK_OPEN_MODEL } from "../../src/claimants";
import { priceConfirmed } from "../../src/cost";

export const META_BASE_URL = "https://api.meta.ai/v1";
/** Baseten's OpenAI-compatible Model API (per-token billing; no dedicated deployment). Live check 2026-10-27: HTTP 200. */
export const BASETEN_BASE_URL = "https://inference.baseten.co/v1";
export const DEFAULT_MAX_TOKENS = 16000;
export const RETRY_MAX_TOKENS = 32000;
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Dollars per 1M tokens. Reasoning tokens are counted inside completion_tokens and billed as output.
 * `cachedInPerM`: the price of prompt tokens the provider reports as cached; absent = billed as input.
 */
export interface Price { inPerM: number; outPerM: number; cachedInPerM?: number }

/** Published price (Meta hackathon materials, Oct 26 2026). */
export const WONDER_PRICE: Price = { inPerM: 4, outPerM: 20 };

/**
 * UNVERIFIED. GET /v1/models returns no pricing (checked Oct 27 2026) and no other source was found.
 * Assumed equal to Wonder's price so the logged cost is an upper bound rather than an undercount.
 * Replace with the real number once Meta publishes it.
 */
export const SPARK_PRICE_UNVERIFIED: Price = { inPerM: 4, outPerM: 20 };

/**
 * Muse Spark Open on Baseten's Model API: $1.25 in, $0.15 cached in, $4.25 out per 1M tokens, billed per
 * token (Baseten's model page https://www.baseten.co/library/muse-spark-open, read 2026-10-27).
 */
export const SPARK_OPEN_PRICE: Price = { inPerM: 1.25, outPerM: 4.25, cachedInPerM: 0.15 };

// `verified` comes from src/cost.ts (final review S7), the same list the screens use for "upper bound".
const PRICES: Record<string, { price: Price; verified: boolean }> = {
  "muse-wonder-1.0": { price: WONDER_PRICE, verified: priceConfirmed("muse-wonder-1.0") },
  "muse-spark-1.3": { price: SPARK_PRICE_UNVERIFIED, verified: priceConfirmed("muse-spark-1.3") },
  [SPARK_OPEN_MODEL]: { price: SPARK_OPEN_PRICE, verified: priceConfirmed(SPARK_OPEN_MODEL) },
};

/** Who serves a model. Only Muse Spark Open goes to Baseten; every other id is Meta's API. */
export type Provider = "meta" | "baseten";
export const providerFor = (model: string): Provider => (model.trim() === SPARK_OPEN_MODEL ? "baseten" : "meta");

export function priceFor(model: string): { price: Price; verified: boolean } {
  // Unknown models get the same upper-bound assumption, marked unverified.
  return PRICES[model] ?? { price: SPARK_PRICE_UNVERIFIED, verified: false };
}

export type Usage = NonNullable<AgentEvent["usage"]>;
/** X1 review minor 8: "outliner" (Muse Wonder outlining a codebase) is logged in usage.jsonl under its own name. */
export type ChatRole = AgentEvent["role"] | "outliner";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface ChatArgs {
  /** Which Atlas role is calling; written to usage.jsonl. */
  role: ChatRole;
  model: string;
  messages: ChatMessage[];
  /** Ask for a JSON object (response_format json_object). The caller must still schema-check the content. */
  json?: boolean;
  maxTokens?: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  temperature?: number;
}

export type ChatResult =
  | { ok: true; content: string; finishReason: string; usage: Usage; warning?: string }
  | { ok: false; reason: string; usage?: Usage; warning?: string; /** Final review M7: refused before any request was sent (no key, refused model id). */ notSent?: true };

export interface ClientOptions {
  /** Defaults to process.env.META_API_KEY, then ~/.config/meta-model-api/env. */
  apiKey?: string;
  /** Meta's base URL (default META_BASE_URL). */
  baseUrl?: string;
  /** D07-01: defaults to process.env.BASETEN_API_KEY, then ~/.config/baseten/env. */
  basetenApiKey?: string;
  /** D07-01: Baseten's base URL (default BASETEN_BASE_URL). */
  basetenBaseUrl?: string;
  /** Where usage lines go. Defaults to ATLAS_USAGE_PATH, then tests/evidence/usage/usage.jsonl in the repo. */
  usagePath?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_USAGE_PATH = join(REPO_ROOT, "tests", "evidence", "usage", "usage.jsonl");

/** Reads the key without ever printing it. Returns undefined when absent. */
export function loadApiKey(): string | undefined {
  if (process.env.META_API_KEY) return process.env.META_API_KEY.trim();
  const file = join(homedir(), ".config", "meta-model-api", "env");
  if (!existsSync(file)) return undefined;
  const m = readFileSync(file, "utf8").match(/^\s*(?:export\s+)?META_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
  return m?.[1];
}

/** Reads the Baseten key without ever printing it. Returns undefined when absent. */
export function loadBasetenKey(): string | undefined {
  if (process.env.BASETEN_API_KEY?.trim()) return process.env.BASETEN_API_KEY.trim();
  const file = join(homedir(), ".config", "baseten", "env");
  if (!existsSync(file)) return undefined;
  const m = readFileSync(file, "utf8").match(/^\s*(?:export\s+)?BASETEN_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
  return m?.[1];
}

/**
 * S4 (day-6 review): the Meta model ids Atlas uses. Any other id is refused, before and after a call.
 * D07-01 adds Muse Spark Open, Meta's open-weights model, as Baseten names it.
 */
export const KNOWN_META_MODELS = ["muse-wonder-1.0", "muse-spark-1.3", "muse-image-1.0", SPARK_OPEN_MODEL] as const;

/** A model id as reported by a tool is shown only when it reads like an id; otherwise it is described. */
export const shownModelId = (model: string) => (/^[A-Za-z0-9._:/-]{1,64}$/.test(model.trim()) ? model.trim() : "an unreadable model id");

/**
 * Whether Atlas may use (or use the answer of) this model id. Null when it may.
 * - "contributor" anywhere in the id, in any case or with any separator or suffix
 *   (muse-spark-1.3-contributor, muse-spark-1.3:contributor, contributor/..., -Contributor-2026): Meta may
 *   train on what such a model receives, so Atlas refuses it. ATLAS_ALLOW_CONTRIBUTOR=1 (a deliberate
 *   choice, for public code only) allows exactly "<known id>-contributor" and nothing else.
 * - Any id that is not one of KNOWN_META_MODELS is refused too (fail closed): Atlas cannot say what an
 *   unknown model is or what happens to its inputs.
 */
export function modelRefusal(model: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const m = model.trim();
  if ((KNOWN_META_MODELS as readonly string[]).includes(m)) return null;
  if (/contributor/i.test(m)) {
    if (env.ATLAS_ALLOW_CONTRIBUTOR === "1" && KNOWN_META_MODELS.some((k) => m === `${k}-contributor`)) return null;
    return `${shownModelId(m)} is a contributor model (Meta may train on its inputs); Atlas does not use it unless ATLAS_ALLOW_CONTRIBUTOR=1 is set`;
  }
  return `${shownModelId(m)} is not a Meta model id Atlas knows (${KNOWN_META_MODELS.join(", ")}); Atlas does not use it`;
}

/** The earlier name of modelRefusal (kept so older callers read the same rule). */
export const contributorRefusal = modelRefusal;

/**
 * Dollars for one call. `cachedTokens` (part of promptTokens) are billed at the cached price when the
 * model has one; otherwise every prompt token is billed as input (an upper bound, never an undercount).
 */
export function costUsd(model: string, promptTokens: number, completionTokens: number, cachedTokens = 0): number {
  const { price } = priceFor(model);
  const cached = price.cachedInPerM !== undefined ? Math.min(Math.max(0, cachedTokens), promptTokens) : 0;
  return ((promptTokens - cached) * price.inPerM + cached * (price.cachedInPerM ?? price.inPerM) + completionTokens * price.outPerM) / 1_000_000;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

function toUsage(model: string, raw: RawUsage | undefined): { usage: Usage; cachedTokens: number | null } | undefined {
  if (!raw) return undefined;
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  const reasoningTokens = raw.completion_tokens_details?.reasoning_tokens;
  const cached = raw.prompt_tokens_details?.cached_tokens;
  const cachedTokens = typeof cached === "number" && Number.isFinite(cached) ? cached : null;
  return {
    usage: {
      promptTokens,
      completionTokens,
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      usd: costUsd(model, promptTokens, completionTokens, cachedTokens ?? 0),
    },
    cachedTokens,
  };
}

function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  const reasoning = (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    ...(a.reasoningTokens !== undefined || b.reasoningTokens !== undefined ? { reasoningTokens: reasoning } : {}),
    usd: a.usd + b.usd,
  };
}

/** Removes the key from any text before it leaves this module. */
function scrub(text: string, key: string): string {
  return redactSecret(text, key); // M2 (day-7 review): any 12+ character piece of the key too
}

/**
 * Set once the API rejects response_format. Live check on Oct 27 2026: the API ACCEPTS
 * { type: "json_object" } (and rejects unknown types with 400), so this normally stays false.
 * It exists so a future API change degrades to "no response_format + schema check" instead of failing.
 */
const responseFormatRejected = new Set<Provider>();
export function _resetResponseFormatFlag(): void { responseFormatRejected.clear(); }

export function createMetaClient(opts: ClientOptions = {}) {
  const baseUrls: Record<Provider, string> = { meta: opts.baseUrl ?? META_BASE_URL, baseten: opts.basetenBaseUrl ?? BASETEN_BASE_URL };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const usagePath = opts.usagePath ?? process.env.ATLAS_USAGE_PATH ?? DEFAULT_USAGE_PATH;

  /** Appends one usage line. Returns a warning instead of throwing when the file cannot be written. */
  function logUsage(role: ChatRole, model: string, usage: Usage, finishReason: string, cachedTokens: number | null): string | undefined {
    const provider = providerFor(model);
    const line = {
      ts: now().toISOString(),
      role,
      provider,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      reasoningTokens: usage.reasoningTokens ?? null,
      ...(provider === "baseten" ? { cachedTokens } : {}),
      usd: usage.usd,
      finishReason,
      priceVerified: priceFor(model).verified,
    };
    try {
      mkdirSync(dirname(usagePath), { recursive: true });
      appendFileSync(usagePath, JSON.stringify(line) + "\n");
      return undefined;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code ?? "unknown error";
      return `the usage line could not be written (${code}); this call's usage is in the result only`;
    }
  }

  type Attempt =
    | { kind: "ok"; content: string; finishReason: string; usage?: Usage; warning?: string }
    | { kind: "fail"; reason: string; status?: number; body?: string; usage?: Usage; warning?: string };

  async function once(args: ChatArgs, key: string, maxTokens: number, withFormat: boolean): Promise<Attempt> {
    const provider = providerFor(args.model);
    // Baseten documents both "Bearer" and "Api-Key"; Atlas sends Api-Key, the scheme its live check used.
    const authorization = provider === "baseten" ? `Api-Key ${key}` : `Bearer ${key}`;
    const body: Record<string, unknown> = {
      model: args.model,
      messages: args.messages,
      max_tokens: maxTokens,
      reasoning_effort: args.reasoningEffort ?? "low",
      temperature: args.temperature ?? 0.2,
    };
    if (withFormat) body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrls[provider]}/chat/completions`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      const what = e?.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : `network error (${e?.name ?? "unknown"}: ${e?.message ?? ""})`;
      return { kind: "fail", reason: scrub(what, key) };
    }

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let message = text;
      try { message = JSON.parse(text)?.error?.message ?? text; } catch { /* keep raw text */ }
      return { kind: "fail", status: res.status, body: scrub(text, key), reason: scrub(`HTTP ${res.status}: ${String(message).slice(0, 300)}`, key) };
    }

    let json: { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: RawUsage };
    try { json = JSON.parse(text); } catch { return { kind: "fail", reason: "response was not JSON" }; }
    // Usage first: a 200 that carries usage was billed, whatever else is wrong with it.
    const choice = json.choices?.[0];
    const finishReason = choice ? choice.finish_reason ?? "unknown" : "no_choices";
    const counted = toUsage(args.model, json.usage);
    const usage = counted?.usage;
    const warning = counted ? logUsage(args.role, args.model, counted.usage, finishReason, counted.cachedTokens) : undefined;
    const extra = { ...(usage ? { usage } : {}), ...(warning ? { warning } : {}) };
    if (!choice) return { kind: "fail", reason: "response had no choices", ...extra };
    return { kind: "ok", content: choice.message?.content ?? "", finishReason, ...extra };
  }

  async function chat(args: ChatArgs): Promise<ChatResult> {
    const refused = modelRefusal(args.model);
    if (refused) return { ok: false, reason: refused, notSent: true };
    const provider = providerFor(args.model);
    const key = provider === "baseten" ? (opts.basetenApiKey ?? loadBasetenKey()) : (opts.apiKey ?? loadApiKey());
    if (!key) {
      return {
        ok: false,
        reason: provider === "baseten" ? "no Baseten API key: set BASETEN_API_KEY or ~/.config/baseten/env" : "no Meta API key: set META_API_KEY or ~/.config/meta-model-api/env",
        notSent: true,
      };
    }

    let maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
    let total: Usage | undefined;
    let lengthRetried = false;
    const warnings: string[] = [];
    const tail = () => ({ ...(total ? { usage: total } : {}), ...(warnings.length ? { warning: warnings.join("; ") } : {}) });

    for (;;) {
      const withFormat = !!args.json && !responseFormatRejected.has(provider);
      let a = await once(args, key, maxTokens, withFormat);

      // The API refused response_format: remember it, resend without it, rely on the caller's schema check.
      if (a.kind === "fail" && withFormat && a.status === 400 && /response_format/i.test(a.body ?? "")) {
        responseFormatRejected.add(provider);
        a = await once(args, key, maxTokens, false);
      }
      total = addUsage(total, a.usage);
      if (a.warning) warnings.push(a.warning);
      if (a.kind === "fail") return { ok: false, reason: a.reason, ...tail() };

      const empty = a.content.trim() === "";

      if (empty && a.finishReason === "length" && !lengthRetried) {
        lengthRetried = true;
        maxTokens = RETRY_MAX_TOKENS;
        continue;
      }
      if (empty) {
        const why = lengthRetried
          ? `no content after retry at max_tokens ${RETRY_MAX_TOKENS} (finish_reason ${a.finishReason})`
          : `empty content (finish_reason ${a.finishReason})`;
        return { ok: false, reason: why, ...tail() };
      }
      if (!total) return { ok: false, reason: "response had no usage block, so the cost could not be logged", ...tail() };
      return { ok: true, content: a.content, finishReason: a.finishReason, usage: total, ...(warnings.length ? { warning: warnings.join("; ") } : {}) };
    }
  }

  return { chat };
}

/** Default client: real fetch, key from env or ~/.config, usage into tests/evidence/usage/usage.jsonl. */
export function chat(args: ChatArgs): Promise<ChatResult> {
  return createMetaClient().chat(args);
}
