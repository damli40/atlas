// R13: atlas_draw, the Muse Code plugin's picture of a file. The Atlas server is real (routes, plain-code drawing); the Meta
// models are mocked and the network is wired straight into the app, as in E5. $0.

import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAtlasClient, type Fetch } from "../../plugins/muse-atlas/mcp/atlas-client";
import type { AtlasConfig } from "../../plugins/muse-atlas/mcp/config";
import { handleMessage, handlersOf } from "../../plugins/muse-atlas/mcp/server";
import { createTools, DRAW_LIMITS, svgLooksSafe } from "../../plugins/muse-atlas/mcp/tools";
import { filePicture } from "../../renderer/authors/file-picture";
import { NO_PNG, PNG_MAX_PIXELS, pngOf } from "../../server/drawing";
import { svgProblem } from "../../plugins/muse-atlas/mcp/svg-check";
import { NAMER_WORDS } from "../../src/natural-names";
import { EXAMPLE_NAMES } from "../../src/example-names";
import { U1_EXAMPLE } from "../../web/u1-example";
import { build } from "../tools/g1-fixtures";
import { makeApp, RETRY_SRC } from "../tools/paste-fixtures";

const BASE = "http://127.0.0.1:8787";
type AppLike = { request: (path: string, init: RequestInit) => Response | Promise<Response> };

function wire(app: AppLike) {
  const sent: { url: string; body?: string }[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, ...(init.body !== undefined ? { body: init.body } : {}) });
    expect(url.startsWith(BASE + "/")).toBe(true);
    return app.request(url.slice(BASE.length), { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
  };
  return { fetch, sent };
}

const cfg = (over: Partial<AtlasConfig> = {}): AtlasConfig => ({ url: BASE, invite: null, webUrl: null, claimant: null, from: { url: "ATLAS_URL", invite: "none set" }, ...over });

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "atlas-r13-ws-"));
  writeFileSync(join(dir, "retry.ts"), RETRY_SRC);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "example.ts"), U1_EXAMPLE);
  writeFileSync(join(dir, "notes.md"), "# not code\n");
  return dir;
}
/** The picture's file name: readable path, a short fingerprint of the path, the function. */
const stem = (rel: string, fn?: string) => `${rel.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "")}-${createHash("sha256").update(rel).digest("hex").slice(0, 8)}${fn ? `-${fn}` : ""}`;
const toolsFor = (fetch: Fetch, ws: string, config = cfg()) => createTools({ client: createAtlasClient(config, { fetch }), config, workspace: ws });

