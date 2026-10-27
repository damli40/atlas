// D22: before bets on a Moonwell experiment, plain code reads a small fixed set of chain facts at block
// 42194662 (the block BEFORE the proposal ran) and every bettor sees the same facts: the person on screen,
// each Meta model in its prompt.
//
// What this file checks (offline: GitHub, the fork, the facts reader and the models are stand-ins):
// 1. Parity: in "both" mode the bet screen's text and BOTH models' prompts hold the identical facts (D19).
// 2. No post-apply value can enter: after a fake run with its own distinctive numbers, a second round in the
//    same session gets the same facts, read once (cached), and none of the run's numbers.
// 3. The facts come from block 42194662 only: for a Level 1 AND a Level 2 round, the reader is asked for
//    42194662; any other block is refused by the reader, by the fork read and by the renderer; a fork whose
//    head moved, or whose cbETH feed is already the proposal's, is refused.
// 4. The bet instruction is the D22 sentence, the same for every model, and the fixture prompt is unchanged.
// One more check needs BASE_RPC_URL and anvil: the real read at 42194662 (skipped without them).

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PublicClient } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { buildBetOnlyMessages, SEEN_CONTEXT_HEADING } from "../../server/meta/roles/claimant-bets";
import type { GithubPrTarget } from "../../server/targets/github";
import { createChainFactsReader, readChainFactsFrom } from "../../runners/evm/chain-facts";
import { CBETH_FEED, PR578_CODE_SHA256, RAW_FEED } from "../../runners/evm/moonwell-base";
import { moonwellBetContext } from "../../src/bet-context";
import { BET_INSTRUCTION, CHAIN_FACTS_LABEL, chainFactsLines, placeDecimals, type MoonwellChainFacts } from "../../src/chain-facts";
import { SPARK_MODEL, SPARK_OPEN_MODEL } from "../../src/claimants";
import { questionsFor } from "../../src/gate";
import type { Experiment, Run } from "../../src/types";
import { createApi } from "../../web/api";
import { MoonwellFlow } from "../../web/screens/Moonwell";

const COPY = join(import.meta.dirname, "..", "..", "contracts", "lib", "moonwell");
const prFile = (path: string) => {
  const content = readFileSync(join(COPY, path), "utf8");
  return { path, status: "modified", sha256: "0".repeat(64), sizeBytes: content.length, binary: false, content, lines: content.split("\n").length };
};
const PR: GithubPrTarget = {
  target: { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578", commit: "9a6738e189fa903bffa0abf10b9dd7ed2fe73a18", codeSha256: PR578_CODE_SHA256 },
  files: ["chains/8453.json", "proposals/ChainlinkOracleConfigs.sol", "proposals/mips/mip-x43/mip-x43.sol"].map(prFile),
  skipped: [],
  changedFiles: 6,
  title: "MIP-X43",
  description: "test description",
  mergedAt: "2026-02-10T18:58:44Z",
};

/** Stand-in facts with numbers no run below produces. */
const FACTS: MoonwellChainFacts = {
  block: 42194662,
  blockTimestamp: 1771178671,
  cbEthOracle: { market: "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5", feed: CBETH_FEED.before, feedDescription: "cbETH / USD (stand-in)", rawUnderlyingPrice: "2345670000000000000000", priceUsd1e18: "2345670000000000000000" },
  ethUsd: { address: RAW_FEED.ETH_USD.address, description: "ETH / USD", decimals: 8, answer: "212345678901" },
  cbEthEth: { address: RAW_FEED.cbETH_ETH.address, description: "cbETH / ETH", decimals: 18, answer: "1104567890123456789" },
};
/** The fake run's numbers: the post-apply price and the reference. None may reach any prompt or the screen's facts. */
const RUN = { post: "1122662744874806300", pre: "2206683650838065175827", ref: "2206683650838065175827" };
const RUN_STRINGS = [RUN.post, RUN.pre, "$1.12", "$2,206.68", "2206.68", "1.12"];

function fakeEvmRun() {
  return async (exp: Experiment, opts: { forkBlock: number; onProgress: (s: string) => void }): Promise<Run> => {
    const now = new Date().toISOString();
    return {
      id: `run-${exp.id}`,
      experimentId: exp.id,
      runner: "evm",
      executor: "local",
      codeSha256: exp.target.codeSha256,
      forkBlock: opts.forkBlock,
      chainId: 8453,
      startedAt: now,
      finishedAt: now,
      trace: [{ t: 0, event: "proposal_derived", data: { count: 1, actions: [{ symbol: "cbETH" }] } }],
      result: {
        measured: { "priceUsd1e18:cbETH": RUN.post, "preApplyPriceUsd1e18:cbETH": RUN.pre },
        notMeasured: {},
        references: { "refUsd1e18:cbETH": { value: RUN.ref, method: "ETH/USD × cbETH/ETH, raw Chainlink, same block" } },
      },
      controlPassed: true,
    };
  };
}

function recordingChat() {
  const calls: ChatArgs[] = [];
  const chat = async (args: ChatArgs): Promise<ChatResult> => {
    calls.push(JSON.parse(JSON.stringify(args)));
    return { ok: true, content: JSON.stringify({ bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2300, tolerancePct: 10, unit: "USD" }, rationale: "r" }] }), finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.0001 } };
  };
  return { calls, chat };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
