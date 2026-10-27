export function safeParse(text) {
  try {
    const v = JSON.parse(text);
    return { ok: true, type: Array.isArray(v) ? "array" : v === null ? "null" : typeof v, value: v };
  } catch (e) {
    return { ok: false, error: e.name };
  }
}