describe("R13 atlas_draw: a picture of a file, written inside the workspace", () => {
  it("draws the file with plain code only: SVG (and PNG here) under .atlas/drawings, honest words, no model call", async () => {
    const { app, m } = makeApp();
    const w = wire(app);
    const ws = workspace();
    const r = await toolsFor(w.fetch, ws).draw({ path: "src/example.ts" });
    expect(r.isError).toBeUndefined();
    const svg = readFileSync(join(ws, ".atlas", "drawings", `${stem("src/example.ts")}.svg`), "utf8");
    expect(svgLooksSafe(svg)).toBe(true);
    expect(svg).toContain("fetchWithRetry");
    expect(svg).toContain("Drawn by Atlas&#39;s plain code");
    expect(r.text).toContain(`Written in this workspace: .atlas/drawings/${stem("src/example.ts")}.svg`);
    expect(r.text).toContain(DRAW_LIMITS);
    expect(r.text).toMatch(/as a machine of 4 parts/);
    // The PNG converter is a dev dependency, so it is here: the PNG is written and returned as the image.
    const png = readFileSync(join(ws, ".atlas", "drawings", `${stem("src/example.ts")}.png`));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(r.image?.mimeType).toBe("image/png");
    expect(Buffer.from(r.image!.data, "base64").equals(png)).toBe(true);
    expect(m.calls).toHaveLength(0); // no model was asked
    expect(w.sent.map((s) => s.url.slice(BASE.length))).toEqual(["/paste", "/paste/drawing"]);
  });

  it("the MCP answer carries the words first, then the image content (type, base64 data, mimeType)", async () => {
    const { app } = makeApp();
    const handlers = handlersOf(toolsFor(wire(app).fetch, workspace()));
    const out = (await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "atlas_draw", arguments: { path: "retry.ts", function: "retryWithBackoff" } } }, handlers, null)) as { result: { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean } };
    expect(out.result.isError).toBeUndefined();
    expect(out.result.content.map((c) => c.type)).toEqual(["text", "image"]);
    expect(out.result.content[0]!.text).toContain(`.atlas/drawings/${stem("retry.ts", "retryWithBackoff")}.svg`);
    expect(out.result.content[1]!.mimeType).toBe("image/png");
    expect(out.result.content[1]!.data).toMatch(/^iVBORw0KGgo[A-Za-z0-9+/]+=*$/);
  });

  it("refuses paths outside the workspace, other file kinds and unknown functions; sends and writes nothing", async () => {
    const { app } = makeApp();
    const w = wire(app);
    const ws = workspace();
    const outside = mkdtempSync(join(tmpdir(), "atlas-r13-out-"));
    writeFileSync(join(outside, "x.ts"), "export function x() { return 1; }\n");
    const tools = toolsFor(w.fetch, ws);
    for (const path of [join(outside, "x.ts"), "../" + outside.split("/").pop() + "/x.ts", "notes.md", "/etc/passwd", ""]) {
      const r = await tools.draw({ path });
      expect(r.isError).toBe(true);
    }
    expect(w.sent).toHaveLength(0);
    const r = await tools.draw({ path: "retry.ts", function: "nope" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/no exported function named "nope"/);
    expect(w.sent.some((s) => s.url.endsWith("/paste/drawing"))).toBe(false);
    expect(existsSync(join(ws, ".atlas"))).toBe(false);
  });

  it("a .atlas folder (or drawings folder) that is a link out of the workspace is refused; nothing is written there", async () => {
    const { app } = makeApp();
    for (const linkAt of [".atlas", join(".atlas", "drawings")]) {
      const ws = workspace();
      const outside = mkdtempSync(join(tmpdir(), "atlas-r13-out-"));
      if (linkAt !== ".atlas") mkdirSync(join(ws, ".atlas"));
      symlinkSync(outside, join(ws, linkAt));
      const r = await toolsFor(wire(app).fetch, ws).draw({ path: "retry.ts" });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Nothing was written: .* is a link/);
      expect(readdirSync(outside)).toEqual([]);
    }
  });

  it("a picture file that is a link is not written through", async () => {
    const { app } = makeApp();
    const ws = workspace();
    const outside = mkdtempSync(join(tmpdir(), "atlas-r13-out-"));
    mkdirSync(join(ws, ".atlas", "drawings"), { recursive: true });
    symlinkSync(join(outside, "target.svg"), join(ws, ".atlas", "drawings", `${stem("retry.ts")}.svg`));
    const r = await toolsFor(wire(app).fetch, ws).draw({ path: "retry.ts" });
    expect(r.isError).toBe(true);
    expect(existsSync(join(outside, "target.svg"))).toBe(false);
  });

  it("no invite on a server that needs one: the plain 'how to get a code' answer; nothing written", async () => {
    const g = build();
    const ws = workspace();
    const r = await toolsFor(wire(g.app).fetch, ws).draw({ path: "retry.ts" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/needs an invite code/);
    expect(existsSync(join(ws, ".atlas"))).toBe(false);
  });

  it("with an invite the drawing route works behind the gate", async () => {
    const g = build();
    const config = cfg({ invite: g.codes.dev });
    const ws = workspace();
    const r = await toolsFor(wire(g.app).fetch, ws, config).draw({ path: "retry.ts" });
    expect(r.isError).toBeUndefined();
    expect(existsSync(join(ws, ".atlas", "drawings", `${stem("retry.ts")}.svg`))).toBe(true);
    expect(g.spent.calls).toHaveLength(0);
  });

  it("a server answer that is not Atlas's picture (a script, a link out, a broken shape) is refused and not written", async () => {
    const { app } = makeApp();
    const real = wire(app).fetch;
    for (const svg of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/a)"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>', "<html></html>"]) {
      const fake: Fetch = async (url, init) => {
        if (url.endsWith("/paste/drawing")) return new Response(JSON.stringify({ kind: "machine", svg, png: null }), { status: 200, headers: { "content-type": "application/json" } }) as Awaited<ReturnType<Fetch>>;
        return real(url, init);
      };
      const ws = workspace();
      const r = await toolsFor(fake, ws).draw({ path: "retry.ts" });
      expect(r.isError).toBe(true);
      expect(existsSync(join(ws, ".atlas"))).toBe(false);
    }
    // A "png" that is not a PNG is dropped: the SVG is still written, and no image is returned.
    const fake: Fetch = async (url, init) => {
      if (url.endsWith("/paste/drawing")) {
        const ok = await real(url, init);
        const j = JSON.parse(await ok.text());
        return new Response(JSON.stringify({ ...j, png: Buffer.from("<svg>not a png</svg>").toString("base64") }), { status: 200 }) as Awaited<ReturnType<Fetch>>;
      }
      return real(url, init);
    };
    const ws = workspace();
    const r = await toolsFor(fake, ws).draw({ path: "retry.ts" });
    expect(r.isError).toBeUndefined();
    expect(r.image).toBeUndefined();
    expect(existsSync(join(ws, ".atlas", "drawings", `${stem("retry.ts")}.png`))).toBe(false);
  });

  it("the server route: needs a paste in this session first, and an exported function the file has", async () => {
    const { app } = makeApp();
    const post = (path: string, body: unknown, session = "s_r13") => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": session }, body: JSON.stringify(body) });
    const pasted = (await (await post("/paste", { code: RETRY_SRC, language: "ts" })).json()) as { target: { ref: string; codeSha256: string } };
    const target = { ref: pasted.target.ref, codeSha256: pasted.target.codeSha256 };
    expect((await post("/paste/drawing", { target }, "s_other")).status).toBe(400);
    expect((await post("/paste/drawing", { target, exportName: "nope" })).status).toBe(400);
    expect((await post("/paste/drawing", { target, extra: 1 })).status).toBe(400);
    const ok = (await (await post("/paste/drawing", { target, fileName: "retry.ts" })).json()) as { kind: string; svg: string };
    expect(ok.kind).toBe("machine");
    expect(svgLooksSafe(ok.svg)).toBe(true);
  });
});

