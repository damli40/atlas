// D60 item 4 and 6: what the first screen relies on.
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createModelBudget } from "../../server/meta/budget";
import { EXAMPLE_FUNCTION } from "../../server/paste";
import { fileOutline } from "../../src/file-outline";
import { U1_EXAMPLE } from "../../web/u1-example";
import EXAMPLE_OUTLINE from "../../web/u1-example-outline.json";
import { defaultFunction } from "../../web/screens/Studio";
import type { ChatArgs, ChatResult } from "../../server/meta/client";

describe("the first screen's example", () => {
  const outline = fileOutline(U1_EXAMPLE, "ts");
  it("the drawing kept in the page is the parser's real output", () => {
    expect(EXAMPLE_OUTLINE).toEqual(JSON.parse(JSON.stringify(outline)));
  });
  it("the kept tests are for the function the round opens on", () => {
    const exports = outline.parts.filter((p) => p.exported).map((p) => ({ name: p.name }));
    expect(defaultFunction(outline, exports)).toBe(EXAMPLE_FUNCTION);
  });
  it("R7: Muse Wonder is not asked for it at all (its tests are recorded, server/example-round.ts), whoever asks; another file still asks", async () => {
    let calls = 0;
    const chat = async (_a: ChatArgs): Promise<ChatResult> => {
      calls++;
      return { ok: true, finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, usd: 0 }, content: JSON.stringify({ claim: "It retries.", experiments: [{ shape: "call-function", exportName: EXAMPLE_FUNCTION, args: [{ kind: "stand-in", name: "fetchIt", async: true, then: "repeat_last", calls: [{ do: "return", value: 1 }] }] }] }) };
    };
    const app = createApp({ modelBets: { chat, budget: createModelBudget({ spendCeilingUsd: 5, callsPerHour: 1000 }) }, paste: { proposer: { chat } } });
    const ask = async (session: string, code: string, exportName: string) => {
      const headers = { "content-type": "application/json", "x-atlas-session": session };
      const p = (await (await app.request("/paste", { method: "POST", headers, body: JSON.stringify({ code, language: "ts" }) })).json()) as { target: { ref: string; codeSha256: string } };
      const r = await app.request("/paste/proposals", { method: "POST", headers, body: JSON.stringify({ target: { ref: p.target.ref, codeSha256: p.target.codeSha256 }, exportName }) });
      return (await r.json()) as { ok: boolean; proposals: { id: string }[] };
    };
    const a = await ask("ssaaaaaaaaaaaaaaaa", U1_EXAMPLE, EXAMPLE_FUNCTION);
    const b = await ask("ssbbbbbbbbbbbbbbbb", U1_EXAMPLE, EXAMPLE_FUNCTION);
    expect(a.ok && b.ok).toBe(true);
    expect(b.proposals.length).toBeGreaterThan(0);
    expect(calls).toBe(0);
    await ask("ssaaaaaaaaaaaaaaaa", "export function other(){ return 1; }\n", "other");
    expect(calls).toBeGreaterThan(0);
  }, 30_000);
  it("review minor 6: without a recorded answer for its model, the example asks Muse Wonder once, whoever asks after; another file still asks", async () => {
    let calls = 0;
    const chat = async (_a: ChatArgs): Promise<ChatResult> => {
      calls++;
      return { ok: true, finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, usd: 0 }, content: JSON.stringify({ claim: "It retries.", experiments: [{ shape: "call-function", exportName: EXAMPLE_FUNCTION, args: [{ kind: "stand-in", name: "fetchIt", async: true, then: "repeat_last", calls: [{ do: "return", value: 1 }] }] }] }) };
    };
    // A proposer model the recording was not made with: the live path, kept once (D60).
    const app = createApp({ modelBets: { chat, budget: createModelBudget({ spendCeilingUsd: 5, callsPerHour: 1000 }) }, paste: { proposer: { chat, model: "muse-spark-1.3" } } });
    const ask = async (session: string, code: string, exportName: string) => {
      const headers = { "content-type": "application/json", "x-atlas-session": session };
      const p = (await (await app.request("/paste", { method: "POST", headers, body: JSON.stringify({ code, language: "ts" }) })).json()) as { target: { ref: string; codeSha256: string } };
      const r = await app.request("/paste/proposals", { method: "POST", headers, body: JSON.stringify({ target: { ref: p.target.ref, codeSha256: p.target.codeSha256 }, exportName }) });
      return (await r.json()) as { ok: boolean; proposals: { id: string }[] };
    };
    const a = await ask("ssaaaaaaaaaaaaaaaa", U1_EXAMPLE, EXAMPLE_FUNCTION);
    const b = await ask("ssbbbbbbbbbbbbbbbb", U1_EXAMPLE, EXAMPLE_FUNCTION);
    expect(a.ok && b.ok, JSON.stringify(a)).toBe(true);
    expect(b.proposals.length).toBeGreaterThan(0);
    expect(calls).toBe(1);
    await ask("ssaaaaaaaaaaaaaaaa", "export function other(){ return 1; }\n", "other");
    expect(calls).toBeGreaterThan(1);
  }, 30_000);
});
