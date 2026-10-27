// B1 (D35), hardened after the B1 review (B-2, M-5): each benchmark's pass rule and corpus come BEFORE any of its
// results; nothing that decides a result can change afterwards without leaving a mark.
//
// Plain words: a pre-registration only means something if nobody can quietly change what was registered, the code
// that scored it, or the result itself. This test reads the git history and checks, for every bench in
// bench/lib/registration.ts that has been registered:
// (a) Alone. One commit adds the registered files and nothing else.
// (b) No edits. Exactly one commit ever touches the registered files (corrections go in new amendment files).
// (c) Order. That commit is a strict ancestor of every commit that adds a result.
// (d) Same corpus. Every result names the registered corpus by SHA-256 (and, for bench T's first result, every case
//     file by SHA-256).
// (e) Append-only results. No commit modifies, deletes or renames a result file after adding it.
// (f) Same tooling. A result that records the SHA-256 of the files that produced it (classifier, runner, corpus
//     loader, every file under runners/, the src/ files used) must match those files at the result's own commit.
//     Bench T's first result predates this record; it is allowed by name only and re-scored instead (g).
// (g) Same scoring. Re-scoring every committed bench T / T2 result with today's classifier, from the stored
//     measurements and the registered expectations, gives exactly the stored classification of every test.
// (h) Scoring changes are visible. After a bench's first result, any commit that changes its scoring code must add an
//     entry to bench/TOOLING-CHANGES.md in the same commit (and that file is only ever appended to).
// (i) One expectations file. The runner reads only the registered paths; no second expectations file is tracked.
// (k) Survives a rebase. bench/REGISTRATIONS.json records a hash of each registration's CONTENTS; the registering
//     commit's contents must hash to it, and so must every result that records one. Commit SHAs may change; contents
//     may not.
// (j) A shallow clone FAILS (it cannot prove any of this). Fetch the full history (CI: fetch-depth 0).
// Merging: never squash this branch; one squashed commit would hold a rule and its results together and fail (c).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGISTRATIONS, TOOLING_LOG, committedFiles, contentHash, inPaths, sha256Of, workingFiles } from "../../bench/lib/registration.ts";
import { BENCH_CORPORA, classifyOptions } from "../../bench/truth/run.ts";
import { classify, type TruthExpect } from "../../bench/truth/classify.ts";
import { loadCorpus } from "../../bench/lib/corpus.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const gitBuf = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

/** Results allowed without a tooling record: written before (f) existed. Never extend this list. */
export const LEGACY_RESULTS = ["bench/truth/results/2026-10-28.json"];

function historyProblem(): string | null {
  try {
    if (git("rev-parse", "--is-shallow-repository") === "true") {
      return "this is a SHALLOW clone (for example CI's default fetch-depth 1): the benchmark order cannot be proven from it. Fetch the full history (git fetch --unshallow, or fetch-depth: 0 in CI). This test fails instead of skipping on purpose.";
    }
    return null;
  } catch {
    return "no git history is available, so the benchmark order cannot be proven";
  }
}

const problem = historyProblem();

it("(j) the history is complete (a shallow clone fails, it does not skip)", () => {
  expect(problem, problem ?? "").toBeNull();
});

const isAncestor = (a: string, b: string) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
};

const registrationsFile = (): Record<string, { registrationSha256: string }> => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "bench/REGISTRATIONS.json"), "utf8")) as Record<string, { registrationSha256: string }>;
  } catch {
    return {};
  }
};

