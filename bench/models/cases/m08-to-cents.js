export function toCents(input) {
  const [whole, frac = ""] = String(input).replace(/[$,\s]/g, "").split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}
