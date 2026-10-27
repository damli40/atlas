# What existed before the hackathon (Oct 27, 2026)

The Meta Global AI Developer Hackathon judges only work built Oct 27 – Nov 4, 2026.
This file lists everything Atlas uses or shows that existed before Oct 27, so judges
can tell it apart. Anything on this list that appears on screen carries a
"Pre-existing" label.

## Code and data Atlas runs or reads (not written during the hackathon)
- `withRpcRetry` and its constants: 56 lines (31–86) of `chain-reads.ts` from Dami's
  production LayerZero monitor (private repo), SHA-256 of the whole file
  bf2d018c092deba95fb40fc6c4a934e2b2992b58bcde2b83d08590d197059fb6. Copied verbatim
  into tests/fixtures/with-rpc-retry.ts. Atlas checks it; it is not part of Atlas.
- The "oracle table" of what withRpcRetry does in 8 scenarios (tests/oracle/), written
  Oct 22, 2026 as planning. It is test data, not product code.
- Moonwell's MIP-X43 files (PR moonwell-fi/moonwell-contracts-v2 #578, merged Feb 10,
  2026; the repo is BSD-3-Clause, and mip-x43.sol itself declares GPL-3.0-or-later;
  both notices are kept in contracts/lib/moonwell/). Third-party code Atlas
  re-runs on a fork. Atlas did not write it and does not judge it.
- Public facts researched Oct 26 (before the window): the execution block 42194663,
  the oracle, market and feed addresses, and the live before/after prices. These are
  inputs and expectations; every number on screen is re-read from the fork at run time.

## Assets made before Oct 27
- The Atlas logo (brand/atlas-logo/, "two bets, one answer"), designed Oct 26, 2026.
- Planning documents (spec, decisions, briefs) are private and not in this repo.

## Tools and third-party software
- Anatomy skill (github.com/wheresryan22/anatomy, MIT): a design method and SVG kit for
  isometric figures. Its kit files are copied into web/machines/iso/ with the license.
  The two Atlas machines (retry machine, price pipe) are built during the hackathon.
- Foundry 1.8.6, Node 25, pnpm, Vite, React, Hono, zod, vitest, viem.
- Meta Model API, Muse Code CLI 1.4.13, Baseten (Muse Spark Open), optionally Modal.

## Pre-window tests (evidence only, not product)
- One Muse Wonder API call on Oct 26, 2026, to confirm access from Nigeria and learn
  the reasoning-token behaviour (4,000 tokens of hidden thinking left the content
  empty; 16,000 with reasoning_effort "low" worked). Its prompt is not reused as-is.

## Explicitly NOT used
- Mida (Dami's earlier memory tool): not a dependency, not shown, never run.
- Dami's OFT Sentinel product: only the 56 fixture lines above are taken from it.

## Everything else
All of src/, server/, runners/, web/, contracts/src, contracts/test, tests/unit,
tests/evidence, proofs/ and the README are written Oct 27 – Nov 4, 2026. The git
history is the record: this file is commit 1.
