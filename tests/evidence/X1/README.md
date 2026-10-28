# X1: the outline engine behind the code explorer

Date: 2026-10-28 (WAT) · live spend **$1.51** in all: $0.39 before review, $0.80 in review round 1, $0.32 in
round 2 (7 Muse Wonder calls in total) · Node 25.8.1.

## Where to look first

- **What works:** Atlas takes a small codebase (a public GitHub folder, or uploaded files: at most 50
  JavaScript/TypeScript/Python files, 300 KB) and returns an outline: named parts, what each part is for, which real
  lines belong to it, and how parts join. Muse Wonder **proposes** the outline. Plain code **decides** which parts
  and joins are real.
- **Correction, said plainly: the round-1 live tables included 5 false "found by plain code" joins.** An import
  statement at the top of a file counted for whichever part happened to start at line 1. So `serializer-protocol`
  in itsdangerous was shown linking to `encoding-utils`, `exceptions` and `signer-core`, and `apply-parse-plan` in
  `runners/evm` to `moonwell-constants` and `fork-reads`. None of those parts' own code uses those names.
  - Round 2 fixed the rule (R2-B1). The tables below replace the round-1 tables.
  - The two saved runs were re-judged offline, and the `server/meta` run was done again live with its section saved.
- **What "confirmed" means now:**
  - A **part** is confirmed when every range it names is a file of the codebase and sits on whole definitions the
    code map knows. A range over 400 lines must be the whole file. The part's quote must start the range. It means
    "these lines exist", not "the purpose is true". The purpose is always labelled as Wonder's words.
  - A **join** is confirmed when the first part's own lines call, extend or refer to a definition inside the second
    part's lines. An import statement counts only for a part that holds the whole importing file.
- **Wonder-only joins say what is true:** "Wonder says this; plain code could not check it", with the reason.
  "Atlas found no import or call for this" appears only when plain code positively looked: different files, no file
  of the first part imports a file of the second, and nothing it could not follow. It never says "the code doesn't
  show it".
- **The server never maps code on its own event loop.** Code maps and checks run in a separate Node process with a
  60-second kill. Each has a counted work budget that ends as "can't check" rather than running long.
- **The proof file** (`.atlas.json`) carries an `outline` section with the files. Checking it rebuilds the code map
  and the whole verification with no model. It proves **internal consistency, not provenance** (see Limits).

## The command and the counts

```
pnpm vitest run tests/unit/outline-codemap.test.ts tests/unit/outline-verify.test.ts tests/unit/outline-atlasfile.test.ts tests/unit/outline-server.test.ts tests/unit/outline-review1.test.ts tests/unit/outline-review2.test.ts --reporter=verbose
pnpm test          # the full suite
npx tsc -p .       # the type check
OUTLINE_CLONE=<git clone dir> OUTLINE_SAVE_SECTION=<scratch file> npx tsx tests/tools/outline-live.ts <owner/repo> <subfolder> [ref] <out.json>   # one live run (paid)
OUTLINE_FROM_SECTION=<saved section> npx tsx tests/tools/outline-live.ts ...   # re-judge a saved run, no model call
```

| | Before X1 (5f28a6c) | X1 first version | After review round 1 | After review round 2 |
|---|---|---|---|---|
| Outline tests | 0 | 56 | 83 | 104 (21 new in `outline-review2.test.ts`) |
| Full suite passed | 920 | 975 | 1002 | **1023** (88 files), 20 skipped |
| tsc | clean | clean | clean | clean (`review2-tsc-output.txt` is empty) |

Files:
- `test-output.txt` / `full-suite.txt` / `tsc-output.txt`: the first version.
- `review1-*`: round 1.
- `review2-*`: round 2.
- `live-*.json`: before review.
- `live-r1-*.json`: round 1. **Superseded: they include the 5 false code-only joins.**
- `live-r2-*.json`: current.

## Live runs (current rules, round 2)

All read from local `git clone`s at pinned commits: no GitHub API, no token. Summaries hold no code. The full saved
sections (which do hold code) stay in the session's scratch folder, outside the repo. All three verify with
`verifyOutlineFile` in under 0.1 s each.

