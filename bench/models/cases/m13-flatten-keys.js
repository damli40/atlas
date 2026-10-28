export function flattenKeys(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") Object.assign(out, flattenKeys(v, path));
    else out[path] = v;
  }
  return out;
}
