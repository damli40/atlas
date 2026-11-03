// R3: the fences. The renderer imports no Atlas run, model or server code; no TLA+, no Kevin fonts; export stays optional.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (f === "dist" || f === "node_modules") return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(join(root, "renderer"));
const imports = (p: string) => [...readFileSync(p, "utf8").matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]!);

describe("R3 boundaries", () => {
  it("the drawing core and live backend import nothing of Atlas", () => {
    const core = files.filter((f) => /\.(ts|mjs)$/.test(f) && !f.includes("/authors/") && !f.includes("/preview/") && !f.endsWith(".d.ts"));
    expect(core.length).toBeGreaterThan(8);
    for (const f of core) for (const i of imports(f)) expect(`${f} -> ${i}`).not.toMatch(/-> (\.\.\/)*(\.\.\/\.\.\/)?(src|server|runners|web)\b|\.\.\/\.\.\/src|\.\.\/\.\.\/server|\.\.\/\.\.\/runners|\.\.\/\.\.\/web/);
  });
  it("authors read Atlas's types and pure rules only: no server, runner, model or file system", () => {
    for (const f of files.filter((x) => x.includes("/authors/"))) {
      for (const i of imports(f)) {
        expect(i).not.toMatch(/server|runners|\/meta|node:/);
        if (i.includes("src/") && !i.endsWith("/types") && !i.endsWith("file-outline") && !i.endsWith("outline/types")) expect(i).toMatch(/src\/(failure-labels|trust|units|network-fake|call-sites|change|helper-steps|captions|moonwell-blocks|cut-value|natural-names|file-summary)$/);
        // The bench and explorer models are pure: plain code's reading of the code, no run and no server.
        if (i.includes("web/")) expect(i).toMatch(/web\/machines\/(bench|explorer)\/model$/);
      }
    }
  });
  it("the live backend is browser-safe: no node: imports, no canvas", () => {
    for (const f of files.filter((x) => x.includes("/live/"))) for (const i of imports(f)) expect(i).not.toMatch(/^node:|napi-rs/);
    for (const name of ["spec.ts", "layout.ts", "hand.ts", "words.ts", "scene.ts", "check.ts"]) for (const i of imports(join(root, "renderer", name))) expect(i).not.toMatch(/^node:|napi-rs/);
  });
  it("no TLA+, no model, no Kevin font, no boba", () => {
    for (const f of files) {
      if (!/\.(ts|mjs|js|json|html)$/.test(f)) continue;
      const text = readFileSync(f, "utf8");
      const code = f.includes("NOTICE") ? "" : text;
      expect(`${f}: ${/\bTLC\b|\.tla\b/.test(code)}`).toMatch(/false$/);
      expect(`${f}: ${/api\.meta\.ai|chat\/completions/.test(code)}`).toMatch(/false$/);
      expect(`${f}: ${/KevinSerif|KevinSans|Kevin Serif/.test(code)}`).toMatch(/false$/);
      expect(`${f}: ${/\bboba\b/i.test(code)}`).toMatch(/false$/);
    }
    expect(files.some((f) => /Kevin/.test(f))).toBe(false);
  });
  it("licences are next to what they cover", () => {
    expect(readFileSync(join(root, "renderer/LICENSE-statechart-art"), "utf8")).toMatch(/Kevin T\. Ngo/);
    expect(readFileSync(join(root, "renderer/export/engine/LICENSE"), "utf8")).toMatch(/Kevin T\. Ngo/);
    expect(readFileSync(join(root, "renderer/fonts/OFL.txt"), "utf8")).toMatch(/Open Font License/);
    const pre = readFileSync(join(root, "PRE-EXISTING.md"), "utf8");
    for (const w of ["statechart-art", "pele 1.12.0", "Besley", "@napi-rs/canvas"]) expect(pre).toContain(w);
  });
  it("the shipped page reaches no old isometric figure", () => {
    const seen = new Set<string>();
    const walkFrom = (f: string) => {
      if (seen.has(f)) return;
      seen.add(f);
      const dir = f.slice(0, f.lastIndexOf("/"));
      // Only what reaches the bundle: an `import type` vanishes at build time.
      const code = readFileSync(f, "utf8").replace(/(import|export)\s+type\s[^;]*;/g, "");
      for (const m of code.matchAll(/(?:from|import\()\s*["']([^"']+)["']|^import\s+["']([^"']+)["']/gm)) {
        const i = (m[1] ?? m[2])!;
        if (!i.startsWith(".")) continue;
        const base = join(dir, i);
        const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts")].find((c) => {
          try {
            return statSync(c).isFile();
          } catch {
            return false;
          }
        });
        if (hit && /\.(ts|tsx|mjs)$/.test(hit)) walkFrom(hit);
      }
    };
    walkFrom(join(root, "web/main.tsx"));
    const shipped = [...seen].map((f) => f.slice(root.length + 1));
    expect(shipped.length).toBeGreaterThan(20);
    expect(shipped).toContain("renderer/live/mount.ts");
    for (const f of shipped) expect(f).not.toMatch(/figure\.mjs|figure\.worker|bench\.worker|iso-kit|RetryMachine|PricePipe|CallTimeline|\/art\.tsx|\/live\.tsx|machines\/iso\//);
    for (const f of shipped) expect(f).not.toMatch(/renderer\/export/);
  });
  it("the canvas engine is a dev dependency, never reachable from the server or the page", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.devDependencies["@napi-rs/canvas"]).toBe("1.0.13");
    expect(pkg.dependencies["@napi-rs/canvas"]).toBeUndefined();
    // pele (Mermaid layout, pure JS) is a runtime dependency since R13: /paste/drawing lays out the machine on the
    // server, and the Fly image installs --prod only (as a dev dependency it crashed release v5 at start).
    expect(pkg.dependencies.pele).toBe("1.12.0");
    expect(pkg.devDependencies.pele).toBeUndefined();
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-l", "renderer/export", "--", "server", "src", "runners", "web"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      hits = ""; // git grep exits 1 when nothing matches
    }
    // One door only, loaded on request and guarded, so a server without the package still starts.
    expect(hits.split("\n").filter(Boolean)).toEqual(["server/pencil-worker.ts"]);
    expect(readFileSync(join(root, "server/pencil-worker.ts"), "utf8")).toMatch(/await import\("\.\.\/renderer\/export\/plate"\)/);
  });
});
