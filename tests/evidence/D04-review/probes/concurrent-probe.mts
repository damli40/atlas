import { readFileSync } from "node:fs";
import { evmRunner } from "../../../../runners/evm/runner.ts";
import { liveAnvilCount, withAnvilFork } from "../../../../runners/evm/anvil.ts";
import { localClient } from "../../../../runners/evm/reads.ts";
import { level1Experiment } from "../../../../tests/tools/level1-run.ts";
import { level2Experiment } from "../../../../tests/tools/level2-run.ts";
import { sameJson } from "../../../../src/atlasfile.ts";
const ref = JSON.parse(readFileSync(new URL("../../../../tests/evidence/D04-04/moonwell-level2-fKqHGIIi2_.atlas.json", import.meta.url), "utf8")).runs[0];
const t0 = Date.now();
const [l2, l1] = await Promise.all([
  evmRunner().run(level2Experiment(), { forkBlock: 42194662 }),
  evmRunner().run(level1Experiment(), { forkBlock: 42194663 }),
]);
console.log("secs", Math.round((Date.now() - t0) / 1000), "live anvils after:", liveAnvilCount());
console.log("L2 control", l2.controlPassed, "L2 measured deep-equal to evidence file:", sameJson(l2.result.measured, ref.result.measured), "refs equal:", sameJson(l2.result.references, ref.result.references));
console.log("L2 cbETH", l2.result.measured["priceUsd1e18:cbETH"], "sources", l2.result.measured["priceSources:cbETH"], "blockAfterApply", l2.result.measured.blockAfterApply);
console.log("L1 control", l1.controlPassed, "L1 cbETH", l1.result.measured["priceUsd1e18:cbETH"], "forkBlock", l1.forkBlock, "notMeasured", JSON.stringify(l1.result.notMeasured));
// timestamps on a fork: what does a mined block look like vs the fork block?
await withAnvilFork({ forkBlock: 42194662 }, async (f) => {
  const c = localClient(f.url);
  const b0 = await c.getBlock({ blockTag: "latest" });
  await c.request({ method: "evm_mine" as never, params: [] as never });
  const b1 = await c.getBlock({ blockTag: "latest" });
  console.log("fork block ts", b0.timestamp.toString(), "next mined ts", b1.timestamp.toString(), "delta s", (b1.timestamp - b0.timestamp).toString(), "now", Math.floor(Date.now()/1000));
});
console.log("live anvils at end:", liveAnvilCount());
