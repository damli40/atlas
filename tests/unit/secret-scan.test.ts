// Review finding S10: the pre-commit secret scan. Fake values are built by joining pieces so this
// file itself never holds a whole secret shape.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs tool with no type declarations
import { GENERIC_PATTERNS, loadRealSecrets, readModalToml, scanText } from "../tools/secret-scan.mjs";

const fake = (...parts: string[]) => parts.join("");

describe("secret scan", () => {
  it("finds each generic secret shape", () => {
    const samples = [
      fake("sk", "-", "a".repeat(32)),
      fake("Bearer ", "b".repeat(30)),
      fake("https://x.base-mainnet.quik", "node.pro/", "c".repeat(20), "/"),
      fake("https://base-mainnet.g.alchemy", ".com/v2/", "d".repeat(20)),
      fake("https://mainnet.infura", ".io/v3/", "e".repeat(32)),
    ];
    for (const s of samples) expect(scanText(s, []).length, s.slice(0, 12)).toBe(1);
    expect(GENERIC_PATTERNS).toHaveLength(5);
  });

  it("finds a real value it was given, and names it without printing it", () => {
    const value = fake("value", "-that-is-secret-", "123");
    const hits = scanText(`config = ${value}`, [{ what: "the real Meta API key", value }]);
    expect(hits).toEqual(["the real Meta API key"]);
  });

  it("an allow comment skips generic shapes but never a real value", () => {
    const value = fake("value", "-that-is-secret-", "123");
    const line = `${fake("sk", "-", "a".repeat(32))} ${value} // secret-scan: allow`;
    expect(scanText(line, [{ what: "the real Meta API key", value }])).toEqual(["the real Meta API key"]);
  });

  it("ordinary code passes", () => {
    expect(scanText('headers: { authorization: `Bearer ${key}` }', [])).toEqual([]);
  });

  it("E4: reads the Modal token id and secret of every profile in a Modal config file, and blocks them by name", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-modal-toml-"));
    try {
      const id = fake("ak-", "fakeTokenId", "0123456789");
      const secret = fake("as-", "fakeTokenSecret", "98765");
      const id2 = fake("ak-", "secondProfile", "11112222");
      const path = join(dir, "modal.toml");
      writeFileSync(path, ["[someone]", `token_id = "${id}"`, `token_secret = '${secret}'`, "active = true", "", '["other profile"]', `token_id = "${id2}" # note`, "token_secret=\"\"", ""].join("\n"));
      expect(readModalToml(path)).toEqual([
        { profile: "someone", key: "token_id", value: id },
        { profile: "someone", key: "token_secret", value: secret },
        { profile: "other profile", key: "token_id", value: id2 },
        { profile: "other profile", key: "token_secret", value: "" },
      ]);
      const secrets = loadRealSecrets({ modalTomlPath: path }) as { what: string; value: string }[];
      const modal = secrets.filter((x) => x.what.includes("Modal"));
      // The empty secret is dropped (too short to be a secret); the three real values are kept.
      expect(modal.map((x) => x.value).sort()).toEqual([id, id2, secret].sort());
      expect(scanText(`MODAL_TOKEN_SECRET=${secret}`, secrets)).toContain("the real Modal token secret");
      expect(scanText(`token: ${id}`, secrets)).toContain("the real Modal token id");
      // A missing file is no secret, not a crash.
      expect(readModalToml(join(dir, "missing.toml"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
