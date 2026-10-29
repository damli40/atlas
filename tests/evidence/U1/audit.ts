// U1: the Anatomy audit on the drawing-first figure, at rest (the file only) and selected (with a test: the stand-in
// deck, the devices and the clock), for the example with the mocked test, the live run's test, and the earlier fixture.
// The animation and the marks change classes, the needle path and HTML only, never the geometry, so these two builds
// are every geometry the screen draws; the line-end check runs in the browser on all four states (README).
//
// Run: pnpm exec tsx tests/evidence/U1/audit.ts
import { fileOutline } from "../../../src/file-outline";
import { timeOptions } from "../../../src/quiz";
import { U1_EXAMPLE } from "../../../web/u1-example";
import { benchModel, dialFullMs, type CallTest } from "../../../web/machines/bench/model";
import { auditFigure, buildFigure } from "../../../web/machines/explorer/figure.mjs";
import { RETRY_SRC } from "../../tools/paste-fixtures";
import { U1_TEST } from "./mock-server";

const LIVE_TEST: CallTest = {
  shape: "call-function",
  exportName: "fetchWithRetry",
  args: [{ kind: "stand-in", name: "fetchIt", async: true, calls: [{ do: "throw", errorName: "Error", message: "flaky" }], then: "repeat_last" }, { kind: "json", value: 3 }, { kind: "json", value: 100 }],
};
const marksOf = (t: CallTest) => [...new Set(timeOptions(t).flatMap((o) => (o.match.kind === "ms" ? [o.match.min, o.match.max ?? 0].filter((x) => x > 0) : [])))];
let failed = 0;
for (const [name, src, test] of [
  ["example at rest", U1_EXAMPLE, null],
  ["example, mocked test", U1_EXAMPLE, U1_TEST as CallTest],
  ["example, live test", U1_EXAMPLE, LIVE_TEST],
  ["retry fixture at rest", RETRY_SRC, null],
] as const) {
  const outline = fileOutline(src, "ts");
  const marks = test ? marksOf(test) : [];
  const fig = buildFigure(benchModel({ fileName: "pasted.ts", outline, test, dial: { marks, fullMs: dialFullMs(marks) } }) as never);
  const a = auditFigure(fig);
  console.log(`${name}: ${fig.stats.solids} solids, ${fig.stats.items} items, ${fig.stats.lines} lines · ${a.passed ? "audit passed" : `audit FAILED (${a.problems} problems)`}`);
  if (!a.passed) {
    failed++;
    console.log(a.report);
  }
}
process.exit(failed ? 1 : 0);
