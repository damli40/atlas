// R3 review B9: the one drawing of a proof file, for anything that draws it from the file alone (the pencil image). The rules
// a drawing of the retry demo or a D20 run must obey are not repeated here: this picks the same author the screens use, and
// that author writes the label. So the pre-existing label, the viem line and D20's "in theory" cannot go missing.
// Not here: D21's caption belongs beside the scoreboard's mark (the Atlas logo). This drawing has no logo, so no caption.
// Pure.

import { theoryCaptions } from "../../src/change";
import type { AtlasFile } from "../../src/types";
import type { RenderSpec } from "../spec";
import { moonwellFlow } from "./moonwell";
import { retryDemo, whatHappened } from "./what-happened";

export function specOfFile(file: Pick<AtlasFile, "runs" | "experiments" | "bets" | "verdicts" | "captions" | "change">, seed: string): RenderSpec | null {
  const run = file.runs[0];
  if (!run) return null;
  const experiment = file.experiments[0];
  const theory = theoryCaptions(file.change).map((words) => ({ words, provenance: "plain-code" as const }));
  const spec =
    run.runner === "evm"
      ? moonwellFlow({ run, bets: file.bets, verdicts: file.verdicts, fileCaptions: file.captions, origin: "proof-file", seed, ...(file.change ? { beforeChange: true } : {}) })
      : experiment?.params.shape === "retry-scenario" || !experiment
        ? retryOrPlain(file, seed)
        : whatHappened({ run, experiment, bets: file.bets.filter((b) => b.who === "human"), verdicts: file.verdicts, origin: "proof-file", seed, title: "What happened" });
  if (!theory.length) return spec;
  // The file's captions may hold the same words: once is enough.
  const seen = new Set<string>();
  return { ...spec, captions: [...theory, ...spec.captions].filter((c) => (seen.has(c.words) ? false : seen.add(c.words) && true)) };
}

function retryOrPlain(file: Pick<AtlasFile, "runs" | "experiments" | "bets" | "verdicts">, seed: string): RenderSpec {
  const run = file.runs[0]!;
  const experiment = file.experiments[0];
  if (experiment) return retryDemo({ run, experiment, bets: file.bets, verdicts: file.verdicts, origin: "proof-file", seed });
  return whatHappened({ run, bets: file.bets.filter((b) => b.who === "human"), verdicts: file.verdicts, origin: "proof-file", seed, title: "What happened" });
}