describe("R13 the picture itself (plain code)", () => {
  it("a server without the optional PNG converter says so in words; the SVG is the picture", async () => {
    const r = await pngOf("<svg/>", 10, 10, async () => null);
    expect(r).toEqual({ ok: false, reason: NO_PNG });
  });

  it("names Meta's AI wrote carry the page's legend in the caption; without names there is none", () => {
    const plain = filePicture({ source: U1_EXAMPLE, language: "ts", fileName: "example.ts", tested: null });
    const named = filePicture({ source: U1_EXAMPLE, language: "ts", fileName: "example.ts", tested: null, names: EXAMPLE_NAMES, namesModel: "muse-wonder-1.0" });
    expect(plain.kind === "machine" && plain.aiNames).toBe(0);
    expect(plain.kind === "machine" && plain.caption.join(" ")).not.toContain(NAMER_WORDS.legend);
    expect(named.kind === "machine" && named.aiNames).toBeGreaterThan(0);
    expect(named.kind === "machine" && named.caption.join(" ")).toContain(NAMER_WORDS.legend);
    // The star is not in the drawing's font: the picture draws it as a shape, and the words follow it.
    expect(named.kind === "machine" && named.svg).toContain(">names: Muse Wonder");
    expect(named.kind === "machine" && named.svg).not.toMatch(/>\u2605/);
  });

  it("past 8 parts: the box chart, saying why; past 16: no picture, the parts in words", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `export function f${i}() { return ${i}; }`).join("\n");
    const chart = filePicture({ source: ten, language: "ts", fileName: "ten.ts", tested: null });
    expect(chart.kind).toBe("chart");
    expect(chart.kind === "chart" && chart.caption.join(" ")).toMatch(/more than the 8 the machine can draw.*box chart/);
    expect(chart.kind === "chart" && svgLooksSafe(chart.svg)).toBe(true);
    const many = Array.from({ length: 20 }, (_, i) => `export function g${i}() { return ${i}; }`).join("\n");
    const none = filePicture({ source: many, language: "ts", fileName: "many.ts", tested: null });
    expect(none.kind).toBe("none");
    expect(none.kind === "none" && none.words).toMatch(/Atlas draws no picture of a file this size\. Its parts: g0, g1/);
  });
});

