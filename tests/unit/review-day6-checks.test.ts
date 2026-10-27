// Day-6 review S3, S5, S9, M3, M4: the plain-code checks on a proposed change.
// Each block fails on the code before this commit (tests/evidence/D06-review/checks-tests-on-old-code.txt).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkChange, moonwellChangeContext, MOONWELL_CONFIG_FILE, tsChangeContext } from "../../runners/change.ts";
import { applyFileDiff, parseUnifiedDiff } from "../../src/diff.ts";

const BANNED = /\b(wrong|correct|bug|right answer|fixed|broken)\b/i;
const REF = "t.ts";
const text = ["l1", "l2", "l3", "l4", "l5", "l3"].join("\n") + "\n";
const ctx = tsChangeContext(REF, text);
const one = (body: string) => `--- a/${REF}\n+++ b/${REF}\n${body}`;

describe("S9: a TS change may not add code-loading or global access (a strict screen; the sandbox is the boundary)", () => {
  const lines = [
    'const m = await import("node:" + "fs");',
    'const fs = process.getBuiltinModule("fs");',
    'const r = globalThis["req"+"uire"]("fs");',
    "eval(\"imp\"+\"ort('node:net')\");",
    'const f = globalThis["fet"+"ch"];',
    "const x = new Function(\"return 1\")();",
    'import * as m from "node:module"; m.createRequire(import.meta.url)("child_process");',
    'import { spawn } from "node:child_process";',
    'const w = globalThis.fetch; w("http://x")',
    'import("node:inspector")',
    'import("node:vm")',
    'import("node:os")',
    "const C = (() => 0).constructor; C(\"return 1\")();",
    'const k = (globalThis as any)?.["pro"+"cess"];',
    "const meta = import.meta.url;",
  ];
  for (const l of lines) {
    it(`refuses: ${l}`, async () => {
      const r = await checkChange(one(`@@ -1,1 +1,2 @@\n l1\n+${l}\n`), ctx);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/^the change adds .*may not add/);
    });
  }
  it("still accepts Muse Code's real TS change from D06-01", async () => {
    const fixture = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
    const diff = readFileSync(new URL("../evidence/D06-01/diff-ts.diff", import.meta.url), "utf8");
    const r = await checkChange(diff, tsChangeContext("tests/fixtures/with-rpc-retry.ts", fixture));
    expect(r.ok).toBe(true);
  });
  it("the comments say the screen is not the boundary", () => {
    const src = readFileSync(new URL("../../runners/change.ts", import.meta.url), "utf8");
    expect(src).toContain("This is a strict SCREEN on the text, not the security boundary");
    expect(src).toContain("The boundary is the sandbox the code runs in");
  });
});

describe("S3: Atlas and git place every line identically, or the change is not tried", () => {
  it("a zero-context insert (only + lines) is refused: its place is not certain", async () => {
    for (const body of ["@@ -2,0 +3,1 @@\n+NEW\n", "@@ -0,0 +1,1 @@\n+NEW\n", "@@ -55,0 +56,1 @@\n+NEW\n"]) {
      const r = await checkChange(one(body), ctx);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/only adds lines.*not certain/);
    }
  });
  it("a hunk past the end of the file is refused with a reason", async () => {
    const r = await checkChange(one("@@ -99,1 +99,1 @@\n-l2\n+X\n"), ctx);
    expect(r).toEqual({ ok: false, reason: "t.ts: the hunk starts at line 99, past the end of the file (6 lines)" });
  });
  it("a zero-context replace is accepted only when its removed line appears once", async () => {
    const twice = await checkChange(one("@@ -3,1 +3,1 @@\n-l3\n+NEW\n"), ctx);
    expect(twice.ok).toBe(false);
    expect(!twice.ok && twice.reason).toMatch(/appear 2 times/);
    const once = await checkChange(one("@@ -2,1 +2,1 @@\n-l2\n+NEW\n"), ctx);
    expect(once.ok).toBe(true);
    const parsed = parseUnifiedDiff(one("@@ -2,1 +2,1 @@\n-l2\n+NEW\n"));
    // verify's applyFileDiff gives exactly the bytes the run used (git's bytes, checked equal).
    expect(once.ok && once.changedFiles[REF]).toBe(parsed.ok ? applyFileDiff(text, parsed.files[0]!) : "x");
  });
  it("the stored one-line Spark answer (no context) on the Moonwell config is placed the same by both", async () => {
    const mctx = moonwellChangeContext();
    const diff = `--- a/${MOONWELL_CONFIG_FILE}\n+++ b/${MOONWELL_CONFIG_FILE}\n@@ -42,1 +42,1 @@\n-            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")\n+            OracleConfig("cbETH_ORACLE", "cbETH", "MOONWELL_cbETH")\n`;
    const r = await checkChange(diff, mctx);
    // Placed (the line appears once); refused only later, for the address book (no OEV wrapper).
    expect(!r.ok && r.reason).toMatch(/cbETH_ORACLE_OEV_WRAPPER/);
  });
});

