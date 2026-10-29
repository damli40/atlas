// X3 review round 2: the reviewer's 40 out-of-sample snippets (scratchpad x3r2/oos.mts, copied unchanged), with the
// reviewer's hand truth. Re-scored after the round-2 fixes.
import type { Lang } from "../../../src/failure-labels";

export interface ReviewSnippet {
  id: string;
  lang: Lang;
  fn: string;
  desc: string;
  truth: string[];
  code: string;
}

export const REVIEW2: ReviewSnippet[] = [
{ id: "o01", lang: "ts", fn: "getRepo", desc: "got with retry + timeout options", truth: [], code: `
import got from "got";
export async function getRepo(name: string) {
  return got(\`https://api.github.com/repos/\${name}\`, { retry: { limit: 2 }, timeout: { request: 5000 } }).json();
}` },
{ id: "o02", lang: "ts", fn: "getQuote", desc: "ky (10 s default timeout)", truth: [], code: `
import ky from "ky";
export async function getQuote(sym: string) {
  return ky.get("https://quotes.example.com/v1", { searchParams: { sym } }).json<{ px: number }>();
}` },
{ id: "o03", lang: "ts", fn: "post", desc: "undici request (default headers/body timeouts)", truth: [], code: `
import { request } from "undici";
export async function post(url: string, body: unknown) {
  const { statusCode, body: res } = await request(url, { method: "POST", body: JSON.stringify(body) });
  if (statusCode >= 400) throw new Error("bad " + statusCode);
  return res.json();
}` },
{ id: "o04", lang: "ts", fn: "fetchAllPages", desc: "node-fetch pagination by page number, failures skipped (NOT a retry)", truth: ["timeout"], code: `
import fetch from "node-fetch";
export async function fetchAllPages(base: string, pages: number) {
  const out: unknown[] = [];
  let failed = 0;
  for (let page = 1; page <= pages; page++) {
    try {
      const r = await fetch(\`\${base}?page=\${page}\`);
      out.push(...(await r.json() as unknown[]));
    } catch (e) {
      failed++;
    }
  }
  return { out, failed };
}` },
{ id: "o05", lang: "ts", fn: "loadConfig", desc: "p-retry around fetch with no signal (p-retry backs off)", truth: ["timeout"], code: `
import pRetry from "p-retry";
export async function loadConfig(url: string) {
  return pRetry(async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }, { retries: 5 });
}` },
{ id: "o06", lang: "ts", fn: "getWithRetry", desc: "retry loop, AbortSignal.timeout per try, backoff", truth: [], code: `
export async function getWithRetry(url: string) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return await r.json();
    } catch (err) {
      lastErr = err;
      await new Promise((res) => setTimeout(res, 250 * 2 ** attempt));
    }
  }
  throw lastErr;
}` },
{ id: "o07", lang: "ts", fn: "pollQueue", desc: "SQS consumer loop: long poll, per-message try, ack after work, no dedupe", truth: ["duplicate-delivery"], code: `
export async function pollQueue(sqs: any, queueUrl: string, handle: (m: unknown) => Promise<void>) {
  while (true) {
    const { Messages = [] } = await sqs.receiveMessage({ QueueUrl: queueUrl, WaitTimeSeconds: 20 }).promise();
    for (const m of Messages) {
      try {
        await handle(JSON.parse(m.Body));
        await sqs.deleteMessage({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }).promise();
      } catch (e) {
        console.error("handler failed, message will reappear", e);
      }
    }
  }
}` },
{ id: "o08", lang: "ts", fn: "startConsumer", desc: "kafkajs eachMessage with autoCommit (no explicit ack)", truth: [], code: `
export async function startConsumer(kafka: any, apply: (v: unknown) => Promise<void>) {
  const consumer = kafka.consumer({ groupId: "billing" });
  await consumer.connect();
  await consumer.subscribe({ topic: "invoices" });
  await consumer.run({ eachMessage: async ({ message }: any) => { await apply(JSON.parse(message.value.toString())); } });
}` },
{ id: "o09", lang: "ts", fn: "placeOrder", desc: "Prisma: create order then decrement stock, no $transaction", truth: ["partial-commit"], code: `
export async function placeOrder(prisma: any, userId: string, sku: string) {
  const order = await prisma.order.create({ data: { userId, sku } });
  await prisma.inventory.update({ where: { sku }, data: { count: { decrement: 1 } } });
  return order;
}` },
{ id: "o10", lang: "ts", fn: "placeOrderTx", desc: "Prisma $transaction", truth: [], code: `
export async function placeOrderTx(prisma: any, userId: string, sku: string) {
  return prisma.$transaction(async (tx: any) => {
    const order = await tx.order.create({ data: { userId, sku } });
    await tx.inventory.update({ where: { sku }, data: { count: { decrement: 1 } } });
    return order;
  });
}` },
{ id: "o11", lang: "ts", fn: "transfer", desc: "knex.transaction with trx", truth: [], code: `
export async function transfer(knex: any, from: number, to: number, amt: number) {
  await knex.transaction(async (trx: any) => {
    await trx("accounts").where({ id: from }).decrement("balance", amt);
    await trx("accounts").where({ id: to }).increment("balance", amt);
  });
}` },
{ id: "o12", lang: "ts", fn: "signup", desc: "knex two inserts, no transaction", truth: ["partial-commit"], code: `
export async function signup(knex: any, user: { email: string }) {
  const [id] = await knex("users").insert(user);
  await knex("audit_log").insert({ userId: id, action: "signup" });
  return id;
}` },
{ id: "o13", lang: "ts", fn: "settle", desc: "pg pool two writes, no BEGIN", truth: ["partial-commit"], code: `
export async function settle(pool: any, invoiceId: number) {
  await pool.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [invoiceId]);
  await pool.query("INSERT INTO ledger (invoice_id, kind) VALUES ($1, 'payment')", [invoiceId]);
}` },
{ id: "o14", lang: "ts", fn: "settleTx", desc: "pg client BEGIN/COMMIT", truth: [], code: `
export async function settleTx(pool: any, invoiceId: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [invoiceId]);
    await client.query("INSERT INTO ledger (invoice_id, kind) VALUES ($1, 'payment')", [invoiceId]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}` },
{ id: "o15", lang: "ts", fn: "refresh", desc: "class-free: lost update on module object? (exported fn reading state.x) -> no marker", truth: [], code: `
const state = { items: [] as string[] };
export async function refresh(load: () => Promise<string[]>) {
  const items = state.items;
  const fresh = await load();
  state.items = [...items, ...fresh];
}` },
{ id: "o16", lang: "ts", fn: "acquireAndRun", desc: "Redis lock spin with SET NX and sleep, no try", truth: [], code: `
export async function acquireAndRun(redis: any, key: string, work: () => Promise<void>) {
  const token = Math.random().toString(36);
  while (!(await redis.set(key, token, "NX", "PX", 10000))) {
    await new Promise((r) => setTimeout(r, 50));
  }
  try { await work(); } finally { if ((await redis.get(key)) === token) await redis.del(key); }
}` },
{ id: "o17", lang: "ts", fn: "isBusinessHours", desc: "luxon setZone", truth: [], code: `
import { DateTime } from "luxon";
export function isBusinessHours() {
  const now = DateTime.now().setZone("America/New_York");
  return now.weekday <= 5 && now.hour >= 9 && now.hour < 17;
}` },
{ id: "o18", lang: "ts", fn: "dayBucket", desc: "UTC getters only", truth: [], code: `
export function dayBucket(ts: number) {
  const d = new Date(ts);
  return \`\${d.getUTCFullYear()}-\${d.getUTCMonth() + 1}-\${d.getUTCDate()}\`;
}` },
{ id: "o19", lang: "ts", fn: "shouldSendDigest", desc: "local getHours for a 9am digest, no zone", truth: ["time-zone"], code: `
export function shouldSendDigest(lastSent: Date) {
  const now = new Date();
  return now.getHours() === 9 && now.toDateString() !== lastSent.toDateString();
}` },
{ id: "o20", lang: "ts", fn: "recentOrders", desc: "query cutoff 'last 24 h' from Date.now() - DAY (not a duration)", truth: [], code: `
const DAY = 24 * 60 * 60 * 1000;
export async function recentOrders(db: any) {
  return db.select("*").from("orders").where("created_at", ">", new Date(Date.now() - DAY));
}` },
{ id: "o21", lang: "ts", fn: "timed", desc: "elapsed via Date.now() for a metric", truth: ["clock-skew"], code: `
export async function timed<T>(name: string, f: () => Promise<T>, metrics: any) {
  const t0 = Date.now();
  try { return await f(); } finally { metrics.histogram(name, Date.now() - t0); }
}` },
{ id: "o22", lang: "ts", fn: "callWithRetry", desc: "retry, wait via util.promisify(setTimeout) named setTimeoutPromise", truth: ["no-overall-timeout"], code: `
import util from "node:util";
const setTimeoutPromise = util.promisify(setTimeout);
export async function callWithRetry(call: () => Promise<unknown>, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await setTimeoutPromise(100 * 2 ** i);
    try {
      return await call();
    } catch (e) {
      console.warn("attempt failed", i, e);
    }
  }
  throw new Error("exhausted");
}` },
{ id: "o23", lang: "ts", fn: "retryForever", desc: "while(true) retry, no wait, no deadline (true storm + no overall timeout)", truth: ["retry-storm", "no-overall-timeout"], code: `
export async function retryForever(send: (p: unknown) => Promise<void>, payload: unknown) {
  while (true) {
    try {
      await send(payload);
      return;
    } catch (e) {
      console.error("send failed, retrying", e);
    }
  }
}` },
{ id: "o24", lang: "ts", fn: "walk", desc: "cursor pagination; catch stops the walk via cursor = null (no retry)", truth: [], code: `
export async function walk(list: (c?: string) => Promise<{ items: string[]; next?: string }>) {
  const all: string[] = [];
  let cursor: string | undefined | null = undefined;
  while (cursor !== null) {
    try {
      const r = await list(cursor);
      all.push(...r.items);
      cursor = r.next ?? null;
    } catch (e) {
      console.error("listing failed, stopping", e);
      cursor = null;
    }
  }
  return all;
}` },
{ id: "o25", lang: "ts", fn: "paginate", desc: "async generator, catch returns", truth: [], code: `
export async function* paginate(fetchPage: (c?: string) => Promise<{ items: number[]; next?: string }>) {
  let cursor: string | undefined;
  do {
    try {
      const r = await fetchPage(cursor);
      yield* r.items;
      cursor = r.next;
    } catch (e) {
      console.error(e);
      return;
    }
  } while (cursor);
}` },
{ id: "o26", lang: "ts", fn: "Wallet", desc: "class: balance += await (race) and read-await-write of this.pending (lost update), with a redis lock key named 'lockKey' only in a string", truth: ["race", "lost-update"], code: `
export class Wallet {
  balance = 0;
  pending: string[] = [];
  async credit(getDelta: () => Promise<number>) {
    this.balance += await getDelta();
  }
  async enqueue(id: string, persist: (ids: string[]) => Promise<void>) {
    const before = this.pending;
    await persist([...before, id]);
    this.pending = [...before, id];
  }
}` },
{ id: "o27", lang: "ts", fn: "runJob", desc: "node-cron with timezone option; job body uses toISOString only", truth: [], code: `
import cron from "node-cron";
export function runJob(task: () => Promise<void>) {
  cron.schedule("0 2 * * *", async () => {
    console.log("nightly run", new Date().toISOString());
    await task();
  }, { timezone: "Europe/Berlin" });
}` },
{ id: "o28", lang: "ts", fn: "handleWebhook", desc: "webhook handler: Stripe event id dedupe via upsert, then ack", truth: [], code: `
export async function handleWebhook(db: any, evt: { id: string; type: string; data: unknown }, ack: () => Promise<void>) {
  const fresh = await db.processedEvents.upsert({ where: { id: evt.id }, create: { id: evt.id }, update: {} });
  await applyEvent(evt);
  await ack();
}
async function applyEvent(e: unknown) {}` },
// ---------------- Python ----------------
{ id: "o29", lang: "py", fn: "get_user", desc: "tenacity stop_after_attempt + wait_exponential, requests.get without timeout", truth: ["timeout"], code: `
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=0.5))
def get_user(uid):
    r = requests.get(f"https://api.example.com/users/{uid}")
    r.raise_for_status()
    return r.json()
` },
{ id: "o30", lang: "py", fn: "get_rates", desc: "backoff decorator max_time + requests timeout", truth: [], code: `
import backoff, requests

@backoff.on_exception(backoff.expo, requests.RequestException, max_time=60)
def get_rates(base):
    return requests.get("https://rates.example.com", params={"base": base}, timeout=10).json()
` },
{ id: "o31", lang: "py", fn: "download", desc: "manual retry with time.sleep backoff, requests.get without timeout", truth: ["timeout", "no-overall-timeout"], code: `
import time, requests

def download(url, attempts=3):
    for attempt in range(attempts):
        try:
            return requests.get(url).content
        except requests.RequestException as e:
            print("retry", attempt, e)
            time.sleep(2 ** attempt)
    raise RuntimeError("download failed")
` },
{ id: "o32", lang: "py", fn: "fetch_json", desc: "asyncio.timeout around an httpx retry loop", truth: [], code: `
import asyncio, httpx

async def fetch_json(url):
    async with asyncio.timeout(10):
        async with httpx.AsyncClient() as client:
            for attempt in range(3):
                try:
                    r = await client.get(url)
                    return r.json()
                except httpx.HTTPError:
                    await asyncio.sleep(0.5 * (attempt + 1))
` },
{ id: "o33", lang: "py", fn: "create_order", desc: "SQLAlchemy session add x2 + commit", truth: [], code: `
def create_order(session, user_id, sku):
    order = Order(user_id=user_id, sku=sku)
    session.add(order)
    session.add(AuditLog(user_id=user_id, action="order"))
    session.commit()
    return order.id
` },
{ id: "o34", lang: "py", fn: "close_account", desc: "sqlite3 autocommit (isolation_level=None), two writes", truth: ["partial-commit"], code: `
import sqlite3

def close_account(path, account_id):
    conn = sqlite3.connect(path, isolation_level=None)
    cur = conn.cursor()
    cur.execute("UPDATE accounts SET closed = 1 WHERE id = ?", (account_id,))
    cur.execute("DELETE FROM sessions WHERE account_id = ?", (account_id,))
    conn.close()
` },
{ id: "o35", lang: "py", fn: "notify", desc: "Celery task: self.retry with countdown, requests.post without timeout", truth: ["timeout"], code: `
import requests

@app.task(bind=True, max_retries=3)
def notify(self, url, payload):
    try:
        requests.post(url, json=payload)
    except requests.RequestException as exc:
        raise self.retry(exc=exc, countdown=60)
` },
{ id: "o36", lang: "py", fn: "sync_rates", desc: "Celery task with soft_time_limit/time_limit, while retry loop without wait", truth: ["retry-storm"], code: `
import logging
logger = logging.getLogger(__name__)

@app.task(soft_time_limit=60, time_limit=90)
def sync_rates(fetch):
    attempt = 0
    while attempt < 5:
        try:
            return fetch()
        except Exception as e:
            logger.warning("retry %s", e)
            attempt += 1
` },
{ id: "o37", lang: "py", fn: "on_message", desc: "pika consumer, ack after work, no dedupe", truth: ["duplicate-delivery"], code: `
import json

def on_message(ch, method, props, body):
    order = json.loads(body)
    charge_card(order["card"], order["amount"])
    ch.basic_ack(delivery_tag=method.delivery_tag)
` },
{ id: "o38", lang: "py", fn: "is_open_now", desc: "datetime.now() with ZoneInfo", truth: [], code: `
from datetime import datetime
from zoneinfo import ZoneInfo

def is_open_now():
    now = datetime.now(ZoneInfo("Europe/London"))
    return 9 <= now.hour < 17
` },
{ id: "o39", lang: "py", fn: "purge_old", desc: "cutoff time.time() - 7 days for a DELETE (not a duration)", truth: [], code: `
import time

def purge_old(conn):
    cutoff = time.time() - 7 * 86400
    with conn:
        conn.execute("DELETE FROM events WHERE ts < ?", (cutoff,))
` },
{ id: "o40", lang: "py", fn: "iter_pages", desc: "generator: transient error -> continue at once, forever", truth: ["retry-storm", "no-overall-timeout"], code: `
class TransientError(Exception):
    pass

def iter_pages(get_page):
    page = 1
    while True:
        try:
            data = get_page(page)
        except TransientError:
            continue
        if not data:
            return
        yield from data
        page += 1
` },
];
