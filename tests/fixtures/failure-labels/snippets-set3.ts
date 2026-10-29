// X3 review round 2 (Dami D49): a third, fresh set of 40 snippets, written before any marker was run on them and
// without looking at the reviewer's 40 (scratchpad x3r2/). `truth` was written by hand: the failures genuinely
// present in the snippet's text. It was committed before the markers were scored on it.
import type { Snippet } from "./snippets";

export type TruthSnippet = Omit<Snippet, "expected">;

export const SET3: TruthSnippet[] = [
{ id: "s3-01", lang: "ts", desc: "retry with sleep backoff and maxAttempts, no deadline", truth: ["no-overall-timeout"], code: `
export async function withBackoff<T>(op: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      await sleep(100 * 2 ** attempt);
    }
  }
  throw lastError;
}` },
{ id: "s3-02", lang: "ts", desc: "retry until a wall-clock deadline, with sleep", truth: [], code: `
export async function untilDeadline(op: () => Promise<string>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return await op();
    } catch {
      await sleep(250);
    }
  }
  throw new Error("deadline passed");
}` },
{ id: "s3-03", lang: "ts", desc: "tight retry of client.send, no wait, no deadline", truth: ["retry-storm", "no-overall-timeout"], code: `
export async function sendWithRetry(client: { send(c: unknown): Promise<unknown> }, cmd: unknown) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await client.send(cmd);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}` },
{ id: "s3-04", lang: "py", desc: "bounded retry, per-call timeout=3, sleep", truth: [], code: `
import time, requests
def get_json(session, url):
    for attempt in range(5):
        try:
            return session.get(url, timeout=3).json()
        except requests.Timeout:
            time.sleep(attempt)
    raise RuntimeError("no answer")
` },
{ id: "s3-05", lang: "py", desc: "connect forever, no wait", truth: ["retry-storm", "no-overall-timeout"], code: `
def connect_forever(connect, host):
    while True:
        try:
            conn = connect(host)
            break
        except OSError:
            continue
    return conn
` },
{ id: "s3-06", lang: "ts", desc: "pagination do/while, no try", truth: [], code: `
export async function listAll(api: { list(q: { cursor?: string }): Promise<{ items: string[]; next?: string }> }) {
  const items: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.list({ cursor });
    items.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return items;
}` },
{ id: "s3-07", lang: "ts", desc: "status polling loop with sleep, no try", truth: [], code: `
export async function waitReady(getStatus: (id: string) => Promise<string>, id: string) {
  let done = false;
  while (!done) {
    const s = await getStatus(id);
    done = s === "ready";
    if (!done) await sleep(1000);
  }
}` },
{ id: "s3-08", lang: "ts", desc: "retry that rethrows non-retryable errors, delay backoff, no deadline", truth: ["no-overall-timeout"], code: `
export async function call(op: () => Promise<unknown>, isRetryable: (e: unknown) => boolean) {
  for (let i = 0; i < 4; i++) {
    try {
      return await op();
    } catch (e) {
      if (!isRetryable(e)) throw e;
      await delay(2 ** i * 100);
    }
  }
  throw new Error("out of tries");
}` },
{ id: "s3-09", lang: "ts", desc: "per-url inner retry with sleep, no deadline", truth: ["no-overall-timeout"], code: `
export async function fetchAll(fetchOne: (u: string) => Promise<string>, urls: string[]) {
  const results: string[] = [];
  for (const url of urls) {
    for (let i = 0; i < 3; i++) {
      try {
        results.push(await fetchOne(url));
        break;
      } catch {
        await sleep(100);
      }
    }
  }
  return results;
}` },
{ id: "s3-10", lang: "ts", desc: "loop over shard numbers, shard passed to the call (not a retry)", truth: [], code: `
export async function flushAll(flush: (shard: number) => Promise<void>, n: number) {
  for (let shard = 0; shard < n; shard++) {
    try {
      await flush(shard);
    } catch (e) {
      console.error("shard failed", shard, e);
    }
  }
}` },
{ id: "s3-11", lang: "py", desc: "tries fn(0), fn(1), fn(2): different inputs, not a retry", truth: [], code: `
def first_that_works(fn):
    for i in range(3):
        try:
            return fn(i)
        except Exception:
            pass
    return None
` },
{ id: "s3-12", lang: "ts", desc: "health check fetch, no timeout", truth: ["timeout"], code: `
export async function healthy(base: string) {
  const r = await fetch(\`\${base}/health\`);
  return r.ok;
}` },
{ id: "s3-13", lang: "ts", desc: "fetch with AbortController and setTimeout abort", truth: [], code: `
export async function healthy(base: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2000);
  try {
    const r = await fetch(\`\${base}/health\`, { signal: controller.signal });
    return r.ok;
  } finally {
    clearTimeout(t);
  }
}` },
{ id: "s3-14", lang: "py", desc: "requests.get with params, no timeout", truth: ["timeout"], code: `
import requests
def search(q):
    r = requests.get("https://api.example.com/search", params={"q": q})
    return r.json()["results"]
` },
{ id: "s3-15", lang: "py", desc: "requests.get with timeout=None (explicitly none)", truth: ["timeout"], code: `
import requests
def download(url):
    return requests.get(url, timeout=None).content
` },
{ id: "s3-16", lang: "ts", desc: "axios instance with a timeout, then api.get", truth: [], code: `
import axios from "axios";
const api = axios.create({ baseURL: "https://api.example.com", timeout: 2000 });
export async function user(id: string) {
  const { data } = await api.get(\`/users/\${id}\`);
  return data;
}` },
{ id: "s3-17", lang: "ts", desc: "got(url) with no timeout (got has none by default)", truth: ["timeout"], code: `
import got from "got";
export async function page(url: string) {
  return got(url).text();
}` },
{ id: "s3-18", lang: "ts", desc: "this.balance += await rate(), no lock", truth: ["race"], code: `
export class Wallet {
  balance = 0;
  async accrue(rate: () => Promise<number>) {
    this.balance += await rate();
  }
}` },
{ id: "s3-19", lang: "ts", desc: "read from a Map, await, write back (lost update through a method)", truth: ["lost-update"], code: `
export class Totals {
  cache = new Map<string, number>();
  async add(k: string, compute: () => Promise<number>) {
    const cur = this.cache.get(k) ?? 0;
    const v = await compute();
    this.cache.set(k, cur + v);
  }
}` },
{ id: "s3-20", lang: "py", desc: "self.total = self.total + await, no lock", truth: ["race"], code: `
class Meter:
    def __init__(self):
        self.total = 0
    async def add(self):
        self.total = self.total + await self.fetch_delta()
` },
{ id: "s3-21", lang: "py", desc: "the same update inside async with self.lock", truth: [], code: `
class Meter:
    async def add(self, f):
        async with self.lock:
            self.n = self.n + await f()
` },
{ id: "s3-22", lang: "ts", desc: "kafkajs eachMessage, auto-commit, no dedupe (no ack call)", truth: ["duplicate-delivery"], code: `
export async function run(consumer: any, ship: (o: unknown) => Promise<void>) {
  await consumer.run({
    eachMessage: async ({ message }: any) => {
      await ship(JSON.parse(message.value.toString()));
    },
  });
}` },
{ id: "s3-23", lang: "ts", desc: "SQS handler with a MessageId check before work", truth: [], code: `
export async function handle(sqs: any, db: any, msg: any, url: string) {
  if (await db.exists(msg.MessageId)) return;
  await db.recordPayment(JSON.parse(msg.Body));
  await sqs.deleteMessage({ QueueUrl: url, ReceiptHandle: msg.ReceiptHandle });
}` },
{ id: "s3-24", lang: "py", desc: "pika callback: charge then basic_ack, no dedupe", truth: ["duplicate-delivery"], code: `
import json
def on_message(ch, method, props, body):
    charge(json.loads(body))
    ch.basic_ack(delivery_tag=method.delivery_tag)
` },
{ id: "s3-25", lang: "py", desc: "pika callback with redis set nx on message_id", truth: [], code: `
import json
def on_message(ch, method, props, body):
    if redis.set(f"seen:{props.message_id}", 1, nx=True):
        charge(json.loads(body))
    ch.basic_ack(delivery_tag=method.delivery_tag)
` },
{ id: "s3-26", lang: "ts", desc: "drizzle insert then update, no transaction", truth: ["partial-commit"], code: `
export async function place(db: any, o: any) {
  await db.insert(orders).values(o);
  await db.update(stock).set({ n: o.n - 1 }).where(eq(stock.sku, o.sku));
}` },
{ id: "s3-27", lang: "ts", desc: "prisma.$transaction with two writes", truth: [], code: `
export async function place(prisma: any, o: any) {
  await prisma.$transaction([prisma.order.create({ data: o }), prisma.stock.update({ where: { sku: o.sku }, data: { n: { decrement: 1 } } })]);
}` },
{ id: "s3-28", lang: "py", desc: "sqlalchemy session.add x2 then one commit", truth: [], code: `
def place(session, order, item):
    session.add(order)
    session.add(item)
    session.commit()
` },
{ id: "s3-29", lang: "py", desc: "autocommit on, two INSERTs", truth: ["partial-commit"], code: `
def record(conn, a, b):
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("INSERT INTO ledger (acct, amt) VALUES (%s, %s)", (a, -10))
    cur.execute("INSERT INTO ledger (acct, amt) VALUES (%s, %s)", (b, 10))
` },
{ id: "s3-30", lang: "ts", desc: "a single update", truth: [], code: `
export async function rename(db: any, id: string, name: string) {
  await db.update(users).set({ name }).where(eq(users.id, id));
}` },
{ id: "s3-31", lang: "ts", desc: "age from Date.now() minus a stored timestamp", truth: ["clock-skew"], code: `
export function ageSeconds(created: Date) {
  return (Date.now() - created.getTime()) / 1000;
}` },
{ id: "s3-32", lang: "ts", desc: "Date.now() - lastPing > 30000", truth: ["clock-skew"], code: `
export function stale(lastPing: number, reconnect: () => void) {
  if (Date.now() - lastPing > 30000) reconnect();
}` },
{ id: "s3-33", lang: "ts", desc: "duration from performance.now()", truth: [], code: `
export async function measure(fn: () => Promise<void>) {
  const start = performance.now();
  await fn();
  const end = performance.now();
  return end - start;
}` },
{ id: "s3-34", lang: "py", desc: "elapsed from time.monotonic()", truth: [], code: `
import time
def run(fn):
    t0 = time.monotonic()
    fn()
    return time.monotonic() - t0
` },
{ id: "s3-35", lang: "py", desc: "deadline = time.time() + 30, no subtraction", truth: [], code: `
import time
def wait_until(check):
    deadline = time.time() + 30
    while time.time() < deadline:
        if check():
            return True
        time.sleep(1)
    return False
` },
{ id: "s3-36", lang: "ts", desc: "toLocaleDateString() with no options", truth: ["time-zone"], code: `
export function dayLabel(d: Date) {
  return d.toLocaleDateString();
}` },
{ id: "s3-37", lang: "ts", desc: "toLocaleDateString with an explicit timeZone", truth: [], code: `
export function dayLabel(d: Date) {
  return d.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
}` },
{ id: "s3-38", lang: "py", desc: "datetime.fromtimestamp(ts) with no tz", truth: ["time-zone"], code: `
from datetime import datetime
def day(ts):
    return datetime.fromtimestamp(ts).date()
` },
{ id: "s3-39", lang: "py", desc: "datetime.fromtimestamp(ts, tz=timezone.utc)", truth: [], code: `
from datetime import datetime, timezone
def day(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).date()
` },
{ id: "s3-40", lang: "ts", desc: "retry with node:timers/promises setTimeout as the wait, no deadline", truth: ["no-overall-timeout"], code: `
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
export async function retry(op: () => Promise<unknown>) {
  for (let i = 0; i < 5; i++) {
    try {
      return await op();
    } catch {
      await setTimeoutPromise(200 * (i + 1));
    }
  }
  throw new Error("failed");
}` },
];
