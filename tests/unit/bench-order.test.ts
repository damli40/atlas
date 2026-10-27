// B1 (D35): each benchmark's pass rule and corpus are committed BEFORE any of its results, and never edited after.
//
// Plain words: bench/truth/PASS-RULE.md and bench/truth/expected.json say, in advance, what the true facts are and
// how a mismatch is named; bench/models/PASS-RULE.md and its corpus say, in advance, what the models are asked and
// how their answers are scored. If a result had been committed first, or the expectations edited after a result,
// they could have been fitted to it. Like tests/unit/pass-rule-order.test.ts (the Moonwell rule), this test reads
// the git history and checks, for each bench whose pre-registration exists:
// (a) Alone. One commit adds the pre-registered files, and that commit adds or changes nothing else.
// (b) No edits. Exactly one commit ever touches the pre-registered files. A correction goes in a NEW dated
//     amendment file next to them; the originals are never changed.
// (c) Order. That commit is an ancestor of (and not the same as) every commit that adds a result file.
// (d) Same corpus. Every committed result file records the SHA-256 of the corpus it ran, and it is the
//     pre-registered one.
// A shallow clone has no full history: skipped, not failed. NOTE for merging: squashing this branch into one
// commit would put the rule and the results in the same commit and fail (c). Merge without squashing.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}
function gitBuf(...args: string[]): Buffer {
  return execFileSync("git", args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function isShallowOrNoGit(): boolean {
  try {
    return git("rev-parse", "--is-shallow-repository") === "true";
  } catch {
    return true;
  }
}

interface Bench {
  name: string;
  /** Paths (files or folders) that make up the pre-registration. */
  prereg: string[];
  corpus: string;
  results: string;
}

export const BENCHES: Bench[] = [
  { name: "bench/truth", prereg: ["bench/truth/PASS-RULE.md", "bench/truth/expected.json", "bench/truth/cases"], corpus: "bench/truth/expected.json", results: "bench/truth/results" },
  {
    name: "bench/models",
    prereg: ["bench/models/PASS-RULE.md", "bench/models/corpus.json", "bench/models/cases", "bench/models/bet-context.ts"],
    corpus: "bench/models/corpus.json",
    results: "bench/models/results",
  },
];

/** True when `path` is one of the pre-registered paths or inside one of its folders. */
export function inPrereg(path: string, prereg: readonly string[]): boolean {
  return prereg.some((p) => path === p || path.startsWith(`${p}/`));
}

const skip = isShallowOrNoGit();

for (const b of BENCHES) {
  const touching = skip ? [] : git("log", "--format=%H", "--", ...b.prereg).split("\n").filter(Boolean);
  const registered = touching.length > 0;

  describe.skipIf(skip || !registered)(`${b.name}: pass rule and corpus come first, alone, and are never edited`, () => {
    const regCommit = touching[touching.length - 1]!;

    it("(b) exactly one commit touches the pass rule, the corpus or the case files", () => {
      expect(
        touching.length,
        `${b.name}'s pre-registered files were changed after they were first committed (${touching.map((h) => h.slice(0, 7)).join(", ")}). ` +
          "A correction must be a new dated amendment file next to them, never an edit.",
      ).toBe(1);
    });

    it("(a) the registering commit adds every pre-registered path and nothing else", () => {
      const files = git("show", "--name-only", "--format=", regCommit).split("\n").filter(Boolean);
      const outside = files.filter((f) => !inPrereg(f, b.prereg));
      expect(outside, `the registering commit also touches: ${outside.join(", ")}`).toEqual([]);
      for (const p of b.prereg) expect(files.some((f) => inPrereg(f, [p])), `${p} is not in the registering commit`).toBe(true);
    });

    const resultAdds = skip
      ? []
      : git("log", "--diff-filter=A", "--format=C %H", "--name-only", "--", b.results)
          .split("\n")
          .reduce<{ commit: string; path: string }[]>((acc, line) => {
            if (line.startsWith("C ")) acc.push({ commit: line.slice(2), path: "" });
            else if (line.trim() && acc.length) acc.push({ commit: acc[acc.length - 1]!.commit, path: line.trim() });
            return acc;
          }, [])
          .filter((a) => a.path !== "");

    it(`(c) the registering commit is a strict ancestor of every commit adding a result (${resultAdds.length} result files)`, () => {
      for (const a of resultAdds) {
        expect(a.commit, `${a.path} was added in the same commit as the pass rule`).not.toBe(regCommit);
        let ancestor = true;
        try {
          execFileSync("git", ["merge-base", "--is-ancestor", regCommit, a.commit], { cwd: ROOT });
        } catch {
          ancestor = false;
        }
        expect(ancestor, `the pass rule's commit is not an ancestor of the commit adding ${a.path}: the result may predate the rule`).toBe(true);
      }
    });

    it("(d) every committed result file names the pre-registered corpus by its SHA-256", () => {
      const corpusSha = createHash("sha256").update(gitBuf("show", `${regCommit}:${b.corpus}`)).digest("hex");
      for (const a of resultAdds.filter((x) => x.path.endsWith(".json") && !x.path.endsWith("usage.jsonl"))) {
        const json = JSON.parse(git("show", `${a.commit}:${a.path}`)) as { meta?: { corpusSha256?: string } };
        expect(json.meta?.corpusSha256, `${a.path} does not record the corpus it ran`).toBe(corpusSha);
      }
    });
  });
}

describe("bench order helpers", () => {
  it("recognises pre-registered paths and folders, and nothing else", () => {
    const p = BENCHES[0]!.prereg;
    expect(inPrereg("bench/truth/expected.json", p)).toBe(true);
    expect(inPrereg("bench/truth/cases/t01-csv-line.js", p)).toBe(true);
    expect(inPrereg("bench/truth/cases-extra/x.js", p)).toBe(false);
    expect(inPrereg("bench/truth/run.ts", p)).toBe(false);
    expect(inPrereg("bench/truth/results/2026-10-27.json", p)).toBe(false);
  });
});
