// D03-01: the Moonwell pass rule must be committed BEFORE any EVM run is published.
//
// Plain words: proofs/moonwell/PASS-RULE.md says, in advance, what counts as a match. If an EVM
// run result (proofs/**/run.json with runner "evm") had been committed first, the rule could have
// been written to fit the result. This test reads the git history and checks the order:
// the commit that added PASS-RULE.md must be an ancestor of, and no newer than, the first commit
// that added any EVM run.json. Every run.json ever added is checked, including ones deleted later.
//
// When no EVM run.json exists yet, the order check passes trivially (there is nothing to be
// earlier than) and the test name says so. A shallow clone has no full history: skipped, not failed.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;
const PASS_RULE = "proofs/moonwell/PASS-RULE.md";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function isShallowOrNoGit(): boolean {
  try {
    return git("rev-parse", "--is-shallow-repository") === "true";
  } catch {
    return true;
  }
}

/** True when the JSON is an EVM run: a Run with runner "evm", or a file holding such runs. */
export function isEvmRun(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const o = json as { runner?: unknown; runs?: unknown };
  if (o.runner === "evm") return true;
  return Array.isArray(o.runs) && o.runs.some((r) => isEvmRun(r));
}

interface Added { commit: string; time: number; path: string }

/** Every (commit, path) that ADDED a proofs/**\/run.json, oldest first. */
function addedRunFiles(): Added[] {
  const out = git("log", "--reverse", "--diff-filter=A", "--format=C %H %ct", "--name-only", "--", ":(glob)proofs/**/run.json");
  const rows: Added[] = [];
  let commit = "";
  let time = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("C ")) {
      const [, h, t] = line.split(" ");
      commit = h;
      time = Number(t);
    } else if (line.trim()) {
      rows.push({ commit, time, path: line.trim() });
    }
  }
  return rows;
}

const skip = isShallowOrNoGit();

describe.skipIf(skip)("pass rule is committed before any EVM run (pre-registration)", () => {
  it("PASS-RULE.md has an adding commit", () => {
    const added = git("log", "--diff-filter=A", "--format=%H %ct", "--", PASS_RULE);
    expect(added, "PASS-RULE.md was never committed").not.toBe("");
  });

  const evmAdds = skip
    ? []
    : addedRunFiles().filter((a) => {
        try {
          return isEvmRun(JSON.parse(git("show", `${a.commit}:${a.path}`)));
        } catch {
          return false;
        }
      });

  const title =
    evmAdds.length === 0
      ? "no EVM run.json has been committed yet, so the order holds trivially"
      : `PASS-RULE.md predates the first EVM run.json (${evmAdds[0].path})`;

  it(title, () => {
    const lines = git("log", "--diff-filter=A", "--format=%H %ct", "--", PASS_RULE).split("\n");
    // The oldest add (a file deleted and re-added counts from its first add).
    const [ruleCommit, ruleTimeText] = lines[lines.length - 1].split(" ");
    const ruleTime = Number(ruleTimeText);
    for (const a of evmAdds) {
      expect(a.commit, `${a.path} was added in the same commit as PASS-RULE.md`).not.toBe(ruleCommit);
      expect(ruleTime, `${a.path} commit time is older than PASS-RULE.md`).toBeLessThanOrEqual(a.time);
      let ancestor = true;
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", ruleCommit, a.commit], { cwd: ROOT });
      } catch {
        ancestor = false;
      }
      expect(ancestor, `PASS-RULE.md commit is not an ancestor of the commit adding ${a.path}`).toBe(true);
    }
  });

  it("recognises an EVM run in both shapes (a single Run, or a file with runs[])", () => {
    expect(isEvmRun({ runner: "evm" })).toBe(true);
    expect(isEvmRun({ runs: [{ runner: "ts" }, { runner: "evm" }] })).toBe(true);
    expect(isEvmRun({ runner: "ts" })).toBe(false);
    expect(isEvmRun(null)).toBe(false);
  });
});
