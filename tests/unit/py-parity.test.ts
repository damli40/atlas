// E2 parity. Part 1: ten ordinary Python functions (the same ten kinds E1's review ran in JavaScript) give the
// facts a real Python run gives. Every expected value was worked out by hand from the code (the times use
// fractions binary floats hold exactly, so there is no rounding to argue about). Part 2: a JavaScript function
// and a Python function that behave the same give IDENTICAL measured fields.

import { beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { exportedFunctions, makePastedTarget } from "../../src/pasted-code.ts";
import { pyTopLevelFunctions } from "../../src/pasted-python.ts";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner.ts";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner.ts";
import { findPython } from "../../runners/executor/sandbox-exec-python.ts";
import type { ArgSpec, Experiment, ExperimentShape, Run } from "../../src/types.ts";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
type StandIn = Extract<ArgSpec, { kind: "stand-in" }>;
const HAVE_PYTHON = findPython() !== null;

let pyControl: Run;
let jsControl: Run;
beforeAll(async () => {
  if (!HAVE_PYTHON) return;
  pyControl = (await runPyCallControl()).run;
  jsControl = (await runCallControl()).run;
}, 60_000);

function exp(source: string, language: "js" | "py", params: Partial<Call> & { exportName: string }): Experiment {
  const target = makePastedTarget(source, language);
  const names = (language === "py" ? pyTopLevelFunctions(source) : exportedFunctions(source)).map((e) => e.name);
  const g = gate({ shape: "call-function", args: [], ...params }, { exportNames: names });
  if (!g.allowed) throw new Error(`gate refused the test's own experiment: ${g.reason}`);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}
const runPy = (source: string, params: Partial<Call> & { exportName: string }) => runPyCallExperiment(exp(source, "py", params), pyControl);
const runJs = (source: string, params: Partial<Call> & { exportName: string }) => runCallExperiment(exp(source, "js", params), jsControl);
const json = (value: ArgSpec extends infer A ? (A extends { kind: "json"; value: infer V } ? V : never) : never): ArgSpec => ({ kind: "json", value });
const standIn = (name: string, calls: StandIn["calls"], over: Partial<StandIn> = {}): ArgSpec => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls, ...over });

