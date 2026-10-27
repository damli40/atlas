// The scenarios a person can pick for withRpcRetry: the six rows of the oracle table, in plain words.
// Each is a "retry-scenario" experiment; the server's gate (src/gate.ts) still checks it.

import type { ExperimentShape } from "../src/types";

export interface Scenario {
  id: string;
  label: string;
  params: ExperimentShape;
}

export const SCENARIOS: Scenario[] = [
  { id: "S3", label: "Every call fails (5 errors in a row)", params: { shape: "retry-scenario", failTimes: 5, failure: "error" } },
  { id: "S1", label: "The first call answers", params: { shape: "retry-scenario", failTimes: 0, failure: "error" } },
  { id: "S2", label: "One call fails, then it answers", params: { shape: "retry-scenario", failTimes: 1, failure: "error" } },
  { id: "S4", label: "One HTTP 429 (too many requests), then it answers", params: { shape: "retry-scenario", failTimes: 1, failure: "error", errorKind: "429" } },
  { id: "S5", label: "The first call answers with a body that says 429", params: { shape: "retry-scenario", failTimes: 0, failure: "error", resolvesWith: { status: 429 } } },
  { id: "S6", label: "A call never answers", params: { shape: "retry-scenario", failTimes: "always", failure: "never_settles" } },
];

export const DEFAULT_SCENARIO = "S3";

export const FIXTURE_REF = "tests/fixtures/with-rpc-retry.ts";
