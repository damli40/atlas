export async function chunkedSum(values, size) {
  let total = 0;
  for (let i = 0; i < values.length; i += size) {
    for (const v of values.slice(i, i + size)) total += v;
    await new Promise((r) => setTimeout(r, 0));
  }
  return total;
}
