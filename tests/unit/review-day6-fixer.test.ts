// Day-6 review S4 (contributor and unknown model ids) and S8 (Muse Code's reach, its raw answer).
// Muse Code is MOCKED here; the live checks are tests/evidence/D06-review/s8-live-probe-*.txt.
// Each block fails on the code before this commit (tests/evidence/D06-review/fixer-tests-on-old-code.txt).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tsChangeContext } from "../../runners/change.ts";
import { modelRefusal } from "../../server/meta/client.ts";
import {
  museArgs,
  museSandboxProfile,
  parseMuseJsonl,
  PREFLIGHT_PROMPT,
  runFixer,
  scrubModelText,
  type MuseExec,
} from "../../server/meta/roles/fixer.ts";
import type { Experiment } from "../../src/types.ts";

const REF = "tests/fixtures/with-rpc-retry.ts";
const code = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const DIFF = `--- a/${REF}\n+++ b/${REF}\n@@ -51,1 +51,1 @@\n-  const delayMs = opts.delayMs ?? RPC_RETRY_DELAY_MS;\n+  const delayMs = opts.delayMs ?? 2000;\n`;
const exp: Experiment = { id: "e", target: { kind: "ts-fixture", ref: REF, codeSha256: "x" }, runner: "ts", params: { shape: "retry-scenario", failTimes: "always", failure: "error" }, proposedBy: { role: "human" }, gate: { allowed: true } };
const input = { context: tsChangeContext(REF, code), finding: { file: REF, lineStart: 49, lineEnd: 66 }, toward: "- x", experiment: exp };
const usage = { promptTokens: 1, completionTokens: 1, usd: 0 };
const usagePath = join(mkdtempSync(join(tmpdir(), "atlas-d6-fixer-")), "usage.jsonl");
const noChat = async () => ({ ok: false as const, reason: "chat not used here" });

