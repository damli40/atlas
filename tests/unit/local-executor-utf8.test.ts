// The local executor must decode the child's output once, as a whole. Review of E2 found that it decoded stdout
// chunk by chunk: a multi-byte character split across two pipe chunks became two replacement characters (U+FFFD),
// so the call-function result line no longer matched its HMAC and an honest run was reported as "tampering".

import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { localExecutor } from "../../runners/executor/local.ts";
import { parseCallWorkerOutput } from "../../runners/ts/call-runner.ts";
import { RESULT_MARKER } from "../../runners/ts/harness.ts";

describe("local executor: output decoded once", () => {
  it("multi-byte characters that straddle pipe chunks arrive whole", async () => {
    // "a" first puts the 2-byte characters at odd offsets; 3-byte "€" never lines up with a 64 KB boundary.
    const text = `a${"é".repeat(150_000)}${"€".repeat(150_000)}😀`;
    const r = await localExecutor.exec({
      files: { "w.mjs": `process.stdout.write(${JSON.stringify(text)});` },
      cmd: ["node", "w.mjs"],
      wallClockMs: 10_000,
      allowNetwork: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.includes("�")).toBe(false);
    expect(r.stdout).toBe(text);
  });

  it("a signed result line split in the middle of a character, with a pause between, still verifies (not tampering)", async () => {
    // The harness writes its line with one writeSync; whether the parent reads it in one piece depends on timing,
    // so this script forces the split: the first write ends half-way through a multi-byte character, then it
    // waits 100 ms so the parent reads the two halves separately. The line itself is a real signed line.
    const script = `
import { createHmac } from "node:crypto";
import { readFileSync, writeSync } from "node:fs";
const key = readFileSync(0, "utf8").trim();
const body = JSON.stringify({ runs: [{ id: "r1", trace: [], result: { measured: { outcome: "returned", returnedJson: JSON.stringify("é€😀".repeat(400)) }, notMeasured: {} } }] });
const mac = createHmac("sha256", key).update(body, "utf8").digest("hex");
const line = Buffer.from("\\n${RESULT_MARKER}" + mac + " " + body + "\\n", "utf8");
let cut = line.indexOf(Buffer.from("€", "utf8")) + 1; // inside the 3-byte euro sign
writeSync(1, line, 0, cut);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
writeSync(1, line, cut, line.length - cut);
`;
    const key = randomBytes(32).toString("hex");
    const r = await localExecutor.exec({ files: { "w.mjs": script }, cmd: ["node", "w.mjs"], stdin: `${key}\n`, wallClockMs: 10_000, allowNetwork: false });
    expect(r.exitCode, r.stderr).toBe(0);
    const parsed = parseCallWorkerOutput(r.stdout, key, ["r1"]);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (parsed.ok) expect(parsed.runs[0]!.result.measured.returnedJson).toBe(JSON.stringify("é€😀".repeat(400)));
  });
});
