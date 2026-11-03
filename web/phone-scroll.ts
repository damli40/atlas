// R15: on a phone the studio is a page that scrolls (tool.css, "R15: phones"), so four moments bring the right thing
// into view by themselves:
// - the first time you pick an answer in a round (by tap or by keyboard), "Lock in my bet" (it can sit below the fold);
//   a later re-pick in the same round leaves the page where you put it;
// - when you lock in, and again when the run starts playing, the drawing (it sits above the bet panel);
// - when the paste box opens ("Try your own code"), the top of the page.
// Only on phone-sized screens: the same query as the CSS (narrow, or short like a phone on its side); a desktop never
// scrolls. Reads the page's test ids and ARIA state only, so it needs no change inside the studio's own components.

export const PHONE_QUERY = "(max-width:760px),(max-height:500px)";

function scrollTo(el: Element | null, block: ScrollLogicalPosition): void {
  if (!el) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block, behavior: still ? "auto" : "smooth" });
}

const stage = () => document.querySelector('[data-testid="bench-stage"]');
const holds = (n: Node, sel: string) => n instanceof Element && (n.matches(sel) || n.querySelector(sel) !== null);

export function installPhoneScroll(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const phone = window.matchMedia(PHONE_QUERY);
  // A round's "Lock in my bet" is a new button each round (it is replaced by the sealed list on lock-in), so a button
  // we already scrolled to means this round's first pick has happened.
  const scrolledFor = new WeakSet<Element>();
  new MutationObserver((records) => {
    if (!phone.matches) return;
    for (const r of records) {
      const el = r.target as Element;
      if (r.type === "attributes" && r.attributeName === "aria-checked") {
        if (el.getAttribute("aria-checked") !== "true" || r.oldValue === "true" || !el.matches('[data-testid^="opt-"]')) continue;
        const seal = document.querySelector('[data-testid="u1-seal"]');
        if (seal && !scrolledFor.has(seal)) {
          scrolledFor.add(seal);
          // After React has finished drawing the pick, on the next frames.
          window.setTimeout(() => scrollTo(seal, "nearest"), 60);
        }
        return;
      }
      if (r.type === "attributes" && r.attributeName === "data-stage") {
        if (el.getAttribute("data-testid") === "bench-stage" && el.getAttribute("data-stage") === "run" && r.oldValue !== "run") {
          scrollTo(el, "start");
          return;
        }
        continue;
      }
      if (r.type === "childList") {
        for (const n of r.addedNodes) {
          // Locked in (by tap or by keyboard): the sealed list replaced the button. Show the drawing.
          if (holds(n, '[data-testid="b-seals"]')) {
            window.setTimeout(() => scrollTo(stage(), "start"), 60);
            return;
          }
          // A new screen inside the studio (the paste box after "Try your own code") starts at its top.
          if (holds(n, ".u1-entry")) {
            window.scrollTo({ top: 0 });
            return;
          }
        }
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-stage", "aria-checked"], attributeOldValue: true });
}
