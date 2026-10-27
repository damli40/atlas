# D01-07: Meta API client and Muse Code CLI check

Date: 2026-10-27 (WAT). Node 25.8.1, pnpm 12.4.1, Muse Code 1.4.13.

## What was built

`server/meta/client.ts` exports one function, `chat({ role, model, messages, json?, maxTokens?, reasoningEffort? })`.
It sends one OpenAI-style request to `https://api.meta.ai/v1/chat/completions` and returns either
`{ ok: true, content, finishReason, usage }` or `{ ok: false, reason }`. It never throws for API trouble.

- Defaults: `max_tokens` 16000, `reasoning_effort` "low", `temperature` 0.2, a 120-second timeout.
- If the reply is empty and `finish_reason` is "length" (the model spent its whole budget thinking),
  it retries once with `max_tokens` 32000. A second empty reply returns `ok: false`.
- After every call that comes back with token counts it appends one line to
  `tests/evidence/usage/usage.jsonl`: `{ts, role, model, promptTokens, completionTokens, reasoningTokens, usd, finishReason, priceVerified}`.
  A length retry therefore writes two lines, because both calls are billed. The usage it returns is the sum.
- Error reasons have the key cut out before they leave the module, even if the server echoes it back.
  The client logs nothing else and never logs headers.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/meta-client.test.ts --reporter=verbose` | `test-output.txt` | 8 tests passed (mocked network) |
| `pnpm exec tsc --noEmit` | `tsc-output.txt` | no errors |
| `pnpm exec tsx tests/evidence/D01-07/live-call.ts` | `live-call.json`, `../usage/usage.jsonl` | `finish_reason` "stop", 1 usage line, usd 0.003092 |
| `node tests/evidence/D01-07/key-scan.mjs tests/evidence server tests/unit` | (printed) | `not found` |
| `grep -rn "META_""API_KEY" tests/evidence` | (printed) | no matches |
| `~/.local/bin/muse --help` and `muse exec --help` | `muse-help.txt` | see below |

`key-scan.mjs` loads the real key and reports only whether it appears in any file. It never prints the key.

## Live call

One `muse-spark-1.3` request ("Return exactly {"ok": true}", `response_format` json_object) returned
`{"ok": true}` with `finish_reason` "stop": 23 prompt tokens, 150 completion tokens (136 of them hidden
reasoning). Logged cost **$0.003092**, using the unverified Spark price below.

Two earlier probe calls (before the client existed) are not in usage.jsonl: one `muse-spark-1.3`
call of 26 + 124 tokens (about $0.003) and one rejected call (HTTP 400, no tokens). So D01-07 spent
roughly $0.006 in total, plus a free `GET /v1/models`.

## Findings

**`response_format: {type: "json_object"}` is accepted.** The API answered 200 and returned valid JSON.
A second probe with `{type: "bogus_format"}` got HTTP 400 "`response_format` did not match any supported type",
so the API does check this field and `json_object` is one of its known values. This does not prove the
model is forced to produce JSON on hard prompts, so callers must still parse and schema-check.
The client keeps a fallback: if the API ever rejects `response_format`, it resends without it and
stops sending it for the rest of the process.

**Spark price is UNVERIFIED.** `GET /v1/models` lists model ids only (no prices). No other source was found.
The client uses a named constant `SPARK_PRICE_UNVERIFIED` set equal to Wonder's price ($4 in / $20 out per 1M),
so logged Spark costs are an upper bound if Spark is cheaper. Each usage line carries `priceVerified: false` for Spark.
Wonder's $4 / $20 is the published price.

**Muse Code has a non-interactive mode: `muse exec`.** `muse exec --help` says "run one prompt non-interactively
(headless)". Useful flags for the Fixer: `--json` (JSONL events on stdout), `--prompt-file`, `--model`,
`--reasoning-effort` (default high), `--workspace`, `--output-schema`, `--max-model-steps`, `--approval-mode`
(top-level), `--no-session-log`. Only `--help` and `--version` were run; no session was started and no file edited.

## What it proves

- The client builds the request the build plan specifies and handles success, one length retry, a second
  empty reply, HTTP errors, network errors and timeouts, and a rejected `response_format`, all against a mocked network.
- A fake key placed in a server error message and a thrown error does not appear in the returned reason or in usage.jsonl.
- One real call works end to end and writes one priced usage line.
- The real key is in no file under `tests/evidence`, `server` or `tests/unit` at the time of the scan.

## What it does not prove

- That `response_format` forces valid JSON on longer prompts. One trivial request cannot show that.
- That the Spark cost is right. It is an assumed upper bound.
- That the 120-second timeout fits a large Investigator call on Wonder. Not tried.
- That `muse exec` produces a usable unified diff, or that it respects a workspace sandbox. Not run.
- Calls that fail with no token counts (timeouts, HTTP errors) write no usage line. If Meta bills a call
  that timed out on our side, that spend is not on file.
