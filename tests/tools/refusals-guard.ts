// Vitest global setup (S7): `pnpm test` must leave proofs/refusals/ exactly as it found it. That
// folder is public and holds only records from REAL live runs. This takes a fingerprint of the
// folder (names and bytes) before any test runs and fails the whole run if it differs afterwards.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../../proofs/refusals/", import.meta.url));

function fingerprint(): string {
  if (!existsSync(DIR)) return "absent";
  const h = createHash("sha256");
  for (const name of readdirSync(DIR).sort()) {
    h.update(name);
    h.update(readFileSync(join(DIR, name)));
  }
  return h.digest("hex");
}

export default function setup(): () => void {
  const before = fingerprint();
  return () => {
    if (fingerprint() !== before) {
      throw new Error("pnpm test changed proofs/refusals/: tests must use an in-memory refusal writer (or none), never the file writer");
    }
  };
}
