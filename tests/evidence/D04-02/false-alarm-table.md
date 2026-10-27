# Level 2 false-alarm table

Caption: **fork of Base one block before MIP-X43 ran; Atlas applied the proposal's oracle-feed actions as the governor**.

Fork block 42194662; 14 setFeed actions applied (fork block after apply: 42194676). Prices are Moonwell's getUnderlyingPrice brought to USD by src/units.ts, shown rounded to the cent; exact values are in level2.json. A market is flagged when its post-apply price differs from what it is compared against by more than 50% (PASS-RULE.md).

| Market | Feed changed? | Pre-apply (USD) | Post-apply (USD) | Post-apply exact (USD × 1e18) | Diff vs pre | Flag compares against | Diff vs that | Flagged? |
|---|---|---|---|---|---|---|---|---|
| DAI | yes | $1.00 | $1.00 | 999900000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| USDC | yes | $1.00 | $1.00 | 999900000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| USDbC | yes | $1.00 | $1.00 | 999900000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| cbETH | yes | $2,206.68 | $1.12 | 1122662744874806300 | -99.9491% | raw Chainlink reference $2,206.68 | -99.9491% | **yes** |
| AERO | yes | $0.31 | $0.31 | 310865530000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| cbBTC | yes | $68,489.74 | $68,489.74 | 68489740000000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| EURC | yes | $1.18 | $1.18 | 1184823110000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| WELL | yes | $0.01 | $0.01 | 5012000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| USDS | yes | $1.00 | $1.00 | 999635870000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| tBTC | yes | $68,265.91 | $68,265.91 | 68265908984780000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| VIRTUAL | yes | $0.63 | $0.63 | 627045790000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| MORPHO | yes | $1.32 | $1.32 | 1323195190000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| cbXRP | yes | $1.49 | $1.49 | 1493697000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| MAMO | yes | $0.01 | $0.01 | 14376590000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