for (const b of REGISTRATIONS) {
  const touching = problem ? [] : git("log", "--format=%H", "--", ...b.prereg).split("\n").filter(Boolean);
  describe.skipIf(problem !== null || touching.length === 0)(`bench/${b.name}: registered first, alone, never edited; results append-only`, () => {
    if (problem !== null || touching.length === 0) return;
    const regCommit = touching[touching.length - 1]!;
    const resultAdds = git("log", "--diff-filter=A", "--format=C %H", "--name-only", "--", b.results)
      .split("\n")
      .reduce<{ commit: string; path: string }[]>((acc, line) => {
        if (line.startsWith("C ")) acc.push({ commit: line.slice(2), path: "" });
        else if (line.trim() && acc.length) acc.push({ commit: acc[acc.length - 1]!.commit, path: line.trim() });
        return acc;
      }, [])
      .filter((a) => a.path !== "");
    const resultJsons = resultAdds.filter((a) => a.path.endsWith(".json"));
    const registeredHash = contentHash(committedFiles(ROOT, regCommit, b.prereg));

    it("(b) exactly one commit touches the registered files", () => {
      expect(touching.length, `bench/${b.name}'s registered files were changed after they were first committed (${touching.map((h) => h.slice(0, 7)).join(", ")}). Corrections go in a new amendment file.`).toBe(1);
    });

    it("(a) the registering commit holds every registered path and nothing else", () => {
      const files = git("show", "--name-only", "--format=", regCommit).split("\n").filter(Boolean);
      expect(files.filter((f) => !inPaths(f, b.prereg)), "the registering commit also touches other files").toEqual([]);
      for (const p of b.prereg) expect(files.some((f) => inPaths(f, [p])), `${p} is not in the registering commit`).toBe(true);
    });

    it("(k) bench/REGISTRATIONS.json records the registration's content hash, and the registered contents still hash to it", () => {
      expect(registrationsFile()[b.name]?.registrationSha256, `bench/REGISTRATIONS.json has no entry for ${b.name}`).toBe(registeredHash);
      // The working tree's registered files are the registered ones (b already forbids later commits; this also catches an uncommitted edit).
      expect(contentHash(workingFiles(ROOT, b.prereg))).toBe(registeredHash);
    });

    it(`(c) the registering commit is a strict ancestor of every commit adding a result (${resultAdds.length} result files)`, () => {
      for (const a of resultAdds) {
        expect(a.commit, `${a.path} was added in the same commit as the pass rule`).not.toBe(regCommit);
        expect(isAncestor(regCommit, a.commit), `the pass rule's commit is not an ancestor of the commit adding ${a.path}`).toBe(true);
      }
    });

    it("(e) no result file is ever modified, deleted or renamed after it was added", () => {
      const later = git("log", "--diff-filter=MDRT", "--format=C %H", "--name-status", "--", b.results).split("\n").filter(Boolean);
      expect(later, `result files changed after they were added:\n${later.join("\n")}`).toEqual([]);
    });

    it("(d) + (k) every result names the registered corpus, and its registration content hash when it records one", () => {
      const corpusSha = sha256Of(gitBuf("show", `${regCommit}:${b.corpus}`));
      const regFiles = new Map(committedFiles(ROOT, regCommit, b.prereg).map((f) => [f.path, f.sha256]));
      for (const a of resultJsons) {
        const j = JSON.parse(git("show", `${a.commit}:${a.path}`)) as { meta?: { corpusSha256?: string; corpusPath?: string; registrationSha256?: string; sources?: Record<string, string> } };
        expect(j.meta?.corpusSha256, `${a.path} does not record the registered corpus`).toBe(corpusSha);
        if (j.meta?.corpusPath !== undefined) expect(j.meta.corpusPath, `${a.path} was read from a file other than the registered corpus`).toBe(b.corpus);
        if (j.meta?.registrationSha256 !== undefined) expect(j.meta.registrationSha256, `${a.path} records another registration`).toBe(registeredHash);
        for (const [file, sha] of Object.entries(j.meta?.sources ?? {})) {
          expect(regFiles.get(`${b.corpus.replace(/[^/]+$/, "")}${file}`), `${a.path}: case file ${file} differs from the registered one`).toBe(sha);
        }
      }
    });

    it("(f) every result's tooling hashes equal the files at the result's own commit (legacy results named, never added)", () => {
      for (const a of resultJsons) {
        const j = JSON.parse(git("show", `${a.commit}:${a.path}`)) as { meta?: { tooling?: Record<string, string>; dirty?: boolean } };
        if (!j.meta?.tooling) {
          expect(LEGACY_RESULTS, `${a.path} records no tooling hashes`).toContain(a.path);
          continue;
        }
        expect(j.meta.dirty, `${a.path} was produced from a working tree with uncommitted changes`).toBe(false);
        expect(Object.keys(j.meta.tooling)).toContain(b.name === "models" ? "bench/models/run.ts" : "bench/truth/classify.ts");
        for (const [path, sha] of Object.entries(j.meta.tooling)) {
          let at: string;
          try {
            at = sha256Of(gitBuf("show", `${a.commit}:${path}`));
          } catch {
            at = "(missing)";
          }
          expect(at, `${a.path}: ${path} at the result's commit is not the file that produced it`).toBe(sha);
        }
      }
    });

    it("(h) after the first result, every change to the scoring code adds an entry to bench/TOOLING-CHANGES.md in the same commit", () => {
      const first = resultAdds[resultAdds.length - 1]?.commit;
      if (!first) return;
      const later = git("log", "--no-merges", "--format=%H", `${first}..HEAD`, "--", ...b.scoring).split("\n").filter(Boolean);
      for (const c of later) {
        const files = git("show", "--name-only", "--format=", c).split("\n");
        expect(files, `commit ${c.slice(0, 7)} changes bench/${b.name}'s scoring code without an entry in ${TOOLING_LOG}`).toContain(TOOLING_LOG);
      }
    });

    if (b.name === "truth" || b.name === "truth-2") {
      it("(g) re-scoring every committed result with today's classifier reproduces every stored classification", () => {
        const { functions } = loadCorpus<TruthExpect>(join(ROOT, b.corpus));
        const expects = new Map(functions.flatMap((f) => f.tests.map((t) => [t.id, t.expect!] as const)));
        for (const a of resultJsons) {
          const j = JSON.parse(git("show", `${a.commit}:${a.path}`)) as { tests: { id: string; classification: string; measured?: Record<string, string | number | boolean | null>; notMeasured?: Record<string, string>; controlPassed?: boolean }[] };
          for (const t of j.tests.filter((x) => x.classification !== "not run")) {
            const again = classify(expects.get(t.id)!, { measured: t.measured ?? {}, notMeasured: t.notMeasured ?? {} }, t.controlPassed === true, classifyOptions(b.name, t.id, ROOT));
            expect(again.classification, `${a.path} ${t.id}: stored "${t.classification}", today's classifier says "${again.classification}"`).toBe(t.classification);
          }
        }
      });
    }
  });
}

