// Milliseconds to "1h 2m 3s". Whole seconds only; zero parts are left out, except a plain "0s".
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`bad duration: ${ms}`);
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}