| Codebase @ commit | How judged | Files split into parts | Parts confirmed | Joins: confirmed / Wonder-only / found by plain code |
|---|---|---|---|---|
| `damli40/atlas` `server/meta` @5f28a6c | **new live run**, $0.325 | `client.ts`, `roles/claimant.ts`, `roles/fixer.ts` | 12 of 12 | 19 / 2 / 2 |
| `pallets/itsdangerous` `src/itsdangerous` @672971d | round-1 answer re-judged offline | `serializer.py`, `signer.py`, `timed.py` | 11 of 11 | 25 / 0 / 4 |
| `damli40/atlas` `runners/evm` @5f28a6c | round-1 answer re-judged offline | `apply.ts`, `control.ts`, `level2.ts`, `runner.ts` | 15 of 15 | 19 / 1 / 19 |

What changed from round 1, and why:

| | Round 1 (wrong in part) | Round 2 | What moved |
|---|---|---|---|
| itsdangerous | 21 / 4 / 5 | 25 / 0 / 4 | Calls inside one file, base classes and class references are now edges, so all 4 Wonder-only joins are confirmed: `HMACAlgorithm()` inside `signer.py`; `class TimestampSigner(Signer)`; `class TimedSerializer(Serializer)`; `default_signer = TimestampSigner`. The 3 false `serializer-protocol` joins are gone. New true ones were spot-checked in the source, e.g. `timed-serializer → exceptions` (`except BadSignature` at `timed.py:217`). |
| runners/evm | 18 / 2 / 15 | 19 / 1 / 19 | The 2 false `apply-parse-plan` joins are gone. Calls inside one file add true joins, e.g. `runner-main → runner-runbuild`. The one Wonder-only join says Wonder claimed a **call**, while the code only reads a constant (`BASE_CHAIN_ID`); plain code lists that read as a found-by-plain-code "imports" join. |
| server/meta | 12 / 3 / 6 | 19 / 2 / 2 (a new Wonder answer) | Not comparable row by row: Wonder split the files differently this time. Its 2 Wonder-only joins say "could not check it": one rests on a type-only import of interfaces (not in the code map). |

Before review (file-level joins, whole-file parts), kept in `live-*.json`:
- `server/meta`: 10 of 10 parts, 17 / 0 / 0 joins.
- itsdangerous: 6 of 7 parts, 18 / 7 / 0 joins.

## Design choices (and why)

- **JS/TS: the TypeScript 5.9 compiler, alias `typescript-api`, pinned to 5.9.3.**
  - It parses each file. In round 2 it also **binds names**: a one-file program with no library and no module
    loading decides what each identifier refers to (a parameter, a block-scoped `for (const x of …)`, a local, the
    import, or a top-level definition). So shadowing is exact.
  - Nothing is type-checked or run.
  - The repo's own `typescript` 7 parser runs as a separate native program over a pipe, so it cannot be used here.
- **Python: a scanner written in TypeScript, not `ast`.** The proof-file check must run anywhere without a Python
  process. Round 2 gave it real scopes:
  - an import inside a `def` binds only in that def;
  - a def's parameters and locals, lambda parameters and comprehension variables hide imports;
  - a module-level `def`/`class`/assignment of an imported name makes the name "unsure", so it is never counted;
  - type annotations are types, not uses (as in TypeScript).
- **Python's standard library:** CPython 3.14.7's `sys.stdlib_module_names` (297 names), in `src/outline/py-stdlib.ts`.
- **Re-exports** are looked up once per (file, name) and remembered. `export *` / `from .x import *` chains are
  walked breadth-first with one visited set. Time grows with files × links, never with the number of paths. Measured:
  the reviewer's 13-file star mesh went from 145 s to 20 ms; 31 files take 35 ms.
- **Edges:**
  - `calls` are calls, `new` and JSX. `uses` are base classes and other references. `imports` are import statements.
  - A use inside one file is an edge when it names the definition it reaches.
  - `Cls.method()` reaches the method's own definition when the code map knows it.
  - Every line where a call happens is kept.
- **Counted budgets, not clocks,** so every machine gives the same answer for the same file:
  - the code map: 3,000,000 steps → "can't check: the codebase is too complex to map";
  - verification: 20,000,000 characters and comparisons → "can't check: the outline is too large to verify".

  The server also runs both in a child process with a 60 s wall-clock kill as a backstop. The reviewer's 7 s verify
  input now takes about 55 ms.
- **Unchanged from round 1:**
  - one repair try only for invalid JSON;
  - never a contributor model;
  - more than 50 files / 300 KB is refused, never trimmed;
  - GitHub reads are pinned to one commit and blob-checked;
  - prompt and cost caps (prompt ≤ 100K tokens, worst case under $2 a job).