describe.skipIf(!HAVE_PYTHON)("ten ordinary Python functions give correct facts", () => {
  it("both controls passed", () => {
    expect(pyControl.controlPassed).toBe(true);
    expect(jsControl.controlPassed).toBe(true);
  });

  it("1. debounce: three keystrokes 100 ms apart, one save 300 ms after the last", async () => {
    const src = `import asyncio

class Debouncer:
    def __init__(self, fn, wait):
        self.fn = fn
        self.wait = wait
        self.handle = None

    def __call__(self, *args):
        if self.handle is not None:
            self.handle.cancel()
        self.handle = asyncio.get_running_loop().call_later(self.wait, self.fn, *args)


async def autosave(save):
    d = Debouncer(save, 0.3)
    for text in ["h", "he", "hel"]:
        d(text)
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.5)
    return "typed"
`;
    const r = await runPy(src, { exportName: "autosave", args: [standIn("save", [{ do: "return", value: null }], { async: false })] });
    expect(r.result.measured).toEqual({ outcome: "returned", virtualMs: 800, returnedType: "string", returnedJson: '"typed"', "calls:save": 1 });
  });

  const retrySrc = `import asyncio

async def fetch_with_retry(fetch, attempts=4):
    delay = 0.125
    for i in range(attempts):
        try:
            return await fetch(i)
        except ConnectionError:
            if i == attempts - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2
`;
  it("2a. retry with backoff: fails twice, then answers after 50 ms", async () => {
    const r = await runPy(retrySrc, {
      exportName: "fetch_with_retry",
      args: [standIn("fetch", [{ do: "throw", errorName: "ConnectionError", message: "reset" }, { do: "throw", errorName: "ConnectionError", message: "reset" }, { do: "return", value: { ok: true }, afterMs: 50 }])],
    });
    expect(r.result.measured).toEqual({ outcome: "returned", virtualMs: 425, returnedType: "object", returnedJson: '{"ok":true}', "calls:fetch": 3 });
  });

  it("2b. retry with backoff: fails every time, raises the last ConnectionError after 125 + 250 + 500 ms", async () => {
    const r = await runPy(retrySrc, { exportName: "fetch_with_retry", args: [standIn("fetch", [{ do: "throw", errorName: "ConnectionError", message: "reset" }])] });
    expect(r.result.measured).toEqual({ outcome: "threw", virtualMs: 875, thrownType: "Error", thrownName: "ConnectionError", thrownMessage: "reset", "calls:fetch": 4 });
  });

  const parserSrc = `import re

def parse_amount(text):
    m = re.fullmatch(r"\\s*([\\d.]+),(\\d{2})\\s+([A-Z]{3})\\s*", text)
    if not m:
        raise ValueError(f"could not parse {text!r}")
    return {"amount": float(m.group(1).replace(".", "") + "." + m.group(2)), "currency": m.group(3)}
`;
  it("3. parser: European number format in, JSON out; bad text raises", async () => {
    const a = await runPy(parserSrc, { exportName: "parse_amount", args: [json("1.234,56 EUR")] });
    expect(a.result.measured.returnedJson).toBe('{"amount":1234.56,"currency":"EUR"}');
    const b = await runPy(parserSrc, { exportName: "parse_amount", args: [json("abc")] });
    expect(b.result.measured).toMatchObject({ outcome: "threw", thrownName: "ValueError", thrownMessage: "could not parse 'abc'" });
  });

  it("4. rate limiter: a token bucket on time.monotonic, six requests 250 ms apart", async () => {
    const src = `import time

class TokenBucket:
    def __init__(self, rate, burst):
        self.rate = rate
        self.burst = burst
        self.tokens = burst
        self.last = time.monotonic()

    def allow(self):
        now = time.monotonic()
        self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


def requests(n):
    bucket = TokenBucket(rate=2, burst=2)
    out = []
    for _ in range(n):
        out.append(bucket.allow())
        time.sleep(0.25)
    return out
`;
    const r = await runPy(src, { exportName: "requests", args: [json(6)] });
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 1500, returnedJson: "[true,true,true,false,true,false]" });
  });

  it("5. currency formatter", async () => {
    const src = `SYMBOLS = {"EUR": "\\u20ac", "USD": "$", "NGN": "\\u20a6"}

def format_cents(cents, currency):
    sign = "-" if cents < 0 else ""
    units, rest = divmod(abs(cents), 100)
    return f"{sign}{SYMBOLS.get(currency, currency + ' ')}{units:,}.{rest:02d}"
`;
    const a = await runPy(src, { exportName: "format_cents", args: [json(123456789), json("EUR")] });
    expect(a.result.measured.returnedJson).toBe(JSON.stringify("€1,234,567.89"));
    const b = await runPy(src, { exportName: "format_cents", args: [json(-5), json("CHF")] });
    expect(b.result.measured.returnedJson).toBe('"-CHF 0.05"');
  });

  it("6. deep merge", async () => {
    const src = `def deep_merge(a, b):
    out = dict(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out
`;
    const r = await runPy(src, { exportName: "deep_merge", args: [json({ a: { x: 1, y: [1] }, b: 2 }), json({ a: { y: [2], z: 3 }, c: null })] });
    expect(r.result.measured.returnedJson).toBe('{"a":{"x":1,"y":[2],"z":3},"b":2,"c":null}');
  });

  it("7. task pool: five jobs, at most two at a time, each 100 ms", async () => {
    const src = `import asyncio

async def run_all(work, jobs, limit):
    sem = asyncio.Semaphore(limit)

    async def one(j):
        async with sem:
            return await work(j)

    return await asyncio.gather(*(one(j) for j in jobs))
`;
    const r = await runPy(src, { exportName: "run_all", args: [standIn("work", [{ do: "return", value: "done", afterMs: 100 }]), json([1, 2, 3, 4, 5]), json(2)] });
    expect(r.result.measured).toEqual({ outcome: "returned", virtualMs: 300, returnedType: "array", returnedJson: '["done","done","done","done","done"]', "calls:work": 5 });
  });

  it("8. a class with methods; a bad quantity raises the code's own error", async () => {
    const src = `class QuantityError(ValueError):
    pass


class Cart:
    def __init__(self):
        self.lines = []

    def add(self, sku, qty, cents):
        if qty <= 0:
            raise QuantityError(f"{sku}: quantity must be positive, got {qty}")
        self.lines.append((sku, qty, cents))

    def total(self):
        return sum(q * c for _, q, c in self.lines)


def checkout(items):
    cart = Cart()
    for it in items:
        cart.add(it["sku"], it["qty"], it["cents"])
    return {"lines": len(cart.lines), "total": cart.total()}
`;
    const a = await runPy(src, { exportName: "checkout", args: [json([{ sku: "a", qty: 2, cents: 150 }, { sku: "b", qty: 1, cents: 999 }])] });
    expect(a.result.measured.returnedJson).toBe('{"lines":2,"total":1299}');
    const b = await runPy(src, { exportName: "checkout", args: [json([{ sku: "a", qty: 0, cents: 150 }])] });
    expect(b.result.measured).toMatchObject({ outcome: "threw", thrownName: "QuantityError", thrownMessage: "a: quantity must be positive, got 0" });
  });

  it("9. an async generator, consumed with async for", async () => {
    const src = `import asyncio

async def ticker(n):
    for i in range(n):
        await asyncio.sleep(0.25)
        yield i * i


async def collect(n):
    return [x async for x in ticker(n)]
`;
    const r = await runPy(src, { exportName: "collect", args: [json(4)] });
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 1000, returnedJson: "[0,1,4,9]" });
  });

  it("10. logging and print do not disturb the facts", async () => {
    const src = `import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(funcName)s %(message)s")
log = logging.getLogger("orders")


def process(order):
    total = sum(order["items"])
    print("processing", order["id"])
    log.info("order %s total %d", order["id"], total)
    if total > 100:
        log.warning("big order %s", order["id"])
    return {"id": order["id"], "total": total}
`;
    const r = await runPy(src, { exportName: "process", args: [json({ id: "A7", items: [60, 70] })] });
    expect(r.result.measured).toEqual({ outcome: "returned", virtualMs: 0, returnedType: "object", returnedJson: '{"id":"A7","total":130}' });
  });
});

