// Copied from the day-5 review's probes (probes5/), local paths made relative. Run: npx tsx tests/evidence/D05-review/probes/p5-control.tsx
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { RetryMachine } from "../../../../web/machines/retry/RetryMachine.tsx";
const ROOT = new URL("../../../../", import.meta.url).pathname;
const f = JSON.parse(readFileSync(ROOT + "tests/evidence/D04-04/fixture-eRopGsrp2a.atlas.json", "utf8"));
const strip = (html: string) => html.replace(/<svg[\s\S]*<\/svg>/, "[svg]").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ctlFail = { ...f.runs[0], controlPassed: false, result: { ...f.runs[0].result, notMeasured: { ...f.runs[0].result.notMeasured, control: "tampered: result rewritten" } } };
const cc = f.verdicts.map((v: any) => ({ ...v, outcome: "cant_check", observed: null }));
console.log("CONTROL FAILED:", strip(renderToStaticMarkup(h(RetryMachine, { run: ctlFail, bets: f.bets, verdicts: cc, still: true, theme: "light" }))).slice(0, 700));
const empty = { ...f.runs[0], trace: [], result: { measured: {}, notMeasured: { run: "the sandbox returned no result for this experiment" } } };
console.log("SANDBOX FAILED:", strip(renderToStaticMarkup(h(RetryMachine, { run: empty, bets: f.bets, verdicts: cc, still: true, theme: "light" }))).slice(0, 500));
