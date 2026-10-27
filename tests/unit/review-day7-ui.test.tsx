// Day-7 review, screen findings: S1 (the Change screen names each model bettor on its own), and the
// minors that live on screens (M3 "not asked" for the person in an autonomous round, M4 the toggle
// locked during a round, M6 a failed "What else?" can be asked again, M7 a model slot that failed
// still gets its column on the proof card). Each test failed on the code before its fix
// (tests/evidence/D07-review/*-tests-on-old-code.txt).

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeResult } from "../../web/screens/Change";
import type { ChangeAnswer } from "../../server/changes";
import type { AtlasFile, Run } from "../../src/types";

const D7 = join(__dirname, "..", "evidence", "D07-01");
const round = (n: number) => JSON.parse(readFileSync(join(D7, `round-${n}.atlas.json`), "utf8")) as AtlasFile;

function changeAnswer(file: AtlasFile): ChangeAnswer {
  const replay = { ...file.runs[0]!, id: "r", trace: [] } as Run;
  return {
    ok: true,
    runId: "x",
    change: { id: "c", runId: "x", diff: "", proposedBy: { role: "fixer", model: "muse-spark-1.3" }, toward: "t" },
    fixer: { path: "muse-exec", model: "muse-spark-1.3", attempts: [], usage: null },
    diff: "",
    caption: "c",
    replay,
    bets: file.bets,
    before: { run: { id: "a", codeSha256: "x" }, verdicts: file.verdicts },
    after: { run: { id: "r", codeSha256: "y" }, verdicts: file.verdicts },
  } as unknown as ChangeAnswer;
}

const bettorCells = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll('[data-testid="change-table"] tbody tr')].map((tr) => tr.children[1]!.textContent);
};

describe("S1: the Change screen labels each model bettor by its own name", () => {
  it("'both' mode (D07-01 round 1): Spark's rows say Spark, Spark Open's rows say Spark Open via Baseten", () => {
    const file = round(1);
    const cells = bettorCells(renderToStaticMarkup(<ChangeResult answer={changeAnswer(file)} />));
    const want = file.bets.map((b) =>
      b.who === "human" ? "You" : b.who === "model:muse-spark-1.3" ? "Muse Spark 1.3 (muse-spark-1.3)" : "Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten",
    );
    expect(cells).toEqual(want);
    expect(cells.filter((c) => c?.startsWith("Muse Spark Open"))).toHaveLength(3);
  });
  it("only Spark Open sealed (round 4): its rows are Spark Open's, never Spark's", () => {
    const cells = bettorCells(renderToStaticMarkup(<ChangeResult answer={changeAnswer(round(4))} />));
    expect(cells).toContain("Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten");
    expect(cells.some((c) => c?.startsWith("Muse Spark 1.3"))).toBe(false);
  });
});
