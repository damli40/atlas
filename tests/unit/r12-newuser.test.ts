// R12 (D73): the new-user review's server-side findings, one test (or more) each. Every model mocked (fake fetch or
// fake chat); no network, no key, $0. Every store in a temp folder.
// - Finding 2: a network error before any response settles at $0 and is retried once; a timeout or a cut-off answer
//   keeps its worst case.
// - Finding 3: the hourly limit says when it frees up; fly.toml sets 400 calls an hour (100 per code).
// - Findings 4 + 5: a file the parser can't read (syntax error, prose, Java, Solidity, Bash, Markdown, JSON, a URL) is
//   answered by plain code with no model call, with the parser's line and column for a syntax error.
// - Finding 6: the proof card's short seal is the person's bet, whatever order the bets are in.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAs, type Principal } from "../../server/access/context";
import { openLedger } from "../../server/access/ledger";
import { openInviteStore } from "../../server/access/store";
import { createApp } from "../../server/app";
import { createModelBudget, type ModelBudget } from "../../server/meta/budget";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMetaClient, neverConnected, NO_RESPONSE_WORDS, type ChatArgs, type ChatResult } from "../../server/meta/client";
import { OUTLINER_TIMEOUT_MS } from "../../server/wiring";
import { firstTryUsd } from "../../server/meta/pasted-guard";
import { plainLimit } from "../../src/paste-words";
import { jsSyntaxProblem, precheckPaste, pySyntaxProblem } from "../../src/paste-precheck";
import { foreignLanguage } from "../../src/paste-language";
import { personSealHash } from "../../web/screens/ProofImage";
import { SAMPLE_FILES } from "../../web/sample-files";
import { U1_EXAMPLE } from "../../web/u1-example";
import { ENV, tmp } from "../tools/g1-fixtures";

const ROOT = resolve(import.meta.dirname, "..", "..");

function pair(o: { callsPerHour?: number; devCallsPerHour?: number; now?: () => number } = {}) {
  const dir = tmp();
  const store = openInviteStore(dir, { env: ENV });
  const dev = store.create({ label: "dev-ada" }).invite;
  let budget: ModelBudget | undefined;
  const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, ownerReserveUsd: 20, modelSpentUsd: () => budget!.spentUsd() });
  budget = createModelBudget({ spendCeilingUsd: 100, guard: ledger, callsPerHour: o.callsPerHour ?? 60, ...(o.devCallsPerHour !== undefined ? { devCallsPerHour: o.devCallsPerHour } : {}), ...(o.now ? { now: o.now } : {}) });
  const asDev = <T,>(f: () => T) => runAs({ kind: "invite", id: dev.id, label: dev.label, role: "dev", route: "test" } as Principal, f);
  return { dir, ledger, budget: budget!, asDev, devId: dev.id };
}
const args = { role: "claimant" as const, model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "hello" }] };
const OK_BODY = JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });

