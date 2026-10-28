// X2: writes the explorer's two saved fixtures from one saved X1 outline section (no model call, no network).
//
//   X2_SECTION=<saved section .json> npx tsx tests/tools/x2-fixture.ts
//
// 1. tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json: exactly what GET /outline/jobs/:id/outline
//    answers for that section (server/outline/routes.ts outlineAnswerOf), with jobId "saved-demo". It holds no code
//    text: file paths, sizes and hashes, the code map, the verified outline, Wonder's model id and usage.
// 2. tests/fixtures/outline/wonder-server-meta-058ab2a.json: Muse Wonder's own answer in that run (its parts, joins
//    and the short quoted lines it gave as evidence), used as the MOCKED Wonder in tests and the $0 browser run.
// The section is first checked with verifyOutlineFile, so a tampered section is refused.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OutlineSection } from "../../src/outline/types";
import { verifyOutlineFile } from "../../src/outline/section";
import { outlineAnswerOf } from "../../server/outline/routes";

const path = process.env.X2_SECTION;
if (!path) {
  console.error("set X2_SECTION to a saved outline section");
  process.exit(2);
}
const section = JSON.parse(readFileSync(path, "utf8")) as OutlineSection;
const check = verifyOutlineFile({ version: 1, kind: "outline", outline: section, createdAt: new Date(0).toISOString() });
if (!check.ok) {
  console.error(`the section does not verify: ${JSON.stringify(check)}`);
  process.exit(1);
}
if (!section.wonder.outline) {
  console.error("the section has no Wonder outline");
  process.exit(1);
}
const dir = join(import.meta.dirname, "..", "fixtures", "outline");
const answer = outlineAnswerOf("saved-demo", section);
writeFileSync(join(dir, "atlas-server-meta-058ab2a.outline.json"), JSON.stringify(answer, null, 1) + "\n");
writeFileSync(join(dir, "wonder-server-meta-058ab2a.json"), JSON.stringify(section.wonder.outline, null, 1) + "\n");
console.log(`wrote the outline answer (${section.verified?.parts.length} parts, ${section.verified?.joins.length} joins, commit ${section.source.kind === "github" ? section.source.commit : "upload"}) and Wonder's answer`);
