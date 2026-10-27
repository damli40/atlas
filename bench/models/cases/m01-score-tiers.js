export function tierCounts(scores) {
  const counts = { A: 0, B: 0, C: 0 };
  for (const s of scores) {
    if (s >= 90) counts.A++;
    else if (s > 75) counts.B++;
    else counts.C++;
  }
  return counts;
}
