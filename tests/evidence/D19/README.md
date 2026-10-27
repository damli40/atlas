# D19: on Moonwell, Muse Spark gets exactly what the person sees before betting

Date: 2026-10-27 (WAT) · model `muse-spark-1.3` (bet-only) · `mida` not run · nothing written to `proofs/`.

## Where to look first

- **Spark declined all 3 times**, even with the fork block and its time. So all 3 verdicts are
  **can't check** (the bettor declined). The run read cbETH at **$1.12** (reference $2,206.68, control passed).
  Its three reasons, word for word:
  1. "unknown: no feed addresses or market price data provided for cbETH at fork block"
  2. "unknown: cannot determine post-proposal oracle price without executing fork simulation"
  3. "unknown: cannot read fork state or proposal feed addresses to determine reported price"
- What this means: the first decline (D04-04) said the fork block time was missing. With the block and
  its time now given, Spark still declines, and the reason moves to live prices and feed addresses,
  which the person does not see before the run either. Nothing was tuned after seeing these answers.
- **Cost: $0.0383** for 3 calls ($0.0113, $0.0142, $0.0129; 378 prompt tokens each, no repair tries).
  The running total in `usage.jsonl` is $3.40 of $150.
- The D04-04 decline stays recorded as it was. No proofs or refusals file was deleted or edited.

## What changed

One function, `moonwellBetContext()` in `src/bet-context.ts`, builds the "what the bettor sees" text.
The web bet screen (`web/screens/Moonwell.tsx`, `data-testid="bet-context"`) renders it after
"Show the question". The server (`seenContextFor()` in `server/app.ts`) passes the same string into
Spark's bet-only prompt (`seenContext` in `server/meta/roles/claimant-bets.ts`). Because both call
the same function on the same inputs, the screen and the prompt cannot drift apart.

The text holds:
- what will run (the Level 2 or Level 1 sentence that was already on screen),
- the fork block and the time it was made: 42194662, **2026-02-15 18:04:31 UTC** (Unix 1771178671),
- the question and its unit (USD), and the tolerance rule (within 10% of what the run reads),
- the chosen finding's file, line numbers and lines, plus who chose them ("picked by a person" or "found by <model>").

It never holds a model's claim (D18), a live price, a reference value or a feed answer. It has no
input that could carry one.

**Where the block times come from:** read once from Base on 2026-10-27 with `cast block <n> --field timestamp`
through the RPC in `~/.config/atlas/rpc.env`: 42194662 → 1771178671, 42194663 → 1771178673 (this
matches the known timestamp for 42194663). Stored as constants in `src/bet-context.ts`. A test checks
the block numbers equal the runner's `FORK_BLOCK` values.

## Before and after: Spark's prompt

Files: `prompt-before.txt` (the D04-04 prompt, rebuilt with the old code for the same line-42 finding),
`prompt-after.txt`, `prompt-diff.txt`.

| | Before (D04-04) | After (D19) |
|---|---|---|
| What will run | experiment JSON `{"shape":"apply-proposal-then-read","markets":"touched"}` plus the shape's description and the list of 14 markets | the screen's sentence: "Fork Base at block 42194662, one block before the proposal ran, apply the proposal's oracle-feed actions as the governor, then read the prices." |
| Fork block | **not given** | 42194662 on Base, made at 2026-02-15 18:04:31 UTC |
| Code | lines 22–62 (the finding ±20 lines) | line 42 only (the chosen finding's own lines, as the bet screen shows) |
| Question, unit, tolerance | question + answer JSON (unit and 10% inside the JSON) | question, "Answer in: USD", "Matched means within 10% of what the run reads", and the same answer JSON |
| Prices, reference, feed values | none | none |
| Prompt size | 1,067 tokens (D04-04 call) | 378 tokens |

## The three live answers

| Call | Spark's bet | Verdict (src/judge.ts) | Cost |
|---|---|---|---|
| 1 | declined: "no feed addresses or market price data provided for cbETH at fork block" | can't check | $0.0113 |
| 2 | declined: "cannot determine post-proposal oracle price without executing fork simulation" | can't check | $0.0142 |
| 3 | declined: "cannot read fork state or proposal feed addresses to determine reported price" | can't check | $0.0129 |

Run: one real Level 2 run on a fork of Base at block 42194662 (`live-run.json`): control passed;
14 oracle-feed actions applied as the governor; cbETH read `1122662744874806300` (≈ $1.12);
reference `2206683650838065175827` (≈ $2,206.68, raw Chainlink). All three bets were sealed before
the run started; the fork block is fixed, so one run serves all three. Files: `live-answers.jsonl`
(answers, rationales, seal hashes, usage, verdicts), `live-summary.json`, `live-output.txt`.

## Commands

| Command | Result |
|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/evidence/D19/live.ts )` | 3 calls, 3 declines, 1 run, $0.0383 |
| `pnpm test` (no RPC in env) | 32 files, 365 passed, 16 skipped (RPC tests skip) |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm gate:day1` | 18 matched / 1 didn't match / 1 can't check (unchanged) |
| `pnpm exec vite build` | built |

New test: `tests/unit/bet-context.test.tsx`. It drives the real Moonwell screen against the real
server (GitHub, the fork and the model are stand-ins), picks line 42, shows the question, then checks:
Spark's prompt begins with the heading followed by exactly the `bet-context` text the screen rendered;
the prompt has no experiment JSON, no market list and no wider code; after a run, none of the run's
numbers (measured, pre-apply, reference, USDC) and no dollar amount appear in the prompt; the only
numbers in the context are the block, its time, the tolerance, "1 cbETH" and the line number.

## What it proves

- On Moonwell, the screen and Spark's prompt now carry the same "what you know before betting" text,
  from one function, checked by a test.
- With that text, Spark declined 3 out of 3 times. Each bet was judged "can't check".

## What it does not prove, and what I am unsure about

- Three calls are a small sample. They do not show Spark would never bet with this context.
- **The code went from 41 lines to 1.** "The code lines of the chosen finding" taken literally is
  line 42 only. Before, Spark saw ±20 lines. The person can still open the whole file in "pick the
  lines yourself", so there the person can see more than Spark. If Dami wants the ±20 lines back on
  both sides, the change is in one function.
- Other things are on screen but not in the context: the PR line (ref, title "MIP-X43", merge commit,
  fingerprint, licences) and the Level 2 caption ("fork of Base one block before MIP-X43 ran…").
  I left them out because the D19 brief listed the contents exactly. Adding them would name MIP-X43 for Spark.
- An Investigator finding shown on screen also shows its claim sentence to the person. Spark never
  gets it (D18 overrides "same as the person").
- The fixture (withRpcRetry) prompt is unchanged. D19 is about Moonwell only.
