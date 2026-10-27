# X1: the outline engine behind the code explorer

Date: 2026-10-27 (WAT) · live spend **$0.39** (2 Muse Wonder calls) · Node 25.8.1.

## Where to look first

- **What now works:** Atlas takes a small codebase (a public GitHub folder, or uploaded files: at most 50
  JavaScript/TypeScript/Python files, 300 KB), and returns an outline of it: named parts, what each part is for,
  which real lines belong to it, and how parts join. Muse Wonder **proposes** the outline. Plain code **decides**
  which parts and joins are real.
- **The two live runs** (table below): on Atlas's own `server/meta` folder, Wonder proposed 10 parts and 17 joins,
  and plain code confirmed all of them. On `pallets/itsdangerous`, plain code confirmed 6 of 7 parts and 18 of 25
  joins. The one part it refused quoted a line with only 11 letters and digits, too short to pin a place, so
  that part's 7 joins became "Wonder says; the code doesn't show it". That refusal is real, not staged: it is the
  rule doing its job on a live answer.
- **What "confirmed" means, exactly:** a part is confirmed when every file and line range it names exists in the
  codebase, and its quoted snippet is whole lines of that range. A join is confirmed when plain code found an
  import or a call from a file of one part to a file of the other. It does **not** mean the part's purpose
  sentence is true: that sentence is always labelled as Wonder's words.
- **The proof file** (`.atlas.json`) now has an `outline` section that carries the files themselves. Checking the
  file rebuilds the code map and the whole verification from those files, with no model. Editing a part to
  "confirmed" by hand makes the check fail. Older proof files still check exactly as before.

## The command and the counts

```
pnpm vitest run tests/unit/outline-codemap.test.ts tests/unit/outline-verify.test.ts tests/unit/outline-atlasfile.test.ts tests/unit/outline-server.test.ts --reporter=verbose
pnpm test          # the full suite
npx tsc -p .       # the type check
npx tsx tests/tools/outline-live.ts <owner/repo> <subfolder> [ref] <out.json>   # one live run (paid)
```

| | Before X1 (commit 5f28a6c) | After X1 |
|---|---|---|
| Test files | 82 | 86 |
| Tests passed | 920 | 975 (+56 new outline tests; see the note on skips) |
| Skipped | 19 | 20 |
| tsc | clean | clean (`tsc-output.txt` is empty) |

The one extra skip is not an X1 test: `github-target.test.ts` makes a real, unauthenticated GitHub call and skips
itself when GitHub's hourly limit for this address is used up. The live runs below used that allowance. It
resets on its own; the test passes again then.

Files: `test-output.txt` (the 56 new tests, verbose), `full-suite.txt`, `tsc-output.txt`,
`live-atlas-server-meta.json`, `live-itsdangerous.json`.

## Live runs (real Muse Wonder, real GitHub)

| Codebase | Commit | Files read | Code map | Wonder's parts | Confirmed parts | Joins: confirmed / model-only / code-only | Not in any part | Cost |
|---|---|---|---|---|---|---|---|---|
| `damli40/atlas` `server/meta` (this repo) | `5f28a6c` | 10 TS files, 134,480 bytes | 57 edges (41 calls) | 10 | **10** | 17 / 0 / 0 | 0 | $0.268 (46,087 in, 4,158 out) |
| `pallets/itsdangerous` `src/itsdangerous` | `672971d` | 8 Python files, 41,738 bytes (1 skipped: `py.typed`) | 84 edges (38 calls) | 7 | **6** (`signing` unconfirmed) | 18 / 7 / 0 | 1 (`signer.py`) | $0.124 (16,923 in, 2,828 out) |

Both answers were usable on the first call (no repair call). Both outline proof files checked out with
`verifyOutlineFile`. The summaries hold no code: counts, part and join statuses with reasons, file paths and
hashes, and Wonder's part names and purposes (labelled as the model's).

What the numbers say:
- On Atlas, Wonder drew one part per file and joined them only by "imports". Every claim was checkable and checked
  out. Plain code found no join Wonder missed. Its 57 edges include calls, but every pair of parts that has an edge
  was already joined by Wonder.
