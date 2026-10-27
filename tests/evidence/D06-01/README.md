# D06-01 · Fixer + same-seed / same-block replay

Date: 2026-10-27. Branch `d06-fixer`. Live rounds driven in headless Chromium against the real server
(real Muse Spark bets, real `muse exec`, real Base fork), with `drive.mjs`.

## In plain words

After a round, the person can press **"Ask Muse Code for a change, then re-run"**. Muse Code (Meta's coding
agent) proposes a diff toward what the bettors expected. Plain code decides whether the diff is tried. If it is,
the **same experiment** runs again on the changed code (TS: **same seed**; EVM: **same fork block**), and
`src/judge.ts` judges the **same sealed bets** again. The page shows "Before change | After change", the diff
(only the diff) and the caption "changed toward what you expected, then re-run".

## Where to look

| File | What it is |
|---|---|
| `replay-ts.json`, `diff-ts.diff`, `ts-before-after.png` | The live TS round: Muse Code's change and the replay |
| `replay-evm.json`, `diff-evm.txt`, `evm-before-after.png` | The live Moonwell round: no usable change, nothing replayed |
| `pass-rule-replay.txt` | PASS-RULE.md rule 3, line by line |
| `cost.json` | Every usage line this task added, plus one probe not in the log |
| `run-ts.json`, `run-evm.json` | The original runs (POST /runs answers) |
| `try1/` | The first live TS try, kept: no usable change, and it ran on a contributor model (see below) |
| `browser-*.txt`, `test-output-*.txt`, `tsc-output.txt`, `gate-day1.txt`, `vite-build.txt` | Raw outputs |

## Results

**TS (withRpcRetry, row S6 "a call never answers"), run Gfn5pjlKRH, seed bf-5Cr93TU.**
Person's sealed bets: calls 5, total wait 12000 ms, outcome throws. Muse Spark's: 1, 0, pending.
Original run measured: calls 1, wait 0, outcome pending.
Muse Code (`muse exec`, model id reported `muse-spark-1.3`) proposed a 45-line change, accepted first try
(`diff-ts.diff`). What it does: after calling `fn`, it lets two microtask turns pass; a call still unanswered is
counted as failed and the loop moves on. That is a zero-length wait limit, not a timer.
Replay lRnGhlj5Z4, **same seed bf-5Cr93TU**: calls 5, waits 4 × 3000 = 12000 ms, **outcome throws** (measured).
Before → after, same six bets: the person's three went didn't match → matched; Spark's three went matched → didn't match.
The changed code still matches oracle rows S1 and S3 and differs on S6 (recorded, not a gate).

