# D03-00: the Base RPC can serve the archive reads Atlas needs

Date: 2026-10-27 (WAT)

The EVM runner forks Base at blocks from February 2026, so its RPC (the remote node anvil
copies state from) must answer reads at old blocks ("archive" reads) without throttling us.
The URL is private: it lives outside the repo and is loaded at run time. The evidence shows
only the provider's domain.

## Command and raw output

| Command | Output file | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; sh tests/tools/rpc-check.sh )` | `rpc-check.txt` | all checks matched, exit 0 |

- `cast block 42194663 -f timestamp` → `1771178673` (matched)
- `getFeed("cbETH")` on the Moonwell oracle at block 42194662 → `0xB0Ba0C5D7DA4ec400C1C3E5ef2485134F89918C5` (the old feed; matched)
- same call at block 42194663 → `0x67996D1ff7a3711a91E2839d1059Fcb950C0495D` (the feed MIP-X43 set; matched)
- 50 `eth_call`s back to back at 50 different old blocks: 50 answered, 0 rate-limited (HTTP 429), 0 other errors, 52 s (about 1 s per call, mostly `cast` start-up).

Also added: `.env.example` with empty `BASE_RPC_URL=` and `META_API_KEY=`. The allow-list
`.gitignore` already lets it through (`!.env.example` is the last rule that matches it;
`git add --dry-run .env.example` adds it), so `.gitignore` was not changed.

## What it proves

- This RPC serves Base mainnet (chain id 8453) state at the two blocks the Moonwell plan uses,
  and the oracle's cbETH feed flips between 42194662 and 42194663 there, as expected.
- 50 sequential archive reads did not hit a rate limit on this day.

## What it does not prove

- That the RPC will not throttle a heavier load (parallel calls, or an anvil fork that fetches
  many storage slots at once). D03-02 exercises it through anvil.
- That it stays available: it is a free-tier plan and can change.
- Anything about the URL itself: it is never printed, and only its domain appears here.
