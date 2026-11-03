// R10 (D72): a local copy of the hosted set-up for the screenshots: the real invite gate with ATLAS_REQUIRE_INVITE on, the
// three app copies (developers, owner, open example), the real ledger in a temp folder, a placeholder waitlist address, the
// built page from dist/. Every model is a fake that COUNTS and fails: a no-code visitor must never reach it. Local sandbox. $0.
//   pnpm exec vite build && PORT=18970 pnpm exec tsx tests/evidence/R10/server.mts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "../../../server/app";
import { createProofStore } from "../../../server/evm-round";
import { createModelBudget, type ModelBudget } from "../../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../../server/meta/client";
import { createReplayGate, createRunGate, createSandboxGate } from "../../../server/replay-limits";
import { withInviteGate } from "../../../server/access/gate";
import { openLedger } from "../../../server/access/ledger";
import { meteredExecutor, meteredGate } from "../../../server/access/metered";
import { openInviteStore } from "../../../server/access/store";
import { servePage } from "../../../server/hosting";
import { localExecutor } from "../../../runners/executor/local";

const dir = mkdtempSync(join(tmpdir(), "atlas-r10-ev-"));
const store = openInviteStore(dir, { env: { ATLAS_INVITE_PEPPER: "evidence-pepper-".padEnd(48, "x") } });
store.create({ label: "dami", role: "owner" }); // never printed: the shots are taken with no code
let budget: ModelBudget | undefined;
const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 1, modelSpentUsd: () => budget!.spentUsd() });
budget = createModelBudget({ spendCeilingUsd: 1, guard: ledger });
const calls: string[] = [];
const chat = async (a: ChatArgs): Promise<ChatResult> => {
  calls.push(`${a.role} ${a.model}`);
  writeFileSync(join(dir, "model-calls.txt"), calls.join("\n"));
  return { ok: false, reason: "evidence server: no model", detail: "evidence server: no model" } as unknown as ChatResult;
};
const opts = (): Parameters<typeof createApp>[0] => ({
  proofs: createProofStore({ publish: false }),
  modelBets: { chat, budget: budget!, sparkOpen: { available: true } },
  investigator: { chat, budget: budget! },
  paste: { proposer: { chat, budget: budget! } },
  executor: meteredExecutor(localExecutor, ledger),
  runGate: meteredGate(createRunGate(), ledger, "EVM run", { ownerGate: createRunGate() }),
  replayGate: meteredGate(createReplayGate(), ledger, "EVM replay", { ownerGate: createReplayGate() }),
  sandboxGate: meteredGate(createSandboxGate(), ledger, "sandbox start", { ownerGate: createSandboxGate(), count: false }),
  exampleRoom: () => ledger.exampleRoom(),
});
const gated = withInviteGate(createApp(opts()), { store, require: true, ledger, secureCookie: false, ownerInner: createApp(opts()), exampleInner: createApp(opts()), waitlistUrl: "https://example.com/atlas-waitlist-placeholder" });
const outer = new Hono();
outer.get("/__evidence", (c) => c.json({ modelCalls: calls.length, calls, ledgerLog: join(dir, "spend-log.jsonl") }));
const page = servePage(gated);
outer.all("*", (c) => page.fetch(c.req.raw, c.env));
const port = Number(process.env.PORT ?? 18970);
serve({ fetch: outer.fetch, port, hostname: "127.0.0.1" }, () => console.log(`R10 evidence server on http://127.0.0.1:${port} (ledger folder ${dir})`));
