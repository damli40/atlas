// Moonwell on Base (chain id 8453): every address the EVM runner uses, in one place.
//
// Source: chains/8453.json in github.com/moonwell-fi/moonwell-contracts-v2 at merge commit
// 9a6738e189fa903bffa0abf10b9dd7ed2fe73a18 (pull request #578, MIP-X43). That file is public and
// BSD-3-Clause licensed. The name in brackets after each constant is its key in that file.
// These are inputs, not results: the runner re-reads every value it shows from the fork.

import type { Address } from "viem";

export const BASE_CHAIN_ID = 8453;

/** Pull request #578's merge commit, the code Atlas tests. */
export const MIP_X43_MERGE_COMMIT = "9a6738e189fa903bffa0abf10b9dd7ed2fe73a18";

/** Fork blocks. A fork "at N" holds the state AFTER block N. MIP-X43 executed on Base in 42194663. */
export const FORK_BLOCK = {
  /** One block before the proposal ran: Level 2 ("before ship"). */
  beforeProposal: 42194662,
  /** The block the proposal ran in: Level 1 ("after the fact"). */
  proposalExecuted: 42194663,
  /** A later block used by the read checks (D03-02). */
  readCheck: 42195500,
} as const;

/** Moonwell's price oracle [CHAINLINK_ORACLE]. getFeed(symbol), getUnderlyingPrice(mToken), admin(). */
export const CHAINLINK_ORACLE: Address = "0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0";
/** The oracle's admin [TEMPORAL_GOVERNOR]. */
export const TEMPORAL_GOVERNOR: Address = "0x8b621804a7637b781e2BbD58e256a591F2dF7d51";
/** Moonwell's Comptroller proxy [UNITROLLER]. Not used for prices; listed for completeness. */
export const UNITROLLER: Address = "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C";

/** Markets (mTokens). */
export const MOONWELL_WETH: Address = "0x628ff693426583D9a7FB391E54366292F509D457"; // [MOONWELL_WETH] control
export const MOONWELL_cbETH: Address = "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5"; // [MOONWELL_cbETH]
export const MOONWELL_USDC: Address = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22"; // [MOONWELL_USDC]

/** Underlying tokens (expected; the runner reads mToken.underlying() and checks). */
export const TOKEN = {
  WETH: "0x4200000000000000000000000000000000000006", // [WETH]
  cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", // [cbETH]
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // [USDC]
} as const satisfies Record<string, Address>;

/**
 * Raw Chainlink aggregators (never a wrapper) used for the reference price, with the decimals
 * they must report on-chain. A different on-chain value means the reference is not measured.
 */
export const RAW_FEED = {
  ETH_USD: { address: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70" as Address, decimals: 8 }, // [CHAINLINK_ETH_USD]
  cbETH_ETH: { address: "0x806b4Ac04501c29769051e42783cF04dCE41440b" as Address, decimals: 18 }, // [cbETHETH_ORACLE]
} as const;

/** cbETH feeds the oracle points at, before and after MIP-X43. */
export const CBETH_FEED = {
  /** [cbETH_ORACLE]: getFeed("cbETH") up to block 42194662. */
  before: "0xB0Ba0C5D7DA4ec400C1C3E5ef2485134F89918C5" as Address,
  /** [cbETHETH_ORACLE_OEV_WRAPPER]: getFeed("cbETH") from block 42194663 (18 decimals, a ratio). */
  afterProposal: "0x67996D1ff7a3711a91E2839d1059Fcb950C0495D" as Address,
} as const;