- On itsdangerous, one short quote (11 letters and digits; the minimum is 12, the same rule the Investigator uses)
  made `signing` unconfirmed. Plain code does not guess which file Wonder meant, so `signer.py` (the file that holds the
  `Signer` class) is listed as "not in any part". In the explorer that shows as a gap, not as a hidden failure.
- Imports that leave the chosen folder (`../../src/types` from `server/meta`) are listed as "unresolved: points
  outside the codebase". Atlas did not read those files, so it does not pretend to know them.

## Design choices (and why)

- **JS/TS parser: the TypeScript 5.9 compiler, installed under the alias `typescript-api`.** The repo's
  `typescript` is version 7. Its parser runs as a separate native program reached over a pipe (an "unstable"
  API). Version 5.9's parser is plain JavaScript, runs in the same process, and answers at once. That matters
  because the proof-file check must rebuild the code map on any machine without starting a program. It only
  parses: no type checking, no module loading, nothing runs. The version is pinned exactly (5.9.3), because the
  parser's syntax messages are part of the code map.
- **Python: a small scanner written in TypeScript, not Python's `ast` module.** The proof-file check runs inside
  the server's own process and is synchronous. Calling Python's `ast` would mean starting a Python process,
  sandboxed, from inside verify, and every machine checking a file would need the same Python. The scanner reads
  only what the code map needs: top-level `def` and `class`, methods of top-level classes, `import` /
  `from … import` (relative ones included), `__all__`, and calls of imported names. It reads every string form
  (triple quotes, prefixes, f-strings with nested quotes). It cannot execute anything. When it meets something it
  cannot read (an unclosed string), it says so in the file's notes and keeps what it read.
- **Deterministic code map:** files sorted by path, symbols by line, edges by id (`calls:a.ts->b.ts@12:save`). The
  same files in any order give the same map, byte for byte (tested).
- **Joins are checked between files, not lines:** a join is confirmed by an import or a call from a file of one
  part to a file of the other. An edge whose two files both belong to the same part never confirms a join (two
  parts may share a file). Plain code cannot see calls inside one file, so a join between two parts of the same
  file is model-only, and the reason says "it sees imports and calls between files only".
- **Wonder gets one repair try, only when its answer is not valid JSON of the right shape.** Unconfirmed parts are
  not a reason to ask again. They are shown with their reasons. A second unusable answer ends the job with the
  code map and the failure, never a third call.
- **Code never reaches a contributor model:** the Outliner refuses any id with "contributor" in it, even with
  `ATLAS_ALLOW_CONTRIBUTOR=1`, and any id the client would refuse, before anything is sent or counted (tested
  with 4 ids). This is the same rule as E3's pasted-code guard, written in `server/meta/roles/outliner.ts`
  because E3's file is on its own branch. X2 can fold the two into one.
- **More than 50 source files or more than 300 KB is refused as a whole** ("choose a subfolder"), not cut down:
  half a codebase would give an outline that looks complete and is not. Single files over 100 KB are skipped and
  listed.
- **GitHub reads are pinned and checked:** one commit (the ref asked for, else the default branch), one listing
  of every file at that commit, and each download checked against the git blob id GitHub listed. So a file cannot
  change between the listing and the download.

## Test map (56 tests)

- `outline-codemap.test.ts` (22): JS/TS and Python fixtures. Re-exports (`export {x} from`, `export *`,
  `export * as`), default exports (`export default`, `module.exports = D`), aliasing (`save as persist`,
  `import pkg.util as pu`), dynamic imports (`import()`, `importlib.import_module`) listed as unresolved, circular
  imports in both languages, Python relative imports (`.`, `.util`, `..` and `...` from a subpackage, climbing out
  of the codebase), CommonJS `require`, `new` and JSX as calls, syntax errors, bracket bombs, order independence.
