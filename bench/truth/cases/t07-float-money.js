// Money in binary floating point: rounding to cents, and adding two prices.
export function roundTo2(x) {
  return Math.round(x * 100) / 100;
}

export function addPrices(a, b) {
  const raw = a + b;
  return { raw, fixed: raw.toFixed(2) };
}
