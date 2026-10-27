// D32 (decided 2026-10-27): with ATLAS_EXECUTOR=modal the server warms Modal once at startup, without waiting.
//
// Plain words: the first sandbox in a fresh server costs about 3 s more (loading Modal's SDK, finding the app and
// the image). The warm-up pays that at startup by running the call-function control in one sandbox. That control is
// then reused for 10 minutes (D31), so the first visitor's paste needs one sandbox, not two. It never blocks the
// server and never stops it: a failure is one log line, and the first real run simply tries Modal again.

import type { Executor } from "../runner.ts";
import { callControlFor } from "../ts/call-runner.ts";
import { pyControlFor } from "../py/py-runner.ts";

/** Starts the warm-up. The promise always resolves (never rejects); the server does not await it. */
export function warmUp(executor: Executor, log: (line: string) => void = (l) => console.log(l)): Promise<void> {
  if (executor.kind !== "modal") return Promise.resolve();
  const t0 = performance.now();
  // E3 (coordinator, after E4): the Python control is warmed too, in one more sandbox, so a pasted Python round's
  // first run also needs one sandbox, not two.
  const one = (what: string, start: () => Promise<{ run: { controlPassed: boolean }; reason?: string }>) =>
    start()
      .then((c) => {
        const ms = Math.round(performance.now() - t0);
        if (c.run.controlPassed) log(`Modal warm-up (${what}): Modal is reachable; the known-case check passed in a sandbox in ${ms} ms and is reused for 10 minutes`);
        else log(`Modal warm-up (${what}): a sandbox ran, but the known-case check did not pass (${(c.reason ?? "no reason").slice(0, 300)}); runs will check again`);
      })
      .catch((e: unknown) => {
        log(`Modal warm-up (${what}) failed (the server keeps running; each run will try Modal again): ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
      });
  return Promise.all([one("JavaScript/TypeScript", () => callControlFor({ executor })), one("Python", () => pyControlFor({ executor }))]).then(() => undefined);
}
