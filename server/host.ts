// H1 (D52): the container's entry point (Dockerfile CMD). It decides between two things, then gets out of the way:
// - SETUP MODE, only on the hosted server's very first start: every host rule holds, the invite pepper is set, and no
//   invite code exists yet. The full server would refuse to start ("no invite code is active"), and a machine that
//   keeps crashing cannot be reached with `fly ssh console` to make that code. So this answers /health and refuses
//   everything else with 503 (server/hosting.ts setupApp). Nothing is spent, nothing is started, no store lock is taken.
//   The operator makes the owner code on the machine, then restarts the app (tools/fly-setup.md).
// - Otherwise: the full server (server/index.ts), which runs every check again itself, so running it directly is
//   never less safe than running it through here.
//
// Like server/index.ts, the first import reads the repo's .env (none in the image; Fly's secrets are real env vars).
import "./load-env";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { isMountPoint, setupApp, setupLine, setupNeeded } from "./hosting";
import { osSandbox } from "./meta/roles/fixer";

const facts = { platform: process.platform, sandboxExec: osSandbox() !== null, isMountPoint, exists: existsSync };
if (setupNeeded(process.env, facts)) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: setupApp().fetch, port }, (info) => {
    console.log(setupLine(info.port, process.env.FLY_APP_NAME));
  });
} else {
  await import("./index");
}
