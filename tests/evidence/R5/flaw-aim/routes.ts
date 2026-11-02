type Route = { name: string; ms: number; ok: boolean };
function onlySuccessful(rs: Route[]) { return rs.filter((r) => r.ok); }
function byLatency(rs: Route[]) { return [...rs].sort((a, b) => a.ms - b.ms); }
function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function medianLatency(rs: Route[]) { return median(onlySuccessful(rs).map((r) => r.ms)); }
function slowestRoute(rs: Route[]) { const ok = byLatency(onlySuccessful(rs)); return ok[ok.length - 1]; }
export function report(rs: Route[]) { return { slowest: slowestRoute(rs), median: medianLatency(rs), fastest: byLatency(onlySuccessful(rs))[0] }; }
