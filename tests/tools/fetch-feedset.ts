// D04-01 test data: the 14 real FeedSet events MIP-X43 emitted on Base, fetched once and stored as
// data (tests/oracle/mipx43-feedset-42194663.json). Atlas never derives anything from this file; it
// only compares its own derived list against it.
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/fetch-feedset.ts tests/oracle/mipx43-feedset-42194663.json )
// Reads the transaction receipt from the remote RPC (BASE_RPC_URL, never written or printed) and
// decodes each log emitted by the oracle with topic0 = keccak256("FeedSet(address,string)").

import { writeFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http, parseAbi, toEventSelector, type Hex } from "viem";
import { redact } from "../../runners/evm/anvil.ts";
import { CHAINLINK_ORACLE } from "../../runners/evm/moonwell-base.ts";

export const MIPX43_TX: Hex = "0xd26baf29dcba7bf66db4be17b46a49bb4dacca41ace968c98c8a5b09a03ae812";
export const MIPX43_BLOCK = 42194663;
const EVENT_SIG = "event FeedSet(address feed, string symbol)";

async function main(out: string) {
  const rpc = process.env.BASE_RPC_URL;
  if (!rpc) throw new Error("BASE_RPC_URL is not set");
  const client = createPublicClient({ transport: http(rpc, { retryCount: 2 }) });
  const receipt = await client.getTransactionReceipt({ hash: MIPX43_TX });
  const abi = parseAbi([EVENT_SIG]);
  const topic0 = toEventSelector(EVENT_SIG);
  const events = receipt.logs
    .filter((l) => l.address.toLowerCase() === CHAINLINK_ORACLE.toLowerCase() && l.topics[0] === topic0)
    .map((l) => {
      const d = decodeEventLog({ abi, data: l.data, topics: l.topics });
      return { logIndex: l.logIndex, symbol: d.args.symbol, wrapper: d.args.feed };
    });
  const data = {
    about: "The FeedSet events Moonwell's ChainlinkOracle emitted in the MIP-X43 execution transaction on Base. Test data for D04-01: Atlas compares its derived (symbol, wrapper) pairs against these; it never derives from them.",
    chainId: 8453,
    oracle: CHAINLINK_ORACLE,
    txHash: MIPX43_TX,
    blockNumber: Number(receipt.blockNumber),
    txStatus: receipt.status,
    event: EVENT_SIG,
    topic0,
    method: "eth_getTransactionReceipt, logs from the oracle filtered by topic0, decoded with viem decodeEventLog",
    fetchedAt: new Date().toISOString(),
    count: events.length,
    events,
  };
  if (data.blockNumber !== MIPX43_BLOCK) throw new Error(`receipt is in block ${data.blockNumber}, expected ${MIPX43_BLOCK}`);
  writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  process.stdout.write(`${events.length} FeedSet events at block ${data.blockNumber}, status ${receipt.status}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2] ?? "tests/oracle/mipx43-feedset-42194663.json").catch((e) => {
    process.stderr.write(redact(e instanceof Error ? e.message : String(e), process.env.BASE_RPC_URL) + "\n");
    process.exit(1);
  });
}
