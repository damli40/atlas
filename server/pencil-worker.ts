// R3 review B8: draws one pencil image, in its own process, so the server's thread is never held. server/pencil.ts starts this,
// with a kill limit and no secrets in its environment. Argument 1: a file holding the spec. Argument 2: where the PNG goes.
// Exit codes: 0 drawn; 3 the engine is not installed here; 4 the spec may not be drawn; anything else, a failure.

import { readFileSync } from "node:fs";

const [specPath, out] = process.argv.slice(2);
if (!specPath || !out) process.exit(2);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
let plate: typeof import("../renderer/export/plate");
try {
  plate = await import("../renderer/export/plate");
} catch {
  process.exit(3);
}
try {
  await plate.drawPlate(spec, { out, ppm: 6 });
  process.exit(0);
} catch (e) {
  process.exit(e instanceof plate.ExportUnavailable ? 3 : 4);
}
