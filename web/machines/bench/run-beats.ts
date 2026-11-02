// The machine's beats for one run, the same for the result on screen and for the proof card. Plain code, from the run's own trace.
import { machineScript, type MachineBeat } from "../../../renderer/authors/machine-script";
import { ranParts, type MachineParts } from "../../../renderer/authors/machine";
import { whatHappened } from "../../../renderer/authors/what-happened";
import type { Experiment, Run } from "../../../src/types";
import type { HelperAnswer } from "../../api";

export function runBeats(o: { run: Run; experiment: Pick<Experiment, "params">; helpers?: HelperAnswer | null; parts: MachineParts; tested: string | null; spec?: Parameters<typeof machineScript>[0] }): MachineBeat[] {
  const spec = o.spec ?? whatHappened({ run: o.run, experiment: o.experiment as never, bets: [], verdicts: [], origin: "proof-file", ...(o.helpers ? { helpers: o.helpers } : {}), seed: `path:${o.run.id}` });
  const m = o.run.result.measured as Record<string, unknown>;
  const called = (port: string) => {
    const v = m[`calls:${port.replace(/^stand-in /, "")}`];
    return typeof v === "number" && v > 0;
  };
  const steps = o.helpers && "steps" in o.helpers ? o.helpers.steps : [];
  const ran = ranParts({ tested: o.tested, steps, parts: o.parts, called });
  const within = new Map(steps.map((s) => [s.name, s.within ?? []]));
  const joins = o.parts.pipes.map((e) => ({ id: `${e.from}->${e.to}`, from: e.from, to: e.to, kind: e.kind }));
  // A part known to have run keeps its lamp lit at rest. A thread is another matter: that needs the true caller.
  return [...machineScript(spec, o.parts, { joins }, o.tested, within, !/"(?:afterMs|waitMs)"/.test(JSON.stringify(o.experiment.params))), { routes: [], lamps: [...ran, ...o.parts.ports.filter((q) => called(q.id)).map((q) => q.id)] }];
}
