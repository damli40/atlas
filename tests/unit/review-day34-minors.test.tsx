// Minor fixes from the days 3–4 review (M1–M10 in tests/evidence/D04-review/README.md). Offline.

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { listeningPort, startAnvil } from "../../runners/evm/anvil.ts";
import { countPriceSources } from "../../runners/evm/apply.ts";
import { cbEthReference } from "../../runners/evm/control.ts";
import { evaluatePassRule, type Level2Record } from "../../runners/evm/level2.ts";
import { judge } from "../../src/judge";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile";
import type { Api, InvestigateAnswer } from "../../web/api";
import { FindingsPanel } from "../../web/screens/Findings";
import { liveLevel2 } from "../tools/review-fixtures";

const LRD = "0xfeaf968c";
const frame = (to: string, input: string, calls: unknown[] = []) => ({ type: "STATICCALL", to, input, calls });

describe("M1: a feed read another way makes the price-source count not measured, never low", () => {
  it("latestAnswer / getRoundData / getAnswer in the trace → not measured, with the reason", () => {
    // Before: ok with count 1 (the latestAnswer leg was not counted).
    for (const sel of ["0x50d25bcd", "0x9a6fc8f5", "0xb5ab58dc"]) {
      const tree = frame("0xoracle", "0xfc57d4df", [frame("0xcomp", LRD, [frame("0xa1", LRD), frame("0xa2", sel)])]);
      const r = countPriceSources(tree);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/which this count does not follow, so the count is not measured/);
    }
    expect(countPriceSources(frame("0xo", "0x", [frame("0xw", LRD, [frame("0xa", LRD)])])).ok).toBe(true);
  });
});

describe("M2: the single-source line is labelled as observed, not pre-registered", () => {
  it("evaluatePassRule names it so", () => {
    const rec = {
      control: { passed: true, reasons: [], stablecoins: [] },
      postStablecoins: [],
      actions: [],
      pre: {},
      post: {},
      referencePost: { ok: false, reason: "x" },
      trace: { post: { ok: true, count: 1, sources: ["0xa"], latestRoundDataCallees: ["0xa"] } },
    } as unknown as Level2Record;
    const line = evaluatePassRule(rec).find((l) => /price source/.test(l.rule))!;
    expect(line.rule).toMatch(/^Observed, not part of the pre-registered rule/);
    expect(line.rule).toMatch(/PASS-RULE.md counts price sources only in rule 3/);
  });
});

describe("M3: the cbETH reference is read at the fork block its method names", () => {
  it("every read passes blockNumber = the fork block", async () => {
    const seen: unknown[] = [];
    const client = {
      readContract: async (args: { functionName: string; blockNumber?: bigint; address: string }) => {
        seen.push(args.blockNumber);
        if (args.functionName === "decimals") return args.address.toLowerCase().startsWith("0x7104") ? 8 : 18;
        return [1n, args.address.toLowerCase().startsWith("0x7104") ? 196558018952n : 1122662744874806300n, 0n, 0n, 1n];
      },
    };
    const r = await cbEthReference(client as never, 42194662);
    expect(r.ok && r.value).toBe("2206683650838065175827");
    expect(seen).toHaveLength(4);
    expect(seen.every((b) => b === 42194662n)).toBe(true); // before: undefined (the fork's latest block)
  });
});

describe("M4: anvil picks its own port and Atlas reads it from anvil's output", () => {
  it("listeningPort parses anvil's line", () => {
    expect(listeningPort("...\nListening on 127.0.0.1:50060\n")).toBe(50060);
    expect(listeningPort("Listening on 0.0.0.0:1")).toBeUndefined();
  });

  it("startAnvil answers on the port anvil printed (a stand-in anvil and node)", async () => {
    // Before: Atlas chose a port itself, so the stand-in's port was never polled (timeout).
    const node = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      });
    });
    await new Promise<void>((r) => node.listen(0, "127.0.0.1", () => r()));
    const a = node.address();
    const port = typeof a === "object" && a ? a.port : 0;
    const dir = mkdtempSync(join(tmpdir(), "atlas-fake-anvil-"));
    writeFileSync(join(dir, "anvil"), `#!/bin/sh\necho "Listening on 127.0.0.1:${port}"\nexec sleep 30\n`);
    chmodSync(join(dir, "anvil"), 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${dir}:${savedPath}`;
    try {
      const fork = await startAnvil({ forkBlock: 1, rpcUrl: "http://127.0.0.1:9/x", readyTimeoutMs: 5_000 });
      expect(fork.port).toBe(port);
      expect(fork.url).toBe(`http://127.0.0.1:${port}`);
      await fork.stop();
    } finally {
      process.env.PATH = savedPath;
      rmSync(dir, { recursive: true, force: true });
      await new Promise((r) => node.close(() => r(null)));
    }
  }, 20_000);
});

describe("M5: a Level 2 file without the actions it applied does not verify", () => {
  it("no proposal_derived event → refused (the table would be silently empty)", () => {
    const base = liveLevel2();
    const run = structuredClone(base.runs[0]!);
    run.trace = run.trace.filter((t) => t.event !== "proposal_derived");
    const file = { ...base, runs: [run], verdicts: base.bets.map((b) => judge(b, run)), falseAlarm: [] };
    const v = verifyAtlasFile(JSON.parse(JSON.stringify(file)));
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v)).toMatch(/must record the actions it applied/);
    expect(() => buildAtlasFile({ target: base.target, experiment: base.experiments[0]!, bets: base.bets, run, verdicts: file.verdicts, agentLog: [], createdAt: base.createdAt })).toThrow(/must record the actions it applied/);
  });
});

describe("M6: the findings panel shows each removed place's real reason", () => {
  it("not 'the lines did not match the file' for every drop", async () => {
    const answer: InvestigateAnswer = {
      ok: true,
      model: "muse-wonder-1.0",
      findings: [],
      dropped: [
        { file: "a.sol", lineStart: 1, lineEnd: 2, reason: "removed: kind is not retry, price or other" },
        { file: "a.sol", lineStart: 9, lineEnd: 9, reason: "removed: more than 3 findings" },
      ],
    };
    const api = { investigate: async () => answer } as unknown as Api;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<FindingsPanel api={api} target={{ kind: "ts-fixture", ref: "x", codeSha256: "0".repeat(64) }} chosen={null} onChoose={() => {}} locked={false} />));
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    const text = host.querySelector('[data-testid="dropped-places"]')!.textContent!;
    expect(text).toContain("kind is not retry, price or other");
    expect(text).toContain("more than 3 findings");
    expect(text).not.toContain("the lines did not match the file");
    act(() => root.unmount());
    host.remove();
  });
});