describe("R12 finding 2: what a failed model call costs", () => {
  it("a connection that never opened (DNS: ENOTFOUND), twice: $0 on the ledger and the budget, 2 tries, the plain sentence, no hourly call used", async () => {
    const s = pair({ callsPerHour: 8, devCallsPerHour: 2 });
    let sent = 0;
    const fetchImpl = (async () => {
      sent++;
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.example"), { code: "ENOTFOUND" }) });
    }) as unknown as typeof fetch;
    const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl, usagePath: join(s.dir, "usage.jsonl") }).chat);
    // 8 failed calls: the review's case ($2.68 charged for 8 failures on a $3 code).
    for (let i = 0; i < 8; i++) {
      const r = await s.asDev(() => chat(args));
      expect(r).toMatchObject({ ok: false, reason: NO_RESPONSE_WORDS, noResponse: true });
    }
    expect(sent).toBe(16); // each call tried twice
    expect(s.ledger.today(s.devId).spentUsd).toBe(0);
    expect(s.ledger.today(s.devId).heldUsd).toBe(0);
    expect(s.budget.spentUsd()).toBe(0);
    // A code with 2 calls an hour can still make a call: none of the 8 counted.
    const ok = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl: (async () => new Response(OK_BODY, { status: 200 })) as unknown as typeof fetch, usagePath: join(s.dir, "usage.jsonl") }).chat);
    expect((await s.asDev(() => ok(args))).ok).toBe(true);
  });

  it("connect refused (a real closed local port), then an answer: one automatic retry, only the answer's real cost is booked", async () => {
    const s = pair();
    // A port nothing listens on: Node's own fetch fails with ECONNREFUSED before anything is sent.
    const closed = await new Promise<number>((done) => {
      const srv = createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = (srv.address() as AddressInfo).port;
        srv.close(() => done(port));
      });
    });
    let sent = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent++;
      if (sent === 1) return fetch(`http://127.0.0.1:${closed}/chat/completions`, init);
      return new Response(OK_BODY, { status: 200 });
    }) as unknown as typeof fetch;
    const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl, usagePath: join(s.dir, "usage.jsonl") }).chat);
    const r = await s.asDev(() => chat(args));
    expect(r.ok).toBe(true);
    expect(sent).toBe(2);
    expect(s.ledger.today(s.devId).spentUsd).toBeCloseTo((1000 * 4 + 100 * 20) / 1e6, 9);
  });

  it("a connection dropped AFTER the whole request was read (a real local server): worst case, exactly one request, no retry, no 'nothing was charged'", async () => {
    const s = pair({ callsPerHour: 8, devCallsPerHour: 2 });
    let requests = 0;
    const srv = createServer((req) => {
      requests++;
      req.on("data", () => {});
      req.on("end", () => req.socket.destroy()); // read the whole prompt, then hang up without a word
    });
    await new Promise<void>((done) => srv.listen(0, "127.0.0.1", () => done()));
    const port = (srv.address() as AddressInfo).port;
    try {
      const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", baseUrl: `http://127.0.0.1:${port}`, usagePath: join(s.dir, "usage.jsonl") }).chat);
      const r = await s.asDev(() => chat(args));
      expect(r).toMatchObject({ ok: false, costUnknown: true });
      expect("noResponse" in r).toBe(false);
      expect((r as { reason: string }).reason).not.toMatch(/nothing was charged/i);
      expect(requests).toBe(1);
      expect(s.ledger.today(s.devId).spentUsd).toBeCloseTo(firstTryUsd(args), 9);
    } finally {
      await new Promise<void>((done) => srv.close(() => done()));
    }
  });

  it("an error with no code, or a reset after connecting (ECONNRESET, UND_ERR_SOCKET): worst case, one try", async () => {
    for (const cause of [undefined, Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })]) {
      const s = pair();
      let sent = 0;
      const fetchImpl = (async () => {
        sent++;
        throw new TypeError("fetch failed", cause ? { cause } : undefined);
      }) as unknown as typeof fetch;
      const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl, usagePath: join(s.dir, "usage.jsonl") }).chat);
      const r = await s.asDev(() => chat(args));
      expect(r, String(cause?.message)).toMatchObject({ ok: false, costUnknown: true });
      expect(sent).toBe(1);
      expect(s.ledger.today(s.devId).spentUsd).toBeCloseTo(firstTryUsd(args), 9);
    }
    // The never-connected list, by code: DNS, refused, connect timeout, TLS certificate; and happy-eyeballs (every address refused).
    for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT"]) expect(neverConnected(new TypeError("fetch failed", { cause: { code } })), code).toBe(true);
    expect(neverConnected(new TypeError("fetch failed", { cause: { errors: [{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }] } }))).toBe(true);
    expect(neverConnected(new TypeError("fetch failed", { cause: { errors: [{ code: "ECONNREFUSED" }, { code: "ECONNRESET" }] } }))).toBe(false);
    for (const code of ["ECONNRESET", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "EPIPE", "SOMETHING_NEW"]) expect(neverConnected(new TypeError("fetch failed", { cause: { code } })), code).toBe(false);
  });

  it("the outline call's own timeout (290 s) fires before Node's 300 s wait for response headers", () => {
    expect(OUTLINER_TIMEOUT_MS).toBeLessThan(300_000);
  });

  it("a timeout (the request may have been accepted) is still its worst case, and is not retried", async () => {
    const s = pair();
    let sent = 0;
    const fetchImpl = (async () => {
      sent++;
      throw Object.assign(new Error("aborted due to timeout"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl, usagePath: join(s.dir, "usage.jsonl") }).chat);
    const r = await s.asDev(() => chat(args));
    expect(r).toMatchObject({ ok: false, costUnknown: true });
    expect("noResponse" in r).toBe(false);
    expect(sent).toBe(1);
    expect(s.ledger.today(s.devId).spentUsd).toBeCloseTo(firstTryUsd(args), 9);
  });

  it("an answer cut off mid-body (headers came, the body broke) is still its worst case", async () => {
    const s = pair();
    const fetchImpl = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"choices":[{"mess'));
          c.error(new Error("other side closed"));
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl, usagePath: join(s.dir, "usage.jsonl") }).chat);
    const r = await s.asDev(() => chat(args));
    expect(r).toMatchObject({ ok: false, costUnknown: true });
    expect(s.ledger.today(s.devId).spentUsd).toBeCloseTo(firstTryUsd(args), 9);
  });
});

