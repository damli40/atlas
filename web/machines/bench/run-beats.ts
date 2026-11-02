// The machine's beats for one run, the same for the result on screen and for the proof card. Plain code, from the run's own trace.
import { machineScript, type MachineBeat } from "../../../renderer/authors/machine-script";
import { ranParts, type MachineEnd, type MachineParts } from "../../../renderer/authors/machine";
import { whatHappened } from "../../../renderer/authors/what-happened";
import { runAct, fitAct, type Act } from "../../../renderer/authors/run-act";
import type { FileOutline } from "../../../src/file-outline";
import type { Experiment, Run } from "../../../src/types";
import type { HelperAnswer } from "../../api";
import type { BenchModel } from "./model";

/** Nothing but the code moves the clock: the test scripts no delay of its own. */
const clockIsTheCodes = (experiment: Pick<Experiment, "params">) => !/"(?:afterMs|waitMs)"/.test(JSON.stringify(experiment.params));

const calledIn = (run: Run) => (port: string) => {
  const v = (run.result.measured as Record<string, unknown>)[`calls:${port.replace(/^stand-in /, "")}`];
  return typeof v === "number" && v > 0;
};

export function runBeats(o: { run: Run; experiment: Pick<Experiment, "params">; helpers?: HelperAnswer | null; parts: MachineParts; tested: string | null; spec?: Parameters<typeof machineScript>[0] }): MachineBeat[] {
  const spec = o.spec ?? whatHappened({ run: o.run, experiment: o.experiment as never, bets: [], verdicts: [], origin: "proof-file", ...(o.helpers ? { helpers: o.helpers } : {}), seed: `path:${o.run.id}` });
  const called = calledIn(o.run);
  const steps = o.helpers && "steps" in o.helpers ? o.helpers.steps : [];
  const ran = ranParts({ tested: o.tested, steps, parts: o.parts, called });
  const within = new Map(steps.map((s) => [s.name, s.within ?? []]));
  const joins = o.parts.pipes.map((e) => ({ id: `${e.from}->${e.to}`, from: e.from, to: e.to, kind: e.kind }));
  // A part known to have run keeps its lamp lit at rest. A thread is another matter: that needs the true caller.
  return [...machineScript(spec, o.parts, { joins }, o.tested, within, clockIsTheCodes(o.experiment)), { routes: [], lamps: [...ran, ...o.parts.ports.filter((q) => called(q.id)).map((q) => q.id)] }];
}

/** R8: the run acted out on the machine, step by step, from the same recorded fields (renderer/authors/run-act.ts). Folded to at most 24 steps. */
export function runActFor(o: { run: Run; experiment: Pick<Experiment, "params">; helpers?: HelperAnswer | null; parts: MachineParts; model: Pick<BenchModel, "parts">; outline: Pick<FileOutline, "joins" | "bodies">; tested: string | null; end: MachineEnd | null }): Act {
  const called = calledIn(o.run);
  const steps = o.helpers && "steps" in o.helpers ? o.helpers.steps : [];
  const portSites = new Map<string, { part: string; lines: number[] }[]>();
  for (const [id, p] of Object.entries(o.model.parts)) if (p.kind === "device") portSites.set(id, (p.calledBy ?? []).map((c) => ({ part: c.part, lines: [...c.lines] })));
  const act = runAct({ run: o.run, experiment: o.experiment as never, helpers: o.helpers ?? null, parts: o.parts, outline: o.outline, tested: o.tested, end: o.end, portSites, ran: ranParts({ tested: o.tested, steps, parts: o.parts, called }), clockIsTheCodes: clockIsTheCodes(o.experiment) });
  return { steps: fitAct(act.steps), quiet: act.quiet };
}