## Review round 2 (finding → fix → test)

The review found 2 blockers, 4 majors and 7 minors (report: `scratchpad/review-X1-r2.md`, not in the repo). Tests are
in `tests/unit/outline-review2.test.ts` (21), plus updates to the earlier files.

| Finding | What was wrong | Fix | Test |
|---|---|---|---|
| **R2-B1** | Import lines at the top of a file linked whichever part started at line 1 (5 false joins in the round-1 tables). | An import statement counts only for a part holding the whole importing file. Otherwise a part links only through calls and references its own lines make. "data" never counts an import line. | reviewer's B1a; the itsdangerous `serializer-protocol` case; the evm `apply-parse-plan` case; whole-file import still links |
| **R2-B2** | `export *` chains walked every path: 2.8 KB took 145 s, on the event loop. | Memoised lookups and a breadth-first walk. A counted map budget ("too complex to map"). Server maps and checks in a child process with a 60 s kill. | N=14 TS and Python, N=40 < 1 s; budget gives the same "can't check" every time; child process result equals the in-process one; a 1 ms limit kills it; `/health` answers while a job maps; 3 KB outline file verifies fast |
| **R2-M1** | `Store.putThing()` was tied to the class, so a method-sized part got no join. | The call resolves to the method's own definition when known, else the class. | JS static call joins the `put` part, not `get`; Python `Store.put` |
| **R2-M2** | "Wonder says; the code doesn't show it" was false for real links plain code could not see. | New wording, as described above. Calls inside one file and base classes are now edges. | the 4 itsdangerous links now confirmed; "found no link" only when positively checked; the phrase never appears |
| **R2-M3** | A Python function-local import leaked to the whole file; lambda, comprehension and redefinition were not handled; JS top-level blocks were not handled. | Python scopes as above; JS via the TypeScript binder. Unsure means not counted. | each case from the reviewer |
| **R2-M4** | The verify budget counted 4 units per edge × pair; the real cost was up to 1,500× more (7 s). | Edges are tied to parts once, every comparison is counted, and pairs are set lookups. | the reviewer's input < 1 s |
| minor 1 | `from .. import x` that Python refuses still made edges. | Every folder climbed must be a package (`__init__.py`), else "Python refuses …". | two cases |
| minor 2 | A namespace package was called an outside package. | It is labelled unresolved, and its submodules still resolve. | `from ns.sub import mod` |
| minor 3 | Only 100 lines per edge were kept. | All lines kept (bounded by the budget). | 24,000 lines kept |
| minor 4 | Removing GitHub blob ids, or editing the reasoning-token total, still verified. | Both fail. | tamper tests |
| minor 5 | A tsconfig with only `extends` got a false "not JSON" note; `tsconfig.base.json` was never read. | `extends` to a held config is followed (5 steps); `tsconfig.*.json` and `jsconfig.*.json` are read; the note says what is true. | extends case; "sets no baseUrl or paths" |
| minor 6 | A "data" arrow could point against the call direction. | The label says a data join is linked either way. | label text |
| minor 7 | "confirmed" next to a purpose reads as "purpose confirmed". | The parts label says confirmed means "these lines exist on whole definitions; not that the purpose is true". The `status` value is unchanged for X2. | label text |

**Not changed:** the 100K-token prompt gate estimates characters ÷ 2.8, so code full of CJK text or emoji can push
past the "$2 worst case" (about $3 by arithmetic, not measured), and the repair call is not re-gated. Logged, not
fixed.

## Rebase onto main (E3 paste flow + E4 Modal executor, 298a781)

- `x1-outline` was replayed onto main with a plain `git rebase main`. The conflicts were resolved by keeping both
  sides:
  - `server/app.ts`: E3's paste routes, sweep and body limit; E4's executor; the outline routes. Both larger body
    limits (`/paste`, `/outline/jobs`) sit in one middleware.
  - `server/index.ts`: main's new `server/wiring.ts` wiring and E4's warm-up; the outliner is now wired there.
  - this evidence index: E3's and E4's rows are kept, and the X1 row is updated.
- **One shared code guard.** `codeModelRefusal` and `guardCodeChat` live in E3's `server/meta/pasted-guard.ts`. The
  paste path (`guardPastedChat`) and the outline path (`server/meta/roles/outliner.ts`) both call them. Each keeps its
  own wording and prompt limit:
  - pasted code: 160,000 characters, $2 a call;
  - a codebase: 280,000 characters, $2.50 a call (every prompt character counted as a token, plus the full output
    room).

  Both refuse every contributor id whatever `ATLAS_ALLOW_CONTRIBUTOR` says, and send nothing.
