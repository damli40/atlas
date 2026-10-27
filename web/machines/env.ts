// Guarded browser checks for the machines. The Anatomy kit's own helpers call window.matchMedia
// and IntersectionObserver directly; a page without them (jsdom in tests, an old browser) would
// throw. Without any of these the machines show their end state and do not animate.

import { useEffect, useState, type RefObject } from "react";

const STILLNESS = "(prefers-reduced-motion: reduce)";

/** True when the reader asked for reduced motion, or when this page cannot animate a figure at all. */
export function stillNow(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function" || typeof IntersectionObserver === "undefined" || typeof requestAnimationFrame === "undefined") return true;
  return window.matchMedia(STILLNESS).matches;
}

/** Whether the element is on (or near) the screen. False when the page has no IntersectionObserver. */
export function useVisible(ref: RefObject<Element | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    // Read the newest entry: one callback can deliver a leave and a return together (Anatomy, motion.md).
    const io = new IntersectionObserver((entries) => setOn(Boolean(entries.at(-1)?.isIntersecting)), { rootMargin: "120px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, [ref]);
  return on;
}
