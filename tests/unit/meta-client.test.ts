import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetResponseFormatFlag, createMetaClient, costUsd } from "../../server/meta/client";

const FAKE_KEY = "sk-fake-test-key-0123456789abcdef"; // secret-scan: allow (an obviously fake key)

interface Call { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const r = responses.shift();
    if (!r) throw new Error("mock: no more responses");
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function completion(content: string, finish: string, prompt = 26, completionTokens = 124, reasoning = 110) {
  return {
    status: 200,
    body: {
      choices: [{ message: { content }, finish_reason: finish }],
      usage: { prompt_tokens: prompt, completion_tokens: completionTokens, completion_tokens_details: { reasoning_tokens: reasoning } },
    },
  };
}

function setup(responses: Array<{ status: number; body: unknown }>) {
  const dir = mkdtempSync(join(tmpdir(), "atlas-meta-"));
  const usagePath = join(dir, "nested", "usage.jsonl");
  const { impl, calls } = mockFetch(responses);
  const client = createMetaClient({ apiKey: FAKE_KEY, fetchImpl: impl, usagePath, now: () => new Date("2026-10-27T12:00:00Z") });
  const lines = () => (existsSync(usagePath) ? readFileSync(usagePath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { client, calls, usagePath, lines };
}

const base = { role: "claimant" as const, model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "hi" }] };

beforeEach(() => _resetResponseFormatFlag());

describe("Meta client", () => {
  it("success: returns content, finish reason and usage priced per 1M tokens", async () => {
    const { client, calls } = setup([completion('{"ok":true}', "stop")]);
    const r = await client.chat({ ...base, json: true });
    expect(r).toEqual({
      ok: true,
      content: '{"ok":true}',
      finishReason: "stop",
      usage: { promptTokens: 26, completionTokens: 124, reasoningTokens: 110, usd: costUsd("muse-spark-1.3", 26, 124) },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(calls[0].body).toMatchObject({ model: "muse-spark-1.3", max_tokens: 16000, reasoning_effort: "low", response_format: { type: "json_object" } });
  });

  it("prices Wonder at $4 in / $20 out per 1M tokens", () => {
    expect(costUsd("muse-wonder-1.0", 1_000_000, 1_000_000)).toBe(24);
  });

  it("length retry: empty content + finish_reason length retries once at 32000 and sums usage", async () => {
    const { client, calls, lines } = setup([completion("", "length", 10, 16000, 16000), completion('{"a":1}', "stop", 10, 500, 400)]);
    const r = await client.chat(base);
    expect(calls.map((c) => c.body.max_tokens)).toEqual([16000, 32000]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toBe('{"a":1}');
      expect(r.usage.promptTokens).toBe(20);
      expect(r.usage.completionTokens).toBe(16500);
      expect(r.usage.reasoningTokens).toBe(16400);
    }
    expect(lines()).toHaveLength(2); // both billed calls are on file
  });

  it("length retry happens only once, then fails with a plain reason", async () => {
    const { client, calls } = setup([completion("", "length"), completion("", "length")]);
    const r = await client.chat(base);
    expect(calls).toHaveLength(2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/no content after retry at max_tokens 32000/);
      expect(r.usage?.completionTokens).toBe(248); // the spend is still reported
    }
  });

  it("API error: returns ok:false and the reason never contains the key, even if the server echoes it", async () => {
    const { client, lines } = setup([{ status: 401, body: { error: { message: `invalid key ${FAKE_KEY}`, type: "auth" } } }]);
    const r = await client.chat(base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/^HTTP 401/);
      expect(r.reason).not.toContain(FAKE_KEY);
      expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    }
    expect(lines()).toHaveLength(0); // no usage returned, nothing to log
  });

  it("network error and timeout return ok:false without the key", async () => {
    const impl = (async () => { const e = new Error(`boom Bearer ${FAKE_KEY}`); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
    const client = createMetaClient({ apiKey: FAKE_KEY, fetchImpl: impl, usagePath: join(mkdtempSync(join(tmpdir(), "atlas-meta-")), "u.jsonl") });
    const r = await client.chat(base);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
  });

  it("usage line: one JSON line per billed call with the agreed fields and no secrets", async () => {
    const { client, lines, usagePath } = setup([completion("x", "stop")]);
    await client.chat(base);
    const l = lines();
    expect(l).toHaveLength(1);
    expect(l[0]).toEqual({
      ts: "2026-10-27T12:00:00.000Z",
      role: "claimant",
      model: "muse-spark-1.3",
      promptTokens: 26,
      completionTokens: 124,
      reasoningTokens: 110,
      usd: costUsd("muse-spark-1.3", 26, 124),
      finishReason: "stop",
      priceVerified: false,
    });
    expect(l[0].usd).toBeGreaterThan(0);
    const raw = readFileSync(usagePath, "utf8");
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw.toLowerCase()).not.toContain("authorization");
  });

  it("if the API rejects response_format, it resends without it and keeps it off", async () => {
    const rejected = { status: 400, body: { error: { message: "`response_format` did not match any supported type", param: "response_format" } } };
    const { client, calls } = setup([rejected, completion("{}", "stop"), completion("{}", "stop")]);
    const r1 = await client.chat({ ...base, json: true });
    const r2 = await client.chat({ ...base, json: true });
    expect(r1.ok && r2.ok).toBe(true);
    expect(calls.map((c) => "response_format" in c.body)).toEqual([true, false, false]);
  });
});

// Review finding S8: chat() must never throw after a billed call, and a billed call is always logged.
describe("Meta client: usage logging never loses a billed call", () => {
  it("an unwritable usage file does not throw: it returns the result, the usage and a warning", async () => {
    const { impl } = mockFetch([completion("{}", "stop")]);
    const client = createMetaClient({ apiKey: FAKE_KEY, fetchImpl: impl, usagePath: "/dev/null/atlas-cannot-write-here/usage.jsonl" });
    const r = await client.chat(base);
    expect(r.ok).toBe(true);
    expect(r.usage?.promptTokens).toBe(26);
    expect(r.warning).toMatch(/usage line could not be written/);
    expect(r.warning).not.toContain(FAKE_KEY);
  });

  it("a 200 with usage but no choices still writes the usage line, then returns ok:false with the usage", async () => {
    const { client, lines } = setup([{ status: 200, body: { usage: { prompt_tokens: 500, completion_tokens: 9000 } } }]);
    const r = await client.chat(base);
    expect(r.ok).toBe(false);
    expect(r.usage?.completionTokens).toBe(9000);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ promptTokens: 500, completionTokens: 9000, finishReason: "no_choices" });
  });
});
