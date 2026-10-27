# Third-party code: Moonwell

Everything in this folder except this NOTICE.md and `LICENSE-GPL-3.0.txt` is third-party code,
written by Moonwell, not by Atlas.

- Copied from: https://github.com/moonwell-fi/moonwell-contracts-v2
- At commit: `9a6738e189fa903bffa0abf10b9dd7ed2fe73a18` (the merge commit of pull request #578,
  "Add MIP-X43: Activate OEV wrappers for all remaining markets")
- Copied byte for byte, unchanged, at the same paths they have in that repository.
- License: the repository is licensed BSD-3-Clause. Its license text is kept verbatim in
  [`LICENSE`](LICENSE) (Copyright 2023 Lunar Enterprise Ventures, Ltd.).
- One file declares a different license in its own header:
  `proposals/mips/mip-x43/mip-x43.sol` starts with `// SPDX-License-Identifier: GPL-3.0-or-later`.
  That file stays under GPL-3.0-or-later; the GPL text is in
  [`LICENSE-GPL-3.0.txt`](LICENSE-GPL-3.0.txt) (from https://www.gnu.org/licenses/gpl-3.0.txt).
  Atlas does not compile or link it; it is kept here as a document Atlas reads.

| Path (same as in the Moonwell repo) | SHA-256 of the bytes |
|---|---|
| `chains/8453.json` (full file, not a slice) | `b3121869f10e149692fd37cfd47be5faf73936d2957a329a2a7a4cc54c09dc06` |
| `proposals/ChainlinkOracleConfigs.sol` | `1051200988ea46e5731052d7cc3387dcb7541bfbba01ebea6e2eabf4563ad383` |
| `proposals/mips/mip-x43/mip-x43.sol` | `fa2a8c6333521534acf51d8b2e89dc034514bd1b291b2233097ff3e0e4fc2bd6` |
| `proposals/mips/mip-x43/x43.md` | `8d37734a593877af61614b6a9360c2206fceac651faf2d6839c51ac0c09696c9` |
| `LICENSE` | `e7965e78ddd9d3372a7c2e2845bd494cfc5d2e337a23fd72bf511542608679f4` |

Pull request #578 changed 6 files. Only the 4 above are copied, because they are the ones Atlas
reads. The other two (`chains/10.json`, `proposals/mips/mips.json`) are fetched at run time by
`server/targets/github.ts` like the rest, but not kept here.

What Atlas does with this code: it re-runs the proposal's Base oracle-feed actions on a private
fork of Base and records what the prices did. Atlas does not judge this code, its authors or the
proposal. It shows what happened when the actions ran, and whose expectation matched.
