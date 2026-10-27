# D06-01 · fair Moonwell retry for Muse Code (Oct 27, after the merge with d06-proof)

**Why a retry:** in the first live run, Muse Code stopped at Atlas's 3-step cap while still reading the
PR files, so it never answered. The lead decided it should get a real attempt.

**What changed before the retry (plain code only):**
- The prompt now also lists every name in the PR's `chains/8453.json` that names an oracle: 71 names,
  exactly as written there, in file order. Nothing says which one to use, and nothing mentions the incident.
- Muse Code may take 6 model steps instead of 3. `--model muse-spark-1.3` is named explicitly.
- `ATLAS_FIXER_REPAIR_WITH=chat`: one `muse exec` try; if plain code refuses it, one muse-spark-1.3 chat
  with the same inputs.

**What came back (live, run hhFxiKOUHg, fork 42194662; `replay-evm.json`):**
- Muse Code (`muse exec`, reported model `muse-spark-1.3`, 26,483 in / 558 out tokens, $0.117):
  line 42 `cbETHETH_ORACLE` → `cbETH_ORACLE`. Refused: `chains/8453.json` has no
  `cbETH_ORACLE_OEV_WRAPPER`, and mip-x43.sol wires `<name>_OEV_WRAPPER`.
- Spark chat fallback ($0.021): the same one-line edit, with no context lines. At the time it was refused by
  `git apply --check` (git refuses hunks with no context unless asked). `--unidiff-zero` was added afterwards.
  The stored answer, re-checked with no model call (`recheck-attempts.txt`), gives the same reason as Muse Code's.
- Shown: "Muse Code (fallback muse-spark-1.3): no usable change (...)". **Nothing replayed.** So all three
  PASS-RULE replay lines (same block, within 2% of the reference, 2 price sources) are **can't check**.

In plain words: both models picked the old cbETH price feed by name. In this proposal, a config name is only
usable when the address book also holds an "OEV wrapper" for it. There is none for that feed. So no change to
the config alone could wire it.

**Cost of the retry:** $0.16 (Spark bet $0.021 + Muse Code $0.117 + fallback $0.021), well under the $1.50 cap.

**Checks after the merge:** offline tests 564 passed / 17 skipped; with RPC 578 passed / 3 skipped; tsc exit 0;
`gate:day1` passed; `vite build` passed. `page-check.txt`: the page loads (not blank); the "Many callers at once"
tab and `?proof=` both render; the change panel renders in `evm-before-after.png`.

**Does not prove:** a live replay of a model's change on Moonwell (none was usable). The proof card's
before | after view is covered by tests (tests/unit/changes-server.test.ts), not by a live round.
