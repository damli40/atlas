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
