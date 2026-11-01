// R3 review B4, in the real screen: a path too long and too varied to fold still reaches its verdict.
import "../tools/jsdom-globals";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { fileOutline } from "../../src/file-outline";
import { benchModel } from "../../web/machines/bench/model";
import { BenchStage } from "../../web/machines/bench/BenchStage";

describe("BenchStage, past the drawing's limit", () => {
  it("shows the plain list and the verdict, instead of hanging on 'Playing the run'", async () => {
    const src = "export async function a(g) {\n  for (let i = 0; i < 400; i++) await g(i);\n  return 1;\n}\n";
    const outline = fileOutline(src, "js");
    const calls = [...Array(200).keys()];
    const trace = [{ t: 0, event: "start" }, ...calls.flatMap((i) => [{ t: i * (i + 3), event: "stand_in_call", data: { name: "g", n: i + 1 } }, { t: i * (i + 3), event: "stand_in_returns", data: { name: "g", n: i + 1 } }]), { t: 40000, event: "returned", data: { type: "number" } }];
    const test = { shape: "call-function", exportName: "a", args: [{ kind: "stand-in", name: "g", async: true, then: "repeat_last", calls: calls.map((value) => ({ do: "return", value })) }] };
    const run = { id: "r", experimentId: "e", runner: "ts", controlPassed: true, trace, result: { measured: { outcome: "returned", returnedJson: "1", virtualMs: 40000, "calls:g": 200 }, notMeasured: {} } };
    const model = benchModel({ fileName: "f.js", outline, test: test as never, source: src, language: "js", dial: { marks: [], fullMs: 1000 } } as never);
    const after = { token: 1, script: { notShown: null, steps: [] }, marks: [], dialFullMs: 1000, run, experiment: { params: test }, bets: [], verdicts: [] };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<BenchStage model={model} after={after as never} title="f.js" source={src} language="js" fileName="f.js" outline={outline} /> as never);
    });
    const end = Date.now() + 15000;
    while (host.querySelector("[data-stage]")?.getAttribute("data-phase") !== "marked" && Date.now() < end) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    }
    expect(host.querySelector("[data-stage]")?.getAttribute("data-phase")).toBe("marked");
    expect(host.querySelector('[data-testid="bench-path"] .rr-list')?.textContent).toMatch(/Showing the list/);
    act(() => root.unmount());
    host.remove();
  }, 30_000);
});
