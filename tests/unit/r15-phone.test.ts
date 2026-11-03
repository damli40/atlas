// R15: the phone fixes that plain code can check. No network, no model, $0.
// - Finding 6: fly.toml lets one client address run 4 sandbox runs at once (two phones behind one carrier address were
//   refused at 2); the server-wide and per-session caps keep their defaults.
// - Findings 1-5: every R15 layout rule lives inside a phone-width media query, so a desktop window is untouched;
//   the auto-scroll is installed once from main.tsx and does nothing above 760 px.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX_LIMITS, createSandboxGate, sandboxLimitsFromEnv } from "../../server/replay-limits";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** fly.toml's [env] table (simple KEY = "value" lines). */
function flyEnv(): Record<string, string> {
  const text = read("fly.toml");
  const env = text.slice(text.indexOf("[env]"), text.indexOf("[http_service]"));
  return Object.fromEntries([...env.matchAll(/^\s*([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1]!, m[2]!]));
}

describe("R15 finding 6: sandbox runs at once per client address", () => {
  it("fly.toml raises the per-address cap to 4 and keeps the server-wide and per-session caps", () => {
    const env = flyEnv();
    expect(env.ATLAS_SANDBOX_IP_MAX_CONCURRENT).toBe("4");
    expect(env.ATLAS_SANDBOX_MAX_CONCURRENT).toBeUndefined();
    expect(env.ATLAS_SANDBOX_SESSION_MAX_CONCURRENT).toBeUndefined();
    const limits = sandboxLimitsFromEnv(env);
    expect(limits.ipConcurrent).toBe(4);
    expect(limits.globalConcurrent).toBe(DEFAULT_SANDBOX_LIMITS.globalConcurrent);
    expect(limits.sessionConcurrent).toBe(DEFAULT_SANDBOX_LIMITS.sessionConcurrent);
  });

  it("with fly.toml's limits, four phones (four sessions) on one address all start; a fifth is refused by the server-wide cap", () => {
    const gate = createSandboxGate(sandboxLimitsFromEnv(flyEnv()));
    const ip = "203.0.113.7";
    for (const s of ["a", "b", "c", "d"]) expect(gate.take(`phone-${s}`, ip).ok).toBe(true);
    const fifth = gate.take("phone-e", "198.51.100.1");
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.reason).toMatch(/the server runs at most 4/);
  });

  it("the default (no env) is still 2 per address", () => {
    const gate = createSandboxGate(sandboxLimitsFromEnv({}));
    expect(gate.take("a", "203.0.113.7").ok).toBe(true);
    expect(gate.take("b", "203.0.113.7").ok).toBe(true);
    const third = gate.take("c", "203.0.113.7");
    expect(third.ok).toBe(false);
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
