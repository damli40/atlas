// Final review M6: what the screens call the code under test, from the target itself.
//
// Plain words: a pull request is named by its reference ("owner/repo#123"). A TypeScript target is named by
// the function the runner calls in it. Today one TypeScript target exists (the pre-existing withRpcRetry
// fixture), and runners/ts/control.ts reads its export name from here, so the screens and the runner can
// never disagree. A TypeScript file not listed here is named by its path, never by another target's name.

import type { Target } from "./types";

/** Each known TypeScript target's file → the exported function the TS runner calls. */
export const TS_TARGET_EXPORTS: Readonly<Record<string, string>> = { "tests/fixtures/with-rpc-retry.ts": "withRpcRetry" };

export function targetName(t: Pick<Target, "kind" | "ref">): string {
  return t.kind === "ts-fixture" ? (TS_TARGET_EXPORTS[t.ref] ?? t.ref) : t.ref;
}
