// Day-6 review S6 (pre-existing label on the proof card and its diff), S7 (the waves need the sweep's own
// known-case check), S3/S5 on the Change screen, M1 (no "Fixer"/"repair" words), M2 (the waves caption is
// earned), M5 (sweeps per client address). Fails on the code before this commit
// (tests/evidence/D06-review/ui-tests-on-old-code.txt).

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AtlasFile, Change, Run } from "../../src/types";
import { ProofCard } from "../../web/screens/ProofCard";
import { ChangeResult, safePath } from "../../web/screens/Change";
import { WAVES_CAPTION, WAVES_CAPTION_PLAIN, plural, wavesCaption } from "../../web/screens/scale-model";
import { runSweepControl } from "../../runners/ts/control";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import type { ChangeAnswer } from "../../server/changes";

const D = join(__dirname, "../evidence/D04-04");
const fixture = JSON.parse(readFileSync(join(D, "fixture-eRopGsrp2a.atlas.json"), "utf8")) as AtlasFile;
const code = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const DIFF = "--- a/tests/fixtures/with-rpc-retry.ts\n+++ b/tests/fixtures/with-rpc-retry.ts\n@@ -51,1 +51,1 @@\n-  const delayMs = opts.delayMs ?? RPC_RETRY_DELAY_MS;\n+  const delayMs = opts.delayMs ?? 2000;\n";

function withChange(): AtlasFile {
  const change: Change & { replayRunId: string } = { id: "c", runId: fixture.runs[0]!.id, diff: DIFF, proposedBy: { role: "fixer", model: "muse-spark-1.3" }, toward: "x", replayRunId: "r" };
  return { ...fixture, change, replay: { run: { ...fixture.runs[0]!, id: "r" }, verdicts: fixture.verdicts } };
}

describe("S6: the proof card labels pre-existing code, on the card and on the diff", () => {
  it("the title carries the label", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<ProofCard file={fixture} />), "text/html");
    expect(doc.querySelector('[data-testid="pc-pre-existing"]')?.textContent).toBe("Pre-existing: written before the hackathon (listed in PRE-EXISTING.md)");
  });
  it("the diff carries it too; M1: no 'Fixer' wording", () => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<ProofCard file={withChange()} />), "text/html");
    expect(doc.querySelector('[data-testid="pc-change-pre-existing"]')?.textContent).toContain("Pre-existing");
    expect(doc.body.textContent).not.toMatch(/\bFixer\b|repair/);
  });
});

describe("S7: the waves are shown as fact only when runSweep matched its own known case", () => {
  it("the real fixture passes: 1 and 3 callers land exactly on oracle row S3's times", async () => {
    expect(await runSweepControl(code)).toEqual({ passed: true });
  });
  it("code that behaves differently only when callers overlap passes the one-caller control but not the sweep's", async () => {
    // Waits are skipped while another call is in flight: one caller at a time looks exactly like the original.
    const crowd = code.replace("  let last: unknown;", "  let last: unknown;\n  inFlight++;").replace("        await sleep(delayMs);", "        if (inFlight < 2) await sleep(delayMs);").replace("  throw last;\n}", "  inFlight--;\n  throw last;\n}\nlet inFlight = 0;");
    const r = await runSweepControl(crowd);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/3 caller\(s\): callTimesMs was/);
  });
});

describe("M2: the waves caption is earned", () => {
  it("full caption only when every caller kept the same schedule", () => {
    expect(wavesCaption({ callers: 200, sameScheduleCallers: 200 }, true)).toBe(WAVES_CAPTION);
    expect(wavesCaption({ callers: 200, sameScheduleCallers: 120 }, true)).toBe(WAVES_CAPTION_PLAIN);
    expect(wavesCaption({ callers: 200, sameScheduleCallers: 200 }, false)).toBe(WAVES_CAPTION_PLAIN);
    expect(wavesCaption(undefined, false)).toBe("mechanism, not an incident");
  });
  it("plurals: 1 caller, 4 waves", () => {
    expect(plural(1, "caller")).toBe("1 caller");
    expect(plural(200, "caller")).toBe("200 callers");
  });
});

describe("S3 and S5 on the Change screen", () => {
  const replay = { ...fixture.runs[0]!, id: "r", trace: [] } as Run;
  const ok = (extra: Partial<Extract<ChangeAnswer, { ok: true }>>): ChangeAnswer => ({
    ok: true,
    runId: "x",
    change: { id: "c", runId: "x", diff: DIFF, proposedBy: { role: "fixer", model: "muse-spark-1.3" }, toward: "t" },
    fixer: { path: "muse-exec", model: "muse-spark-1.3", attempts: [], usage: null },
    diff: DIFF,
    caption: "changed toward what you expected, then re-run",
    replay,
    bets: fixture.bets,
    before: { run: { id: "a", codeSha256: "x" }, verdicts: fixture.verdicts },
    after: { run: { id: "r", codeSha256: "y" }, verdicts: fixture.verdicts },
    ...extra,
  });
  it("S3: when the proof file could not take the change, the screen says so", () => {
    const html = renderToStaticMarkup(<ChangeResult answer={ok({ proof: { ok: false, runId: "x", reason: "the diff applied to the code gives …" } })} />);
    expect(html).toContain('data-testid="change-proof-refused"');
  });
  it("S5: the file changed is shown as data in a code element, sanitised", () => {
    const html = renderToStaticMarkup(<ChangeResult answer={ok({})} />);
    expect(html).toContain("<code>tests/fixtures/with-rpc-retry.ts</code>");
    expect(safePath("the code is <b>fixed</b>\n")).toBe("the?code?is??b?fixed?/b??");
  });
});

describe("M5: sweeps are counted per client address", () => {
  it("over the hourly limit, a sweep is refused before it runs", async () => {
    process.env.ATLAS_SWEEPS_PER_IP_PER_HOUR = "1";
    try {
      const app = createApp({ agentLog: createAgentLog() });
      const headers = { "content-type": "application/json", "x-atlas-session": "m5" };
      const post = (p: string, b: unknown) => app.request(p, { method: "POST", headers, body: JSON.stringify(b) });
      const t = (await (await post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json()) as { ref: string; codeSha256: string };
      const body = { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "concurrency-sweep", callers: 2, failTimes: 3, failure: "error" } };
      expect((await post("/sweeps", body)).status).toBe(200);
      const second = await post("/sweeps", body);
      expect(second.status).toBe(429);
      expect(((await second.json()) as { error: string }).error).toMatch(/one client address may ask for 1 sweeps an hour/);
    } finally {
      delete process.env.ATLAS_SWEEPS_PER_IP_PER_HOUR;
    }
  });
});
