// D60 check: the real app behind the real invite gate, models off. Prints one code. PORT=<port> pnpm exec tsx tests/evidence/R3/design/invite-server.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { withInviteGate } from "../../../../server/access/gate";
import { openInviteStore } from "../../../../server/access/store";
import { createApp } from "../../../../server/app";
const dir = mkdtempSync(join(tmpdir(), "invite-"));
const store = openInviteStore(dir, { env: { ATLAS_INVITE_PEPPER: "x".repeat(64), ATLAS_INVITE_SECRET: "x".repeat(64) } as never });
const { code } = store.create({ label: "check", dailyUsd: 1 }) as unknown as { code: string };
const dir2 = mkdtempSync(join(tmpdir(), "kept-"));
const app = withInviteGate(createApp({ keptProofsDir: dir2 }), { store, require: true, secureCookie: false });
serve({ fetch: app.fetch, port: Number(process.env.PORT) }, () => console.log(`CODE ${code}`));
