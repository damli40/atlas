// Copied from the day-5 review's probes (probes5/), local paths made relative. Run: npx tsx tests/evidence/D05-review/probes/p4-why-real.tsx
import { readFileSync } from "node:fs";
import { linkSentences } from "../../../../src/why.ts";
import { modelTextsOf, whySentences } from "../../../../web/screens/Why.tsx";
const ROOT = new URL("../../../../", import.meta.url).pathname;
for (const n of ["fixture-eRopGsrp2a", "moonwell-level2-mwTaxvHFzB"]) {
  const f = JSON.parse(readFileSync(`${ROOT}tests/evidence/D04-04/${n}.atlas.json`, "utf8"));
  const finding = f.findings?.[0];
  const r = linkSentences(whySentences(f.runs[0], finding, modelTextsOf(f.bets, finding)), f.runs[0], f.findings ?? []);
  console.log("==", n);
  for (const s of r.shown) console.log("SHOWN", s.by.kind === "model" ? s.by.model : "Atlas, plain code", "|", s.text);
  for (const s of r.dropped) console.log("DROP", s.by.kind === "model" ? s.by.model : "plain", "|", s.text.slice(0, 140));
  // Added for the after-run: since S2 a model's words are shown apart, whole and unlinked.
  for (const m of modelTextsOf(f.bets, finding)) console.log("MODEL WORDS (unlinked)", m.model, "|", m.text.slice(0, 140));
}
