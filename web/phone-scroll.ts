// R15: on a phone the studio is a page that scrolls (tool.css, "R15: phones"), so three moments bring the right thing
// into view by themselves:
// - after you pick an answer, "Lock in my bet" (it can sit below the fold);
// - when you lock in, and again when the run starts playing, the drawing (it sits above the bet panel);
// - when the paste box opens ("Try your own code"), the top of the page.
// Only at phone widths (the same 760 px as the CSS); a desktop never scrolls. Reads the page's test ids only, so it
// needs no change inside the studio's own components.

const PHONE = "(max-width:760px)";

function scrollTo(el: Element | null, block: ScrollLogicalPosition): void {
  if (!el) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block, behavior: still ? "auto" : "smooth" });
}

const stage = () => document.querySelector('[data-testid="bench-stage"]');

export function installPhoneScroll(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const phone = window.matchMedia(PHONE);
  document.addEventListener("click", (e) => {
    if (!phone.matches) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    // After React has drawn the pick (or the sealed list), on the next frames.
    if (t.closest('[data-testid^="opt-"]')) window.setTimeout(() => scrollTo(document.querySelector('[data-testid="u1-seal"]'), "nearest"), 60);
    else if (t.closest('[data-testid="u1-seal"]')) window.setTimeout(() => scrollTo(stage(), "start"), 60);
  });
  new MutationObserver((records) => {
    if (!phone.matches) return;
    for (const r of records) {
      const el = r.target as Element;
      if (el.getAttribute("data-testid") === "bench-stage" && el.getAttribute("data-stage") === "run" && r.oldValue !== "run") {
        scrollTo(el, "start");
        return;
      }
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-stage"], attributeOldValue: true });
  // A new screen inside the studio (the paste box after "Try your own code") starts at its top, not where the last one was scrolled.
  new MutationObserver((records) => {
    if (!phone.matches) return;
    for (const r of records)
      for (const n of r.addedNodes)
        if (n instanceof Element && (n.matches(".u1-entry") || n.querySelector(".u1-entry"))) {
          window.scrollTo({ top: 0 });
          return;
        }
  }).observe(document.body, { subtree: true, childList: true });
}