describe.skipIf(!HAVE_PYTHON)("the same behaviour in JavaScript and in Python gives identical measured fields", () => {
  const pairs: { what: string; js: string; py: string; params: Partial<Call> & { exportName: string } }[] = [
    {
      what: "retry with backoff, a stand-in that fails twice then answers late",
      js: `export async function call(fetch) {
  let delay = 125;
  for (let i = 0; i < 4; i++) {
    try { return await fetch(i); }
    catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, delay)); delay *= 2; }
  }
}`,
      py: `import asyncio

async def call(fetch):
    delay = 0.125
    for i in range(4):
        try:
            return await fetch(i)
        except Exception:
            if i == 3:
                raise
            await asyncio.sleep(delay)
            delay *= 2
`,
      params: { exportName: "call", args: [standIn("fetch", [{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: { rate: 1.5, ok: true, tags: ["é", "x"] }, afterMs: 50 }])] },
    },
    {
      what: "the same retry when every call fails",
      js: `export async function call(fetch) {
  let delay = 125;
  for (let i = 0; i < 4; i++) {
    try { return await fetch(i); }
    catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, delay)); delay *= 2; }
  }
}`,
      py: `import asyncio

async def call(fetch):
    delay = 0.125
    for i in range(4):
        try:
            return await fetch(i)
        except Exception:
            if i == 3:
                raise
            await asyncio.sleep(delay)
            delay *= 2
`,
      params: { exportName: "call", args: [standIn("fetch", [{ do: "throw", errorName: "TypeError", message: "bad input" }])] },
    },
    {
      what: "a call that waits on a stand-in that never answers",
      js: "export async function call(lookup) { return await lookup(); }",
      py: "async def call(lookup):\n    return await lookup()\n",
      params: { exportName: "call", args: [standIn("lookup", [{ do: "never_settle" }])] },
    },
    {
      what: "a 10-minute wait with a 30 s watch limit",
      js: "export async function call() { await new Promise((r) => setTimeout(r, 600000)); return 1; }",
      py: "import asyncio\n\nasync def call():\n    await asyncio.sleep(600)\n    return 1\n",
      params: { exportName: "call" },
    },
    {
      what: "a value JSON cannot hold (NaN)",
      js: "export function call() { return NaN; }",
      py: "def call():\n    return float('nan')\n",
      params: { exportName: "call" },
    },
    {
      what: "plain JSON in and out, with JavaScript's number forms",
      js: "export function call(a) { return { sum: a.x + 0.25, big: 1e21, tiny: 5e-7, list: a.list.slice().reverse() }; }",
      py: "def call(a):\n    return {'sum': a['x'] + 0.25, 'big': 1e21, 'tiny': 5e-7, 'list': list(reversed(a['list']))}\n",
      params: { exportName: "call", args: [json({ x: 2, list: [1, "two", null] })] },
    },
    {
      what: "a sync stand-in counted after the call returned (timer 500 ms later)",
      js: "export function call(ping) { setTimeout(() => ping(), 500); return 'now'; }",
      py: "import asyncio\n\nasync def call(ping):\n    asyncio.get_running_loop().call_later(0.5, ping)\n    return 'now'\n",
      params: { exportName: "call", args: [standIn("ping", [{ do: "return", value: null }], { async: false })] },
    },
  ];
  for (const p of pairs) {
    it(p.what, async () => {
      const [js, py] = await Promise.all([runJs(p.js, p.params), runPy(p.py, p.params)]);
      expect(js.result.notMeasured.wholeRun).toBeUndefined();
      expect(Object.keys(js.result.measured).length).toBeGreaterThan(0);
      expect(py.result.measured).toEqual(js.result.measured);
    });
  }
});
