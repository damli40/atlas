// S1 (days 3–4 review): no error or message that leaves runners/evm carries the RPC URL, its host,
// its endpoint subdomain or its key: not in a thrown error, a trace reason, the agent-log SSE, an
// HTTP body (/runs, /replay) or an .atlas.json.
//
// The secret here is FAKE (a made-up endpoint and key, never a real one). A local JSON-RPC stand-in
// answers every call with an error that echoes it, the way anvil echoes its fork URL ("MPP HTTP
// request to <url> failed"). No real RPC is called.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAnvil } from "../../runners/evm/anvil.ts";
import { applyFeedActions, planFromPrFiles, resolveSymbols, traceUnderlyingPriceSources } from "../../runners/evm/apply.ts";
import { assertPreExecution } from "../../runners/evm/control.ts";
import { runLevel2OnFork } from "../../runners/evm/level2.ts";
import { MOONWELL_cbETH, TEMPORAL_GOVERNOR } from "../../runners/evm/moonwell-base.ts";
import { localClient } from "../../runners/evm/reads.ts";
import { redact, scrubDeep } from "../../runners/evm/redact.ts";
import { evmRunner } from "../../runners/evm/runner.ts";
import { level2Experiment } from "../tools/level2-run.ts";
import { level2Round, liveRunFor } from "../tools/review-fixtures.ts";

const HOST = "abc-def.base-mainnet.quiknode.pro"; // secret-scan: allow (made up)
const TOKEN = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"; // secret-scan: allow (made up)
const FAKE = `https://${HOST}/${TOKEN}/`; // secret-scan: allow (made up)
const ECHO = `MPP HTTP request to ${FAKE} failed: error sending request for url (${FAKE.slice(0, -1)}) at ${HOST.toUpperCase()} path /${TOKEN}`;

/** Every way the secret could show, checked case-insensitively. */
function leaks(text: string): string[] {
  const t = text.toLowerCase();
  return [FAKE, HOST, "abc-def", "quiknode.pro", TOKEN].filter((x) => t.includes(x.toLowerCase()));
}

let server: Server;
let url = "";
/** Methods the stand-in answers successfully; everything else errors with ECHO. */
const ok: Record<string, unknown> = {};
const savedEnv = process.env.BASE_RPC_URL;

beforeAll(async () => {
  process.env.BASE_RPC_URL = FAKE;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msgs = JSON.parse(body);
      const one = (m: { id: number; method: string }) =>
        m.method in ok ? { jsonrpc: "2.0", id: m.id, result: ok[m.method] } : { jsonrpc: "2.0", id: m.id, error: { code: -32603, message: ECHO } };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(msgs) ? msgs.map(one) : one(msgs)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => {
  if (savedEnv === undefined) delete process.env.BASE_RPC_URL;
  else process.env.BASE_RPC_URL = savedEnv;
  await new Promise((r) => server.close(() => r(null)));
});

const messageOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the call to fail");
};

