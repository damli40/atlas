// R15: the phone fixes that plain code can check. No network, no model, $0.
// - Finding 6: fly.toml lets one client address run 4 sandbox runs at once (two phones behind one carrier address were
//   refused at 2); the server-wide and per-session caps keep their defaults.
// - Findings 1-5: every R15 layout rule lives inside a phone-width media query, so a desktop window is untouched;
//   the auto-scroll is installed once from main.tsx and does nothing above 760 px.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX_LIMITS, createSandboxGate, sandboxLimitsFromEnv } from "../../server/replay-limits";
import { runAs } from "../../server/access/context";
import { accessFromEnv } from "../../server/access/setup";
import { openInviteStore } from "../../server/access/store";
import { ENV, tmp } from "../tools/g1-fixtures";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** fly.toml's [env] table (simple KEY = "value" lines). */
function flyEnv(): Record<string, string> {
  const text = read("fly.toml");
  const env = text.slice(text.indexOf("[env]"), text.indexOf("[http_service]"));
  return Object.fromEntries([...env.matchAll(/^\s*([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1]!, m[2]!]));
}

describe("R15 finding 6: sandbox runs at once per client address", () => {
  it("fly.toml raises the per-address cap to 4 and the server-wide cap to 12, and keeps the per-session cap", () => {
    const env = flyEnv();
    expect(env.ATLAS_SANDBOX_IP_MAX_CONCURRENT).toBe("4");
    expect(env.ATLAS_SANDBOX_MAX_CONCURRENT).toBe("12");
    expect(env.ATLAS_SANDBOX_SESSION_MAX_CONCURRENT).toBeUndefined();
    const limits = sandboxLimitsFromEnv(env);
    expect(limits.ipConcurrent).toBe(4);
    expect(limits.globalConcurrent).toBe(12);
    expect(limits.sessionConcurrent).toBe(DEFAULT_SANDBOX_LIMITS.sessionConcurrent);
  });

  it("with fly.toml's limits, four phones on one address all start, a fifth there is refused, and other addresses still start", () => {
    const gate = createSandboxGate(sandboxLimitsFromEnv(flyEnv()));
    const ip = "203.0.113.7";
    for (const s of ["a", "b", "c", "d"]) expect(gate.take(`phone-${s}`, ip).ok).toBe(true);
    expect(gate.take("phone-e", ip).ok).toBe(false);
    // One busy address can't hold the whole server: others fill the remaining 8 slots, then the 13th is refused.
    for (let i = 0; i < 8; i++) expect(gate.take(`other-${i}`, `198.51.100.${i + 1}`).ok).toBe(true);
    const thirteenth = gate.take("other-x", "198.51.100.99");
    expect(thirteenth.ok).toBe(false);
    if (!thirteenth.ok) expect(thirteenth.reason).toMatch(/the server runs at most 12/);
  });

  it("the default (no env) is still 2 per address", () => {
    const gate = createSandboxGate(sandboxLimitsFromEnv({}));
    expect(gate.take("a", "203.0.113.7").ok).toBe(true);
    expect(gate.take("b", "203.0.113.7").ok).toBe(true);
    const third = gate.take("c", "203.0.113.7");
    expect(third.ok).toBe(false);
  });
});

describe("R15 review: the no-code example's own cap on sandboxes at once", () => {
  const visitor = (n: number) => ({ kind: "example" as const, label: "the open example (no invite code)", route: "POST /runs", ip: `198.51.100.${n}` });
  /** The ledger as server/index.ts builds it, from fly.toml's [env] values (only the folder and pepper are local). */
  function ledgerFrom(env: Record<string, string | undefined>) {
    const dir = tmp();
    openInviteStore(dir, { env: ENV }).create({ label: "dev-ada" });
    const keep = ["ATLAS_REQUIRE_INVITE", "ATLAS_PUBLIC_ORIGIN", "ATLAS_EXAMPLE_MAX_CONCURRENT", "ATLAS_EXAMPLE_SANDBOX_STARTS_PER_DAY", "ATLAS_EXAMPLE_SANDBOX_SECONDS_PER_DAY"];
    const picked = Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
    return accessFromEnv({ ATLAS_REQUIRE_INVITE: "1", ATLAS_PUBLIC_ORIGIN: "https://atlas.example", ...picked, ATLAS_INVITES_DIR: dir, ...ENV }, { ceilingUsd: 100, modelSpentUsd: () => 0 });
  }

  it("fly.toml sets the example's cap to 8, Modal's runner to 12 (the server-wide 12), and 8 + 4 for codes fits in 12", () => {
    const env = flyEnv();
    expect(env.ATLAS_EXAMPLE_MAX_CONCURRENT).toBe("8");
    expect(env.ATLAS_MODAL_MAX_SANDBOXES).toBe("12");
    expect(env.ATLAS_MODAL_MAX_SANDBOXES).toBe(env.ATLAS_SANDBOX_MAX_CONCURRENT);
    expect(Number(env.ATLAS_EXAMPLE_MAX_CONCURRENT)).toBeLessThan(Number(env.ATLAS_SANDBOX_MAX_CONCURRENT));
  });

  it("with fly.toml's values, 8 no-code players start at once and the 9th is refused with the plain sentence", () => {
    const a = ledgerFrom(flyEnv());
    try {
      const held = [];
      for (let i = 1; i <= 8; i++) {
        const r = runAs(visitor(i), () => a.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
        expect(r.ok).toBe(true);
        held.push(r);
      }
      const ninth = runAs(visitor(9), () => a.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
      expect(ninth.ok).toBe(false);
      if (!ninth.ok) expect(ninth.reason).toBe("call limit reached: visitors without a code already have 8 example runs going at once (their limit together is 8); try again in a few seconds");
      // One finishes: the next player starts.
      const first = held[0]!;
      if (first.ok) first.settle(0.0001, { seconds: 1 });
      expect(runAs(visitor(10), () => a.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true })).ok).toBe(true);
    } finally {
      a.release();
    }
  });

  it("with no setting the example keeps its old cap of 2", () => {
    const a = ledgerFrom({});
    try {
      for (let i = 1; i <= 2; i++) expect(runAs(visitor(i), () => a.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true })).ok).toBe(true);
      expect(runAs(visitor(3), () => a.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true })).ok).toBe(false);
    } finally {
      a.release();
    }
  });
});