describe.skipIf(problem !== null)("one expectations file per bench, read from the registered path only", () => {
  it("(i) the runner's corpus map equals the registered corpora", () => {
    for (const [name, path] of Object.entries(BENCH_CORPORA)) expect(REGISTRATIONS.find((r) => r.name === name)?.corpus).toBe(path);
  });

  it("(i) no second expectations file is tracked next to a registered one", () => {
    const allowed = new Set(["bench/truth/expected.json", "bench/truth/reason-categories.json", "bench/truth-2/expected.json"]);
    const tracked = git("ls-files", "--", "bench/truth", "bench/truth-2").split("\n").filter(Boolean);
    const extra = tracked.filter((f) => f.endsWith(".json") && !/\/results\//.test(f) && !allowed.has(f));
    expect(extra, "an extra .json next to the registered expectations").toEqual([]);
  });

  it("(h) bench/TOOLING-CHANGES.md is only ever appended to", () => {
    const commits = git("log", "--format=%H", "--", TOOLING_LOG).split("\n").filter(Boolean);
    for (const c of commits) {
      const removed = git("show", "--format=", "--unified=0", c, "--", TOOLING_LOG).split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
      expect(removed, `commit ${c.slice(0, 7)} removes or edits lines of ${TOOLING_LOG}`).toEqual([]);
    }
  });
});

describe("bench order helpers", () => {
  it("recognises registered paths and folders, and nothing else", () => {
    const p = REGISTRATIONS[0]!.prereg;
    expect(inPaths("bench/truth/expected.json", p)).toBe(true);
    expect(inPaths("bench/truth/cases/t01-csv-line.js", p)).toBe(true);
    expect(inPaths("bench/truth/cases-extra/x.js", p)).toBe(false);
    expect(inPaths("bench/truth/run.ts", p)).toBe(false);
    expect(inPaths("bench/truth/results/2026-10-28.json", p)).toBe(false);
  });

  it("a content hash depends on contents and paths, not on order", () => {
    const a = [{ path: "x", sha256: "1" }, { path: "y", sha256: "2" }];
    expect(contentHash(a)).toBe(contentHash([...a].reverse()));
    expect(contentHash(a)).not.toBe(contentHash([{ path: "x", sha256: "1" }, { path: "y", sha256: "3" }]));
  });
});