describe("S1: one redaction on every runner error path", () => {
  it("the redaction removes the full URL, the host, the endpoint subdomain and the key, in any case", () => {
    const out = redact(ECHO, FAKE);
    expect(leaks(out)).toEqual([]);
    expect(out).toContain("<rpc>");
    expect(out).toContain("<rpc-host>");
    // Chain data is left alone: an address, a hash, the word Base.
    const data = "fork of Base; 0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5; base-mainnet";
    expect(redact(data, FAKE)).toBe(data);
  });

  it("setFeed: a refused transaction, and a refused impersonation", async () => {
    ok.anvil_impersonateAccount = null;
    ok.anvil_setBalance = null;
    const client = localClient(url);
    const a = await messageOf(applyFeedActions(client, TEMPORAL_GOVERNOR, [{ symbol: "cbETH", wrapper: "0x67996D1ff7a3711a91E2839d1059Fcb950C0495D" }]));
    expect(a).toMatch(/was not accepted/);
    expect(leaks(a)).toEqual([]);
    delete ok.anvil_impersonateAccount;
    const c = await messageOf(applyFeedActions(client, TEMPORAL_GOVERNOR, []));
    expect(c).toMatch(/anvil_impersonateAccount/);
    expect(leaks(c)).toEqual([]);
    delete ok.anvil_setBalance;
    delete ok.eth_sendTransaction;
  }, 20_000);

  it("the pre-execution check", async () => {
    const m = await messageOf(assertPreExecution({ url }));
    expect(m).toMatch(/pre-execution check could not read/);
    expect(leaks(m)).toEqual([]);
  });

  it("the symbol reads", async () => {
    const m = await messageOf(resolveSymbols(localClient(url), planFromPrFiles()));
    expect(m).toMatch(/symbol\(\) of 0x/);
    expect(leaks(m)).toEqual([]);
  });

  it("the call trace", async () => {
    const t = await traceUnderlyingPriceSources(localClient(url), MOONWELL_cbETH);
    expect(t.ok).toBe(false);
    expect(leaks(!t.ok ? t.reason : "")).toEqual([]);
  });

  it("a whole Level 2 run on a fork that fails", async () => {
    const m = await messageOf(runLevel2OnFork(localClient(url), { url }, 42194662));
    expect(leaks(m)).toEqual([]);
  });

  it("scrubDeep: every string of a Run, keys included", () => {
    const run = { a: ECHO, b: [ECHO, 1, null, { [ECHO]: ECHO }], c: true };
    expect(leaks(JSON.stringify(scrubDeep(run)))).toEqual([]);
  });

  it("anvil spawn/exit: anvil echoes its fork URL and exits, directly and through the runner", async () => {
    // A stand-in "anvil" first on PATH: it prints the URL it was given (as a fork error does) and exits 1.
    const dir = mkdtempSync(join(tmpdir(), "atlas-fake-anvil-"));
    writeFileSync(join(dir, "anvil"), '#!/bin/sh\necho "error: failed to fork from $2: MPP HTTP request to $2 failed" >&2\nexit 1\n');
    chmodSync(join(dir, "anvil"), 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${dir}:${savedPath}`;
    try {
      const m = await messageOf(startAnvil({ forkBlock: 42194662, rpcUrl: FAKE, readyTimeoutMs: 10_000 }));
      expect(m).toMatch(/anvil exited before it was ready/);
      expect(m).toContain("<rpc>");
      expect(leaks(m)).toEqual([]);
      const r = await messageOf(evmRunner({ rpcUrl: FAKE }).run(level2Experiment(), { forkBlock: 42194662 }));
      expect(r).toMatch(/anvil exited before it was ready/);
      expect(leaks(r)).toEqual([]);
      const ctl = await messageOf(evmRunner({ rpcUrl: FAKE, controlForkBlock: 42194662 }).control(level2Experiment().target));
      expect(leaks(ctl)).toEqual([]);
      process.env.PATH = "/nonexistent-atlas-path";
      const spawnErr = await messageOf(startAnvil({ forkBlock: 42194662, rpcUrl: FAKE, readyTimeoutMs: 5_000 }));
      expect(spawnErr).toMatch(/spawn error|exited/);
      expect(leaks(spawnErr)).toEqual([]);
    } finally {
      process.env.PATH = savedPath;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("S1 at the server: SSE, HTTP bodies (/runs and /replay) and the .atlas.json", () => {
  it("a runner error that still carries the URL is redacted in the 503 body and the agent log", async () => {
    const { r, agentLog, session } = await level2Round(async () => {
      throw new Error(ECHO);
    });
    // Final review S2: a run that did not finish is a 503 ("try the run again"), no longer a 500.
    expect(r.status).toBe(503);
    expect(leaks(r.text)).toEqual([]);
    expect(leaks(JSON.stringify(agentLog.history(session)))).toEqual([]);
    expect(JSON.stringify(agentLog.history(session))).toMatch(/the run did not finish/);
  });

  it("a finished run whose strings carry the URL is scrubbed before the answer and the .atlas.json", async () => {
    const { r, file, ask } = await level2Round(async (exp) => {
      const run = liveRunFor(exp);
      run.result.notMeasured["preApplyPriceSources:cbETH"] = `debug_traceCall failed: ${ECHO}`;
      return run;
    });
    expect(r.status).toBe(200);
    expect(leaks(r.text)).toEqual([]);
    expect(leaks(JSON.stringify(file))).toEqual([]);
    const proof = await ask(`/proofs/${r.body.run.id}`);
    expect(leaks(proof.text)).toEqual([]);
  });

  it("/replay: an error during the replay is redacted in its body", async () => {
    let calls = 0;
    const { r, ask } = await level2Round(async (exp) => {
      if (++calls > 1) throw new Error(ECHO);
      return liveRunFor(exp);
    });
    expect(r.status).toBe(200);
    const rep = await ask(`/replay/${r.body.run.id}`);
    expect(rep.status).toBe(500);
    expect(leaks(rep.text)).toEqual([]);
  });
});