const $ = (sel: string) => host!.querySelector(sel) as HTMLElement | null;
const byText = (tag: string, text: string) => [...host!.querySelectorAll(tag)].find((e) => e.textContent?.trim() === text) as HTMLElement | undefined;
async function until(check: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 10));
    });
  }
}
function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new (el.ownerDocument.defaultView!.Event)("input", { bubbles: true }));
}

/** A server round trip without the page: target, the person's pick (line 42), an experiment. */
function server(opts: Parameters<typeof createApp>[0], session: string, claimant?: string) {
  const app = createApp(opts);
  const h: Record<string, string> = { "content-type": "application/json", "x-atlas-session": session, ...(claimant ? { "x-atlas-claimant": claimant } : {}) };
  const ask = async (path: string, body?: unknown) => {
    const res = await app.request(path, body === undefined ? { headers: h } : { method: "POST", headers: h, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const round = async (params: Record<string, unknown>) => {
    const t = (await ask("/targets", { kind: "github-pr", ref: PR.target.ref })).body;
    const f = (await ask("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).body.finding;
    return (await ask("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params, findingId: f.id })).body;
  };
  return { ask, round };
}
const LEVEL2 = { shape: "apply-proposal-then-read", markets: "touched" };
const LEVEL1 = { shape: "price-read", markets: ["cbETH"] };

describe("D22: chain facts before the bet", () => {
  it("parity in 'both' mode: the screen's text and both models' prompts hold the identical facts", async () => {
    const { calls, chat } = recordingChat();
    const app = createApp({ fetchPr: async () => PR, modelBets: { chat, sparkOpen: { available: true } }, evmRun: fakeEvmRun(), chainFacts: async () => FACTS });
    const api = createApi((url, init) => Promise.resolve(app.request(url.replace(/^\/api/, ""), init)));
    api.setClaimant("both");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<MoonwellFlow api={api} />));
    act(() => setValue($('[data-testid="pr-link"]') as HTMLInputElement, "https://github.com/moonwell-fi/moonwell-contracts-v2/pull/578"));
    await act(async () => byText("button", "Read it")!.click());
    await until(() => $('[data-testid="pr-target"]') !== null, "the PR target");
    await act(async () => byText("button", "Read the files and pick lines")!.click());
    await until(() => $('[data-line="42"]') !== null, "the file's lines");
    await act(async () => $('[data-line="42"]')!.click());
    await act(async () => ($('[data-testid="pick-use"]') as HTMLButtonElement).click());
    await until(() => $('[data-testid="chosen-finding"]') !== null, "the chosen finding");
    await act(async () => byText("button", "Show the question")!.click());
    await until(() => $('[data-testid="bet-context"]') !== null, "the bet context");
    await until(() => [...host!.querySelectorAll('[data-testid="model-slot"]')].every((s) => s.getAttribute("data-status") !== "thinking"), "the model slots");

    // The facts are visible on screen without opening anything, under the D22 label.
    const visible = $('[data-testid="chain-facts"]')!.textContent!;
    expect(visible.startsWith(`${CHAIN_FACTS_LABEL}:`)).toBe(true);
    expect(CHAIN_FACTS_LABEL).toBe("Chain facts read by Atlas at block 42194662, before the proposal ran");
    for (const l of chainFactsLines({ ok: true, facts: FACTS })) expect(visible).toContain(l);

    const shown = $('[data-testid="bet-context"]')!.textContent!;
    expect(calls.map((c) => c.model)).toEqual([SPARK_MODEL, SPARK_OPEN_MODEL]);
    for (const c of calls) {
      const user = c.messages[1]!.content;
      expect(user.startsWith(`${SEEN_CONTEXT_HEADING}\n${shown}\n\nQUESTIONS`)).toBe(true);
    }
    expect(calls[0]!.messages).toEqual(calls[1]!.messages); // the two models get the same prompt
    expect(shown).toContain("$2,345.67 per cbETH");
    expect(shown).toContain(`latestRoundData answer 212345678901 with 8 decimals (2123.45678901)`);
    expect(shown).toContain(`latestRoundData answer 1104567890123456789 with 18 decimals (1.104567890123456789)`);
    expect(shown).toContain(`getFeed("cbETH"): ${CBETH_FEED.before}`);
    expect(shown).toContain("Block 42194662 timestamp: 1771178671 (2026-02-15 18:04:31 UTC).");
    expect(shown).toContain(`How to bet: ${BET_INSTRUCTION}`);

    // Run, then check nothing from the run reached any prompt.
    act(() => setValue($('[data-testid="bet-usd"]') as HTMLInputElement, "2200"));
    await act(async () => byText("button", "Seal my bet")!.click());
    await until(() => $('[data-testid="hash-usd"]') !== null, "the sealed hash");
    await act(async () => byText("button", "Run it on a fork of Base")!.click());
    await until(() => $('[data-testid="run-facts"]') !== null, "the run");
    const prompts = calls.flatMap((c) => c.messages.map((m) => m.content)).join("\n");
    for (const n of RUN_STRINGS) expect(prompts).not.toContain(n);
  }, 30_000);

  it("no post-apply value can enter: after a fake run, the next round gets the same facts (read once) and no run number", async () => {
    const blocks: number[] = [];
    let forks = 0;
    const reader = createChainFactsReader({
      openFork: async (o, fn) => {
        forks++;
        blocks.push(o.forkBlock);
        return fn({ url: "http://127.0.0.1:1", port: 1, forkBlock: o.forkBlock, stop: async () => {} });
      },
      readOnFork: async (_fork, block) => ({ ...FACTS, block }),
    });
    const { calls, chat } = recordingChat();
    const s = server({ fetchPr: async () => PR, modelBets: { chat }, evmRun: fakeEvmRun(), chainFacts: (b) => reader.read(b) }, "d22-cache");
    const e1 = await s.round(LEVEL2);
    expect(e1.chainFacts).toEqual({ ok: true, facts: FACTS });
    await s.ask("/bets", { experimentId: e1.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
    const ran = await s.ask("/runs", { experimentId: e1.experiment.id });
    expect(ran.status).toBe(200);
    expect(ran.body.run.result.measured["priceUsd1e18:cbETH"]).toBe(RUN.post); // the run's own numbers exist now

    const e2 = await s.round(LEVEL1); // a Level 1 round: its run forks at 42194663, its facts are still 42194662
    expect(e2.chainFacts).toEqual(e1.chainFacts);
    await s.ask("/bets", { experimentId: e2.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
    expect(calls).toHaveLength(2);
    const second = calls[1]!.messages[1]!.content;
    for (const n of RUN_STRINGS) expect(second).not.toContain(n);
    // The facts block of both prompts is the same lines.
    const factsBlock = (p: string) => p.split("\n").filter((l) => l.startsWith(CHAIN_FACTS_LABEL) || l.startsWith("- ")).join("\n");
    expect(factsBlock(second)).toBe(factsBlock(calls[0]!.messages[1]!.content));
    expect(forks).toBe(1); // cached per fork block
    expect(blocks).toEqual([42194662]);
  });

  it("the facts come from block 42194662 only, for Level 1 and Level 2 alike", async () => {
    const asked: number[] = [];
    const { chat } = recordingChat();
    for (const params of [LEVEL1, LEVEL2]) {
      const s = server({ fetchPr: async () => PR, modelBets: { chat }, evmRun: fakeEvmRun(), chainFacts: async (b) => (asked.push(b), FACTS) }, `d22-block-${params.shape}`);
      expect((await s.round(params)).chainFacts.ok).toBe(true);
    }
    expect(asked).toEqual([42194662, 42194662]);

    // The reader refuses any other block, before opening a fork.
    let opened = 0;
    const reader = createChainFactsReader({ openFork: async () => (opened++, FACTS) as never });
    for (const b of [42194663, 42194661, 42195500]) await expect(reader.read(b)).rejects.toThrow(/only at block 42194662/);
    expect(opened).toBe(0);
    // The renderer refuses facts from another block.
    expect(() => chainFactsLines({ ok: true, facts: { ...FACTS, block: 42194663 } })).toThrow(/must come from block 42194662/);
  });

  it("the fork read pins every call to 42194662, and refuses a moved head or the proposal's feed", async () => {
    const seen: { fn: string; blockNumber?: bigint }[] = [];
    const fakeClient = (head: bigint, cbEthFeed: string) =>
      ({
        getBlockNumber: async () => head,
        getBlock: async (a: { blockNumber: bigint }) => (seen.push({ fn: "getBlock", blockNumber: a.blockNumber }), { timestamp: 1771178671n }),
        readContract: async (a: { functionName: string; blockNumber?: bigint; address: string }) => {
          seen.push({ fn: a.functionName, ...(a.blockNumber !== undefined ? { blockNumber: a.blockNumber } : {}) });
          switch (a.functionName) {
            case "getFeed": return cbEthFeed;
            case "getUnderlyingPrice": return 2345670000000000000000n;
            case "decimals": return a.address === RAW_FEED.ETH_USD.address ? 8 : 18;
            case "description": return "d";
            case "latestRoundData": return [1n, a.address === RAW_FEED.ETH_USD.address ? 212345678901n : 1104567890123456789n, 0n, 0n, 1n];
          }
          throw new Error(a.functionName);
        },
      }) as unknown as PublicClient;
    const facts = await readChainFactsFrom(fakeClient(42194662n, CBETH_FEED.before), 42194662);
    expect(facts.block).toBe(42194662);
    expect(facts.ethUsd).toMatchObject({ decimals: 8, answer: "212345678901" });
    expect(seen.length).toBeGreaterThan(8);
    expect(seen.every((c) => c.blockNumber === 42194662n)).toBe(true);
    await expect(readChainFactsFrom(fakeClient(42194663n, CBETH_FEED.before), 42194662)).rejects.toThrow(/head is block 42194663/);
    await expect(readChainFactsFrom(fakeClient(42194662n, CBETH_FEED.afterProposal), 42194662)).rejects.toThrow(/already the feed the proposal sets/);
    await expect(readChainFactsFrom(fakeClient(42194663n, CBETH_FEED.before), 42194663)).rejects.toThrow(/only at block 42194662/);
  });

  it("a failed read is said in words to everyone, and is not cached", async () => {
    let n = 0;
    const reader = createChainFactsReader({ openFork: async () => { n++; throw new Error("anvil exited before it was ready (forced)"); } });
    const { calls, chat } = recordingChat();
    const s = server({ fetchPr: async () => PR, modelBets: { chat }, evmRun: fakeEvmRun(), chainFacts: (b) => reader.read(b) }, "d22-fail");
    const e = await s.round(LEVEL2);
    expect(e.chainFacts).toEqual({ ok: false, reason: "anvil exited before it was ready (forced)" });
    await s.ask("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 1 } }] });
    expect(calls[0]!.messages[1]!.content).toContain(`${CHAIN_FACTS_LABEL}: Atlas could not read them (anvil exited before it was ready (forced)).`);
    await s.round(LEVEL2);
    expect(n).toBe(2);
  });

  it("the bet instruction: the D22 sentence in the Moonwell prompt's task (the fixture prompt is pinned by its own tests)", () => {
    expect(BET_INSTRUCTION).toBe("Give your best estimate in USD. Decline only if you cannot form any estimate at all; if you decline, say why.");
    const q = questionsFor({ shape: "price-read", markets: ["cbETH"] } as never).filter((x) => x.measures === "priceUsd1e18:cbETH");
    expect(q).toHaveLength(1);
    const seen = moonwellBetContext({ level: "level2", question: q[0]!, finding: { file: "f.sol", lineStart: 1, lineEnd: 1, proposedBy: { role: "human", model: "none: picked by a person" } }, fileText: "x\n", pr: { ref: "o/r#1", title: "t", fileCount: 1, codeSha256: "a".repeat(64) }, chainFacts: { ok: true, facts: FACTS } });
    const msgs = buildBetOnlyMessages({ seenContext: seen, questions: q } as never);
    const task = msgs[1]!.content.split("TASK\n")[1]!;
    expect(task).toContain(BET_INSTRUCTION);
    expect(task).not.toContain("instead of guessing");
    expect(placeDecimals("5", 3)).toBe("0.005");
  });
});

const HAS_RPC = Boolean(process.env.BASE_RPC_URL);
const HAS_ANVIL = spawnSync("anvil", ["--version"]).status === 0;
describe.skipIf(!HAS_RPC || !HAS_ANVIL)("D22 on a real Base fork (needs BASE_RPC_URL and anvil)", () => {
  it("reads the facts at 42194662: the pre-proposal cbETH feed, raw feeds with 8 and 18 decimals, the stored timestamp", async () => {
    const reader = createChainFactsReader();
    const f = await reader.read(42194662);
    expect(f.block).toBe(42194662);
    expect(f.blockTimestamp).toBe(1771178671);
    expect(f.cbEthOracle.feed.toLowerCase()).toBe(CBETH_FEED.before.toLowerCase());
    expect(f.ethUsd.decimals).toBe(8);
    expect(f.cbEthEth.decimals).toBe(18);
    const usd = Number(BigInt(f.cbEthOracle.priceUsd1e18) / 10n ** 16n) / 100;
    expect(usd).toBeGreaterThan(500);
    expect(usd).toBeLessThan(20000);
    expect(await reader.read(42194662)).toBe(f); // cached: the same object, no second fork
    expect(reader.forksOpened()).toBe(1);
  }, 120_000);
});
