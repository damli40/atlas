// D60: a shared proof link opens logged out and survives a restart, without the pasted source. Nothing is kept unless asked.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";

const SRC = "export function secretName(a) {\n  return a + 1;\n}\n";
const round = async (app: ReturnType<typeof createApp>, session: string) => {
  const headers = { "content-type": "application/json", "x-atlas-session": session };
  const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers, body: JSON.stringify(body) })).json() as Promise<Record<string, never>>;
  const p = await post("/paste", { code: SRC, language: "js" });
  const target = { ref: (p.target as { ref: string }).ref, codeSha256: (p.target as { codeSha256: string }).codeSha256 };
  const e = await post("/experiments", { target, params: { shape: "call-function", exportName: "secretName", args: [{ kind: "json", value: 1 }] }, quiz: true });
  const id = (e.experiment as { id: string }).id;
  const qs = e.questions as { measures: string }[];
  await post("/bets", { experimentId: id, who: "human", bets: qs.map((q) => ({ measures: q.measures, answer: { kind: "declined", reason: "can't tell" } })) });
  const r = await post("/runs", { experimentId: id });
  if (!r.run) throw new Error(JSON.stringify(r).slice(0, 300));
  return (r.run as { id: string }).id;
};

describe("a shared proof link", () => {
  it("survives a restart once asked for, opens with no session, and leaves the source out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const a = createApp({ keptProofsDir: dir });
    const runId = await round(a, "ssownerownerowner1");
    expect((await createApp({ keptProofsDir: dir }).request(`/proofs/${runId}`)).status).toBe(404);
    expect(readdirSync(dir)).toEqual([]);
    const stranger = await a.request(`/proofs/${runId}/keep`, { method: "POST", headers: { "x-atlas-session": "ssstrangerstranger" } });
    expect(stranger.status).toBe(403);
    const kept = await a.request(`/proofs/${runId}/keep`, { method: "POST", headers: { "x-atlas-session": "ssownerownerowner1" } });
    expect(await kept.json()).toEqual({ kept: true });
    const after = await createApp({ keptProofsDir: dir }).request(`/proofs/${runId}`);
    expect(after.status).toBe(200);
    const body = (await after.json()) as { sourceWithheld?: boolean; runs: { id: string }[] };
    expect(body.runs[0]!.id).toBe(runId);
    expect(body.sourceWithheld).toBe(true);
    expect(readFileSync(join(dir, `${runId}.json`), "utf8")).not.toContain("return a + 1");
  }, 60_000);
  it("a run id cannot walk out of the folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kept-"));
    const r = await createApp({ keptProofsDir: dir }).request(`/proofs/${encodeURIComponent("../../etc/passwd")}`);
    expect(r.status).toBe(404);
  });
});