- **Shared budgets.** `server/wiring.ts` turns the outliner on (`ATLAS_OUTLINER`, a 5-minute call limit) with the same
  model-budget object as every other role, so one spend ceiling covers everything. The Wonder call takes the shared
  per-address model-round limit. An outline job also counts against E3's per-address paste allowance.
- Tests: `tests/unit/outline-merge.test.ts` (5) covers both guard paths, the wiring, and the shared paste allowance.
  Full suite after the rebase, run three times at low machine load: **1304 passed, 35 skipped (103 files), all three
  runs identical** (`merge-full-suite-1/2/3.txt`; the skips are main's own: RPC, Modal and network checks). tsc is
  clean (`merge-tsc-output.txt` is empty).
- `live-r2-atlas-server-meta.json` is unchanged (an Anatomy prototype reads it).

## Routes for X2

- `POST /outline/jobs {repo, ref?, subfolder?} | {files}` → 202 `{jobId}`.
- `GET /outline/jobs/:id` (reading, mapping, asking-wonder, checking, done, failed).
- `GET /outline/jobs/:id/outline`.
- `GET /outline/jobs/:id/parts/:partId`.
- `GET /outline/jobs/:id/atlas` (the outline-only proof file, with the code).

Every route needs `x-atlas-session`; another session gets 404. Limits:
- 10 jobs an hour per address;
- 5 started and 1 running per session;
- 4 running per server;
- 3 kept per session;
- 30-minute expiry.

X2 must render:
- `wholeFile` ranges as "whole file";
- `typeOnly` joins as type-only;
- `noLinkFound` vs "could not check";
- `cantCheck` / `codeMap.cantMap` as can't-check;
- "confirmed" as "lines confirmed".

X2 must also keep round files that carry an outline in memory only: they hold the code.

## Limits

- **Provenance:**
  - The proof file proves internal consistency, not where the code came from. Repo name, commit, `skipped`, attempt
    errors and finish reasons, and a consistent model-id rename are not tied to anything outside the file.
  - GitHub files must carry their git blob ids (verify recomputes them), so an online check could compare them with
    GitHub's tree. Nothing runs that check yet.
  - Wonder's answer is not signed.
  - The UI must never show "verified" next to the repo name.
- **Links plain code still does not see** (they show as "could not check it", never as a false "confirmed"):
  - calls through a value passed around (`const f = save; f()`, callbacks);
  - destructuring (`const {save} = db`);
  - member chains three names deep (`L.api.go()`);
  - `require` inside a function, then a member call;
  - `require('./db').save`;
  - names from `from x import *`;
  - calls inside f-strings;
  - `a.top()` after `import a.b.c`;
  - in a try/except import pair, only the first import gets the uses;
  - calls of methods through `self.x` / `this.x`.
- **Unsure Python names are not counted:** a name both imported and redefined at module level gives no edge at all.
  Block scope inside a Python function is not modelled: a name bound anywhere in the def hides the import in the
  whole def.
- **Types:** TypeScript type positions and Python annotations are not uses. A part that only names a type of another
  part gets no join, unless it holds the importing file whole.
- **Python resolution:**
  - CPython 3.14.7's standard-library list; a local module that really shadows the standard library is still called
    outside.
  - Namespace packages are labelled "unresolved" (their submodules still resolve).
  - A relative import through a folder without `__init__.py` is refused, which is wrong for some namespace-package
    layouts.
- **Path aliases:** `extends` that names a package (not a relative file) is not followed. Without any config, a scoped
  name like `@app/x` cannot be told from a package.
- **Ranges** must sit on definitions the code map knows. Scripts whose code is not in definitions can only be taken
  whole.
- **Wording is part of the proof:** verify compares reasons word for word. Outline files made before a rewording stop
  verifying. This round reworded them again: earlier saved files do not verify, and the regenerated ones do.
- **Intake:**
  - A Git LFS file that fails the blob check fails the whole job.
  - A download is read whole before its size is checked.
- **Sessions are made by the client,** so the per-session caps bind only cooperating clients. The real limit is per
  address.
- **The agent-log line for an outline uses role `investigator`:** `web/logstrip/LogStrip.tsx` (X2's file) has no
  `outliner` role. `usage.jsonl` says `outliner`.
