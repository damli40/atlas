// D19: on the Moonwell pull request, Muse Spark gets exactly what the person sees on the bet screen
// before betting. Both read one function (src/bet-context.ts), and this test checks the two outputs
// are the same string: the real React screen against the real server (in-process), with GitHub, the
// fork and the model as stand-ins (no network, no key, no anvil).
//
// It also checks the prompt carries no price: none of the run's measured or reference numbers, and no
// dollar amount at all.

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { SEEN_CONTEXT_HEADING } from "../../server/meta/roles/claimant-bets";
import type { GithubPrTarget } from "../../server/targets/github";
import { FORK_BLOCK, PR578_CODE_SHA256 } from "../../runners/evm/moonwell-base";
import { LEVEL2_CAPTION } from "../../src/atlasfile";
import { MOONWELL_FORK_BLOCKS, blockTimeUtc, moonwellBetContext } from "../../src/bet-context";
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

// The run's numbers (the values D04-02 read live). None of them may appear in Spark's prompt.
const RUN_NUMBERS = { post: "1122662744874806300", pre: "2206683650838065175827", ref: "2206683650838065175827", usdc: "999900000000000000" };
function fakeEvmRun() {
  return async (exp: Experiment, opts: { forkBlock: number; onProgress: (s: string) => void }): Promise<Run> => {
    const now = new Date().toISOString();
    return {
      id: `run-${opts.forkBlock}`,
      experimentId: exp.id,
      runner: "evm",
      executor: "local",
      codeSha256: exp.target.codeSha256,
      forkBlock: opts.forkBlock,
      chainId: 8453,
      startedAt: now,
      finishedAt: now,
      trace: [{ t: 0, event: "proposal_derived", data: { count: 2, actions: [{ symbol: "USDC" }, { symbol: "cbETH" }] } }],
      result: {
        measured: { "priceUsd1e18:cbETH": RUN_NUMBERS.post, "preApplyPriceUsd1e18:cbETH": RUN_NUMBERS.pre, "priceUsd1e18:USDC": RUN_NUMBERS.usdc, "preApplyPriceUsd1e18:USDC": RUN_NUMBERS.usdc },
        notMeasured: {},
        references: { "refUsd1e18:cbETH": { value: RUN_NUMBERS.ref, method: "ETH/USD × cbETH/ETH, raw Chainlink, same block" } },
      },
      controlPassed: true,
    };
  };
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

describe("D19: what the bettor sees", () => {
  it("the stored fork blocks are the runner's, with the timestamps read from Base", () => {
    expect(MOONWELL_FORK_BLOCKS.level2.block).toBe(FORK_BLOCK.beforeProposal);
    expect(MOONWELL_FORK_BLOCKS.level1.block).toBe(FORK_BLOCK.proposalExecuted);
    // Base makes a block every 2 seconds, so the two adjacent blocks are 2 s apart.
    expect(MOONWELL_FORK_BLOCKS.level1.timestamp - MOONWELL_FORK_BLOCKS.level2.timestamp).toBe(2);
    expect(blockTimeUtc(MOONWELL_FORK_BLOCKS.level2.timestamp)).toBe("2026-02-15 18:04:31 UTC");
  });

  it("the context holds the PR line, level, caption, block, time, question, unit, tolerance and the whole file; never a claim", () => {
    const fileText = PR.files[1]!.content!;
    const text = moonwellBetContext({
      level: "level2",
      question: { text: "After this proposal is applied, what will Moonwell's oracle report for 1 cbETH, in USD?", unit: "USD", tolerancePct: 10 },
      finding: { file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42, proposedBy: { role: "investigator", model: "muse-wonder-1.0" } },
      fileText,
      pr: { ref: PR.target.ref, title: PR.title, commit: PR.target.commit!, fileCount: 3, codeSha256: PR578_CODE_SHA256 },
    });
    expect(text).toContain(`Pull request: moonwell-fi/moonwell-contracts-v2#578 · MIP-X43 · merge commit 9a6738e189 · 3 files · code fingerprint ${PR578_CODE_SHA256.slice(0, 12)}…`);
    expect(text).toContain(`Read with this run: ${LEVEL2_CAPTION}`);
    expect(text).not.toContain("test description"); // the PR description is not on screen
    // The whole file, numbered; only the chosen line marked.
    const lines = fileText.split("\n");
    if (fileText.endsWith("\n")) lines.pop();
    expect(text.split("\n").filter((l) => /^[> ] \d+\| /.test(l))).toHaveLength(lines.length);
    expect(text.split("\n").filter((l) => l.startsWith("> "))).toEqual(['> 42|             OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")']);
    expect(text).toContain("  41|         _oracleConfigs[BASE_CHAIN_ID].push(");
    expect(text).toContain("Fork Base at block 42194662, one block before the proposal ran");
    expect(text).toContain("Fork block: 42194662 on Base, made at 2026-02-15 18:04:31 UTC.");
    expect(text).toContain("Answer in: USD.");
    expect(text).toContain("Matched means within 10% of what the run reads.");
    expect(text).toContain("(found by muse-wonder-1.0): proposals/ChainlinkOracleConfigs.sol, line 42");
  });

  it("the bet screen renders the same context Spark's prompt holds, and the prompt has no price", async () => {
    const calls: ChatArgs[] = [];
    const chat = async (args: ChatArgs): Promise<ChatResult> => {
      calls.push(JSON.parse(JSON.stringify(args)));
      return { ok: true, content: JSON.stringify({ bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "declined", reason: "unknown: test" }, rationale: "r" }] }), finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.0001 } };
    };
    const app = createApp({ fetchPr: async () => PR, modelBets: { chat }, evmRun: fakeEvmRun() });
    const api = createApi((url, init) => Promise.resolve(app.request(url.replace(/^\/api/, ""), init)));
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
    await until(() => $('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", "the model slot");

    const shown = $('[data-testid="bet-context"]')!.textContent!;
    expect(shown).toContain("Fork block: 42194662 on Base, made at 2026-02-15 18:04:31 UTC.");
    expect(shown).toContain('> 42|             OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")');
    expect(shown).toContain("Pull request: moonwell-fi/moonwell-contracts-v2#578 · MIP-X43");
    expect(shown).toContain(`Read with this run: ${LEVEL2_CAPTION}`);
    expect(calls).toHaveLength(1);
    const user = calls[0]!.messages[1]!.content;
    // The prompt holds exactly the screen's text under its heading, followed by the answer format only.
    expect(user.startsWith(`${SEEN_CONTEXT_HEADING}\n${shown}\n\nQUESTIONS`)).toBe(true);
    // Nothing else about the round: no experiment JSON, no list of markets, no wider code.
    expect(user).not.toContain('"shape"');
    expect(user).not.toContain('"touched"');
    // The screen's file viewer (a separate component): every line it renders, with its number, is in the prompt.
    const viewer = [...host!.querySelectorAll('[data-testid="pick-code"] [data-line]')];
    expect(viewer.length).toBeGreaterThan(40);
    for (const div of viewer) {
      const n = div.querySelector(".ln")!.textContent!;
      const rest = div.textContent!.slice(n.length);
      expect(user).toContain(`${n}| ${rest === " " ? "" : rest}\n`); // the viewer shows an empty line as one space
    }

    // Seal a bet and run, so the run's numbers exist; none of them is in what Spark was given.
    act(() => setValue($('[data-testid="bet-usd"]') as HTMLInputElement, "2200"));
    await act(async () => byText("button", "Seal my bet")!.click());
    await until(() => $('[data-testid="hash-usd"]') !== null, "the sealed hash");
    await act(async () => byText("button", "Run it on a fork of Base")!.click());
    await until(() => $('[data-testid="run-facts"]') !== null, "the run");
    const prompt = calls[0]!.messages.map((m) => m.content).join("\n");
    for (const n of [...Object.values(RUN_NUMBERS), "1.12", "1,12", "2206", "2,206", "0.9999"]) expect(prompt).not.toContain(n);
    expect(prompt).not.toMatch(/\$\s?\d/); // no dollar amount at all
  }, 30_000);
});
