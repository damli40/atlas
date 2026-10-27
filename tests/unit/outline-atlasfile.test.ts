// X1: a round's .atlas.json with an `outline` section. verifyAtlasFile re-judges the outline from the stored file
// texts (no model); a file without one (every older file) verifies exactly as before. The TS sandbox is real.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { MAX_FILE_DEPTH, verifyAtlasFile } from "../../src/atlasfile";
import type { AtlasFile, Run, Target } from "../../src/types";
import { goodSection } from "../tools/outline-fixtures";

const REF = "tests/fixtures/with-rpc-retry.ts";

async function roundFile(): Promise<AtlasFile> {
  process.env.ATLAS_USAGE_PATH = join(mkdtempSync(join(tmpdir(), "atlas-x1-")), "usage.jsonl");
  const app = createApp({ agentLog: createAgentLog() });
  const headers = { "content-type": "application/json", "x-atlas-session": "x1-outline" };
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const target = (await (await post("/targets", { kind: "ts-fixture", ref: REF })).json()) as Target;
  await post("/experiments", { id: "s3", target: { ref: target.ref, codeSha256: target.codeSha256 }, params: { shape: "retry-scenario", failTimes: "always", failure: "error" } });
  await post("/bets", { experimentId: "s3", who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }] });
  const run = ((await (await post("/runs", { experimentId: "s3" })).json()) as { run: Run }).run;
  return (await (await app.request(`/proofs/${run.id}`, { headers })).json()) as AtlasFile;
}

describe("the .atlas.json outline section", () => {
  it("an older file (no outline) still verifies; with an outline it verifies; editing a part to confirmed fails", async () => {
    const file = await roundFile();
    expect(file.outline).toBeUndefined();
    expect(verifyAtlasFile(file)).toMatchObject({ ok: true });

    const withOutline = JSON.parse(JSON.stringify({ ...file, outline: goodSection() })) as AtlasFile;
    expect(verifyAtlasFile(withOutline)).toMatchObject({ ok: true });

    const forged = JSON.parse(JSON.stringify(withOutline)) as AtlasFile;
    const part = forged.outline!.verified!.parts[0]!;
    // An outline whose first part is unconfirmed, hand-edited to "confirmed".
    forged.outline!.wonder.outline!.parts[0]!.files[0]!.quotedSnippet = "a quote that is not in the file anywhere";
    part.status = "confirmed";
    const v = verifyAtlasFile(forged);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems).toContain("outline: the verified outline is not what plain code (src/outline/verify.ts) decides for this outline and these files");

    const edgeAdded = JSON.parse(JSON.stringify(withOutline)) as AtlasFile;
    edgeAdded.outline!.codeMap.edges = [];
    expect(verifyAtlasFile(edgeAdded)).toMatchObject({ ok: false, problems: [expect.stringMatching(/^outline: the code map/)] });

    // Never throws on a hostile outline value.
    let deep: unknown = 1;
    for (let i = 0; i < MAX_FILE_DEPTH + 10; i++) deep = { x: deep };
    expect(verifyAtlasFile({ ...file, outline: deep })).toMatchObject({ ok: false });
    expect(verifyAtlasFile({ ...file, outline: "nope" })).toMatchObject({ ok: false });
    expect(verifyAtlasFile({ ...file, outline: null })).toMatchObject({ ok: false });
  });
});
