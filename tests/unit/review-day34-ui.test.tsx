// Days 3–4 review, through the real server (in-process) and the real React table. Offline: GitHub
// and the fork are stand-ins built from the live D04-04 run; no model is asked (modelBets off).

import "../tools/jsdom-globals"; // first: a jsdom page on globalThis
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { falseAlarmFromRun, type FalseAlarmRow } from "../../src/falsealarm";
import { verifyAtlasFile } from "../../src/atlasfile";
import { FalseAlarmTable } from "../../web/screens/Moonwell";
import { level2Round as round, liveLevel2, liveRunFor } from "../tools/review-fixtures";

const LIVE = liveLevel2();
const level2Round = (controlPassed: boolean) => round(async (exp) => liveRunFor(exp, controlPassed)).then((x) => ({ r: x.r, file: x.file! }));

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
function render(rows: FalseAlarmRow[]): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<FalseAlarmTable rows={rows} />));
  return host;
}

describe("B1 through the server and the page", () => {
  it("POST /runs and the .atlas.json: a failed control gives can't check on every flag", async () => {
    const { r, file } = await level2Round(false);
    expect(r.status).toBe(200);
    expect(r.body.verdicts.every((v: { outcome: string }) => v.outcome === "cant_check")).toBe(true);
    expect(r.body.falseAlarm).toHaveLength(14);
    expect(r.body.falseAlarm.every((x: FalseAlarmRow) => x.flagged === null)).toBe(true); // before: cbETH true
    expect(file.falseAlarm!.every((x) => x.flagged === null)).toBe(true);
    expect(verifyAtlasFile(file).ok).toBe(true);
  });

  it("a passing control still flags cbETH in the response and the file", async () => {
    const { r, file } = await level2Round(true);
    expect(r.body.falseAlarm.filter((x: FalseAlarmRow) => x.flagged).map((x: FalseAlarmRow) => x.market)).toEqual(["cbETH"]);
    expect(file.falseAlarm!.filter((x) => x.flagged).map((x) => x.market)).toEqual(["cbETH"]);
  });

  it("the table: can't check in every flag cell and in the summary, never 'yes' or '1 flagged'", () => {
    const run = structuredClone(LIVE.runs[0]!);
    run.controlPassed = false;
    run.result.notMeasured.control = "WETH control did not match";
    const el = render(falseAlarmFromRun(run));
    const text = el.textContent ?? "";
    expect(text).toContain("The control did not pass");
    expect(text).toContain("WETH control did not match");
    expect(text).not.toMatch(/\b1 flagged\b/);
    const cells = [...el.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild!.textContent);
    expect(cells).toHaveLength(14);
    expect(cells.every((c) => c === "can't check")).toBe(true);
    expect(el.querySelector("tr.flagged")).toBeNull();
  });
});
