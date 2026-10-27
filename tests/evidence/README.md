# Evidence index

One folder per task. Each folder has a README.md with the date, the commands that
were run, the raw output, what the check proves, and what it does not.

| Task | What was checked |
|---|---|
| [D01-01](D01-01/README.md) | Commit 1 holds only PRE-EXISTING.md and .gitignore; private folders are ignored |
| [D01-02](D01-02/README.md) | Scaffold: tests run, types check, `/health` answers `{"ok":true}` |
| [D01-03](D01-03/README.md) | The withRpcRetry fixture is an exact copy of the pinned original; oracle table is complete |
| [D01-04](D01-04/README.md) | TS harness: real withRpcRetry on a virtual clock matches oracle rows S1–S6 and H2; same seed gives the same trace |
