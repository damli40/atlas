# X1: the outline engine behind the code explorer

Date: 2026-10-27 (WAT) · live spend **$1.19** in all: $0.39 before review, $0.80 in review round 1 (6 Muse Wonder
calls in total) · Node 25.8.1.

## Where to look first

- **What works:** Atlas takes a small codebase (a public GitHub folder, or uploaded files: at most 50
  JavaScript/TypeScript/Python files, 300 KB) and returns an outline of it: named parts, what each part is for,
  which real lines belong to it, and how parts join. Muse Wonder **proposes** the outline. Plain code **decides**
  which parts and joins are real.
- **Review round 1 changed what "confirmed" means.** The first version checked joins file by file. So when a
  part was a few lines of a bigger file, a call made elsewhere in that file could confirm a join the part never
  makes (B1). Now a join counts only an import or call that happens **inside the first part's lines** and reaches
  a definition **inside the second part's lines**. A part's lines must also start and end on whole definitions,
  and its quote must start the range (M4). Read "Review round 1" below.
- **The live runs after the review** (table below) split files into parts in all three codebases, so the new
  rule was exercised on real answers. All 38 parts were confirmed. Of the joins Wonder proposed, 51 were confirmed
  and 9 stayed "Wonder says; the code doesn't show it". Plain code added 26 joins Wonder missed.
- **What "confirmed" means, exactly:**
  - A **part** is confirmed when every range it names is a file of the codebase and sits on whole definitions the
    code map knows. A range over 400 lines must be the whole file, and is labelled "whole file". The part's quote
    must also be whole lines, starting at the range's first line.
  - A **join** is confirmed when an import or a call made inside the first part's lines reaches a definition inside
    the second part's lines.
  - It does **not** mean the purpose sentence is true. That sentence is always labelled as Wonder's words.
- **The proof file** (`.atlas.json`) has an `outline` section that carries the files. Checking the file rebuilds
  the code map and the whole verification from them, with no model. Editing a part to "confirmed" makes the check
  fail. Older proof files still check exactly as before. The check proves **internal consistency, not
  provenance**: see "Limits".

## The command and the counts

```
pnpm vitest run tests/unit/outline-codemap.test.ts tests/unit/outline-verify.test.ts tests/unit/outline-atlasfile.test.ts tests/unit/outline-server.test.ts tests/unit/outline-review1.test.ts --reporter=verbose
pnpm test          # the full suite
npx tsc -p .       # the type check
OUTLINE_CLONE=<git clone dir> npx tsx tests/tools/outline-live.ts <owner/repo> <subfolder> [ref] <out.json>   # one live run (paid)
OUTLINE_FROM_SECTION=<saved section> npx tsx tests/tools/outline-live.ts ...   # re-judge a saved run, no model
```

| | Before X1 (5f28a6c) | X1 first version | After review round 1 |
|---|---|---|---|
| Outline tests | 0 | 56 | 83 |
| Full suite passed | 920 | 975 | **1002** (87 files), 20 skipped |
| tsc | clean | clean | clean (`review1-tsc-output.txt` is empty) |

Note on the full suite after round 1: the machine was busy with other agents' work (load average up to 76). Under
that load, older sandbox tests timed out at 5 s and one wall-clock check (`< 5000 ms`) failed. None of them touch
outline code. The run in `review1-full-suite.txt` waited for the load to fall and passed: 1002 passed, 20 skipped.
The 20th skip is `github-target.test.ts`, which skips itself while this address's unauthenticated GitHub allowance
is used up.

Files: `test-output.txt` / `full-suite.txt` / `tsc-output.txt` (first version), `review1-*.txt` (round 1),
`live-*.json` (first version), `live-r1-*.json` (round 1).

## Live runs

All runs used real Muse Wonder (`muse-wonder-1.0`). The round-1 runs read the code from local `git clone`s at the
pinned commits: no GitHub API call, no token. Summaries hold no code: counts, ranges, statuses with reasons,
paths and hashes, and Wonder's names and purposes (labelled as the model's).

**After review round 1 (the current rules):**

| Codebase @ commit | Files | Files Wonder split into parts | Parts confirmed | Joins: confirmed / Wonder-only / found by plain code | Cost |
|---|---|---|---|---|---|
| `damli40/atlas` `server/meta` @5f28a6c | 10 TS | `client.ts` (3 parts) | 12 of 12 | 12 / 3 / 6 | $0.290 |
| `pallets/itsdangerous` `src/itsdangerous` @672971d | 8 Python | `serializer.py`, `signer.py`, `timed.py` | 11 of 11 | 21 / 4 / 5 | $0.135 |
| `damli40/atlas` `runners/evm` @5f28a6c (the multi-part run) | 9 TS | `apply.ts` (4 parts), `control.ts`, `level2.ts`, `runner.ts` (2 each) | 15 of 15 | 18 / 2 / 15 | $0.237 |