- `outline-verify.test.ts` (19): a mocked Wonder returning a correct outline, wrong line numbers, a fabricated
  snippet, a fragment, punctuation only, a join with no code evidence, joins to unconfirmed, missing or same parts,
  a part outside the codebase and by path traversal (`../../etc/passwd`, `/etc/passwd`, `./src/api.ts`), hostile
  names with bidi controls and line breaks (`visibleText`), a depth bomb, a huge answer, 5,000 parts, duplicate
  ids, extra keys. Also: the quote rule equals the Investigator's on the same inputs, the shared-file rule, and the
  proof-file section: round trip, and 10 tampers (part made confirmed, model-only join promoted, edge added, file
  text, text plus hash plus size, outline swapped, usage, contributor model, `..` path, extra key). Verify never
  throws on a 100,000-deep nest, a 400 KB text, wrong types or a cycle.
- `outline-atlasfile.test.ts` (1): a real round's `.atlas.json` (TS sandbox real) verifies without an outline,
  verifies with one, fails when a part is edited to confirmed or the code map is emptied, and never throws on a
  hostile `outline` value.
- `outline-server.test.ts` (14): upload limits and skip reasons, GitHub intake with a mocked fetch (subfolder,
  symlink, submodule, token sent to api.github.com only, a tampered download refused, a missing folder), URL
  parsing, the Outliner (one call; exactly one repair; never a third call; depth bomb; contributor ids refused
  with nothing sent), and the routes: upload → job → verified outline → part details (real lines and the
  definitions' parameters and return types read from the code) → outline file that verifies; another session gets
  404 on every route; 429 per address; 409 while a job runs; 413 for 51 files; 400 for a bad repo; a Wonder
  failure still gives the code map; a GitHub intake error fails the job with its reason.

## Routes for X2

`POST /outline/jobs {repo, ref?, subfolder?} | {files: [{path, text}]}` → 202 `{jobId, status}` ·
`GET /outline/jobs/:id` (status: reading, mapping, asking-wonder, checking, done, failed) ·
`GET /outline/jobs/:id/outline` (verified outline, code map, file list without text, skipped, usage, labels) ·
`GET /outline/jobs/:id/parts/:partId` · `GET /outline/jobs/:id/atlas` (the outline-only proof file, with the code).
All need `x-atlas-session`. Another session gets 404. Limits: 10 jobs an hour per address
(`ATLAS_OUTLINES_PER_IP_PER_HOUR`), 5 per session, one running at a time per session. The Wonder call also counts
against the shared per-address model-round limit and the model budget. `ATLAS_OUTLINER=off` turns Wonder off; the
code map is still built.

## Not done, limits, and things to know

- **Not built:** the UI (X2), "Bet on this part" into the paste loop (X2), attaching an outline to a round's file
  (the schema and the check are ready; nothing writes one yet), common-failure labels beyond Wonder's pattern list
  (X3).
- **X2 must keep round files that carry an outline in memory only, never published**, the way E3 keeps pasted
  rounds. The outline section holds the code, and `ATLAS_PUBLISH_PROOFS=1` writes round files to the public
  `proofs/` folder.
- **The code map's reach:** a local name that shadows an imported one is still counted as the import. Calls
  through a value passed around (`const f = save; f()`) are not followed. tsconfig path aliases (`@/x`) are
  unresolved. Python: nested functions, conditional-import conditions and star-args are not interpreted. An
  absolute Python import that matches several files is unresolved rather than guessed.
- **What the proof-file check cannot prove:** that the files really are those of the named commit (that needs
  GitHub; intake checks each blob when it reads it), or that Wonder really wrote this outline (the file is not
  signed). It proves the stored verdicts are what plain code gives for the stored files and outline.
- **Wording is part of the proof:** the reasons in a verified outline are compared word for word on verify. If a
  later commit rewords a reason, outline files made before it stop verifying. Old round files are unaffected.
  A version field for the wording would fix this; not done.
- **The live summaries were made just before one rule was tightened** (an edge inside one part never confirms a
  join, commit `ea7bd99`). In both live runs no two parts share a file, so the rule changes nothing there.
- **The GitHub token:** the itsdangerous run used the logged-in `gh` account's token at run time
  (`GITHUB_TOKEN=$(gh auth token)`), because this machine's unauthenticated GitHub allowance was used up. The
  token was sent to api.github.com only, never printed or stored.
