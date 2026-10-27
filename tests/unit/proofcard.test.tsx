// D06-02 waves chart + D06-03 proof card, rendered from real files and runs only.
// - The proof card draws both example .atlas.json files from tests/evidence/D04-04 (they validate with
//   src/atlasfile.ts): the scoreboard with the Meta model id and outcome words, fingerprint, seed or fork
//   block, control, the file's captions (data-driven), the sealed hashes re-hashed in the browser,
//   "judged by src/judge.ts", the download link and the re-run link. No banned verdict words.
// - The waves chart draws only when src/trust.ts allows it, and its caption is always in the DOM.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { verifyAtlasFile } from "../../src/atlasfile";
import type { AtlasFile, Run } from "../../src/types";
import { ProofCard } from "../../web/screens/ProofCard";
import { proofCardModel, replayWords } from "../../web/screens/proofcard-model";
import { ScaleScreen, WavesChart } from "../../web/screens/Scale";
import { WAVES_CAPTION } from "../../web/screens/scale-model";
import { createApi } from "../../web/api";

const D = join(__dirname, "../evidence/D04-04");
const load = (n: string) => JSON.parse(readFileSync(join(D, n), "utf8")) as AtlasFile;
const fixture = load("fixture-eRopGsrp2a.atlas.json");
const moonwell = load("moonwell-level2-mwTaxvHFzB.atlas.json");
const BANNED = /\b(wrong|correct|bug|fixed|broken)\b/i;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("proof card (D06-03)", () => {
  it("both example files validate with src/atlasfile.ts", () => {
    expect(verifyAtlasFile(fixture).ok).toBe(true);
    expect(verifyAtlasFile(moonwell).ok).toBe(true);
  });

  it("fixture card: model id, outcome words, seed, control, pre-existing caption, every hash re-hashed", () => {
    const html = renderToStaticMarkup(<ProofCard file={fixture} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = doc.body.textContent ?? "";
    // D07-04: one line per bettor under the mark, outcome words counted over its bets. D07-01: product name and id.
    expect(text).toContain("Muse Spark 1.3 (muse-spark-1.3) · 3 matched");
    expect(text).toContain("You · 2 matched, 1 didn't match");
    expect(text).toContain("seed tFjD64Wn2K");
    expect(doc.querySelector('[data-testid="pc-controls"]')?.textContent).toMatch(/^passed: known-case check matched/);
    expect([...doc.querySelectorAll('[data-testid="pc-captions"] li')].map((l) => l.textContent)).toEqual(fixture.captions);
    expect(text).toContain("Pre-existing: written before the hackathon (listed in PRE-EXISTING.md)");
    expect(text).toContain("judged by src/judge.ts");
    for (const b of fixture.bets) expect(text).toContain(b.sealedHash);
    expect(doc.querySelectorAll('[data-testid="pc-seals"] li').length).toBe(fixture.bets.length);
    expect(text).not.toContain("✗");
    expect(doc.querySelector('[data-testid="pc-rerun"]')?.getAttribute("href")).toBe(`/api/replay/${fixture.runs[0]!.id}`);
    expect(text).not.toMatch(BANNED);
  });

  it("Moonwell card: fork block, Level 2 and its caption, the picked-by-a-person caption from the file, cbETH in USD", () => {
    const card = proofCardModel(moonwell);
    expect(card.where).toBe("Base (chain 8453), fork block 42194662");
    expect(card.level).toMatch(/^Level 2/);
    expect(card.captions).toContain("the cbETH line was picked by a person; the Investigator pointed elsewhere");
    expect(card.controls).toEqual(["WETH read equals its Chainlink feed at the same block", "4 of 4 stablecoins inside the $1 band before", "4 of 4 inside the band after"]);
    const html = renderToStaticMarkup(<ProofCard file={moonwell} />);
    expect(html).toContain("$1.12");
    expect(html).toContain("Muse Spark 1.3 (muse-spark-1.3) · can&#x27;t check"); // D07-01: product name and id
    expect(html).toContain("fork of Base one block before MIP-X43 ran");
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(BANNED);
  });

  it("captions are data-driven: a file without the picked-by-a-person caption does not show it", () => {
    const f: AtlasFile = { ...moonwell, captions: moonwell.captions.filter((c) => !c.startsWith("the cbETH line")) };
    expect(renderToStaticMarkup(<ProofCard file={f} />)).not.toContain("picked by a person");
  });

  it("a tampered bet shows ✗ next to its hash", () => {
    const f: AtlasFile = { ...fixture, bets: fixture.bets.map((b, i) => (i === 0 ? { ...b, answer: { kind: "integer", value: 6 } } : b)) };
    expect(renderToStaticMarkup(<ProofCard file={f} />)).toContain("✗ does not match its fields");
  });

  it("a run whose control did not match shows the trust sentence, no scoreboard and no values", () => {
    const r = { ...fixture.runs[0]!, controlPassed: false };
    const html = renderToStaticMarkup(<ProofCard file={{ ...fixture, runs: [r] }} />);
    expect(html).toContain("Atlas&#x27;s known-case check did not match");
    expect(html).not.toContain('data-testid="scoreboard"');
    expect(html).toContain("not shown");
  });

  it("re-run: the page calls GET /replay/:id with a session header and shows the result", async () => {
    const seen: { url: string; session: string | null }[] = [];
    const api = createApi(async (url, init) => {
      seen.push({ url, session: new Headers(init.headers).get("x-atlas-session") });
      return new Response(JSON.stringify({ runId: "eRopGsrp2a", replayRunId: "x", runner: "ts", seed: "tFjD64Wn2K", replaySeed: "tFjD64Wn2K", measuredEqual: true, resultDiff: [], controlPassed: true, sameOutcomes: true }), { status: 200 });
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<ProofCard file={fixture} api={api} />));
    await act(async () => (el.querySelector('[data-testid="pc-rerun"]') as HTMLAnchorElement).click());
    expect(seen[0]!.url).toBe("/api/replay/eRopGsrp2a");
    expect(seen[0]!.session).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(el.querySelector('[data-testid="pc-replay"]')?.textContent).toBe("replayed: same result ✓ · same seed tFjD64Wn2K");
  });

  it("replay words: a diff is named, a failed control is can't check", () => {
    expect(replayWords({ measuredEqual: false, resultDiff: ["measured.calls"], sameOutcomes: false, controlPassed: true }).text).toBe("replayed: the result differs (measured.calls)");
    expect(replayWords({ measuredEqual: true, resultDiff: [], sameOutcomes: true, controlPassed: false }).same).toBe(false);
  });
});

describe("waves chart (D06-02)", () => {
  const run = (over: Partial<Run> = {}): Run => ({
    id: "r1",
    experimentId: "e1",
    runner: "ts",
    executor: "local",
    codeSha256: "f".repeat(64),
    seed: "s",
    startedAt: "2026-10-27T00:00:00.000Z",
    finishedAt: "2026-10-27T00:00:01.000Z",
    trace: [{ t: 0, event: "start" }],
    result: { measured: { callers: 200, calls: 800, callTimesMs: "0:200,3000:200,6000:200,9000:200", waveCount: 4, largestWave: 200, sameScheduleCallers: 200 }, notMeasured: {} },
    controlPassed: true,
    ...over,
  });

  it("draws one bar per wave from the measured call times", () => {
    const html = renderToStaticMarkup(<WavesChart run={run()} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bars = [...doc.querySelectorAll('[data-testid="wave-bar"]')].map((b) => [b.getAttribute("data-from"), b.getAttribute("data-count")]);
    expect(bars).toEqual([["0", "200"], ["3000", "200"], ["6000", "200"], ["9000", "200"]]);
    expect(doc.body.textContent).toContain("200 callers made 800 calls in 4 waves");
  });

  it("a run whose control did not match draws no bars, only the reason", () => {
    const html = renderToStaticMarkup(<WavesChart run={run({ controlPassed: false })} />);
    expect(html).not.toContain("wave-bar");
    expect(html).toContain("known-case check did not match");
  });

  it("the screen registers the fixture, runs a 200-caller sweep on open, and keeps the caption in the DOM", async () => {
    const bodies: unknown[] = [];
    const api = createApi(async (url, init) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (url.endsWith("/targets")) return new Response(JSON.stringify({ kind: "ts-fixture", ref: body.ref, codeSha256: "f".repeat(64) }), { status: 200, headers: { "x-atlas-session": "scale-ui" } });
      return new Response(JSON.stringify({ experiment: {}, run: run(), control: { runId: "c", passed: true } }), { status: 200 });
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => createRoot(el).render(<ScaleScreen api={api} />));
    await act(async () => {});
    expect(bodies[1]).toEqual({ target: { ref: "tests/fixtures/with-rpc-retry.ts", codeSha256: "f".repeat(64) }, params: { shape: "concurrency-sweep", callers: 200, failTimes: 3, failure: "error" } });
    expect(el.querySelector('[data-testid="waves-caption"]')?.textContent).toBe(WAVES_CAPTION);
    expect(el.querySelectorAll('[data-testid="wave-bar"]').length).toBe(4);
  });

  it("the caption says mechanism, not an incident, and never claims an outage or a hang", () => {
    expect(WAVES_CAPTION).toBe("mechanism, not an incident: every caller retries on the same fixed schedule");
    expect(WAVES_CAPTION).not.toMatch(/outage|hang|forever|hammer/i);
  });
});