Also in round 1: one superseded itsdangerous run, $0.136. It was run before the import-statement fix below, and
its file was overwritten.

What these numbers say:
- **Every "Wonder-only" join I checked is a real limit of plain code, not a lie by Wonder.** Each one is one of
  these three:
  - a class extending another class: `TimestampSigner(Signer)` and `TimedSerializer(Serializer)` in itsdangerous;
  - a call inside one file, which plain code does not see;
  - a constant read rather than called: `runners/evm` `runner-runbuild` → `moonwell-constants`.

  These are listed under Limits.
- **Two rule changes came from the live runs themselves:**
  - Two `from .timed import …` lines were being merged into one edge that kept only the first line's names. Now
    each import statement is its own edge.
  - Wonder's "imports" joins failed whenever the import sat at the top of the file, outside every part's
    definitions. Now a call made through the import also shows the import.

  After those two changes, the itsdangerous run was **re-judged offline** from its saved section (same files,
  same Wonder answer, no model call). Before the change it read 14 / 11 / 12.
- **The `server/meta` row was judged before those two changes**, and its section was not saved, so it was not
  re-judged. A check of that folder's code map shows no file with two import statements to the same file, so the
  first change does not touch it. Its 3 Wonder-only joins are a type-only import of interfaces (not in the code
  map) and two calls inside `client.ts`, which plain code cannot see; the second change would not turn those into
  confirmed. Not re-run: it would have taken this round past the $1 cap.
- **Before review** (first version, file-level joins, kept for comparison in `live-*.json`):
  - `server/meta`: 10 of 10 parts, 17 / 0 / 0 joins, $0.268.
  - itsdangerous: 6 of 7 parts, 18 / 7 / 0 joins, $0.124. Its one refusal was an 11-character quote.

  Both outlines were one part per whole file, so file-level checking was nearly automatic. That is why the
  review's B1 did not show up there.

## Design choices (and why)

- **JS/TS parser: the TypeScript 5.9 compiler, installed under the alias `typescript-api`, pinned exactly to
  5.9.3.** The repo's `typescript` is version 7. Its parser runs as a separate native program reached over a pipe
  (an unstable API). 5.9's parser runs inside the same process and answers at once, so the proof-file check can
  rebuild the code map on any machine. It only parses: nothing is type-checked or run.
- **Python: a small scanner written in TypeScript, not Python's `ast` module.** The proof-file check runs
  synchronously in the server's own process. With `ast`, every check would need a sandboxed Python process of the
  same version. The scanner reads definitions, imports (relative ones included), `__all__`, and calls of imported
  names. It cannot execute anything.
- **Python's standard library** comes from CPython **3.14.7's** `sys.stdlib_module_names` (297 names), copied into
  `src/outline/py-stdlib.ts`. Standard-library imports are always outside the codebase.
- **The code map is deterministic.** Files are sorted by path and symbols by line.
  - A call edge is one per (file, target file, name), with every line where the call happens and a count:
    `calls:a.ts->db.ts:save`.
  - An import edge is one per import statement: `imports:a.ts->db.ts:./db@1`.
- **Wonder gets one repair try**, and only when its answer is not valid JSON of the right shape. Unconfirmed parts
  are shown with their reasons, never re-asked.
- **Code never reaches a contributor model.** The Outliner refuses any model id containing "contributor", even with
  `ATLAS_ALLOW_CONTRIBUTOR=1`, before anything is sent or counted. This is the same rule as E3's pasted-code
  guard; X2 can fold the two into one.
- **More than 50 source files or 300 KB is refused as a whole** ("choose a subfolder"), never cut down. Single
  files over 100 KB are skipped and listed.
- **GitHub reads are pinned and checked:** one commit, one tree listing, and every download checked against the
  git blob id GitHub listed. The blob id is stored per file, and verify recomputes it.

## Review round 1 (finding → fix → test)

The review found 3 blockers, 4 majors and 9 minors (report: `scratchpad/review-X1.md`, not in the repo). Tests:
`tests/unit/outline-review1.test.ts` (27), written from the reviewer's inputs (`x1r/ver.ts`, `py.ts`,
`bomb.ts`, `cost.ts`), plus updates to the four earlier outline test files. They were not re-run against the old
code: most of them call functions this round added.

