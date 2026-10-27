# Evidence index

One folder per task. Each folder has a README.md with the date, the commands that
were run, the raw output, what the check proves, and what it does not.

| Task | What was checked |
|---|---|
| [D01-01](D01-01/README.md) | Commit 1 holds only PRE-EXISTING.md and .gitignore; private folders are ignored |
| [D01-02](D01-02/README.md) | Scaffold: tests run, types check, `/health` answers `{"ok":true}` |
| [D01-03](D01-03/README.md) | The withRpcRetry fixture is an exact copy of the pinned original; oracle table is complete |
| [D01-06](D01-06/README.md) | Judge, seal and units: every can't-check branch, bigint price tolerance, SHA-256 vs node:crypto, wording lint |
| [D01-07](D01-07/README.md) | Meta API client: mocked tests, one live Spark call with usage logged, key absent from evidence, `muse exec` is the headless mode |
| [D01-04](D01-04/README.md) | TS harness: real withRpcRetry on a virtual clock matches oracle rows S1–S6 and H2; same seed gives the same trace |
| [D01-05](D01-05/README.md) | Local executor (Node `--permission`: no network, read-only own folder, wall-clock kill); control S1+S3 passes on the fixture, does not pass with attempts edited to 3 |
| [D01-08](D01-08/README.md) | Day gate: S1–S6 over HTTP, 18 oracle bets matched + 1 didn't match + 1 can't check from real runs, 690 ms; `retry-scenario` gained `errorKind` and `resolvesWith` |
| [D02-01](D02-01/README.md) | Experiment gate: every shape allowed inside its bounds, refused outside with a plain reason; server returns refusals (422) and never runs them; question text in one place |
| [D02-02](D02-02/README.md) | Claimant (muse-spark-1.3): 5/5 live calls schema-valid and gate-allowed first try, $0.17 upper bound; first model bets sealed, run and judged by plain code (15 matched); repair loop and gate rejection tested with a mocked model |
| [D01-review](D01-review/README.md) | Fixes for the day-1 adversarial review: a run Atlas's own limit stopped is "can't check" (blocker); whole results, per-run marker, real-timer tracking, S6 in the control; judge refuses missing control, wrong options, wrong units; rationale sealed; billed usage always logged; pre-commit secret scan; fixture hash pinned. Probes before/after; gate still 18 / 1 / 1 |
| [D02-02b](D02-02b/README.md) | Claimant re-run with a neutral claim, the whole function in view and a "least sure" pick rule: Spark still chose a never-answering read 5/5; 5/5 schema-valid; 11 matched / 0 didn't match / 4 can't check (declined, recorded in proofs/refusals/); $0.21 upper bound |
| [D02-03](D02-03/README.md) | Model go/no-go by plain script: Wonder GO (1 live schema-valid call, $0.02), Spark GO (5/5 in D02-02b), Spark Open on Baseten pending (no key on this machine); fallback chain listed |
| [D02-05](D02-05/README.md) | Agent event stream: one real round logs human → investigator stand-in → gate → seal → runner → judge; model events without model name or usage are refused; SSE replays history, then live events, and cleans up on disconnect |
| [D02-04](D02-04/README.md) | Human bets: server seals at its own time with a hidden nonce, hash on screen before "Break it", inputs locked, 409 after run start, sealedAt < startedAt asserted; browser recomputes each revealed hash (✓ match); one S3 round in headless Chromium |
| [D02-06](D02-06/README.md) | Day gate: Muse Spark bets live on the same S3 experiment as the person (bet-only mode), sealed by the server, values hidden until the run; both columns judged, all 6 seals ✓ in headless Chromium; Spark 12/12 matched across 4 live calls, $0.09 upper bound; pending vs can't-check wording added; D02-05 events regenerated |
