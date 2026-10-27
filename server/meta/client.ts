// Meta API client: one function, chat(), used by every Meta role.
//
// What it does, in order:
// 1. POSTs an OpenAI-style request to https://api.meta.ai/v1/chat/completions.
// 2. If the model ran out of room (empty content, finish_reason "length"), it retries ONCE
//    with max_tokens 32000. Muse models are reasoning models: hidden thinking spends max_tokens.
// 3. After every HTTP call that returned usage, it appends one JSON line to usage.jsonl
//    (tokens, dollars, finish reason) so every cent spent is on file.
// 4. It never throws for API trouble. It returns { ok: false, reason } instead, and the reason
//    never contains the API key or any request header.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../../src/types";

export const META_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MAX_TOKENS = 16000;
export const RETRY_MAX_TOKENS = 32000;
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Dollars per 1M tokens. Reasoning tokens are counted inside completion_tokens and billed as output. */
export interface Price { inPerM: number; outPerM: number }

/** Published price (Meta hackathon materials, Oct 26 2026). */
export const WONDER_PRICE: Price = { inPerM: 4, outPerM: 20 };

/**
 * UNVERIFIED. GET /v1/models returns no pricing (checked Oct 27 2026) and no other source was found.
 * Assumed equal to Wonder's price so the logged cost is an upper bound rather than an undercount.
 * Replace with the real number once Meta publishes it.
 */
export const SPARK_PRICE_UNVERIFIED: Price = { inPerM: 4, outPerM: 20 };

const PRICES: Record<string, { price: Price; verified: boolean }> = {
  "muse-wonder-1.0": { price: WONDER_PRICE, verified: true },
  "muse-spark-1.3": { price: SPARK_PRICE_UNVERIFIED, verified: false },
};

export function priceFor(model: string): { price: Price; verified: boolean } {
  // Unknown models get the same upper-bound assumption, marked unverified.
  return PRICES[model] ?? { price: SPARK_PRICE_UNVERIFIED, verified: false };
}

export type Usage = NonNullable<AgentEvent["usage"]>;
export type ChatRole = AgentEvent["role"];

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
  | { ok: true; content: string; finishReason: string; usage: Usage }
  | { ok: false; reason: string; usage?: Usage };

export interface ClientOptions {
  /** Defaults to process.env.META_API_KEY, then ~/.config/meta-model-api/env. */
  apiKey?: string;
  baseUrl?: string;
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

export function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const { price } = priceFor(model);
  return (promptTokens * price.inPerM + completionTokens * price.outPerM) / 1_000_000;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

function toUsage(model: string, raw: RawUsage | undefined): Usage | undefined {
  if (!raw) return undefined;
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  const reasoningTokens = raw.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens,
    completionTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    usd: costUsd(model, promptTokens, completionTokens),
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
  return key ? text.split(key).join("[redacted]") : text;
}

/**
 * Set once the API rejects response_format. Live check on Oct 27 2026: the API ACCEPTS
 * { type: "json_object" } (and rejects unknown types with 400), so this normally stays false.
 * It exists so a future API change degrades to "no response_format + schema check" instead of failing.
 */
let responseFormatRejected = false;
export function _resetResponseFormatFlag(): void { responseFormatRejected = false; }

export function createMetaClient(opts: ClientOptions = {}) {
  const baseUrl = opts.baseUrl ?? META_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const usagePath = opts.usagePath ?? process.env.ATLAS_USAGE_PATH ?? DEFAULT_USAGE_PATH;

  function logUsage(role: ChatRole, model: string, usage: Usage, finishReason: string): void {
    const line = {
      ts: now().toISOString(),
      role,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      reasoningTokens: usage.reasoningTokens ?? null,
      usd: usage.usd,
      finishReason,
      priceVerified: priceFor(model).verified,
    };
    mkdirSync(dirname(usagePath), { recursive: true });
    appendFileSync(usagePath, JSON.stringify(line) + "\n");
  }

  type Attempt =
    | { kind: "ok"; content: string; finishReason: string; usage?: Usage }
    | { kind: "fail"; reason: string; status?: number; body?: string };

  async function once(args: ChatArgs, key: string, maxTokens: number, withFormat: boolean): Promise<Attempt> {
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
      res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
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
    const choice = json.choices?.[0];
    if (!choice) return { kind: "fail", reason: "response had no choices" };
    const finishReason = choice.finish_reason ?? "unknown";
    const usage = toUsage(args.model, json.usage);
    if (usage) logUsage(args.role, args.model, usage, finishReason);
    return { kind: "ok", content: choice.message?.content ?? "", finishReason, usage };
  }

  async function chat(args: ChatArgs): Promise<ChatResult> {
    const key = opts.apiKey ?? loadApiKey();
    if (!key) return { ok: false, reason: "no Meta API key: set META_API_KEY or ~/.config/meta-model-api/env" };

    let maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
    let total: Usage | undefined;
    let lengthRetried = false;

    for (;;) {
      const withFormat = !!args.json && !responseFormatRejected;
      let a = await once(args, key, maxTokens, withFormat);

      // The API refused response_format: remember it, resend without it, rely on the caller's schema check.
      if (a.kind === "fail" && withFormat && a.status === 400 && /response_format/i.test(a.body ?? "")) {
        responseFormatRejected = true;
        a = await once(args, key, maxTokens, false);
      }
      if (a.kind === "fail") return { ok: false, reason: a.reason, ...(total ? { usage: total } : {}) };

      total = addUsage(total, a.usage);
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
        return { ok: false, reason: why, ...(total ? { usage: total } : {}) };
      }
      if (!total) return { ok: false, reason: "response had no usage block, so the cost could not be logged" };
      return { ok: true, content: a.content, finishReason: a.finishReason, usage: total };
    }
  }

  return { chat };
}

/** Default client: real fetch, key from env or ~/.config, usage into tests/evidence/usage/usage.jsonl. */
export function chat(args: ChatArgs): Promise<ChatResult> {
  return createMetaClient().chat(args);
}
