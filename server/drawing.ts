// R13: the server side of POST /paste/drawing: the fonts that go inside the picture, an optional PNG, and a small cache.
//
// Plain words:
// - The drawing is plain code (renderer/authors/file-picture.ts). Here the server only adds what needs the file system: the
//   page's own font files, read once and put inside the SVG.
// - PNG: only where the optional @napi-rs/canvas package is installed. It is a dev dependency, so the production image has no
//   PNG converter and the answer then says so in words (the SVG is the picture). It is loaded on first request and guarded, so a
//   server without it still starts. It is the plain canvas package (Skia drawing the SVG as it is), not R3's pencil engine,
//   and it takes tens of milliseconds for one picture. A picture over PNG_MAX_PIXELS gets no PNG.
// - The drawing depends only on the code, the function and the names, and is kept per those (never per file name). The
//   caption with the file's name and the PNG are made per request, and the route counts requests per client an hour.

import { readFileSync } from "node:fs";
import { fileDrawing, filePictureOf, type FileDrawing, type FilePicture } from "../renderer/authors/file-picture";

export const PNG_SCALE = 1.5;
/** The plugin reads answers of at most 2 MB; a PNG past this (a big box chart) is made again at 1x so the answer fits. */
export const PNG_MAX_BYTES = 700 * 1024;
/** R13 review M1: the most pixels a PNG may have (at 1.5x a 2,300 × 2,300 picture). Past this at 1x: no PNG, the SVG is the picture. */
export const PNG_MAX_PIXELS = 12_000_000;
const MAX_KEPT = 20;

let fonts: string | null = null;
/** The page's fonts as @font-face rules (base64). A font file that cannot be read is left out: the words fall back to Georgia. */
export function fontCss(): string {
  if (fonts !== null) return fonts;
  const face = (file: string, family: string, style: "normal" | "italic") => {
    try {
      return `@font-face{font-family:"${family}";src:url("data:font/woff2;base64,${readFileSync(new URL(file, import.meta.url)).toString("base64")}") format("woff2");font-style:${style};font-weight:400}`;
    } catch {
      return "";
    }
  };
  fonts = face("../renderer/fonts/besley-latin-400-normal.woff2", "Atlas Besley", "normal") + face("../renderer/fonts/besley-latin-400-italic.woff2", "Atlas Besley", "italic") + face("../public/fonts/geist-mono-latin-wght.woff2", "Geist Mono", "normal");
  return fonts;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Canvas = any;
let canvas: Promise<Canvas | null> | null = null;
function loadCanvas(): Promise<Canvas | null> {
  canvas ??= import("@napi-rs/canvas").then(
    (c: Canvas) => {
      for (const [file, family] of [
        ["../renderer/fonts/besley-latin-400-normal.woff2", "Atlas Besley"],
        ["../renderer/fonts/besley-latin-400-italic.woff2", "Atlas Besley"],
        ["../public/fonts/geist-mono-latin-wght.woff2", "Geist Mono"],
      ] as const) {
        try {
          c.GlobalFonts.register(readFileSync(new URL(file, import.meta.url)), family);
        } catch {
          // a missing font falls back; the words stay readable
        }
      }
      return c;
    },
    () => null,
  );
  return canvas;
}

export const NO_PNG = "this Atlas server has no PNG converter (the optional @napi-rs/canvas package is not installed here), so the picture is SVG only";

/** A PNG of an SVG file, or the reason there is none. */
export async function pngOf(svg: string, width: number, height: number, load: () => Promise<Canvas | null> = loadCanvas, scale = PNG_SCALE): Promise<{ ok: true; png: Buffer } | { ok: false; reason: string }> {
  // Checked before the converter is even loaded: a huge canvas is memory the server never spends.
  if (width * height > PNG_MAX_PIXELS) return { ok: false, reason: `the picture is ${Math.round(width)} × ${Math.round(height)} px, more than Atlas turns into a PNG, so it is SVG only` };
  if (width * height * scale * scale > PNG_MAX_PIXELS) scale = 1;
  const c = await load();
  if (!c) return { ok: false, reason: NO_PNG };
  try {
    const img = new c.Image();
    img.src = Buffer.from(svg, "utf8");
    const out = c.createCanvas(Math.round(width * scale), Math.round(height * scale));
    out.getContext("2d").drawImage(img, 0, 0, width * scale, height * scale);
    const png = out.toBuffer("image/png") as Buffer;
    if (png.length > PNG_MAX_BYTES && scale > 1) return pngOf(svg, width, height, load, 1);
    if (png.length > PNG_MAX_BYTES) return { ok: false, reason: `the PNG would be ${Math.round(png.length / 1024)} KB, too big to send, so the picture is SVG only` };
    return { ok: true, png };
  } catch (e) {
    return { ok: false, reason: `the PNG converter failed (${e instanceof Error ? e.message : String(e)}), so the picture is SVG only` };
  }
}

export type ServedPicture = FilePicture & { png?: Buffer | null; pngReason?: string };

const drawings = new Map<string, FileDrawing>();
/**
 * The picture for one request. The drawing is kept per (code, function, names): `drawingKey` must name exactly those. The caption
 * (with `fileName`) and the PNG are made each time. Throws only if plain code cannot draw the file.
 */
export async function servedPicture(drawingKey: string, o: Parameters<typeof fileDrawing>[0] & { fileName: string; namesModel?: string | null }): Promise<ServedPicture> {
  let d = drawings.get(drawingKey);
  if (!d) {
    d = fileDrawing(o);
    drawings.set(drawingKey, d);
    while (drawings.size > MAX_KEPT) drawings.delete(drawings.keys().next().value!);
  }
  const pic = filePictureOf(d, { fileName: o.fileName, tested: o.tested, namesModel: o.namesModel ?? null, fontCss: fontCss() });
  if (pic.kind === "none") return pic;
  const png = await pngOf(pic.svg, pic.width, pic.height);
  return { ...pic, png: png.ok ? png.png : null, ...(png.ok ? {} : { pngReason: png.reason }) };
}
