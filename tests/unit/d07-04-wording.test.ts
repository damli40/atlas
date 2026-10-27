// D07-04 wording: "line 42" (never "lines 42–42"), "1 answer" (plural only when more than one), and who
// proposed a change: "Muse Code (muse-spark-1.3)" when Muse Code ran, "Muse Spark 1.3 (chat fallback)" when
// the fallback ran. Also a source scan, so a new "lines ${a}–${b}" template cannot come back.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileLines, lineSpan, plural } from "../../src/words";
import { changeProposer } from "../../src/claimants";

describe("D07-04 wording helpers", () => {
  it("line spans", () => {
    expect(lineSpan(42, 42)).toBe("line 42");
    expect(lineSpan(42, 44)).toBe("lines 42–44");
    expect(fileLines("a.sol", 42, 42)).toBe("a.sol line 42");
  });
  it("counts", () => {
    expect(plural(1, "answer")).toBe("1 answer");
    expect(plural(0, "answer")).toBe("0 answers");
    expect(plural(3, "bet")).toBe("3 bets");
  });
  it("who proposed a change", () => {
    expect(changeProposer("muse-exec", "muse-spark-1.3")).toBe("Muse Code (muse-spark-1.3)");
    expect(changeProposer("chat-fallback", "muse-spark-1.3")).toBe("Muse Spark 1.3 (chat fallback)");
  });
});

describe("D07-04 source scan", () => {
  const files = execFileSync("git", ["ls-files", "src", "server", "web", "runners"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f));
  it('no template writes "lines ${a}–${b}" by hand (use lineSpan / fileLines)', () => {
    const hits = files.filter((f) => f !== "src/words.ts" && /lines \$\{[^}]+\}–\$\{/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it('no template writes "${n.length} answers|bets|lines|files" without plural()', () => {
    const re = /\$\{[^}]*\.length\}\s+(answers|bets|lines|files|markets|calls|waits|places)\b/;
    const hits = files.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