describe("R12 finding 3: calls an hour per code, and when the limit frees up", () => {
  it("the limit's reason says when the next call frees up, and the page's sentence keeps it", async () => {
    let t = Date.parse("2026-11-03T10:00:00Z");
    const s = pair({ callsPerHour: 400, now: () => t });
    const chat = s.budget.wrap(async (): Promise<ChatResult> => ({ ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.0001 } }));
    for (let i = 0; i < 100; i++) {
      expect((await s.asDev(() => chat(args))).ok).toBe(true);
      t += 6_000; // one call every 6 s: 100 calls in 10 minutes
    }
    const over = await s.asDev(() => chat(args));
    expect(over).toMatchObject({ ok: false, reason: "call limit reached: this invite may make 100 model calls an hour. The next one frees up in about 50 min" });
    expect(plainLimit(`not asked (${(over as { reason: string }).reason})`)).toBe("Your invite code has used this hour's 100 AI calls. The next one frees up in about 50 min.");
  });

  it("the per-address limit's sentence ends its 'frees up' clause with a full stop (it ran into the next sentence)", () => {
    expect(plainLimit("not asked (call limit reached: one client address may ask for 20 model rounds an hour. The next one frees up in about 42 min)")).toBe("You've used this hour's 20 model rounds. The next one frees up in about 42 min.");
  });

  it("fly.toml sets ATLAS_MODEL_CALLS_PER_HOUR to 400 (100 an hour for each invite code)", () => {
    const toml = readFileSync(join(ROOT, "fly.toml"), "utf8");
    expect(toml).toMatch(/^\s*ATLAS_MODEL_CALLS_PER_HOUR = "400"$/m);
    expect(toml).toMatch(/^\s*ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR = "60"$/m);
    expect(toml).toMatch(/^\s*ATLAS_PASTES_PER_IP_PER_HOUR = "150"$/m);
  });
});