describe("R15 findings 1-5: phone layout only at phone widths", () => {
  it("every rule after the R15 marker in tool.css is inside an @media (max-width:760px) block", () => {
    const css = read("web/tool.css");
    const at = css.indexOf("/* R15: phones");
    expect(at).toBeGreaterThan(0);
    // Strip comments, then walk the top-level blocks after the marker.
    const tail = css.slice(at).replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let head = "";
    const tops: string[] = [];
    for (const ch of tail) {
      if (ch === "{") {
        if (depth === 0) tops.push(head.trim());
        depth++;
        head = "";
      } else if (ch === "}") depth--;
      else if (depth === 0) head += ch;
    }
    expect(tops.length).toBeGreaterThan(0);
    for (const t of tops) expect(t).toBe("@media (max-width:760px)");
  });

  it("the paste box and every input are at least 16 px on a phone (iOS zooms the page on focus below 16 px)", () => {
    const css = read("web/tool.css");
    expect(css).toMatch(/\.u1-shell textarea,\.u1-shell input:not\(\[type=button\]\)[^{]*\{font-size:16px!important\}/);
  });

  it("main.tsx installs the phone auto-scroll, which is gated on the same 760 px", () => {
    expect(read("web/main.tsx")).toMatch(/installPhoneScroll\(\);/);
    const js = read("web/phone-scroll.ts");
    expect(js).toContain('"(max-width:760px)"');
    expect(js).toMatch(/if \(!phone\.matches\) return;/);
  });
});
