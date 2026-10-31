// R3 phase 2: the renderer on a React page. One SVG in one host; React never touches what is inside it.
// The spec is the only input: anything drawn is in the spec (D55).

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { drawSpec } from "../../renderer/live/draw";
import { mountDrawing, type Mounted, type MountOptions } from "../../renderer/live/mount";
import { fontFaceCss, RENDERER_CSS } from "../../renderer/live/style";
import type { RenderSpec } from "../../renderer/spec";

let styled = false;
/** The renderer's stylesheet and self-hosted fonts, once per page. */
export function ensureRendererStyle(): void {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const style = document.createElement("style");
  style.dataset.atlas = "renderer";
  style.textContent = fontFaceCss(new URL("../../renderer/fonts/besley-latin-400-normal.woff2", import.meta.url).href, new URL("../../renderer/fonts/besley-latin-400-italic.woff2", import.meta.url).href) + RENDERER_CSS;
  document.head.append(style);
}

export interface DrawingProps extends Omit<MountOptions, "theme"> {
  spec: RenderSpec;
  theme: "light" | "dark";
  className?: string;
  testid?: string;
  style?: CSSProperties;
  /** Called with the mounted drawing each time the spec is drawn. */
  onMount?: (m: Mounted | null, narrow: boolean) => void;
}

/** A phone: the drawing uses its narrow layout. */
export const isNarrow = () => typeof window !== "undefined" && window.innerWidth < 760;

export function Drawing({ spec, theme, className, testid, style, onMount, ...opts }: DrawingProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const mounted = useRef<Mounted | null>(null);
  const handler = useRef(onMount);
  handler.current = onMount;
  const options = useRef(opts);
  options.current = opts;
  useLayoutEffect(() => {
    ensureRendererStyle();
    const el = host.current;
    if (!el) return;
    const narrow = isNarrow();
    let m: Mounted | null = null;
    try {
      m = mountDrawing(el, drawSpec(spec, { narrow }), spec, { theme, ...options.current });
    } catch (e) {
      el.classList.add("rr-host");
      el.dataset.theme = theme;
      const p = document.createElement("p");
      p.className = "rr-list";
      p.textContent = `This drawing was refused: ${(e as Error).message}`;
      el.replaceChildren(p);
    }
    mounted.current = m;
    handler.current?.(m, narrow);
    return () => {
      m?.destroy();
      mounted.current = null;
    };
  }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    mounted.current?.setTheme(theme);
  }, [theme]);
  return <div ref={host} className={className} data-testid={testid} style={style} />;
}