describe("R12 findings 4 + 5: plain code reads the file before any model is asked", () => {
  const D = join(ROOT, "tests/fixtures/r12");
  const read = (f: string) => readFileSync(join(D, f), "utf8");

  it("syntax errors come back with the parser's line, column and message", () => {
    expect(jsSyntaxProblem(read("syntax.js"), "js")).toEqual({ line: 3, column: 26, message: "')' expected." });
    expect(jsSyntaxProblem(read("syntax-ts.txt"), "ts")).toEqual({ line: 2, column: 21, message: "Expression expected." });
    expect(pySyntaxProblem(read("syntax.py"))).toEqual({ line: 1, column: 17, message: 'expected ":" at the end of this `def` line.' });
    expect(pySyntaxProblem("def f():\nreturn 1\n")).toMatchObject({ line: 1, message: "expected an indented block after this `def` line." });
    expect(pySyntaxProblem("x = 'open\n")).toMatchObject({ line: 1, message: "an unclosed string starts on line 1." });
    const w = precheckPaste(read("syntax.js"), "js");
    expect(w).toMatchObject({ kind: "syntax", line: 3, column: 26 });
    expect(w!.words).toMatch(/^Atlas's parser can't read this JavaScript file: line 3, column 26: '\)' expected\. .*Nothing was sent to Meta's AI\.$/);
  });

  it("each kind of file that isn't JS/TS/Python code is named, and nothing else is refused", () => {
    expect(precheckPaste(read("Main.java"), "js")).toMatchObject({ kind: "foreign", language: "Java" });
    expect(precheckPaste(read("token.sol"), "js")).toMatchObject({ kind: "foreign", language: "Solidity" });
    expect(precheckPaste(read("script.sh"), "js")).toMatchObject({ kind: "foreign", language: "a shell script (Bash)" });
    // R12 review: shell words inside a JS template literal (or a comment) are not a shell script.
    const tpl = "export function script(x) {\n  return `if [ -f x ]; then\necho hi\nfi\n`;\n// done\n}\n}\n";
    expect(foreignLanguage(tpl)).toBeNull();
    expect(precheckPaste(tpl, "js")).toMatchObject({ kind: "syntax" });
    expect(foreignLanguage("if [ -f x ]; then\n  echo hi\nfi\n")).toBe("a shell script (Bash)");
    expect(precheckPaste("fun main() {\n  println(\"hi\")\n}\n", "js")).toMatchObject({ kind: "foreign", language: "Kotlin" });
    expect(precheckPaste("#include <stdio.h>\nint main(void) { return 0; }\n", "js")).toMatchObject({ kind: "foreign", language: "C or C++" });
    expect(precheckPaste("func greet(name: String) -> String {\n  return name\n}\n", "ts")).toMatchObject({ kind: "foreign", language: "Swift" });
    expect(precheckPaste(read("prose.txt"), "js")).toMatchObject({ kind: "prose" });
    expect(precheckPaste('{"a": [1, 2]}', "js")).toMatchObject({ kind: "data" });
    expect(precheckPaste("https://github.com/sindresorhus/is-odd/blob/main/index.js", "js")).toMatchObject({ kind: "address" });
    const md = precheckPaste(read("readme.md"), "js");
    expect(md).toMatchObject({ kind: "markdown", fenced: { language: "js", code: "export function add(a, b) { return a + b; }\n" } });
    expect(precheckPaste("# Notes\n\n```\nnot ( code\n```\n", "js")).toMatchObject({ kind: "markdown" });
    expect(precheckPaste("# Notes\n\n```\nnot ( code\n```\n", "js")).not.toHaveProperty("fenced");
    // JSX parses but can't run here: said plainly, with the tag's line (the runner's scanner had called it an unclosed regular expression).
    expect(precheckPaste(read("component-jsx.txt"), "js")).toMatchObject({ kind: "jsx", line: 6 });
    // A TypeScript generic arrow, a type assertion and comparisons are not JSX.
    for (const c of ["export const f = <T,>(x: T): T => x;\n", "export function g(y: unknown) { const s = <string>y; return s.length; }\n", "export function h(a: number, b: number) { return a < b && b > 0; }\n"]) expect(precheckPaste(c, "ts"), c).toBeNull();
    // Never refused: the example, every sample, Python with lambdas and one-line blocks.
    expect(precheckPaste(U1_EXAMPLE, "ts")).toBeNull();
    for (const f of SAMPLE_FILES) expect(precheckPaste(f.code, f.language as "js" | "ts" | "py"), f.id).toBeNull();
    // A TSX file read as TypeScript is not called a syntax error: it is named as JSX.
    expect(precheckPaste("export function A(p: { n: number }) {\n  return <div>{p.n}</div>;\n}\n", "ts")).toMatchObject({ kind: "jsx", line: 2 });
    expect(precheckPaste("def f(xs):\n    if xs: return sorted(xs, key=lambda x: x[0])\n    for x in xs: pass\n    return None\n\nclass A: pass\n", "py")).toBeNull();
    expect(precheckPaste("match = 3\ncase = match + 1\ntype = 'x'\n", "py")).toBeNull();
  });

  it("POST /paste answers a file it can't read with `precheck` and no target to ask about; prose and a syntax error ask no model, end to end", async () => {
    let calls = 0;
    const chat = async (_a: ChatArgs): Promise<ChatResult> => {
      calls++;
      return { ok: false, reason: "should not be called", notSent: true };
    };
    const app = createApp({ modelBets: { chat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: false, reason: "test" } }, paste: { proposer: { chat } } });
    const H = { "content-type": "application/json", "x-atlas-session": "ss_r12_precheck" };
    for (const f of ["syntax.js", "syntax-ts.txt", "syntax.py", "prose.txt", "Main.java", "token.sol", "script.sh", "readme.md"]) {
      const res = await app.request("/paste", { method: "POST", headers: H, body: JSON.stringify({ code: read(f) }) });
      const a = (await res.json()) as { runnable: boolean; precheck?: { kind: string }; outline?: unknown; target: { codeSha256: string } };
      expect(res.status, f).toBe(200);
      expect(a.runnable, f).toBe(false);
      expect(a.precheck, f).toBeDefined();
      expect(a.outline, f).toBeUndefined();
      // The file was not kept: asking about it is refused by plain code, still with no model call.
      for (const route of ["/paste/names", "/paste/summary"]) {
        const r2 = await app.request(route, { method: "POST", headers: H, body: JSON.stringify({ target: { kind: "pasted", ref: "pasted", codeSha256: a.target.codeSha256 } }) });
        expect(r2.status, `${f} ${route}`).toBeGreaterThanOrEqual(400);
      }
    }
    expect(calls).toBe(0);
    // A TypeScript file with no TypeScript sign but `new Set<string>()` is read as TypeScript, not refused as JavaScript.
    const ts = await app.request("/paste", { method: "POST", headers: H, body: JSON.stringify({ code: "export function f() {\n  const s = new Set<string>();\n  return s.size;\n}\n" }) });
    const tsA = (await ts.json()) as { runnable: boolean; language: { chosen: string } };
    expect(tsA).toMatchObject({ runnable: true, language: { chosen: "ts" } });
  });
});

describe("R12 finding 6: the proof card's seal is the person's", () => {
  it("picks the human bet's hash even when a model's bet comes first; none when the person placed no bet", () => {
    const bets = [
      { who: "model:muse-spark-1.3", sealedHash: "aaaaaaaaaaaaaaaaaaaa" },
      { who: "human", sealedHash: "bbbbbbbbbbbbbbbbbbbb" },
      { who: "model:meta-models/muse-spark-open-1026", sealedHash: "cccccccccccccccccccc" },
    ];
    expect(personSealHash(bets)).toBe("bbbbbbbbbb");
    expect(personSealHash(bets.filter((b) => b.who !== "human"))).toBe("");
  });
});
