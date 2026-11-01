import { fontFaceCss, RENDERER_CSS } from "../live/style";

export function installStyle(extra = ""): void {
  const style = document.createElement("style");
  style.textContent = fontFaceCss(new URL("../fonts/besley-latin-400-normal.woff2", import.meta.url).href, new URL("../fonts/besley-latin-400-italic.woff2", import.meta.url).href) + RENDERER_CSS + extra;
  document.head.append(style);
}

/** Waits for the two faces: nothing is pinned before the words can be drawn in their real font. */
export async function fontsReady(): Promise<void> {
  await Promise.all([document.fonts.load('400 20px "Atlas Besley"'), document.fonts.load('italic 400 20px "Atlas Besley"')]);
}
