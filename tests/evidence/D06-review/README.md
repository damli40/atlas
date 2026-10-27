# D06-review: the day-6 adversarial review, finding by finding

Date: 2026-10-27. The review found 1 blocker, 9 should-fix and 9 minor problems in the day-6 work (waves,
proof card, Fixer and replay). Each one below says what went wrong before, what happens now, and which test
proves it. Every regression test was also run on the code BEFORE its commit; those runs failed, and the
outputs are kept here (`*-tests-on-old-code.txt`).

## Where to look first

- **B1 (the blocker)**: a one-line change could make Atlas record "throws" for code that really never
  answered. Now any change to JavaScript's built-ins makes the run "can't check". `b1-tests-on-old-code.txt`
  shows all five forges succeeding before.
- **S8**: Muse Code's own file tools **did read a file outside its workspace** when given an absolute path
  (`s8-live-probe-before.txt`, a canary file, no real secret). Inside the new OS sandbox the same request got
  "Operation not permitted" (`s8-live-probe-after.txt`).
- Final checks: `test-output-offline.txt` (639 passed, 17 skipped), `test-output-rpc.txt` (653 passed,
  3 skipped), `tsc-output.txt` (empty = no errors), `gate-day1.txt`, `vite-build.txt`. Secret scan over every
  tracked file: nothing found.

## Before / after

| Finding | Before | After | Test (old-code run) |
|---|---|---|---|
| **B1** record forgeable | A setter on `Object.prototype.outcome`, a patched `Array.prototype.push`, `JSON.stringify` or `Promise.prototype.then`, or a patch put back later, rewrote the record and still passed the harness check | The worker copies the built-ins it needs before the code loads (`runners/ts/primordials.ts`), records into objects with no prototype, and compares every built-in object with a snapshot each time the code hands control back and before writing. Any change: no result is sent; "the code under test changed JavaScript's built-in objects, so Atlas's record of this run cannot be trusted"; `controlPassed` and the replay's `harnessCheck.passed` are false; every verdict is can't check | `review-day6-b1.test.ts` (`b1-tests-on-old-code.txt`: 5 of 5 forges passed before) |
| **S1** replay not re-checked | Editing the replay's measured values, deleting its trace, or a failed harness check with `controlPassed: true` all verified | Verify adds up the TS trace (calls, waits, log lines, outcome) for the original and the replay, ties `harnessCheck.passed` to `controlPassed`, checks the replay names the run, change, seed and changed code, its times are in order, and the change caption is present | `review-day6-verify.test.ts` |
| **S2** "Re-run it" | Re-ran only the original run, then said "same result ✓" under the before / after table | `GET /replay` re-runs the change replay too; "same result ✓" only when both match, otherwise which one differed | `review-day6-verify.test.ts` |
| **S3** zero-context hunks | git and verify placed an added line one line apart; a hunk past the end of the file was accepted | One reader places every hunk (`src/diff.ts placeHunks`), used by the run and by verify; git must give the same bytes. A hunk with only added lines, a hunk past the end, or an ambiguous place is refused with a reason; the Change screen says when the proof file could not take a change | `review-day6-checks.test.ts`, `review-day6-ui.test.tsx` |
| **S4** contributor guard | Only an exact "-contributor" ending, only the first model id, unknown ids allowed, checked after sending | Allow-list of the three Meta ids; "contributor" anywhere refused; every reported id and stdout/stderr checked; no id reported means not used; a no-code preflight shows the model before code is sent. A refusal after the run says it cannot un-send the code | `review-day6-fixer.test.ts` |
| **S5** model text in Atlas's voice | A path like "the original code had a bug and this is fixed" appeared inside Atlas's sentence | Paths and oracle names from the model are quoted only when they are a target file or read like an address-book name; git's text is reduced to a known file and a line; the screen shows the file in a code element | `review-day6-checks.test.ts`, `review-day6-ui.test.tsx` |
| **S6** pre-existing label | Missing on the proof card | On the card's title and above the diff | `review-day6-ui.test.tsx` |
| **S7** waves gate | The chart's gate never ran the sweep code | `runSweep` must land oracle row S3's call times exactly with 1 and 3 callers, or the chart is not shown | `review-day6-ui.test.tsx` |
| **S8** Muse Code's reach | Absolute-path reads worked (live probe); raw answer unscrubbed and sent to the browser | macOS `sandbox-exec` profile: no file contents under the home folder, `/private/tmp` or `/private/var/folders` except its workspace, its empty HOME and its install folder (file names stay visible). No OS sandbox: muse exec is not run. Env: PATH, empty HOME, TMPDIR, `MUSE_NO_AUTO_UPDATE=1`; key on stdin. `--approval-judge off`. Answer scrubbed, never returned to the browser; a diff holding a secret shape is refused | `review-day6-fixer.test.ts`; live: `s8-live-probe-*.txt` |
| **S9** import screen | `getBuiltinModule`, computed `import()`, `globalThis["fet"+"ch"]`, `createRequire` passed | Any import, require, createRequire, getBuiltinModule, eval, Function constructor, `.constructor`, globalThis, computed global access, `process.*`, fetch is refused. The comments say this is a screen; the sandbox is the boundary | `review-day6-checks.test.ts` |
| M1 | "one repair try", "(Fixer)" | "one more try", "Change proposed by <model>" | `review-day6-ui.test.tsx` |
| M2 | Caption always claimed "the same fixed schedule"; "1 callers" | Full caption only when every caller kept one schedule; plurals | `review-day6-ui.test.tsx` |
| M3 | A lone carriage return could hide code | Refused | `review-day6-checks.test.ts` |
| M4 | Parser and git read `--- a/x` inside a hunk differently | A hunk ends only at `@@ ` or `diff `, as git does | `review-day6-checks.test.ts` |
| M5 | No per-address cap on sweeps | 120 an hour per client address (env `ATLAS_SWEEPS_PER_IP_PER_HOUR`) | `review-day6-ui.test.tsx` |
| M6 | A failed replay was cached forever; the model-round slot was spent before the fork slot | Not cached; fork slot taken first | `review-day6-verify.test.ts` |
| M7 | Budget counts `muse exec` as one call | **Not done.** Counting steps needs a budget change, and charging an estimated cost when muse reports none would write a made-up line into the usage log | none |
| M8 | Any text in `proposedBy.model` | A model id shape only | `review-day6-verify.test.ts` |
| M9 | (no finding) | | |

## What changed in wording (said plainly)

- Earlier evidence said Muse Code could "read those files" in its workspace and implied it could read nothing
  else. That was wrong: the live probe shows muse's own policy let an absolute-path read through. The OS
  sandbox, not muse's flags, is what now keeps it in.
- The old refusal for `cbETH_ORACLE` ("no usable change") now applies only to names with neither a wrapper
  nor a feed entry; D20 makes `cbETH_ORACLE` usable in a labelled theoretical mode (see `../D20/`).

## Limits

- The built-in snapshot guards the RECORD. Code in the same process can still do things it does not look
  at; the sandbox stays the security boundary.
- The OS sandbox exists on macOS only. Elsewhere muse exec does not run and the chat fallback is used.
  File names and sizes outside the workspace are still visible to Muse Code.
- The preflight costs one muse exec step (about $0.09 measured), on every Fixer run.
- Live spend for this work: $0.58 (probe before $0.30, preflight $0.09, probe after $0.19), all in
  `tests/evidence/usage/usage.jsonl` (roles `s8-probe`, `s8-preflight`, `s8-probe-after`).
