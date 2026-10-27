// Final review (Oct 27): fresh-clone reality (S3) and public-repo polish (S6). Each test failed on the code
// before its fix (tests/evidence/final-review/*-tests-on-old-code.txt).
// - S3: the server reads .env itself (never printing it), .env.example lists every key the server reads, the
//   Node version is pinned, and a plain startup message names an old Node or a missing --permission.
// - S6: no tracked file carries "mida not run" lines or pointers to a private plan's sections.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "../../server/load-env";
import { startupNotes } from "../../server/startup-check";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("S3: a fresh clone can run the server as the files say", () => {
  it("loadDotEnv reads KEY=VALUE lines, skips comments and empty values, and never overrides the environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    const file = join(dir, ".env");
    writeFileSync(file, ["# a comment", "BASE_RPC_URL=https://rpc.example.invalid/k", 'META_API_KEY="quoted-value"', "BASETEN_API_KEY=", "ALREADY=from-file", "export SPACED = spaced value ", "not a line"].join("\n"));
    const env: Record<string, string | undefined> = { ALREADY: "from-env" };
    const out = loadDotEnv(file, env);
    expect(env.BASE_RPC_URL).toBe("https://rpc.example.invalid/k");
    expect(env.META_API_KEY).toBe("quoted-value");
    expect("BASETEN_API_KEY" in env).toBe(false); // an empty value never hides the key file fallback
    expect(env.ALREADY).toBe("from-env");
    expect(env.SPACED).toBe("spaced value");
    // What it reports: key NAMES only, never a value.
    expect(out.loaded.sort()).toEqual(["BASE_RPC_URL", "META_API_KEY", "SPACED"]);
    expect(JSON.stringify(out)).not.toContain("quoted-value");
    expect(JSON.stringify(out)).not.toContain("rpc.example.invalid");
  });

  it("a missing .env is fine (nothing loaded, no error)", () => {
    expect(loadDotEnv(join(tmpdir(), "no-such-dir-atlas", ".env"), {})).toEqual({ found: false, loaded: [] });
  });

  it("server/index.ts loads .env before anything reads process.env", () => {
    const firstImport = read("server/index.ts").split("\n").find((l) => l.startsWith("import "));
    expect(firstImport).toBe('import "./load-env";');
  });

  it(".env.example lists every key the server reads from the environment for a secret", () => {
    const keys = read(".env.example")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => l.split("=")[0]);
    for (const k of ["BASE_RPC_URL", "META_API_KEY", "BASETEN_API_KEY", "GITHUB_TOKEN"]) expect(keys).toContain(k);
    // Placeholders only: no value after the "=".
    for (const l of read(".env.example").split("\n").filter((x) => /^[A-Z_]+=/.test(x))) expect(l).toMatch(/^[A-Z_]+=$/);
  });

  it("package.json pins Node >= 22.13 (node --permission)", () => {
    expect(JSON.parse(read("package.json")).engines).toEqual({ node: ">=22.13" });
  });

  it("startup notes: an old Node, a Node without --permission, and no macOS sandbox each get one plain sentence", () => {
    expect(startupNotes({ version: "25.8.1", hasPermission: true, platform: "darwin", sandboxExec: true })).toEqual([]);
    const old = startupNotes({ version: "20.11.0", hasPermission: false, platform: "darwin", sandboxExec: true });
    expect(old).toHaveLength(1);
    expect(old[0]).toMatch(/^Node 20\.11\.0 is older than 22\.13/);
    expect(old[0]).toMatch(/can't check/);
    expect(startupNotes({ version: "22.12.0", hasPermission: true, platform: "darwin", sandboxExec: true })[0]).toMatch(/older than 22\.13/);
    expect(startupNotes({ version: "22.13.0", hasPermission: false, platform: "darwin", sandboxExec: true })[0]).toMatch(/--permission/);
    const linux = startupNotes({ version: "24.0.0", hasPermission: true, platform: "linux", sandboxExec: false });
    expect(linux).toHaveLength(1);
    expect(linux[0]).toMatch(/macOS only/);
    expect(linux[0]).toMatch(/chat/);
  });
});

describe("S6: the public repo carries no private-tool lines or private-plan pointers", () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  const text = (f: string): string | null => {
    try {
      const buf = readFileSync(join(ROOT, f));
      return buf.includes(0) ? null : buf.toString("utf8");
    } catch {
      return null;
    }
  };
  const hits = (re: RegExp, skip: (f: string) => boolean = () => false) =>
    files
      .filter((f) => !skip(f) && f !== "tests/unit/review-final-hygiene.test.ts")
      .flatMap((f) => (text(f) ?? "").split("\n").map((l, i) => [f, i + 1, l] as const))
      .filter(([, , l]) => re.test(l))
      .map(([f, n]) => `${f}:${n}`);

  it("no 'mida not run' / 'never run mida' line and no '.mida/' folder name outside PRE-EXISTING.md", () => {
    expect(hits(/`?mida`? (was )?not run|never run `?mida|\.mida\//i, (f) => f === "PRE-EXISTING.md")).toEqual([]);
  });

  it("no pointer to a numbered section of a private plan", () => {
    expect(hits(/\bplan section \d|\(section \d+(\.\d+)?\)|plan's fallback \(section/i)).toEqual([]);
  });
});
