// Probe: does anvil echo the fork URL in errors, and do the unredacted paths pass it through?
import { createServer } from "node:http";
import { startAnvil } from "../../../../runners/evm/anvil.ts";
import { localClient, getFeed } from "../../../../runners/evm/reads.ts";
import { traceUnderlyingPriceSources, applyFeedActions } from "../../../../runners/evm/apply.ts";
import { assertPreExecution, why } from "../../../../runners/evm/control.ts";
import { MOONWELL_cbETH, TEMPORAL_GOVERNOR } from "../../../../runners/evm/moonwell-base.ts";

const block = { number: "0x100", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), nonce: "0x0000000000000000", sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347", logsBloom: "0x" + "00".repeat(256), transactionsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421", stateRoot: "0x" + "33".repeat(32), receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421", miner: "0x" + "00".repeat(20), difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", size: "0x200", gasLimit: "0x1c9c380", gasUsed: "0x0", timestamp: "0x65000000", transactions: [], uncles: [], baseFeePerGas: "0x1", mixHash: "0x" + "00".repeat(32) };
let failing = false;
const srv = createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const msgs = JSON.parse(body); const arr = Array.isArray(msgs) ? msgs : [msgs];
    const out = arr.map((m: any) => {
      if (m.method === "eth_chainId") return { jsonrpc: "2.0", id: m.id, result: "0x2105" };
      if (m.method === "eth_blockNumber") return { jsonrpc: "2.0", id: m.id, result: "0x100" };
      if (m.method === "eth_getBlockByNumber" || m.method === "eth_getBlockByHash") return { jsonrpc: "2.0", id: m.id, result: block };
      if (m.method === "net_version") return { jsonrpc: "2.0", id: m.id, result: "8453" };
      if (!failing && (m.method === "eth_getBalance" || m.method === "eth_getTransactionCount")) return { jsonrpc: "2.0", id: m.id, result: "0x0" };
      if (!failing && m.method === "eth_getCode") return { jsonrpc: "2.0", id: m.id, result: "0x" };
      if (!failing && m.method === "eth_getStorageAt") return { jsonrpc: "2.0", id: m.id, result: "0x" + "00".repeat(32) };
      return null;
    });
    if (out.some((x) => x === null)) { res.statusCode = 500; res.end("boom"); return; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(Array.isArray(msgs) ? out : out[0]));
  });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
const port = (srv.address() as any).port;
const SECRET = `http://127.0.0.1:${port}/v2/SUPERSECRETKEY0123456789`;
process.env.BASE_RPC_URL = SECRET;
const fork = await startAnvil({ forkBlock: 256, rpcUrl: SECRET, readyTimeoutMs: 20000 });
const client = localClient(fork.url);
failing = true; srv.closeAllConnections(); await new Promise((r)=>srv.close(()=>r(null)));
const has = (s: string) => ({ key: s.includes("SUPERSECRETKEY"), host: s.includes(`127.0.0.1:${port}`) });
try { await getFeed(client, "cbETH"); } catch (e: any) { console.log("getFeed raw:", has(e.message), "| redacted by why():", has(why(e))); console.log("SAMPLE:", e.message.replace(/SUPERSECRETKEY\w+/g, "[KEY]").slice(0, 400)); }
const t = await traceUnderlyingPriceSources(client, MOONWELL_cbETH);
console.log("trace reason:", has((t as any).reason ?? ""));
try { await assertPreExecution(fork); } catch (e: any) { console.log("assertPreExecution:", has(e.message)); }
try { await applyFeedActions(client, TEMPORAL_GOVERNOR, [{ symbol: "cbETH", wrapper: "0x67996D1ff7a3711a91E2839d1059Fcb950C0495D" }]); } catch (e: any) { console.log("applyFeedActions:", has(e.message)); }
await fork.stop();
