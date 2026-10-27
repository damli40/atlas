# D03-04: GitHub target (PR #578 at its merge commit) and the Moonwell copies

Date: 2026-10-27 (WAT)

Plain words: `server/targets/github.ts` downloads the files a merged pull request changed, exactly
as they are at the pull request's merge commit, and computes one fingerprint (`codeSha256`) for
all of them. `contracts/lib/moonwell/` keeps byte-for-byte copies of the 4 files Atlas reads,
with Moonwell's license.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `pnpm exec tsx tests/tools/github-target-check.ts tests/evidence/D03-04/pr578-fetch.json` | `pr578-fetch.json`, `fetch-output.txt` | 6/6 files fetched, 4 copies matched, 2 not copied (on purpose) |
| `pnpm exec vitest run tests/unit/github-target.test.ts --reporter=verbose` | `test-output.txt` | 21 passed (includes the real fetch) |
| `ATLAS_OFFLINE=1 pnpm exec vitest run tests/unit/github-target.test.ts --reporter=verbose` | `offline-skip.txt` | 20 passed, 1 skipped (the network test skips, it does not fail) |
| `pnpm test` | `full-suite.txt` | 315 passed, 8 skipped |

Also green: `pnpm exec tsc -p tsconfig.json` (no output) and `pnpm gate:day1` (18 matched, 1 didn't match, 1 can't check, as before).

## The 6 changed files at `9a6738e189fa903bffa0abf10b9dd7ed2fe73a18`

| Path | Lines | SHA-256 of the fetched bytes | Copy in contracts/lib/moonwell/ |
|---|---|---|---|
| `chains/10.json` | 782 | `6aa4053ada5aa13aa615b9844e154b8e04e3b524f8e9ddb2b91e5f1523e0d088` | not copied (Optimism; Atlas does not use it) |
| `chains/8453.json` | 1407 | `b3121869f10e149692fd37cfd47be5faf73936d2957a329a2a7a4cc54c09dc06` | matched (full file) |
| `proposals/ChainlinkOracleConfigs.sol` | 188 | `1051200988ea46e5731052d7cc3387dcb7541bfbba01ebea6e2eabf4563ad383` | matched |
| `proposals/mips/mip-x43/mip-x43.sol` | 701 | `fa2a8c6333521534acf51d8b2e89dc034514bd1b291b2233097ff3e0e4fc2bd6` | matched |
| `proposals/mips/mip-x43/x43.md` | 103 | `8d37734a593877af61614b6a9360c2206fceac651faf2d6839c51ac0c09696c9` | matched |
| `proposals/mips/mips.json` | 835 | `25eb2e4cc21cf987cefc9d2ff20d4297e0f14620ad5d4ec0212cc3b4642d5137` | not copied (proposal index; Atlas does not use it) |

Every file ends with a newline, so these line counts equal `wc -l`.
Also copied: the repo's `LICENSE` (BSD-3-Clause, "Copyright 2023 Lunar Enterprise Ventures, Ltd."), SHA `e7965e78…79f4`.

**codeSha256 of the whole PR = `6c431aaec1a5631719cb0c90128b0b2b0f294bafb3634c775cb93fee0670f7c7`.**
Rule (in a comment in `github.ts`): for each fetched file sorted by path, `path + "\n" + bytes + "\n"`,
then SHA-256 of the whole. Cross-checked by a separate shell pipeline over files downloaded with
`curl` (`printf '%s\n' path; cat file; printf '\n'` in path order, piped to `shasum -a 256`): same hash.

## Choices made

- **`chains/8453.json` is the full file, not a slice.** A slice would no longer match the fetched
  SHA, which is this task's acceptance check, and D04-01 needs entries beyond the 14 wrapper names
  (token addresses for each symbol, the mTokens, the oracle). Slicing risked dropping a key the
  parser needs. Cost: 1407 lines instead of about 60.
- **Copies keep the repo's own paths** (`proposals/…`, `chains/…`) so a path in the fetched
  target and a path in the copy are the same string.
- **A license surprise:** the repo is BSD-3-Clause, but `mip-x43.sol` declares
  `SPDX-License-Identifier: GPL-3.0-or-later` in its first line. NOTICE.md says so, and the GPL-3.0
  text is added as `LICENSE-GPL-3.0.txt` (from gnu.org). `ChainlinkOracleConfigs.sol` has no SPDX line,
  so the repo's BSD-3-Clause applies to it.
- The network test is skipped when `ATLAS_OFFLINE=1` or `api.github.com/zen` does not answer in 3 s,
  and skipped (not failed) if GitHub rate-limits this IP. It uses 3 unauthenticated API requests per
  `pnpm test` run (out of 60 per hour).

## What this proves

- The fetcher returns all 6 changed files of PR #578 at the merge commit, none removed, none binary,
  `x43.md` among them.
- The 4 committed copies are byte-identical to what GitHub serves at that commit (fetched SHA =
  committed SHA), and an offline test keeps checking the copies against the pinned SHAs.
- The fingerprint is stable: it does not depend on the order GitHub lists files, it changes when one
  byte changes, and the path is part of it (mocked tests).
- Not merged, rate limit (403 with 0 left, and 429), plain 403, incomplete file list, removed files,
  binary files and network failure each give a plain, typed result. The optional token goes only to
  api.github.com and never appears in an error.

## What this does not prove

- Nothing about what the Moonwell code does: that is D04-01 (deriving the 14 feed pairs) and D04-02 (the fork run).
- Not that the merge commit equals what was deployed on Base; that link is the fork run's job.
- Not tested: GitHub Enterprise hosts, PRs with more than 3000 files (GitHub's own listing limit),
  files that need Git LFS (raw would return the pointer file, and Atlas would fingerprint the pointer).
- Not checked by a lawyer: whether keeping a GPL file next to MIT code needs anything more than its
  notice and the GPL text. Atlas does not compile or link it.

Note for D04-01: in `ChainlinkOracleConfigs.sol` each `push(` and its `OracleConfig(...)` sit on
**separate lines**, and commented-out pushes are `// ` on both lines. A one-line regex will miss all 14.
