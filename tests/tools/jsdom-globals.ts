// A browser-like page for one test file that also runs the real server in the same process.
//
// Why not vitest's "jsdom" environment: it swaps Node's URL class for jsdom's, which cannot read
// file: URLs, and the server and runners find their files with new URL(..., import.meta.url).
// So the test stays in Node and this module copies jsdom's window objects (document, HTMLElement,
// Event, ...) onto globalThis, WITHOUT replacing anything Node already has (URL, fetch, crypto,
// TextEncoder). Import it FIRST: react-dom checks for `window` when it loads.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in g) continue;
  try {
    g[key] = (dom.window as unknown as Record<string, unknown>)[key];
  } catch {
    // a few window getters throw outside a real page; they are not needed here
  }
}
g.window = dom.window;
g.document = dom.window.document;
g.IS_REACT_ACT_ENVIRONMENT = true;

export const jsdomWindow = dom.window;
