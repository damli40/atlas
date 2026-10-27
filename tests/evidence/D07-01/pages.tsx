// D07-01: static pages of the real proof card and Verdict screen, drawn by the real React components
// (web/screens/ProofCard.tsx, web/screens/Verdict.tsx) from the live rounds' .atlas.json files. No model,
// no RPC. shoot.mjs turns them into PNGs.
//
// Run: pnpm exec tsx tests/evidence/D07-01/pages.tsx
// Writes proof-card-fixture.html (round 1), proof-card-moonwell.html (round 5), verdict-fixture.html (round 1).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ProofCard, modelNames } from "../../../web/screens/ProofCard.tsx";
import { VerdictScreen } from "../../../web/screens/Verdict.tsx";
import type { AtlasFile } from "../../../src/types.ts";
import { orderModelBettors } from "../../../src/claimants.ts";
import type { RunAnswer } from "../../../web/api.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const css = () => {
  const dir = join(ROOT, "web/machines");
  const machines = readFileSync(join(dir, "machines.css"), "utf8").replace(/@import "\.\/([^"]+)";/g, (_, p: string) => readFileSync(join(dir, p), "utf8"));
  return [readFileSync(join(ROOT, "web/styles.css"), "utf8"), machines, readFileSync(join(ROOT, "web/screens/proof.css"), "utf8")].join("\n");
};
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css()}\nbody{margin:0}main{max-width:1100px;margin:0 auto;padding:24px 16px}</style></head><body><main>${body}</main></body></html>`;
const file = (n: number) => JSON.parse(readFileSync(join(HERE, `round-${n}.atlas.json`), "utf8")) as AtlasFile;

writeFileSync(join(HERE, "proof-card-fixture.html"), page("D07-01 proof card, fixture S3, both models", renderToStaticMarkup(<ProofCard file={file(1)} />)));
writeFileSync(join(HERE, "proof-card-moonwell.html"), page("D07-01 proof card, Moonwell Level 2, both models", renderToStaticMarkup(<ProofCard file={file(5)} />)));

// The Verdict screen for round 1. "Shown before the run" here is the file's sealed hashes (the live page
// kept its own copy; this static page has only the file), so the seal check re-hashes the file's bets.
const f1 = file(1);
const run = f1.runs[0]!;
const answer: RunAnswer = { run, verdicts: f1.verdicts, bets: f1.bets, betsFrozenAt: run.startedAt };
const names = modelNames(f1);
const models = orderModelBettors(f1.bets.filter((b) => b.who !== "human").map((b) => b.who)).map((who) => ({ who, name: names[who] ?? who, shown: f1.bets.filter((b) => b.who === who) }));
writeFileSync(
  join(HERE, "verdict-fixture.html"),
  page("D07-01 verdict screen, fixture S3, both models", renderToStaticMarkup(<VerdictScreen shown={f1.bets.filter((b) => b.who === "human")} modelShown={[]} modelName={null} models={models} result={answer} />)),
);
console.log("wrote proof-card-fixture.html, proof-card-moonwell.html, verdict-fixture.html");
