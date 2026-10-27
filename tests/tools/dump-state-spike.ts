// D03-05 spike: can a Level 1 read be replayed with no network from a dumped anvil state?
//
// Steps: (1) fork Base at a block with `--dump-state`, do every Level 1 read (control, cbETH,
// reference); (2) stop anvil so it writes the state file; (3) start a fresh anvil with only
// `--load-state` (no --fork-url, so it has no remote to fetch from) and do the same reads;
// (4) compare the two read sets byte for byte.
//
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/dump-state-spike.ts 42194663 tests/evidence/D03-05 )
//
// The RPC URL is passed to the first anvil only, never logged; anvil output is redacted.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, redact } from "../../runners/evm/anvil.ts";
import { cbEthReference, readControl, readNamedMarket, why } from "../../runners/evm/control.ts";
import { localClient } from "../../runners/evm/reads.ts";

async function waitReady(url: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("anvil did not answer");
}

async function withAnvil<T>(args: string[], fn: (url: string) => Promise<T>): Promise<{ value: T; output: string }> {
  const port = await freePort();
  const child = spawn("anvil", [...args, "--port", String(port), "--host", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const keep = (b: Buffer) => (output = (output + redact(b.toString("utf8"), process.env.BASE_RPC_URL)).slice(-4000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  try {
    const url = `http://127.0.0.1:${port}`;
    await waitReady(url, 60_000);
    return { value: await fn(url), output };
  } finally {
    child.kill("SIGTERM"); // anvil writes --dump-state on a clean exit
    await exited;
  }
}

/** Every Level 1 read, without times or ids, so two runs can be compared byte for byte. */
async function level1Reads(url: string, forkBlock: number) {
  const client = localClient(url);
  const out: Record<string, unknown> = {};
  out.control = await readControl(client, forkBlock);
  try {
    out.cbETH = await readNamedMarket(client, "cbETH");
  } catch (e) {
    out.cbETH = { error: why(e) };
  }
  out.reference = await cbEthReference(client, forkBlock);
  return out;
}

const forkBlock = Number(process.argv[2] ?? 42194663);
const dir = process.argv[3];
const rpc = process.env.BASE_RPC_URL;
if (!rpc) throw new Error("BASE_RPC_URL is not set");
const work = mkdtempSync(join(tmpdir(), "atlas-dump-"));
const stateFile = join(work, "state.json");

const t0 = Date.now();
const forked = await withAnvil(["--fork-url", rpc, "--fork-block-number", String(forkBlock), "--dump-state", stateFile, "--silent"], (url) => level1Reads(url, forkBlock));
const forkMs = Date.now() - t0;
const stateBytes = statSync(stateFile).size;

const t1 = Date.now();
// No --fork-url: this anvil cannot reach any remote node. --chain-id 8453 so the chain id check sees Base.
const loaded = await withAnvil(["--load-state", stateFile, "--chain-id", "8453", "--silent"], (url) => level1Reads(url, forkBlock));
const loadMs = Date.now() - t1;

const a = JSON.stringify(forked.value, null, 2);
const b = JSON.stringify(loaded.value, null, 2);
const identical = a === b;
const summary = {
  forkBlock,
  stateFileBytes: stateBytes,
  forkedRunMs: forkMs,
  loadedRunMs: loadMs,
  identicalByteForByte: identical,
  forkedControlPassed: (forked.value.control as { passed: boolean }).passed,
  loadedControlPassed: (loaded.value.control as { passed: boolean }).passed,
  loadedControlReasons: (loaded.value.control as { reasons: string[] }).reasons,
};
if (dir) {
  writeFileSync(join(dir, `forked-reads-${forkBlock}.json`), a + "\n");
  writeFileSync(join(dir, `loaded-reads-${forkBlock}.json`), b + "\n");
  writeFileSync(join(dir, `summary-${forkBlock}.json`), JSON.stringify(summary, null, 2) + "\n");
}
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
rmSync(work, { recursive: true, force: true });
