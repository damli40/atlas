// X3 review round 1 (M1): 50 realistic snippets for the failure-label markers, with the truth.
// 01–30 are the reviewer's (scratchpad x3r/snippets.mts, copied unchanged); 31–50 were added in the fix.
// `truth`: failures genuinely present in the snippet. A "found in this code" label outside `truth` is a false claim.
// A real failure left as "common pattern" is a miss (acceptable: precision over coverage).
import type { Lang } from "../../../src/failure-labels";
import { RETRY_SRC } from "../../tools/paste-fixtures";
import { PASTE_EXAMPLE } from "../../../web/paste-example";

export interface Snippet {
  id: string;
  lang: Lang;
  desc: string;
  code: string;
  truth: string[];
  /** The "found in this code" labels plain code gives today (sorted). A change to any of them must be on purpose. */
  expected: string[];
}

export const SNIPPETS: Snippet[] = [
{ id: "01", lang: "ts", desc: "retry w/ Date.now deadline + exp backoff around fetch", truth: ["clock-skew"], expected: ["clock-skew"] /* the reviewer counted this true: the deadline is measured on the wall clock */, code: `
export async function getJson(url: string, deadlineMs = 10_000) {
  const start = Date.now();
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } catch (e) {
      if (Date.now() - start > deadlineMs) throw e;
      await sleep(2 ** i * 100);
    }
  }
}` },
{ id: "02", lang: "ts", desc: "retry no deadline, no backoff, fetch", truth: ["retry-storm","no-overall-timeout","timeout","rate-limit"], expected: ["no-overall-timeout","retry-storm","timeout"], code: `
export async function getJson(url: string) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url);
      return await res.json();
    } catch (e) {
      console.log("retrying", e);
    }
  }
  throw new Error("failed");
}` },
{ id: "03", lang: "ts", desc: "retry w/ setTimeout backoff, per-try AbortController timeout", truth: [], expected: [], code: `
export async function getJson(url: string, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status === 429) { await new Promise(r => setTimeout(r, 1000)); continue; }
      return await res.json();
    } catch (e) {
      await new Promise((r) => setTimeout(r, 2 ** i * 200));
    } finally { clearTimeout(t); }
  }
  throw new Error("gave up");
}` },
{ id: "04", lang: "ts", desc: "single fetch w/ AbortSignal.timeout", truth: [], expected: [], code: `
export async function getUser(id: string) {
  const res = await fetch(\`/api/users/\${id}\`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}` },
{ id: "05", lang: "ts", desc: "axios.get with timeout option", truth: [], expected: [], code: `
import axios from "axios";
export async function getPrice(symbol: string) {
  const { data } = await axios.get("https://api.example.com/price", { params: { symbol }, timeout: 5000 });
  return data.price;
}` },
{ id: "06", lang: "ts", desc: "loop over pages, axios w/ timeout, skip failures (not a retry)", truth: [], expected: [], code: `
export async function getAll(pages: number[]) {
  const out = [];
  for (const page of pages) {
    try {
      out.push(await axios.get(\`/items?page=\${page}\`, { timeout: 5000 }));
    } catch (e) {
      console.warn("page failed", page);
    }
  }
  return out;
}` },
{ id: "07", lang: "ts", desc: "batch parse with try/catch per row, no I/O", truth: [], expected: [], code: `
export function parseRows(rows: string[]) {
  const ok = [], bad = [];
  for (const row of rows) {
    try {
      ok.push(JSON.parse(row));
    } catch {
      bad.push(row);
    }
  }
  return { ok, bad };
}` },
{ id: "08", lang: "ts", desc: "retry with pause() helper backoff, no deadline", truth: ["no-overall-timeout"], expected: ["no-overall-timeout"], code: `
export async function withRetry<T>(op: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (e) {
      lastErr = e;
      await pause(250 * 2 ** i);
    }
  }
  throw lastErr;
}` },
{ id: "09", lang: "ts", desc: "demo fixture RETRY_SRC (backoff, no deadline)", truth: ["no-overall-timeout","timeout"], expected: ["no-overall-timeout"], code: RETRY_SRC },
{ id: "10", lang: "py", desc: "requests.get with timeout=", truth: [], expected: [], code: `
import requests
def get_user(uid):
    r = requests.get(f"https://api.example.com/users/{uid}", timeout=5)
    r.raise_for_status()
    return r.json()
` },
{ id: "11", lang: "py", desc: "requests retry w/ time.sleep backoff and timeout=10", truth: [], expected: [], code: `
import time, requests
def get_with_retry(url, tries=3):
    for i in range(tries):
        try:
            return requests.get(url, timeout=10).json()
        except requests.RequestException:
            time.sleep(2 ** i)
    raise RuntimeError("gave up")
` },
{ id: "12", lang: "py", desc: "asyncio.wait_for around aiohttp", truth: [], expected: [], code: `
import asyncio, aiohttp
async def fetch_status(session, url):
    async def go():
        async with session.get(url) as r:
            return r.status
    return await asyncio.wait_for(go(), 5)
` },
{ id: "13", lang: "py", desc: "httpx retry, no sleep, no timeout", truth: ["retry-storm","no-overall-timeout","rate-limit"], expected: ["no-overall-timeout","retry-storm"], code: `
import httpx
def get(url):
    while True:
        try:
            return httpx.get(url).json()
        except httpx.HTTPError:
            continue
` },
{ id: "14", lang: "py", desc: "tenacity decorator; requests.get without timeout", truth: ["timeout"], expected: ["timeout"], code: `
from tenacity import retry, stop_after_attempt, wait_exponential
@retry(stop=stop_after_attempt(3), wait=wait_exponential())
def get(url):
    return requests.get(url).json()
` },
{ id: "15", lang: "ts", desc: "amqp consumer with idempotency key header + redis NX", truth: [], expected: [], code: `
export async function onMessage(channel, redis, msg) {
  const key = msg.properties.headers["idempotency-key"];
  const fresh = await redis.set(key, "1", "NX", "EX", 86400);
  if (fresh === null) { channel.ack(msg); return; }
  await chargeCard(JSON.parse(msg.content.toString()));
  channel.ack(msg);
}` },
{ id: "16", lang: "ts", desc: "consumer with processedIds set", truth: [], expected: [], code: `
const processedIds = new Set<string>();
export async function handle(msg, channel) {
  if (processedIds.has(msg.id)) return channel.ack(msg);
  await sendEmail(msg.body);
  processedIds.add(msg.id);
  channel.ack(msg);
}` },
{ id: "17", lang: "ts", desc: "SQS consumer, no dedupe", truth: ["duplicate-delivery"], expected: ["duplicate-delivery"], code: `
export async function poll(sqs, url) {
  const { Messages = [] } = await sqs.receiveMessage({ QueueUrl: url });
  for (const m of Messages) {
    await chargeCustomer(JSON.parse(m.Body));
    await sqs.deleteMessage({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle });
  }
}` },
{ id: "18", lang: "ts", desc: "Kafka consumer, idempotent INSERT ... ON CONFLICT DO NOTHING by event id", truth: [], expected: [], code: `
export async function onEvent(consumer, db, { topic, partition, message }) {
  const ev = JSON.parse(message.value.toString());
  await db.query("INSERT INTO payments (event_id, amount) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING", [ev.eventId, ev.amount]);
  await consumer.commitOffsets([{ topic, partition, offset: message.offset }]);
}` },
{ id: "19", lang: "py", desc: "sqlite 'with conn:' transaction, two inserts", truth: [], expected: [], code: `
def transfer(conn, a, b, amt):
    with conn:
        conn.execute("UPDATE accounts SET bal = bal - ? WHERE id = ?", (amt, a))
        conn.execute("UPDATE accounts SET bal = bal + ? WHERE id = ?", (amt, b))
` },
{ id: "20", lang: "py", desc: "psycopg2 cursor + conn.commit()", truth: [], expected: [], code: `
def transfer(conn, a, b, amt):
    with conn.cursor() as cur:
        cur.execute("UPDATE accounts SET bal = bal - %s WHERE id = %s", (amt, a))
        cur.execute("UPDATE accounts SET bal = bal + %s WHERE id = %s", (amt, b))
    conn.commit()
` },
{ id: "21", lang: "ts", desc: "two SELECT reads via db.execute", truth: [], expected: [], code: `
export async function profile(db, id: string) {
  const [user] = await db.execute("SELECT * FROM users WHERE id = ?", [id]);
  const [orders] = await db.execute("SELECT * FROM orders WHERE user_id = ?", [id]);
  return { user, orders };
}` },
{ id: "22", lang: "ts", desc: "pg BEGIN/COMMIT two inserts", truth: [], expected: [], code: `
export async function addOrder(client, o) {
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO orders (id, total) VALUES ($1, $2)", [o.id, o.total]);
    await client.query("UPDATE stock SET n = n - 1 WHERE sku = $1", [o.sku]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}` },
{ id: "23", lang: "ts", desc: "in-memory Map cache delete x2", truth: [], expected: [], code: `
const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();
export function evict(key: string) {
  cache.delete(key);
  pending.delete(key);
}` },
{ id: "24", lang: "ts", desc: "pg-promise db.tx two writes (transaction via tx)", truth: [], expected: [], code: `
export async function transfer(db, a, b, amt) {
  await db.tx(async (t) => {
    await t.none("UPDATE accounts SET bal = bal - $1 WHERE id = $2", [amt, a]);
    await t.none("UPDATE accounts SET bal = bal + $1 WHERE id = $2", [amt, b]);
  });
}` },
{ id: "25", lang: "ts", desc: "prisma two writes no transaction", truth: ["partial-commit"], expected: ["partial-commit"], code: `
export async function transfer(prisma, a, b, amt) {
  await prisma.account.update({ where: { id: a }, data: { bal: { decrement: amt } } });
  await prisma.account.update({ where: { id: b }, data: { bal: { increment: amt } } });
}` },
{ id: "26", lang: "ts", desc: "explicit UTC Date arithmetic + toLocaleString with timeZone UTC", truth: [], expected: [], code: `
export function monthLabel(y: number, m: number) {
  const d = new Date(Date.UTC(y, m, 1));
  const dow = d.getUTCDay();
  return d.toLocaleString("en-US", { timeZone: "UTC", month: "long" }) + " " + dow;
}` },
{ id: "27", lang: "ts", desc: "latency via Date.now() - start (wall clock duration)", truth: ["clock-skew"], expected: ["clock-skew"], code: `
export async function timed(fn: () => Promise<void>) {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}` },
{ id: "28", lang: "py", desc: "aware datetime arithmetic in UTC", truth: [], expected: [], code: `
from datetime import datetime, timezone
def age_seconds(created_at):
    return (datetime.now(timezone.utc) - created_at).total_seconds()
` },
{ id: "29", lang: "ts", desc: "Promise.all over a local in-memory fetchFromCache", truth: [], expected: [], code: `
const store = new Map<string, number>();
function fetchFromCache(id: string) { return Promise.resolve(store.get(id) ?? 0); }
export async function totals(ids: string[]) {
  const vals = await Promise.all(ids.map((id) => fetchFromCache(id)));
  return vals.reduce((a, b) => a + b, 0);
}` },
{ id: "30", lang: "ts", desc: "read-await-write guarded by a mutex", truth: [], expected: [], code: `
export class Account {
  balance = 0;
  constructor(private mutex: { acquire(): Promise<() => void> }) {}
  async deposit(n: number, audit: (n: number) => Promise<void>) {
    const release = await this.mutex.acquire();
    try {
      const bal = this.balance;
      await audit(n);
      this.balance = bal + n;
    } finally { release(); }
  }
}` },
{ id: "31", lang: "ts", desc: "the paste screen's default example (backoff, no deadline, stand-in fetchIt)", truth: ["no-overall-timeout"], expected: ["no-overall-timeout"], code: PASTE_EXAMPLE },
{ id: "32", lang: "py", desc: "retry over range(3), except: pass, no wait", truth: ["retry-storm","no-overall-timeout"], expected: ["no-overall-timeout","retry-storm"], code: `
def call_with_retry(call):
    for attempt in range(3):
        try:
            return call()
        except Exception:
            pass
    raise RuntimeError("gave up")
` },
{ id: "33", lang: "ts", desc: "indexed for loop over items, per-item try/catch (not a retry)", truth: [], expected: [], code: `
export async function sendAll(send: (x: string) => Promise<void>, items: string[]) {
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    try {
      await send(items[i]);
    } catch {
      failed++;
    }
  }
  return failed;
}` },
{ id: "34", lang: "ts", desc: "while(true) retry around rpc.call with sleep, no deadline", truth: ["no-overall-timeout"], expected: ["no-overall-timeout"], code: `
export async function callUntilOk(rpc: { call(x: unknown): Promise<unknown> }, x: unknown) {
  while (true) {
    try {
      return await rpc.call(x);
    } catch (e) {
      await sleep(1000);
    }
  }
}` },
{ id: "35", lang: "ts", desc: "single fetch with no signal", truth: ["timeout"], expected: ["timeout"], code: `
export async function getConfig(url: string) {
  const res = await fetch(url);
  return res.json();
}` },
{ id: "36", lang: "ts", desc: "retry with AbortSignal.timeout per try and backoff", truth: [], expected: [], code: `
export async function getConfig(url: string) {
  for (let i = 0; i < 3; i++) {
    try {
      return await (await fetch(url, { signal: AbortSignal.timeout(2000) })).json();
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error("no config");
}` },
{ id: "37", lang: "py", desc: "requests.post without timeout", truth: ["timeout"], expected: ["timeout"], code: `
import requests
def send_event(url, payload):
    r = requests.post(url, json=payload)
    return r.status_code
` },
{ id: "38", lang: "py", desc: "urlopen with timeout=3", truth: [], expected: [], code: `
from urllib.request import urlopen
def read(url):
    with urlopen(url, timeout=3) as r:
        return r.read()
` },
{ id: "39", lang: "py", desc: "httpx.get once (httpx has a 5 s default timeout)", truth: [], expected: [], code: `
import httpx
def status(url):
    return httpx.get(url).status_code
` },
{ id: "40", lang: "ts", desc: "axios.post without a timeout option", truth: ["timeout"], expected: ["timeout"], code: `
import axios from "axios";
export async function notify(url: string, body: object) {
  const r = await axios.post(url, body);
  return r.status;
}` },
{ id: "41", lang: "ts", desc: "knex: two inserts, no transaction", truth: ["partial-commit"], expected: ["partial-commit"], code: `
export async function createOrder(knex, order, items) {
  await knex("orders").insert(order);
  await knex("order_items").insert(items);
}` },
{ id: "42", lang: "py", desc: "django transaction.atomic around two saves", truth: [], expected: [], code: `
from django.db import transaction
def move(a, b):
    with transaction.atomic():
        a.save()
        b.save()
` },
{ id: "43", lang: "ts", desc: "drizzle db.transaction with two inserts", truth: [], expected: [], code: `
export async function addUser(db, user, profile) {
  await db.transaction(async (tx) => {
    await tx.insert(users).values(user);
    await tx.insert(profiles).values(profile);
  });
}` },
{ id: "44", lang: "ts", desc: "message handler: work then msg.ack(), no dedupe", truth: ["duplicate-delivery"], expected: ["duplicate-delivery"], code: `
export async function onMessage(msg) {
  await sendInvoice(JSON.parse(msg.data));
  msg.ack();
}` },
{ id: "45", lang: "ts", desc: "local getHours on new Date()", truth: ["time-zone"], expected: ["time-zone"], code: `
export function isNight() {
  const h = new Date().getHours();
  return h < 6 || h > 22;
}` },
{ id: "46", lang: "ts", desc: "Intl.DateTimeFormat with an explicit timeZone", truth: [], expected: [], code: `
export function hourIn(tz: string, d: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric" }).format(d);
}` },
{ id: "47", lang: "py", desc: "duration from time.time()", truth: ["clock-skew"], expected: ["clock-skew"], code: `
import time
def timed(fn):
    start = time.time()
    fn()
    return time.time() - start
` },
{ id: "48", lang: "ts", desc: "duration from performance.now() (monotonic)", truth: [], expected: [], code: `
export async function timed(fn: () => Promise<void>) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}` },
{ id: "49", lang: "ts", desc: "this.count = this.count + await, no lock", truth: ["race"], expected: ["race"], code: `
export class Counter {
  count = 0;
  async add(fetchDelta: () => Promise<number>) {
    this.count = this.count + await fetchDelta();
  }
}` },
{ id: "50", lang: "ts", desc: "the same update inside a mutex", truth: [], expected: [], code: `
export class Counter {
  count = 0;
  constructor(private lock: { runExclusive<T>(f: () => Promise<T>): Promise<T> }) {}
  async add(fetchDelta: () => Promise<number>) {
    await this.lock.runExclusive(async () => {
      this.count = this.count + await fetchDelta();
    });
  }
}` },
];
