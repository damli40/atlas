// R3 review B6: every wire on the chart is true of the code. The review's 42 snippets go through the real parser and bench
// model, and where a wire is drawn to a device, the real run must show calls to it.
import { beforeAll, describe, expect, it } from "vitest";
import { betView } from "../../renderer/authors/bet-view";
import { fileOutline } from "../../src/file-outline";
import { gate } from "../../src/gate";
import { makePastedTarget } from "../../src/pasted-code";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner";
import { cases } from "../fixtures/r3/snippets";

describe("R3 B6: wires against the code's truth", () => {
  let ctl: Awaited<ReturnType<typeof runCallControl>>["run"];
  let pyctl: Awaited<ReturnType<typeof runPyCallControl>>["run"];
  beforeAll(async () => {
    ctl = (await runCallControl()).run;
    pyctl = (await runPyCallControl()).run;
  }, 120_000);
  for (const c of cases) {
    it(c.id, async () => {
      const outline = fileOutline(c.src, c.lang);
      const g = gate({ shape: "call-function", ...c.p }, { exportNames: [c.p.exportName] });
      expect(g.allowed).toBe(true);
      if (!g.allowed) return;
      const spec = betView({ fileName: `f.${c.lang}`, outline, source: c.src, language: c.lang, test: g.params as never, tested: c.p.exportName });
      const wires = spec.edges.filter((e) => e.to.startsWith("stand-in") || e.to === "clock housing").map((e) => `${e.from}=>${e.to}`);
      // No false wire. (A missing one is allowed: plain code may miss `map(fetch)`, and the card says no line was found.)
      expect(wires.filter((w) => !c.truthWires.includes(w))).toEqual([]);
      const exp = { id: "exp1", target: makePastedTarget(c.src, c.lang), runner: "ts" as const, params: g.params as never, proposedBy: { role: "human" as const }, gate: { allowed: true as const } };
      const run = c.lang === "py" ? await runPyCallExperiment(exp as never, pyctl) : await runCallExperiment(exp as never, ctl);
      // Each device wire drawn is seen in the real run: the path really reached that device.
      for (const w of wires) {
        const to = w.split("=>")[1]!;
        if (to === "clock housing") continue;
        const name = to.replace("stand-in ", "");
        const n = run.result.measured[`calls:${name}`];
        if (typeof n === "number") expect(`${w}: ${n}`).not.toBe(`${w}: 0`);
      }
    }, 60_000);
  }
});
