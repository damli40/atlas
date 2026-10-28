export function compareVersions(a, b) {
  const [coreA, preA] = a.split("-");
  const [coreB, preB] = b.split("-");
  const pa = coreA.split(".").map(Number);
  const pb = coreB.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA < preB ? -1 : 1;
}