describe("S5: text the model wrote never sits inside Atlas's sentences", () => {
  it("a path that is not a file of this target is described, not quoted", async () => {
    const d = "--- a/the original code had a bug and this is fixed and correct\n+++ b/the original code had a bug and this is fixed and correct\n@@ -1,1 +1,1 @@\n-l1\n+X\n";
    const r = await checkChange(d, ctx);
    expect(r).toEqual({ ok: false, reason: "the diff touches a file outside this target (only t.ts may change)" });
    expect(BANNED.test(!r.ok ? r.reason : "")).toBe(false);
  });
  it("parse reasons name lines of the diff, never its paths", () => {
    const p = parseUnifiedDiff("--- a/this is fixed\n+++ b/this is fixed\n@@ -1,1 +1,1 @@\n?bad\n");
    expect(p.ok).toBe(false);
    expect(!p.ok && p.reason).not.toMatch(/fixed/);
  });
  it("an oracle name the model wrote in the config is quoted only when it reads like an address-book name", async () => {
    const mctx = moonwellChangeContext();
    const diff = `--- a/${MOONWELL_CONFIG_FILE}\n+++ b/${MOONWELL_CONFIG_FILE}\n@@ -42,1 +42,1 @@\n-            OracleConfig("cbETHETH_ORACLE", "cbETH", "MOONWELL_cbETH")\n+            OracleConfig("the price is fixed now", "cbETH", "MOONWELL_cbETH")\n`;
    const r = await checkChange(diff, mctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).not.toMatch(/fixed/);
    expect(!r.ok && r.reason).toMatch(/a name that is not written like an address-book name/);
  });
  it("git's own error text is not shown: only a known file and a line number", async () => {
    const r = await checkChange(one("@@ -1,2 +1,2 @@\n l1\n-lX\n+NEW\n"), ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).not.toMatch(/error:/);
  });
});

describe("M3 and M4", () => {
  it("M3: an added line with a lone carriage return is refused", async () => {
    const r = await checkChange(one('@@ -1,1 +1,2 @@\n l1\n+// harmless note\rconst x = 1;\n'), ctx);
    expect(r).toEqual({ ok: false, reason: "an added line holds a carriage return on its own, which can hide code after it" });
  });
  it("M4: inside a hunk, '--- a/x' / '+++ b/x' lines are a removed and an added line, as git --recount reads them", () => {
    const p = parseUnifiedDiff(one("@@ -1,2 +1,2 @@\n l1\n--- a/x\n+++ b/x\n"));
    expect(p.ok).toBe(true);
    expect(p.ok && p.files.length).toBe(1);
    expect(p.ok && p.files[0]!.removed).toEqual(["-- a/x"]);
    expect(p.ok && p.files[0]!.added).toEqual(["++ b/x"]);
  });
});
