// R13: atlas_draw, the Muse Code plugin's picture of a file. The Atlas server is real (routes, plain-code drawing); the Meta
// models are mocked and the network is wired straight into the app, as in E5. $0.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAtlasClient, type Fetch } from "../../plugins/muse-atlas/mcp/atlas-client";
import type { AtlasConfig } from "../../plugins/muse-atlas/mcp/config";
import { handleMessage, handlersOf } from "../../plugins/muse-atlas/mcp/server";
import { createTools, DRAW_LIMITS, svgLooksSafe } from "../../plugins/muse-atlas/mcp/tools";
import { filePicture } from "../../renderer/authors/file-picture";
import { NO_PNG, pngOf } from "../../server/drawing";
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
const toolsFor = (fetch: Fetch, ws: string, config = cfg()) => createTools({ client: createAtlasClient(config, { fetch }), config, workspace: ws });

describe("R13 atlas_draw: a picture of a file, written inside the workspace", () => {
  it("draws the file with plain code only: SVG (and PNG here) under .atlas/drawings, honest words, no model call", async () => {
    const { app, m } = makeApp();
    const w = wire(app);
    const ws = workspace();
    const r = await toolsFor(w.fetch, ws).draw({ path: "src/example.ts" });
    expect(r.isError).toBeUndefined();
    const svg = readFileSync(join(ws, ".atlas", "drawings", "src_example.ts.svg"), "utf8");
    expect(svgLooksSafe(svg)).toBe(true);
    expect(svg).toContain("fetchWithRetry");
    expect(svg).toContain("Drawn by Atlas&#39;s plain code");
    expect(r.text).toContain("Written in this workspace: .atlas/drawings/src_example.ts.svg");
    expect(r.text).toContain(DRAW_LIMITS);
    expect(r.text).toMatch(/as a machine of 4 parts/);
    // The PNG converter is a dev dependency, so it is here: the PNG is written and returned as the image.
    const png = readFileSync(join(ws, ".atlas", "drawings", "src_example.ts.png"));
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
    expect(out.result.content[0]!.text).toContain(".atlas/drawings/retry.ts-retryWithBackoff.svg");
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
    symlinkSync(join(outside, "target.svg"), join(ws, ".atlas", "drawings", "retry.ts.svg"));
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
    expect(existsSync(join(ws, ".atlas", "drawings", "retry.ts.svg"))).toBe(true);
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
    expect(existsSync(join(ws, ".atlas", "drawings", "retry.ts.png"))).toBe(false);
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
