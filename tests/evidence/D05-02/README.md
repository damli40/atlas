# D05-02 · The retry machine (an Anatomy "Figure", 75 parts)

**What this is, in plain words.** After "Break it" on the withRpcRetry fixture, the run screen shows a small machine on a bench that replays what the run's trace recorded:
- The **dispatch station** sends one **capsule** up the **tube** for every call.
- What drops out of the **return chute** onto the rack is what that call did. A slash across the cap means it threw; a dot means it returned a value. A call that never answered sends nothing back, so the chute stays empty.
- The **retry lever** is pulled once for every call after the first, and a mark lights on the pull counter each time.
- The **wait drum** turns once for every wait the code asked for. It is engraved "3 s (virtual)", because the run's clock is virtual and nothing waited for real.
- **Ghost markers** on the rack's ruler show the bets on how many calls there would be (solid = you, ring = the model). They come from `Bet[]` only, and a matched bet's marker turns dark when the run ends.

Input is `{ run, bets, verdicts }` and nothing else. The files follow Anatomy's React split:
- `model.ts`: a pure function from the input to every part's state, plus the readout and caption text.
- `geometry.ts`: world layout, camera, every static path, and the parts list.
- `art.tsx`: the static parts as JSX.
- `live.tsx`: one loop that moves parts through refs.
- `RetryMachine.tsx`: the card around it.

How the run ended, when it did not return or throw, is a **caption under the card**, never a part of the machine.

## What this proves
- `test-output.txt` (`tests/unit/machines-retry.test.tsx`, 7 tests; the runs are made fresh through the real server in the test):
  - `model.ts`'s only import is `import type { Bet, Run, Verdict }`.
  - **Manifest** (`manifest.txt`): 75 parts. Every `data-part` drawn is in the list and every listed part is drawn. No part name or class name contains timer, timeout, clock, abort or backoff.
  - **S3** (a real run): readout `calls 5 · waits 4 × 3,000 ms · threw the 5th error`. The test also counts these straight from the trace, separately from `model.ts`: 5 `call` events, 4 `sleep` events of 3000, and the thrown error equals the 5th call's error. It also finds 5 capsules marked "threw", 4 pull marks, 4 turn marks, exactly 4 lever pulls across the whole animation, and the 5th capsule lit at the end.
  - **S6** (a real run): the lever stays at 0 at every sampled moment, there are 0 retries, and the readout is `calls 1 · waits 0 · still pending`. The caption under the card reads "Still pending when Atlas stopped watching: nothing was left that could wake it (…). 0 retries." The drawing itself contains no "watch" or "limit".
  - **Watch limit**: a run that really hit Atlas's 30,000 ms virtual watch limit (made with `runScenario`) gets the caption "Still pending at Atlas's watch limit: … 0 retries so far."
  - **Ghosts**: with no bets there are no markers. From the D04-04 bets: you at slot 5, Spark at slot 5, both matched. A bet past the ruler's 8 slots is drawn at the end, and the caption says so.
  - **Reduced motion**: the first paint is the end state (every capsule in its slot, the final readout, the lever at rest).
- `lines-output.txt`: Anatomy `scripts/lines.mjs` prints **`line ends: 0`** on all 16 built pages: 8 states × dark and light. That covers the S3 (two rounds), S6 and S2 end states, plus held moments mid-send, mid-return, mid-wait and mid-pull.
- PNGs, captured with Anatomy `scripts/capture.mjs`: `retry-S3-person-and-spark{,-light}-{desktop,390}.png`, `retry-S6{,-light}-{desktop,390}.png` and `retry-S3-mid-pull-light-desktop.png`.
- `live-contact-sheet.png`: the real component running in headless Chrome (a throwaway Vite page, not committed, mounting `RetryMachine` with the D04-04 run). 14 frames 700 ms apart, with the readout counting up. The same session ended on exactly `calls 5 · waits 4 × 3,000 ms · threw the 5th error`, printed `line ends: 0` at the end state and again 2.6 s into a replay, and logged no console errors.
- `runs.json`: the traces, measured values, bets and verdicts each page was drawn from.

## What this does not prove, and where it differs from the brief
- **S6 wording differs from the plan, on purpose.** The plan asked for "still pending at Atlas's watch limit, 0 retries". The real S6 trace does not end at the watch limit. The harness stops because nothing is left that could wake the function (trace event `pending`: "unsettled, no timers left, queue drained"), long before 30,000 ms of virtual time. So the caption says that, in the trace's own words. "At Atlas's watch limit" appears only when the trace really says so, and the extra test above covers that case.
- The Anatomy geometry audit (`kit/audit.mjs`) was not run. The machine uses only the kit's upright prisms and cylinders (no `lathe` or `tube` parts) and sets painter's order by hand, as the test-rig example does. The line check and close-up captures were the checks used.
- No 4× close-up of every joint. Close-ups were taken of the tube, ruler and drum while building.
- The rack has 8 slots. A run with more than 8 calls would stack its extra capsules in slot 8 (withRpcRetry's default is 5 attempts).
- The capsule in the cradle fades in rather than arriving from a part. Story timing (about 1 s per step) is page time only; the virtual ms are in the readout and on the drum.
- In the app, the machine was checked in jsdom tests and in the throwaway Vite page, not in a full browser round against the running server.
- Ghost markers cover the "calls" bets only. The wait and outcome bets are shown by the scoreboard (D05-01).
