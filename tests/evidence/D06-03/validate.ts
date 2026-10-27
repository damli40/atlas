// D06-03: the two files the proof cards draw validate with src/atlasfile.ts.
//   pnpm exec tsx tests/evidence/D06-03/validate.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyAtlasFile } from "../../../src/atlasfile.ts";
for (const name of ["fixture-eRopGsrp2a.atlas.json", "moonwell-level2-mwTaxvHFzB.atlas.json"]) {
  const v = verifyAtlasFile(JSON.parse(readFileSync(join(import.meta.dirname, "../D04-04", name), "utf8")));
  console.log(v.ok ? `${name}: valid · captions ${JSON.stringify(v.file.captions)}` : `${name}: NOT valid: ${v.problems.join("; ")}`);
}