| Finding | What was wrong | Fix | Test |
|---|---|---|---|
| **B1** | A join was checked file by file, so a call made outside a part's lines confirmed it. The reviewer's case: `fmt` (lines 1–3, calls nothing) → `db` was "confirmed". | An import or call counts only when its line is inside A's ranges (not B's) and its target definition is inside B's ranges (not A's), or B holds the whole target file. Same rule for joins found by plain code. Wonder's evidence "matches" only on the line of such an import or call. | reviewer's fmt/db case → Wonder-only; `persistAll` → confirmed; call to `saveUser` does not join a part holding only `dropAll` |
| **B2** | `import logging` / `json` / `requests` matched any local file whose path ended with that name. | Standard library first (CPython 3.14.7 list). Then only these places: the script's own folder (when not in a package), the root, and src-style roots. Never a match on the end of a path. Otherwise an outside package. | logging/json with `myapp/logging.py` and `tools/json.py` → no edges; `tests/requests.py` stub → no edge; `src/` layout and script folder resolve |
| **B3** | The quote check grew with lines × quote², so a hostile file could run for hours. | Outline quotes are anchored at the range's first line: one prefix check. The Investigator's "anywhere" rule uses a rolling hash, and `server/meta/roles/investigator.ts` now uses it too. Caps: 200 ranges, 2,000 characters per quote, 100,000 quoted characters per outline. A counted work budget gives "can't check: the outline is too large to verify". It is a count, not a clock, so every machine gives the same answer. | 8,000 lines × 2,000-character quote < 0.5 s; budget → can't check; caps refused |
| **M1** | The code map was unbounded: about 640K-token prompts, about 9 MB per job, $5.70 per job worst case. | One edge per name. Code-map caps (3,000 edges, 6,000 definitions). The map in the prompt is cut at about 30K tokens. A prompt over 100K tokens is never sent: the worst case is under $2 per job. Finished jobs expire after 30 min. Each session keeps at most 3, at most 60 are kept in all, and at most 4 run at once (503). A running job is never evicted. GET outline is serialised once. | 24,000 calls → 1 edge (count 24,000); over-cap map refused; huge prompt not sent; a flood from one session never evicts another's job |
| **M2** | `.jsx`, `.mts` and `.cts` were not read. | Read, and `./a.mjs` resolves to `a.mts`. | React `.jsx` component and `.mts`/`.cts` imports resolve |
| **M3** | `@app/x` and `src/x` were listed as outside packages. | tsconfig/jsconfig `paths` and `baseUrl` are read (comments and trailing commas allowed; `extends` not followed). Config files are kept beside the code (at most 5, 20 KB each) and re-checked. Without a config, a name that matches a folder of the codebase is "may be a path alias". | paths + baseUrl resolve; bare `src/x` → may be an alias; tampered config caught |
| **M4** | One 12-character line confirmed a range of any size. | Ranges start at line 1 or at a definition's first line, and end at a definition's last line or at the file's last line (comments and blank lines may sit between). The quote starts the range. A range over 400 lines must be the whole file, labelled "whole file". The prompt tells Wonder the rule. | reviewer's `wipe` → unconfirmed; `wipe2` → confirmed only as "whole file"; mid-definition ranges refused; 452-line range refused |
| minor 1 | A shadowed name counted as a call. | A parameter or local of the enclosing function hides the import (JS and Python). | `handler(save) { save() }` is not a call |
| minor 3 | Type-only imports confirmed "data" joins. | Never for "data". An "imports" join they confirm is labelled `typeOnly`. "data" is accepted in either direction. | `import type { User }` |
| minor 4 | Two `export *` giving the same name: the first one was picked. A barrel's private import was followed. | No symbol is picked, and the edge says why (as TypeScript does). A JS name that is imported but not re-exported is not followed. | `one.ts` / `two.ts` |
| minor 5 | Hidden characters went raw into fields. | Join part ids must match the id pattern. Paths, import strings, names, signatures and parse notes pass through `visibleText`. The Python scanner never takes direction controls as name characters. | U+202E in an import, a Python name, a join id and a range path |
| minor 6 | Provenance could not be checked. | Git blob ids are stored for GitHub files and recomputed by verify, so a checker can compare them with GitHub's tree online. The rest stays a limit (below). | a wrong blob id is refused |
| minor 8 | Wonder's outline spend was logged as Investigator spend. | `usage.jsonl` now says `"role":"outliner"` (the 4 round-1 lines show it). The on-screen agent log still uses role `investigator` for the outline line, because adding a role breaks `web/logstrip/LogStrip.tsx`'s role map (X2's file). | usage line role = outliner |
| minor 2, 7, 9 | Missed call forms; session ids made by the client; LFS and whole-download reads. | Logged under Limits. Minor 7's fair share is fixed (M1). | — |

Also changed while doing the round: an `imports` edge's id now ends with `@<line>`, and the code-map JSON shape
changed (edges carry `lines` and `count`; the map carries `notes`). So **outline files made before this round no
longer verify.** None were ever written outside tests.

## Routes for X2

- `POST /outline/jobs {repo, ref?, subfolder?} | {files: [{path, text}]}` → 202 `{jobId, status}`. A
  `tsconfig.json` or `jsconfig.json` in `files` is kept as a config file.
- `GET /outline/jobs/:id`: the status (reading, mapping, asking-wonder, checking, done, failed).
- `GET /outline/jobs/:id/outline`: the verified outline, the code map, the file list (no text), what was skipped,
  usage and labels.
- `GET /outline/jobs/:id/parts/:partId`
- `GET /outline/jobs/:id/atlas`: the outline-only proof file, with the code.

Every route needs `x-atlas-session`. Another session gets 404.

Limits:
- 10 jobs an hour per address (`ATLAS_OUTLINES_PER_IP_PER_HOUR`).
- 5 started per session, one running per session, 4 running across the server, 3 kept per session, 30-minute
  expiry.
- The Wonder call also counts against the shared per-address model-round limit and the model budget.
- `ATLAS_OUTLINER=off` turns Wonder off; the code map is still built.

**X2 must render** `wholeFile` ranges as "whole file", `typeOnly` joins as type-only, `cantCheck` as the outline's
can't-check reason, and must keep any round file that carries an outline in memory only. The outline section
holds the code, and `ATLAS_PUBLISH_PROOFS=1` writes round files to the public `proofs/` folder.

## Limits (everything the review named, plus what the live runs showed)

- **Provenance:** the proof file proves internal consistency, not where the code came from.
  - Files, repo name, commit, `skipped`, and Wonder's `attempts` (errors and finish reasons) are not tied to
    anything outside the file. A made-up section that claims `pallets/itsdangerous@672971d` verifies.
  - Git blob ids let an online checker compare each file with GitHub's tree. Nothing does that check yet.
  - Wonder's answer is not signed.
  - The UI must never show "verified" next to the repo name.
- **Joins plain code cannot see** (they show as "Wonder says"; none is ever a false "confirmed"):
  - **Calls:**
    - calls inside one file;
    - a class extending an imported class (`class A(B)`, `extends B`);
    - a constant read rather than called;
    - calls through a value passed around (`const f = save; f()`, callbacks);
    - destructuring (`const {save} = db`);
    - member chains three names deep (`L.api.go()`).
  - **Imports and requires:**
    - `require` inside a function, followed by a member call;
    - `require('./db').save`;
    - names from `from x import *`;
    - in a try/except import pair, only the first import gets the calls;
    - `a.top()` after `import a.b.c`.
  - **Python syntax:**
    - decorators without parentheses (`@cached`);
    - calls inside f-strings.
  - **Imports joins:** an import at the top of a file confirms an "imports" join only for a part whose range
    includes the top of the file, or through a call made from inside the part.
- **Shadowing is approximate:** block scope is not modelled. A name declared anywhere in a function hides the
  import in the whole function. That can hide a real call; it never invents one.
- **Python resolution:**
  - The standard-library list is CPython 3.14.7's. A module added or removed in other versions (for example
    `distutils`) is treated like any other name.
  - A local `logging.py` that a script really shadows the standard library with is still called "outside".
  - Namespace packages (no `__init__.py`) resolve from the root and the script folder only.
- **Path aliases:**
  - `extends` in a tsconfig is not followed.
  - Without a config, a scoped name like `@app/x` cannot be told from a package and is listed as one.
- **Ranges:** a range must sit on definitions the code map knows. A file whose top-level code is not in definitions
  (a script) can only be taken whole.
- **Wording is part of the proof:** verify compares the reasons word for word. If a later commit rewords one,
  outline files made before it stop verifying. There is no wording version field.
- **Intake** (not reproduced live):
  - A Git LFS file whose bytes fail the blob check fails the whole job ("integrity") instead of being skipped.
  - A download is read whole before its size is checked.
- **Sessions are made by the client,** so per-session caps bind only cooperating clients. The real limit is per
  address.
