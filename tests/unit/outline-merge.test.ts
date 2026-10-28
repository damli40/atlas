// X1 after main's E3 + E4: one shared code guard for pasted code and outlines, the outline on the shared model
// budget (server/wiring.ts), and outline jobs counted against E3's per-address paste allowance.
import { describe, expect, it } from "vitest";
import { codeModelRefusal, guardCodeChat, guardPastedChat, pastedCodeModelRefusal, MAX_PASTED_PROMPT_CHARS } from "../../server/meta/pasted-guard";
import { codeModelRefusal as outlineRefusal, guardCodeChat as outlineGuard, MAX_OUTLINE_PROMPT_CHARS } from "../../server/meta/roles/outliner";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { serverOptions } from "../../server/wiring";
import { createModelBudget } from "../../server/meta/budget";
import { createProofStore } from "../../server/evm-round";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { FILES } from "../tools/outline-fixtures";

const ok: ChatResult = { ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 } };
const args = (model: string, chars = 10): ChatArgs => ({ role: "outliner", model, messages: [{ role: "user", content: "x".repeat(chars) }] });

describe("one shared code guard (server/meta/pasted-guard.ts) for pasted code and outlines", () => {
  it("both paths refuse every contributor id, even with ATLAS_ALLOW_CONTRIBUTOR=1, and say which code it was", async () => {
    const before = process.env.ATLAS_ALLOW_CONTRIBUTOR;
    process.env.ATLAS_ALLOW_CONTRIBUTOR = "1";
    try {
      for (const model of ["muse-wonder-1.0-contributor", "muse-spark-1.3:Contributor"]) {
        expect(pastedCodeModelRefusal(model)).toMatch(/pasted code is never sent to one/);
        expect(outlineRefusal(model)).toMatch(/a codebase is never sent to one/);
        expect(codeModelRefusal(model)).not.toBeNull();
        let sent = 0;
        const chat = async () => (sent++, ok);
        expect(await guardPastedChat(chat)(args(model))).toMatchObject({ ok: false, notSent: true });
        expect(await outlineGuard(chat)(args(model))).toMatchObject({ ok: false, notSent: true });
        expect(sent).toBe(0);
      }
      expect(outlineRefusal("muse-wonder-1.0")).toBeNull();
    } finally {
      if (before === undefined) delete process.env.ATLAS_ALLOW_CONTRIBUTOR;
      else process.env.ATLAS_ALLOW_CONTRIBUTOR = before;
    }
  });

  it("each path keeps its own prompt limit; an allowed call goes through", async () => {
    let sent = 0;
    const chat = async () => (sent++, ok);
    expect(await guardPastedChat(chat)(args("muse-wonder-1.0", MAX_PASTED_PROMPT_CHARS + 1))).toMatchObject({ ok: false, reason: expect.stringMatching(/pasted code may send at most/) });
    expect(await outlineGuard(chat)(args("muse-wonder-1.0", MAX_OUTLINE_PROMPT_CHARS + 1))).toMatchObject({ ok: false, reason: expect.stringMatching(/a codebase may send at most/) });
    expect(await outlineGuard(chat)(args("muse-wonder-1.0", MAX_PASTED_PROMPT_CHARS + 1))).toMatchObject({ ok: true });
    expect(await guardCodeChat(chat, { what: "x", maxPromptChars: 5, maxCallUsd: 100 })(args("muse-wonder-1.0", 6))).toMatchObject({ ok: false });
    expect(sent).toBe(1);
  });
});

describe("outline jobs share E3's budgets", () => {
  it("the live wiring gives the outliner the same budget object as every other role", () => {
    const budget = createModelBudget();
    const o = serverOptions({}, { makeChat: () => async () => ok, budget, sparkOpen: { available: false, reason: "test" }, proofs: createProofStore({ publish: false }), refusals: () => {} });
    expect(o.outline?.outliner?.budget).toBe(budget);
    expect(o.paste?.proposer?.budget).toBe(budget);
    expect(serverOptions({ ATLAS_OUTLINER: "off" }, { makeChat: () => async () => ok, budget, sparkOpen: { available: false, reason: "test" }, proofs: createProofStore({ publish: false }), refusals: () => {} }).outline).toBeUndefined();
  });

  it("an outline job counts against the per-address paste allowance", async () => {
    process.env.ATLAS_PASTES_PER_IP_PER_HOUR = "1";
    try {
      const app = createApp({ agentLog: createAgentLog() });
      const post = (path: string, body: unknown, s: string) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": s }, body: JSON.stringify(body) });
      expect((await post("/outline/jobs", { files: FILES.map((f) => ({ path: f.path, text: f.text })) }, "a")).status).toBe(202);
      const paste = await post("/paste", { code: "export function add(a, b) { return a + b; }\n" }, "b");
      expect(paste.status).toBe(429);
    } finally {
      delete process.env.ATLAS_PASTES_PER_IP_PER_HOUR;
    }
  });
});
