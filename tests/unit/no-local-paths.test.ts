// The repo is public: no tracked file may hold this machine's home folder path.
// Test runners print their working folder, so evidence outputs need "<repo>" in its place.
//
// Final review (Oct 27): the first version of this test looked only for "/Users/<name>/" and "/home/<name>/".
// Six committed test outputs had been half-redacted to "<home>/Documents/Atlas-Meta" (and a private worktree
// folder, "Atlas-wt"), which still says where the repo lives on this machine, and the pattern did not see it.
// It now also catches "<home>/…", "~/Documents/…", a Windows home ("C:\Users\…"), JSON-escaped paths
// ("\/Users\/…") and the worktree folder name, and reads every tracked file that is text (no NUL byte),
// whatever its extension.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HOME_PATHS = [
  /\/(Users|home)\/[A-Za-z0-9._-]+\//, // /Users/<name>/ or /home/<name>/
  /\\\/(Users|home)\\\/[A-Za-z0-9._-]+\\\//, // the same, JSON-escaped
  /[A-Za-z]:\\+Users\\+[A-Za-z0-9._-]+/, // C:\Users\<name>
  /<home>\/[A-Za-z]/, // a half-redacted home folder
  /~\/(Documents|Desktop|Downloads)\//, // a home-relative private folder
  /\bAtlas-wt\b/, // the private worktree folder
];

/** Lines that hold a home path on purpose (redaction tests), and say so. */
const allowed = (line: string) => line.includes("path-check: allow");

export function homePathLines(text: string): number[] {
  return text
    .split("\n")
    .map((l, i) => [l, i + 1] as const)
    .filter(([l]) => !allowed(l) && HOME_PATHS.some((re) => re.test(l)))
    .map(([, n]) => n);
}

describe("public repo hygiene", () => {
  it("the patterns catch each form seen in this repo, and pass the redacted forms", () => {
    for (const bad of ["RUN v5 /Users/someone/x", "RUN v5 <home>/Documents/Atlas-Meta", "at C:\\Users\\someone\\x", '"\\/Users\\/someone\\/x"', "cd ~/Documents/x", "worktree Atlas-wt/pipe"]) {
      expect(homePathLines(bad), bad).toEqual([1]);
    }
    for (const ok of ["RUN v5 <repo>", "<scratch>/x", "https://example.com/Users/x"]) expect(homePathLines(ok), ok).toEqual([]);
  });

  it("no tracked text file contains a local home-folder path", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    const hits = files.flatMap((f) => {
      if (f === "tests/unit/no-local-paths.test.ts") return [];
      let buf: Buffer;
      try {
        buf = readFileSync(f);
      } catch {
        return [];
      }
      if (buf.includes(0)) return []; // a binary file (PNG, …)
      return homePathLines(buf.toString("utf8")).map((n) => `${f}:${n}`);
    });
    expect(hits).toEqual([]);
  });
});
