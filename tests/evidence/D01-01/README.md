# D01-01: repo, licence, first commit

Date: 2026-10-27 (WAT)

## Commands

```
git log --oneline --stat     > git-log.txt
git status --ignored --short > git-ignored.txt
```

Both were run before the D01-01 commit, so `git-log.txt` shows commit 1 only, and
`git-ignored.txt` shows LICENSE and README.md as not yet committed (`??`).

## What it proves

- Commit 1 (`aa567d6`) holds exactly two files: `PRE-EXISTING.md` and `.gitignore`.
  No code was committed before the list of pre-existing work.
- The private planning folders and files are ignored by git (lines starting `!!`):
  `docs/`, `pitch/`, `research/`, `official/`, `.mida/`, `CLAUDE.md`, `BUILD-CARD.md`,
  `VISION.md`, `atlas-prep.md`, and `brand/logo-explore.html`.

## What it does not prove

- That nothing private was ever pushed anywhere else. It only shows this local
  repo's state at the time of the command.
- That later commits stay clean. Each later commit has to be checked on its own.
- That the dates in the commit are trustworthy: git commit dates can be set by hand.
  A public remote's push time is the stronger record.
