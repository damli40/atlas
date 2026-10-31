import { useSyncExternalStore } from "react";

function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const m = window.matchMedia(q);
      m.addEventListener("change", changed);
      return () => m.removeEventListener("change", changed);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches,
    () => false,
  );
}
export const useDarkScheme = () => useMedia("(prefers-color-scheme: dark)");
export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");
