// Eleven realistic files of 5 to 8 parts, written for the measures, not for the router.
export const FILES: Record<string, [string, "js" | "ts" | "py", string]> = {
  // Rebuilt from the cold tester's chart (its own file is not on disk): the same six functions and seven calls.
  latency: [`type Hit = { route: string; ms: number; ok: boolean };
function percentile(xs: number[], p: number) { const s = [...xs].sort(); return s[Math.floor((s.length - 1) * p)]; }
function onlySuccessful(hits: Hit[]) { return hits.filter((h) => h.ok); }
function groupByRoute(hits: Hit[]) { const m = new Map<string, number[]>(); for (const h of hits) m.set(h.route, [...(m.get(h.route) ?? []), h.ms]); return m; }
function formatRow(route: string, p50: number, p95: number) { return route.padEnd(8) + " p50=" + p50 + "ms p95=" + p95 + "ms"; }
export function latencyReport(hits: Hit[]) {
  const rows: string[] = [];
  for (const [route, xs] of groupByRoute(onlySuccessful(hits))) rows.push(formatRow(route, percentile(xs, 0.5), percentile(xs, 0.95)));
  return rows;
}
export function slowestRoute(hits: Hit[]) {
  let worst = "";
  let most = -1;
  for (const [route, xs] of groupByRoute(onlySuccessful(hits))) { const p = percentile(xs, 0.95); if (p > most) { most = p; worst = route; } }
  return worst;
}
`, "ts", "latencyReport"],
  routes: [`type Route = { name: string; ms: number; ok: boolean };
function onlySuccessful(rs: Route[]) { return rs.filter((r) => r.ok); }
function byLatency(rs: Route[]) { return [...rs].sort((a, b) => a.ms - b.ms); }
function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function medianLatency(rs: Route[]) { return median(onlySuccessful(rs).map((r) => r.ms)); }
function slowestRoute(rs: Route[]) { const ok = byLatency(onlySuccessful(rs)); return ok[ok.length - 1]; }
export function report(rs: Route[]) { return { slowest: slowestRoute(rs), median: medianLatency(rs), fastest: byLatency(onlySuccessful(rs))[0] }; }
`, "ts", "report"],
  cart: [`function price(i) { return i.qty * i.unit; }
function subtotal(items) { let t = 0; for (const i of items) t += price(i); return t; }
function discount(total, code) { if (code === "TEN") return total * 0.1; return 0; }
function tax(total) { return total * 0.2; }
function shipping(total) { return total > 50 ? 0 : 5; }
export function checkout(items, code) { const s = subtotal(items); const d = discount(s, code); const net = s - d; return net + tax(net) + shipping(net); }
`, "js", "checkout"],
  signup: [`function normalizeEmail(e) { return e.trim().toLowerCase(); }
function isValid(e) { return e.includes("@"); }
function checkPassword(p) { if (p.length < 8) throw new Error("too short"); return true; }
async function saveUser(db, u) { return db.insert(u); }
async function sendWelcome(mail, e) { await mail.send(e); }
export async function signup(db, mail, email, pass) {
  const e = normalizeEmail(email);
  if (!isValid(e)) throw new Error("bad email");
  checkPassword(pass);
  const u = await saveUser(db, { e });
  await sendWelcome(mail, e);
  return u;
}
`, "js", "signup"],
  fan: [`export function a(x) { return b(x) + c(x) + d(x) + e(x); }
function b(x) { return f(x); }
function c(x) { return f(x) + 1; }
function d(x) { return g(x); }
function e(x) { return g(x) + 2; }
function f(x) { return x; }
function g(x) { return x * 2; }
`, "js", "a"],
  chain: [`function one(x) { return two(x) + 1; }
function two(x) { return three(x) + 1; }
function three(x) { return four(x) + 1; }
function four(x) { return five(x) + 1; }
function five(x) { return x; }
export function run(x) { return one(x); }
`, "js", "run"],
  retry: [`const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function backoff(n: number) { return 100 * 2 ** n; }
function shouldRetry(e: Error) { return e.message.includes("429"); }
async function attempt(f: () => Promise<string>) { return await f(); }
export async function withRetry(f: () => Promise<string>, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await attempt(f); } catch (e) { if (!shouldRetry(e as Error)) throw e; await sleep(backoff(i)); }
  }
  throw new Error("gave up");
}
`, "ts", "withRetry"],
  py_users: [`def normalize_email(e):
    return e.strip().lower()

def valid(e):
    return "@" in e

def dedupe(xs):
    return list(dict.fromkeys(xs))

def clean(emails):
    return [normalize_email(e) for e in emails if valid(e)]

def import_users(emails):
    out = dedupe(clean(emails))
    if not out:
        raise ValueError("no users")
    return out
`, "py", "import_users"],
  py_cache: [`import time

_cache = {}

def now():
    return time.time()

def get(k):
    hit = _cache.get(k)
    if hit and hit[0] > now():
        return hit[1]
    return None

def put(k, v, ttl):
    _cache[k] = (now() + ttl, v)

def load(k):
    time.sleep(0.1)
    return k.upper()

def fetch(k):
    v = get(k)
    if v is None:
        v = load(k)
        put(k, v, 60)
    return v
`, "py", "fetch"],
  parser: [`function tokens(s) { return s.split(/\\s+/); }
function isNum(t) { return /^\\d+$/.test(t); }
function parseNum(t) { return Number(t); }
function parseWord(t) { return t.toLowerCase(); }
function parseToken(t) { return isNum(t) ? parseNum(t) : parseWord(t); }
function totals(v) { return v.filter((x) => typeof x === "number").reduce((a, b) => a + b, 0); }
export function parse(s) { const v = tokens(s).map(parseToken); return { v, total: totals(v) }; }
`, "js", "parse"],
  hub: [`function a1() { return 1; }
function a2() { return 2; }
function a3() { return 3; }
function a4() { return 4; }
function a5() { return 5; }
function a6() { return 6; }
function a7() { return 7; }
export function hub() { return a1() + a2() + a3() + a4() + a5() + a6() + a7(); }
`, "js", "hub"],
};

