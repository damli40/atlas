// The repo is public: no tracked file may hold this machine's home folder path.
// Test runners print their working folder, so evidence outputs need "<repo>" in its place.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HOME_PATH = /\/(Users|home)\/[A-Za-z0-9._-]+\//;

describe("public repo hygiene", () => {
  it("no tracked file contains a local home-folder path", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    const hits = files.filter((f) => {
      if (f === "tests/unit/no-local-paths.test.ts" || /\.(png|jpg|ico)$/.test(f)) return false;
      try {
        // A line may hold an obviously fake path on purpose (redaction tests) if it says so.
        return readFileSync(f, "utf8").split("\n").some((l) => HOME_PATH.test(l) && !l.includes("path-check: allow"));
      } catch {
        return false;
      }
    });
    expect(hits).toEqual([]);
  });
});
