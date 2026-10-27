# D03-01: the Moonwell pass rule was committed before any EVM run

Date: 2026-10-27 (WAT)

A pass rule written after seeing the results could be bent to fit them. So
`proofs/moonwell/PASS-RULE.md` (blocks, addresses, the 10%-of-observed bet tolerance, the 50% flag
rule, the 2% false-alarm and replay rules, the WETH control, the wording) was committed on its
own, as the first commit of this task, before Atlas forked Base even once.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `git log --diff-filter=A` on PASS-RULE.md, `git show --stat` of that commit, the list of EVM run.json files ever added, and the order test | `commit.txt` | PASS-RULE.md added in `98e71ef` with no other file; no EVM run.json exists yet; 3 tests passed |

## The test

`tests/unit/pass-rule-order.test.ts` reads git history. For every `proofs/**/run.json` ever added
(even if deleted later) whose content is an EVM run, it checks that the commit adding
PASS-RULE.md is a strict ancestor of it and no newer by commit time. Today there is no EVM
run.json, so the order check passes trivially and its test name says so. A shallow clone has no
history to check: the test is skipped, not failed.

A probe in a throwaway clone (not committed) showed it bites: a run.json added after the rule
passed; a run.json committed first with the rule cherry-picked on top failed with "PASS-RULE.md
commit is not an ancestor". The commit-time check alone did not catch that case (both commits
had the same second), which is why the ancestry check is there.

## What it proves

- PASS-RULE.md was committed alone, before any EVM run file, on branch `d03-evm`.

## What it does not prove

- That nobody ran a fork privately before writing the rule. Git can only order what was committed.
  (In fact no fork had run: D03-00's reads used `cast` against the RPC, not anvil, and came after.)
- That the commit hash stays `98e71ef`: a rebase onto main rewrites it. The test checks order, not
  the hash, so it still holds after a rebase that keeps the order.
