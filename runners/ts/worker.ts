// Entry point inside the sandboxed child process (see runners/executor/local.ts).
//
// The executor copies four files into an empty temp folder: this worker, harness.ts, shapes.ts,
// the code under test as target.ts, plus request.json. The worker loads target.ts, runs every
// requested scenario through the harness, and prints ONE line to stdout:
//   ATLAS_RESULT {"runs":[...]}
// Anything else the code under test prints is ignored by the parent.

import { readFileSync } from "node:fs";
import { RESULT_MARKER, runScenario, type RetryFn, type WorkerRequest, type WorkerResponse } from "./harness.ts";

async function main(): Promise<void> {
  const req = JSON.parse(readFileSync(new URL("./request.json", import.meta.url), "utf8")) as WorkerRequest;
  // A variable specifier keeps the type checker from resolving a file that exists only in the sandbox.
  const targetPath = "./target.ts";
  const mod = (await import(targetPath)) as Record<string, unknown>;
  const target = mod[req.exportName];
  if (typeof target !== "function") throw new Error(`target.ts has no exported function "${req.exportName}"`);

  const out: WorkerResponse = { runs: [] };
  for (const r of req.runs) {
    const res = await runScenario(target as RetryFn, r.scenario, {
      seed: r.seed,
      ...(r.label !== undefined ? { label: r.label } : {}),
      ...(r.watchLimitMs !== undefined ? { watchLimitMs: r.watchLimitMs } : {}),
    });
    out.runs.push({ id: r.id, ...res });
  }
  process.stdout.write(`\n${RESULT_MARKER}${JSON.stringify(out)}\n`);
  // Exit now: a never-settled promise must not keep the process alive, and the parent has the answer.
  process.exit(0);
}

main().catch((e: unknown) => {
  process.stderr.write(`worker failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(2);
});