describe("R13 review round 1", () => {
  const SVG = 'xmlns="http://www.w3.org/2000/svg"';
  it("M2: the picture is read as XML against an allow-list; the reviewer's bypasses and their kin are refused", () => {
    const bad = [
      // a namespace prefix that is still SVG, so a browser runs it
      `<svg ${SVG} xmlns:a="http://www.w3.org/2000/svg"><a:script>alert(1)</a:script></svg>`,
      // a CSS escape inside the stylesheet
      `<svg ${SVG}><style>@\\69mport url(https://evil.example/x.css);</style></svg>`,
      // animate / set rewriting an href
      `<svg ${SVG}><g><set attributeName="href" to="javascript:alert(1)"/></g></svg>`,
      `<svg ${SVG}><animate attributeName="href" values="javascript:alert(1)"/></svg>`,
      // feImage, xlink:href, use, image, foreignObject, script
      `<svg ${SVG}><feImage href="https://evil.example/x.svg"/></svg>`,
      `<svg ${SVG}><use xlink:href="https://evil.example/x.svg#a"/></svg>`,
      `<svg ${SVG}><foreignObject><div/></foreignObject></svg>`,
      `<svg ${SVG}><script>alert(1)</script></svg>`,
      // url( to anything but #id, also written with an entity or a backslash
      `<svg ${SVG}><rect fill="url(https://evil.example/a)"/></svg>`,
      `<svg ${SVG}><rect fill="u&#114;l(https://evil.example/a)"/></svg>`,
      `<svg ${SVG}><rect fill="u\\rl(https://evil.example/a)"/></svg>`,
      `<svg ${SVG} onload="alert(1)"></svg>`,
      `<svg ${SVG}><style>rect{fill:red}</style></svg>`,
      `<!DOCTYPE svg [<!ENTITY x "y">]><svg ${SVG}></svg>`,
      `<svg ${SVG}><!-- --></svg>`,
      `<svg xmlns="http://evil.example/ns"></svg>`,
      `<svg ${SVG}><g></svg>`,
      "<html></html>",
    ];
    for (const b of bad) expect(svgProblem(b), b).not.toBeNull();
    expect(svgProblem(`<svg ${SVG}><rect fill="url(#p)" class="x"/><text aria-label="url(evil) onload= javascript: \\">a &amp; b</text></svg>`)).toBeNull();
  });

  it("m4: a file name full of markup-looking text is only text: the picture is still accepted", () => {
    const p = filePicture({ source: U1_EXAMPLE, language: "ts", fileName: 'x url(evil) onload=alert(1) javascript: data: \\ <script>"&.ts', tested: null });
    expect(p.kind).toBe("machine");
    expect(p.kind === "machine" && svgProblem(p.svg)).toBeNull();
  });

  it("M1: a 64,000-character name and 16 cross-calling functions come back quickly, as words, with no picture", async () => {
    const long = "f" + "x".repeat(64_000);
    const longSrc = `export function ${long}(a: number) { return a + 1; }\nexport function g() { return ${long}(1); }\n`;
    const cross = (n: number) => Array.from({ length: n }, (_, i) => `export function f${i}(k: number): number { if (k <= 0) return 0; return ${Array.from({ length: n }, (_, j) => `f${j}(k - 1)`).join(" + ")}; }`).join("\n");
    for (const src of [longSrc, cross(16), cross(8)]) {
      const t0 = Date.now();
      const p = filePicture({ source: src, language: "ts", fileName: "x.ts", tested: null });
      expect(Date.now() - t0).toBeLessThan(2_000);
      expect(p.kind).toBe("none");
      expect(p.kind === "none" && p.words.length).toBeLessThan(4_000);
      expect(p.kind === "none" && p.words).toMatch(/no picture/);
    }
    // and through the plugin: nothing is written
    const { app } = makeApp();
    const ws = workspace();
    writeFileSync(join(ws, "cross.ts"), cross(16));
    const r = await toolsFor(wire(app).fetch, ws).draw({ path: "cross.ts" });
    expect(r.isError).toBeUndefined();
    expect(r.text).toMatch(/Atlas drew no picture of cross\.ts: .*no picture/);
    expect(existsSync(join(ws, ".atlas"))).toBe(false);
  });

  it("M1: no PNG past the pixel cap, said in words, without loading the converter", async () => {
    let loaded = false;
    const r = await pngOf("<svg/>", 4_000, 4_000, async () => ((loaded = true), null));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/more than Atlas turns into a PNG/);
    expect(loaded).toBe(false);
    expect(4_000 * 4_000).toBeGreaterThan(PNG_MAX_PIXELS);
  });

  it("M1: drawings are counted per client an hour (ATLAS_DRAWINGS_PER_CLIENT_PER_HOUR)", async () => {
    vi.stubEnv("ATLAS_DRAWINGS_PER_CLIENT_PER_HOUR", "2");
    try {
      const { app } = makeApp();
      const tools = toolsFor(wire(app).fetch, workspace());
      expect((await tools.draw({ path: "retry.ts" })).isError).toBeUndefined();
      expect((await tools.draw({ path: "retry.ts" })).isError).toBeUndefined();
      const third = await tools.draw({ path: "retry.ts" });
      expect(third.isError).toBe(true);
      expect(third.text).toMatch(/2 drawings an hour/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("M1: the drawing is kept per code, not per file name: two names, same drawing, each caption its own", async () => {
    const { app } = makeApp();
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "s_r13b" }, body: JSON.stringify(body) });
    const pasted = (await (await post("/paste", { code: RETRY_SRC, language: "ts" })).json()) as { target: { ref: string; codeSha256: string } };
    const a = (await (await post("/paste/drawing", { target: pasted.target, fileName: "a.ts" })).json()) as { svg: string };
    const b = (await (await post("/paste/drawing", { target: pasted.target, fileName: "b.ts" })).json()) as { svg: string };
    expect(a.svg).toContain("a.ts: Atlas");
    expect(b.svg).toContain("b.ts: Atlas");
    expect(a.svg.replace(/a\.ts/g, "")).toBe(b.svg.replace(/b\.ts/g, ""));
  });

  it("M3: when the server has forgotten the paste, the plugin pastes once more and draws", async () => {
    const { app } = makeApp();
    const w = wire(app);
    let forgot = 1;
    const fetch: Fetch = async (url, init) => {
      if (url.endsWith("/paste/drawing") && forgot-- > 0) return new Response(JSON.stringify({ error: "this session has no pasted file with that ref and fingerprint: paste it first (POST /paste)" }), { status: 400 }) as Awaited<ReturnType<Fetch>>;
      return w.fetch(url, init);
    };
    const r = await toolsFor(fetch, workspace()).draw({ path: "retry.ts" });
    expect(r.isError).toBeUndefined();
    expect(w.sent.map((s) => s.url.slice(BASE.length))).toEqual(["/paste", "/paste", "/paste/drawing"]);
  });

  it("m1/m2: a hard-linked picture file is not written through; m3: a/b.ts and a_b.ts get different pictures", async () => {
    const { app } = makeApp();
    const ws = workspace();
    mkdirSync(join(ws, "a"));
    writeFileSync(join(ws, "a", "b.ts"), RETRY_SRC);
    writeFileSync(join(ws, "a_b.ts"), U1_EXAMPLE);
    const tools = toolsFor(wire(app).fetch, ws);
    expect((await tools.draw({ path: "a/b.ts" })).isError).toBeUndefined();
    expect((await tools.draw({ path: "a_b.ts" })).isError).toBeUndefined();
    const files = readdirSync(join(ws, ".atlas", "drawings")).filter((f) => f.endsWith(".svg"));
    expect(files.sort()).toEqual([`${stem("a/b.ts")}.svg`, `${stem("a_b.ts")}.svg`].sort());
    expect(files[0]).not.toBe(files[1]);
    // A second name for the picture file, elsewhere: the plugin refuses, and the other name keeps its bytes.
    const outside = mkdtempSync(join(tmpdir(), "atlas-r13-out-"));
    const target = join(ws, ".atlas", "drawings", `${stem("a_b.ts")}.svg`);
    linkSync(target, join(outside, "same.svg"));
    const before = readFileSync(join(outside, "same.svg"), "utf8");
    writeFileSync(join(ws, "a_b.ts"), RETRY_SRC); // a different drawing would be written
    const r = await tools.draw({ path: "a_b.ts" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not a plain file with one name/);
    expect(readFileSync(join(outside, "same.svg"), "utf8")).toBe(before);
    expect(readdirSync(join(ws, ".atlas", "drawings")).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
