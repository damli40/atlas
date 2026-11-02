// The shared proof picture's machine SVG, built exactly as web/screens/ProofImage.tsx builds it, for each R8 fixture run.
//   ROOT=<a checkout> FIX=<repo>/tests/unit/fixtures/r8-runs pnpm exec tsx tests/evidence/R8/proof-picture-sha.mts
// Prints one sha256 per fixture and ring kind. Main's tree was exported with `git archive 3203228`.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
const ROOT = process.env.ROOT!;
const FIX = process.env.FIX!;
const { drawMachine, endOfFile, machinePartsOfFile, publicParts, ringFor } = await import(`${ROOT}/renderer/authors/machine.ts`);
const { lightMachine } = await import(`${ROOT}/renderer/authors/machine-script.ts`);
const { runBeats } = await import(`${ROOT}/web/machines/bench/run-beats.ts`);
const { fileOutline } = await import(`${ROOT}/src/file-outline.ts`);
for (const f of readdirSync(FIX).sort()) {
  const x = JSON.parse(readFileSync(`${FIX}/${f}`, "utf8"));
  const parts = publicParts(machinePartsOfFile(x.source, x.language, x.params, fileOutline(x.source, x.language)));
  const steps = x.helpers && "steps" in x.helpers ? x.helpers.steps : [];
  const end = endOfFile({ measured: x.run.result.measured, parts: machinePartsOfFile(x.source, x.language, x.params, fileOutline(x.source, x.language)), tested: x.params.exportName, test: x.params, steps, thrownAt: x.helpers?.thrownAt ?? null });
  for (const kind of ["not_matched", "matched"] as const) {
    const drawn = drawMachine(parts, { seed: `proof:${x.run.id}`, ended: true, end, ring: ringFor({ kind, you: "returns a value", end, tested: x.params.exportName, stranger: false }) });
    const svg = lightMachine(drawn.svg, runBeats({ run: x.run, experiment: { params: x.params }, helpers: x.helpers, parts, tested: x.params.exportName }));
    console.log(f, kind, createHash("sha256").update(svg).digest("hex").slice(0, 16), svg.length);
  }
}