describe("S4: the model guard", () => {
  it("refuses 'contributor' anywhere in the id, in any case, with any separator or suffix", () => {
    for (const id of ["muse-spark-1.3-contributor-2026", "muse-spark-1.3:contributor", "muse_spark_contributor", "contributor/muse-spark-1.3", "MUSE-SPARK-1.3-CONTRIBUTOR", "muse-spark-1.3-Contributor"]) {
      expect(modelRefusal(id, {}), id).toMatch(/contributor model/);
    }
  });
  it("refuses an unknown id; allows only the known Meta ids", () => {
    expect(modelRefusal("muse-spark-1.3", {})).toBeNull();
    expect(modelRefusal("muse-wonder-1.0", {})).toBeNull();
    expect(modelRefusal("muse-spark-1.4", {})).toMatch(/is not a Meta model id Atlas knows/);
    expect(modelRefusal("gpt-x", {})).toMatch(/is not a Meta model id Atlas knows/);
  });
  it("ATLAS_ALLOW_CONTRIBUTOR=1 allows exactly '<known id>-contributor', nothing looser", () => {
    expect(modelRefusal("muse-spark-1.3-contributor", { ATLAS_ALLOW_CONTRIBUTOR: "1" })).toBeNull();
    expect(modelRefusal("muse-spark-1.3-contributor-2026", { ATLAS_ALLOW_CONTRIBUTOR: "1" })).toMatch(/contributor/);
  });
  it("muse exec's usage lists every model: a contributor id in second place is seen", () => {
    const out = [
      JSON.stringify({ payload_type: "run.usage", payload: { models: [{ model: "muse-spark-1.3", input_tokens: 1, output_tokens: 1 }, { model: "muse-spark-1.3-contributor", input_tokens: 1, output_tokens: 1 }] } }),
      JSON.stringify({ payload_type: "run.terminal.completed", payload: { terminal: "completed", text: DIFF } }),
    ].join("\n");
    const r = parseMuseJsonl(out);
    expect(r.models).toEqual(["muse-spark-1.3", "muse-spark-1.3-contributor"]);
  });
  it("an answer whose report lists a contributor model second is not used", async () => {
    const muse: MuseExec = async () => ({ ok: true, text: DIFF, model: "muse-spark-1.3", models: ["muse-spark-1.3", "muse-spark-1.3-contributor"], usage });
    const r = await runFixer(input, { museExec: muse, musePreflight: null, chat: noChat, usagePath });
    expect(r.ok).toBe(false);
    expect(r.attempts[0]!.reason).toMatch(/contributor model.*the answer is not used \(the code was already sent, and refusing now cannot un-send it\)/);
  });
  it("an answer with NO model id reported is not used (fail closed)", async () => {
    const muse: MuseExec = async () => ({ ok: true, text: DIFF, model: "unknown (muse exec reported no model id)", usage });
    const r = await runFixer(input, { museExec: muse, musePreflight: null, chat: noChat, usagePath });
    expect(r.ok).toBe(false);
    expect(r.attempts[0]!.reason).toMatch(/reported no model id/);
  });
  it("'contributor' in muse exec's stdout or stderr: the answer is not used", async () => {
    const muse: MuseExec = async () => ({ ok: true, text: DIFF, model: "muse-spark-1.3", models: ["muse-spark-1.3"], contributorSeen: true, usage });
    const r = await runFixer(input, { museExec: muse, musePreflight: null, chat: noChat, usagePath });
    expect(r.ok).toBe(false);
    expect(r.attempts[0]!.reason).toMatch(/mentions a contributor model/);
  });
  it("the preflight runs BEFORE any code is sent; a contributor answer there means the code is never sent", async () => {
    let sent = 0;
    const seen: { files: Record<string, string>; prompt: string }[] = [];
    const pre: MuseExec = async (req) => (seen.push(req), { ok: true, text: "OK", model: "muse-spark-1.3-contributor", models: ["muse-spark-1.3-contributor"], usage });
    const muse: MuseExec = async () => (sent++, { ok: true, text: DIFF, model: "muse-spark-1.3", usage });
    const r = await runFixer(input, { museExec: muse, musePreflight: pre, chat: noChat, usagePath });
    expect(sent).toBe(0);
    expect(seen[0]!.prompt).toBe(PREFLIGHT_PROMPT);
    expect(Object.values(seen[0]!.files).join("")).not.toContain("withRpcRetry");
    expect(r.attempts[0]!.reason).toMatch(/^not asked \(preflight, no code sent: .*contributor model/);
  });
  it("a clean preflight lets the real run go once", async () => {
    let sent = 0;
    const pre: MuseExec = async () => ({ ok: true, text: "OK", model: "muse-spark-1.3", models: ["muse-spark-1.3"], usage });
    const muse: MuseExec = async () => (sent++, { ok: true, text: DIFF, model: "muse-spark-1.3", models: ["muse-spark-1.3"], usage });
    const r = await runFixer(input, { museExec: muse, musePreflight: pre, chat: noChat, usagePath });
    expect(r.ok).toBe(true);
    expect(sent).toBe(1);
  });
});

describe("S8: Muse Code's reach and its raw answer", () => {
  it("the flags include --approval-judge off and the strict set", () => {
    const a = museArgs("<ws>", "<p>").join(" ");
    for (const f of ["--disable-shell", "--disable-write", "--disable-web-tools", "--approval-mode never", "--approval-judge off", "--no-foreign-personal-context", "--contributor-mode off", "--model muse-spark-1.3", "--api-key-stdin"]) expect(a).toContain(f);
  });
  it("the sandbox profile refuses file contents under the home folder and the temp roots, except its own folders", () => {
    const p = museSandboxProfile({ workspace: "/private/var/folders/x/T/ws", home: "/private/var/folders/x/T/h", museDir: "/Users/someone/.local/bin", userHome: "/Users/someone" });
    expect(p).toContain('(deny file-read-data file-write* (subpath "/Users/someone"))');
    expect(p).toContain('(deny file-read-data file-write* (subpath "/private/var/folders"))');
    expect(p).toContain('(deny file-read-data file-write* (subpath "/private/tmp"))');
    expect(p).toContain('(allow file-read-data file-write* (subpath "/private/var/folders/x/T/ws") (subpath "/private/var/folders/x/T/h"))');
  });
  it.skipIf(process.platform !== "darwin")("on macOS, a process inside that profile cannot read a file outside its folders (no model needed)", () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "atlas-s8-out-")));
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "atlas-s8-ws-")));
    const home = realpathSync(mkdtempSync(join(tmpdir(), "atlas-s8-home-")));
    try {
      writeFileSync(join(outside, "env"), "CANARY-VALUE\n");
      writeFileSync(join(ws, "inside.txt"), "INSIDE\n");
      const profile = join(home, "p.sb");
      writeFileSync(profile, museSandboxProfile({ workspace: ws, home, museDir: "/usr/bin", userHome: realpathSync(homedir()) }));
      const out = spawnSync("/usr/bin/sandbox-exec", ["-f", profile, "/bin/cat", join(outside, "env")], { encoding: "utf8" });
      expect(out.stdout).not.toContain("CANARY-VALUE");
      expect(out.stderr).toMatch(/Operation not permitted/);
      expect(execFileSync("/usr/bin/sandbox-exec", ["-f", profile, "/bin/cat", join(ws, "inside.txt")], { encoding: "utf8" })).toBe("INSIDE\n");
    } finally {
      for (const d of [outside, ws, home]) rmSync(d, { recursive: true, force: true });
    }
  });
  it("the raw answer is kept only scrubbed: key, secret shapes and absolute paths removed", () => {
    const key = "meta-key-0123456789abcdef";
    const raw = `I read ${key} from /Users/someone/.config/meta-model-api/env and ~/.config/atlas/rpc.env; also sk-${"a".repeat(24)}`; // secret-scan: allow
    const s = scrubModelText(raw, key);
    expect(s).not.toContain(key);
    expect(s).not.toContain("/Users/");
    expect(s).not.toContain("~/.config");
    expect(s).not.toMatch(/sk-a{20}/);
  });
  it("a diff holding a secret shape is refused, never shown", async () => {
    const leaky = DIFF.replace("2000;", `2000; // sk-${"b".repeat(24)}`); // secret-scan: allow
    const muse: MuseExec = async () => ({ ok: true, text: leaky, model: "muse-spark-1.3", models: ["muse-spark-1.3"], usage });
    const r = await runFixer(input, { museExec: muse, musePreflight: null, chat: noChat, usagePath });
    expect(r.ok).toBe(false);
    expect(r.attempts[0]!.reason).toBe("the diff holds text shaped like a secret, so it is not used or shown");
  });
});
