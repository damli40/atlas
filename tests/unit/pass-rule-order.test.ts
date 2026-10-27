// D03-01, tightened after the days 3–4 review (S4): the Moonwell pass rule must be committed BEFORE
// any EVM run, and never edited afterwards.
//
// Plain words: proofs/moonwell/PASS-RULE.md says, in advance, what counts as a match. If an EVM run
// had been committed first, or the rule edited after a run, the rule could have been fitted to the
// result. This test reads the git history and checks two things:
// (a) Order. It finds every EVM run ever committed, wherever it was put: any file under proofs/ or
//     tests/evidence/ named run.json, *.atlas.json or level*.json whose JSON holds a run with runner
//     "evm" or a forkBlock (at any depth). The commit that first added PASS-RULE.md must be an
//     ancestor of (and not the same as) the commit that first added each of those files.
// (b) No edits. Exactly one commit may touch PASS-RULE.md. An amendment goes in a NEW dated file
//     next to it; the original is never changed.
// A shallow clone has no full history: skipped, not failed.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;
const PASS_RULE = "proofs/moonwell/PASS-RULE.md";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function isShallowOrNoGit(): boolean {
  try {
    return git("rev-parse", "--is-shallow-repository") === "true";
  } catch {
    return true;
  }
}

/** True when the JSON holds an EVM run anywhere: an object with runner "evm", or with a forkBlock key. */
export function isEvmRun(json: unknown, depth = 0): boolean {
  if (depth > 8 || !json || typeof json !== "object") return false;
  if (Array.isArray(json)) return json.some((x) => isEvmRun(x, depth + 1));
  const o = json as Record<string, unknown>;
  if (o.runner === "evm" || Object.prototype.hasOwnProperty.call(o, "forkBlock")) return true;
  return Object.values(o).some((v) => isEvmRun(v, depth + 1));
}

/** A path that may hold an EVM run: run.json, *.atlas.json or level*.json under proofs/ or tests/evidence/. */
export function isRunFilePath(path: string): boolean {
  if (!/^(proofs|tests\/evidence)\//.test(path)) return false;
  const name = path.split("/").pop() ?? "";
  return name === "run.json" || name.endsWith(".atlas.json") || /^level.*\.json$/.test(name);
}

interface Added { commit: string; time: number; path: string }

/** Every (commit, path) that first ADDED a candidate file under proofs/ or tests/evidence/, oldest first. */
function addedRunFiles(): Added[] {
  const out = git("log", "--reverse", "--diff-filter=A", "--format=C %H %ct", "--name-only", "--", "proofs", "tests/evidence");
  const first = new Map<string, Added>();
  let commit = "";
  let time = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("C ")) {
      const [, h, t] = line.split(" ");
      commit = h!;
      time = Number(t);
    } else if (line.trim() && isRunFilePath(line.trim()) && !first.has(line.trim())) {
      first.set(line.trim(), { commit, time, path: line.trim() });
    }
  }
  return [...first.values()];
}

const skip = isShallowOrNoGit();

describe.skipIf(skip)("pass rule is committed before any EVM run, and never edited (pre-registration)", () => {
  const touching = skip ? [] : git("log", "--format=%H", "--", PASS_RULE).split("\n").filter(Boolean);

  it("PASS-RULE.md has an adding commit", () => {
    expect(touching.length, "PASS-RULE.md was never committed").toBeGreaterThan(0);
  });

  it("(b) exactly one commit touches PASS-RULE.md", () => {
    expect(
      touching.length,
      `PASS-RULE.md was changed after it was first committed (${touching.length} commits touch it: ${touching.map((h) => h.slice(0, 7)).join(", ")}). ` +
        "Amendments must be appended as a new dated file next to it (for example proofs/moonwell/PASS-RULE-AMENDMENT-YYYY-MM-DD.md), never as edits to PASS-RULE.md.",
    ).toBe(1);
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

  it(`(a) finds the committed EVM runs (${evmAdds.length}: ${evmAdds.map((a) => a.path).join(", ") || "none"})`, () => {
    // Today's history holds Level 1, Level 2 and .atlas.json EVM outputs under tests/evidence/;
    // finding none would mean the search is broken, not that the order holds.
    expect(evmAdds.length).toBeGreaterThan(0);
  });

  it("(a) PASS-RULE.md's first commit is an ancestor of the commit that first added each EVM run", () => {
    const lines = git("log", "--diff-filter=A", "--format=%H %ct", "--", PASS_RULE).split("\n");
    const [ruleCommit, ruleTimeText] = lines[lines.length - 1]!.split(" ");
    const ruleTime = Number(ruleTimeText);
    for (const a of evmAdds) {
      expect(a.commit, `${a.path} was added in the same commit as PASS-RULE.md`).not.toBe(ruleCommit);
      expect(ruleTime, `${a.path} commit time is older than PASS-RULE.md`).toBeLessThanOrEqual(a.time);
      let ancestor = true;
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", ruleCommit!, a.commit], { cwd: ROOT });
      } catch {
        ancestor = false;
      }
      expect(ancestor, `PASS-RULE.md's first commit is not an ancestor of the commit adding ${a.path}: the run may predate the rule`).toBe(true);
    }
  });

  it("recognises an EVM run in every shape it is committed in, and only in the run-file paths", () => {
    expect(isEvmRun({ runner: "evm" })).toBe(true);
    expect(isEvmRun({ runs: [{ runner: "ts" }, { runner: "evm" }] })).toBe(true);
    expect(isEvmRun({ run: { forkBlock: 42194662 } })).toBe(true);
    expect(isEvmRun({ runner: "ts" })).toBe(false);
    expect(isEvmRun(null)).toBe(false);
    expect(isRunFilePath("proofs/x/run.json")).toBe(true);
    expect(isRunFilePath("tests/evidence/D04-04/a.atlas.json")).toBe(true);
    expect(isRunFilePath("tests/evidence/D03-03/level1-after.json")).toBe(true);
    expect(isRunFilePath("tests/evidence/D04-01/derived-vs-real.json")).toBe(false);
    expect(isRunFilePath("web/run.json")).toBe(false);
  });
});
