// E3 review minor 1: keys that JavaScript reads as an object's prototype. Shared by the proposer and the paste routes.

/** E3 review minor 1: a key that JavaScript treats as an object's prototype, anywhere in a value. */
export function prototypeKeyIn(v: unknown, depth = 0): string | null {
  if (depth > 120 || v === null || typeof v !== "object") return null;
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") return k;
    const inner = prototypeKeyIn((v as Record<string, unknown>)[k], depth + 1);
    if (inner) return inner;
  }
  return null;
}

