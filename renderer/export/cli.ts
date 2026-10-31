// R3: draws one saved spec in pencil to a PNG. npx tsx renderer/export/cli.ts <spec name in tests/fixtures/r3/specs.json> <out.png> [px per mm]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawPlate } from "./plate";

const [name, out, ppm] = process.argv.slice(2);
if (!name || !out) throw new Error("usage: cli.ts <spec> <out.png> [ppm]");
const data = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "tests", "fixtures", "r3", "specs.json"), "utf8"));
const t = performance.now();
await drawPlate(data.specs[name], { out, ...(ppm ? { ppm: Number(ppm) } : {}) });
console.log(`${name}: ${Math.round(performance.now() - t)} ms`);