**EVM (Moonwell PR #578, Level 2), run UQQlK8-2S5 at 42194662.** cbETH $1.12, reference $2,206.68, 1 price source.
Person bet 2200 USD (didn't match); Spark declined (can't check).
Muse Code hit Atlas's 3-step cap while reading the PR files (100,596 input tokens, $0.41) and gave no answer.
The muse-spark-1.3 chat fallback then proposed two oracle names not in `chains/8453.json` (see `pass-rule-replay.txt`).
Recorded as "Muse Code (fallback muse-spark-1.3): no usable change (...)". Nothing replayed, so rule 3 is can't check.

**Cost:** $1.05 logged (usage.jsonl lines 43–52) + one $0.19 probe = **$1.24** (upper bound; Spark price unverified).

## How it works

- `server/meta/roles/fixer.ts`: `muse exec --json --api-key-stdin --workspace <scratch> --model muse-spark-1.3
  --contributor-mode off --disable-web-tools --disable-shell --disable-write --disable-request-user-input
  --approval-mode never --no-foreign-personal-context --disable-reminders --no-session-log --reasoning-effort low
  --max-model-steps 3 --max-tool-output-bytes 20000 --prompt-file <outside the workspace>`, with an empty HOME and
  only PATH in the environment. If it gives no answer, one muse-spark-1.3 chat with the same prompt. The log names
  the path and the model id. `toward` is written by plain code from the bets that did not match.
- `runners/change.ts` (plain code): unified diff of existing files only; only the editable files (TS: the target;
  Moonwell: only `proposals/ChainlinkOracleConfigs.sol`); ≤ 200 changed lines; TS: no added import of
  fetch/http/net/child_process/fs (and friends) and no `fetch(`; `git apply --check` in a scratch copy; Moonwell:
  the changed config is re-parsed by `runners/evm/apply.ts` and every `<name>_OEV_WRAPPER` must be in the PR's
  `chains/8453.json`. One repair try with the reason, then "no usable change".
- Hunk header counts are not trusted (`git apply --recount`): try 1 failed only on miscounted headers. The diff's
  text is never changed.
- TS replay (`runners/ts/control.ts`): same seed asserted, changed bytes in the same sandbox and harness.
- EVM replay (`runners/evm/runner.ts`): fork block copied from the original run and asserted equal; actions
  re-derived from the changed config; the 14 PR markets are read before and after on a fresh fork.

## Why the TS replay's control is a harness check, not the function's known rows

The control rows (S1, S3, S6) are known answers of the **original** function. A change toward the bets is meant to
make the function behave differently, so on the changed code those rows can stop matching *because the change did
what it was asked* (here S6 now throws). Gating on them would mark the replay "can't check" exactly when the change
worked, and writing new expected rows would mean deciding what the code should do, which Atlas never does.
So the replay is gated on the same control rows run on the **original bytes**, through the same harness files and
executor, just before the replay. That proves the harness still measures known cases exactly. The changed code's
results on those rows are recorded in the `replay_checks` trace event, never used as a gate.

## Changed interfaces (noted as the plan asks)

- `Runner.replayWithChange(run, change, ctx)`: `ctx.experiment` added, because a Run names its experiment only by id.
- `ModelBudget.track()` added so a non-chat call (muse exec) is counted against the same limits.
- `src/atlasfile.ts` now imports `node:fs` / `node:path` as namespaces and builds its path when used. Before this,
  the page failed to load in the browser at all (a named import from `node:fs` breaks Vite's browser stand-in).
- `vite.config.ts` reads `ATLAS_API_PORT` (default 8787) so a second dev server can run beside another worktree.

## What this proves

- The live Fixer path works end to end on the TS target: Muse Code's diff, plain-code checks, same-seed replay,
  same bets judged before and after, outcome changed from pending to throws (measured). The page never says "fixed".
- A name not in the address book becomes "no usable change", live, and nothing replays.
- Unit tests with mocked models: valid diff, forbidden file refused, unknown oracle name refused, forbidden imports,
  over-200 lines, chat fallback, same seed / same block assertions, POST /changes before/after, one change per run.
- With the RPC: the EVM replay mechanism (test-data diff, not a model's) re-applies at 42194662 and meets rule 3.

## What it does not prove

- No live EVM replay of a **model's** change happened. Rule 3 was not evaluated on one.
- Muse Code did not get a fair EVM try: the 3-step cap (chosen to keep spend under $2) ended it. More steps cost
  roughly $0.13 per step on this target.
- Muse Code's TS change gives up on any call not answered within two microtask turns. On a real RPC that answers
  after a few milliseconds, that would count every normal call as failed. Atlas only shows what it did on S6.
- The first TS try (`try1/`) reported model `muse-spark-1.3-contributor` although `--contributor-mode off` was
  passed. The fixture code and the prompt went to a model Meta may train on. `--model muse-spark-1.3` was added;
  the next runs reported `muse-spark-1.3`. Attempts answered by a contributor model are now flagged.
  In one plain sentence: on Oct 27 (08:53–08:54 UTC) two Muse Code calls, $0.34 together (lines 44–45 of
  `tests/evidence/usage/usage.jsonl`), sent the withRpcRetry fixture and the change prompt to
  `muse-spark-1.3-contributor`, a model Meta may train on; the fixture is public code, and since then Atlas
  refuses any contributor model id before and after every call.
- The replay is not yet written into `.atlas.json` (the proof file belongs to the D06-03 work).
- Cached input tokens are billed in `cost.json` at the full input price, so the cost is an upper bound.
