import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFinding } from "../../../../server/meta/roles/investigator.ts";
const R = new URL("../../../..", import.meta.url).pathname;
const read = (p: string) => readFileSync(p, "utf8");
const files = new Map<string, string>();
for (const p of ["chains/8453.json", "proposals/ChainlinkOracleConfigs.sol", "proposals/mips/mip-x43/mip-x43.sol"]) files.set(p, read(join(R, "contracts/lib/moonwell", p)));
files.set("tests/fixtures/with-rpc-retry.ts", read(join(R, "tests/fixtures/with-rpc-retry.ts")));
let kept = 0, dropped = 0;
for (const f of ["investigator-5-runs.jsonl", "investigator-medium-2-runs.jsonl", "investigator-low-extra-3-runs.jsonl", "fixture-runs.jsonl"]) {
  for (const line of read(join(R, "tests/evidence/D04-03", f)).split("\n").filter(Boolean)) {
    const d = JSON.parse(line);
    for (const x of d.findings ?? []) {
      const { file, lineStart, lineEnd, kind, claim, quotedSnippet } = x; const r = checkFinding({ file, lineStart, lineEnd, kind, claim, quotedSnippet }, files);
      if (r.ok) kept++; else { dropped++; console.log(f, x.file, x.lineStart, x.lineEnd, "->", r.reason); }
    }
  }
}
console.log(`previously verified findings: ${kept + dropped}; still verified under the whole-line + 12-char rule: ${kept}; now dropped: ${dropped}`);
