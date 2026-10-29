// D04-04: validate the example .atlas.json files with src/atlasfile.ts (zod + plain-code checks).
//   pnpm exec tsx tests/evidence/D04-04/validate.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyAtlasFile } from "../../../src/atlasfile.ts";
// The first two are the original D04-04 files (kept as recorded); the last two were regenerated on Oct 27 with the code after the days 3–4 review and M7.
for (const name of ["fixture-GFNRq1eJx7.atlas.json", "superseded/moonwell-level2-fKqHGIIi2_.json", "fixture-eRopGsrp2a.atlas.json", "moonwell-level2-mwTaxvHFzB.atlas.json"]) {
  const v = verifyAtlasFile(JSON.parse(readFileSync(join(import.meta.dirname, name), "utf8")));
  if (v.ok) {
    const f = v.file;
    console.log(`${name}: valid · target ${f.target.ref} · ${f.bets.length} bets · verdicts ${f.verdicts.map((x) => x.outcome).join(", ")} · ${f.forkBlock ? `fork block ${f.forkBlock}` : `seed ${f.seed}`} · captions: ${JSON.stringify(f.captions)}`);
  } else console.log(`${name}: NOT valid: ${v.problems.join("; ")}`);
}
