# The control's reference functions for Python "call-function" runs. Written by hand and shipped in the repo; no
# model wrote or chose them, and Atlas never changes them at run time.
#
# Plain words: before any verdict on pasted Python counts, Atlas runs THIS file through exactly the same sandbox,
# boot file and harness as the pasted code, with fixed experiments whose results are known in advance
# (runners/py/py-runner.ts, PY_CALL_CONTROL_CASES). Each function exercises one part of the machinery: JSON
# arguments in and out, a plain stand-in that returns then throws then runs out, an async stand-in with virtual
# delays, the code's own asyncio timers and time.time / perf_counter / datetime on the virtual clock, a call that
# can never settle, a raise, a call cut off by the watch limit, a value that is not JSON, timers after the call
# returned, a blocking time.sleep, asyncio.run inside a plain function, an integer JSON numbers cannot hold, and
# JavaScript's way of writing numbers. If any measured fact differs from the known answer, the control fails and
# every verdict on pasted Python is "can't check".
#
# It imports only standard-library modules Atlas loads before the code runs.

import asyncio
import datetime
import time


def combine(a, b):
    """JSON in, JSON out. Known answer: {"nested":{"none":null,"ok":true},"sum":42,"tags":["c","b","a"]} at 0 ms."""
    return {"sum": a["x"] + b, "tags": list(reversed(a["tags"])), "nested": {"ok": True, "none": None}}


def use_sync_stand_in(get):
    """A plain stand-in: returns, then raises a TypeError, then has no step left (throw_exhausted)."""
    first = get("a")
    second = "no throw"
    try:
        get("b")
    except Exception as e:
        second = "%s:%s:%s" % (isinstance(e, TypeError), type(e).__name__, e)
    third = "no throw"
    try:
        get("c")
    except Exception as e:
        third = type(e).__name__
    return {"first": first, "second": second, "third": third}


async def use_async_stand_in(fetch_rate):
    """An async stand-in with virtual delays, asyncio.sleep, and the virtual time.time / perf_counter / datetime."""
    t0 = time.time()
    p0 = time.perf_counter()
    a = await fetch_rate()  # step 1: returns 7 after 1500 ms
    b = "no throw"
    try:
        await fetch_rate()  # step 2: raises RangeError
    except Exception as e:
        b = type(e).__name__
    await asyncio.sleep(0.25)
    c = await fetch_rate()  # step 3: returns "c" after 100 ms
    d = await fetch_rate()  # repeat_last: step 3 again
    return {
        "a": a, "b": b, "c": c, "d": d,
        "elapsed": round((time.time() - t0) * 1000),
        "perf": round((time.perf_counter() - p0) * 1000),
        "year": datetime.datetime.now(datetime.timezone.utc).year,
    }


async def waits_forever(lookup):
    """Waits on a stand-in that never answers: nothing is left that could wake it."""
    return await lookup()


class ReferenceCheckError(Exception):
    pass


def throws_named(message):
    """Raises a named error with the given message."""
    raise ReferenceCheckError(message)


async def sleeps_long():
    """Waits 60 s of virtual time; with a 1000 ms watch limit it is still running when Atlas stops watching."""
    await asyncio.sleep(60)
    return "late"


def returns_tuple():
    """A tuple is not stored as JSON: returnedType is measured, returnedJson is not."""
    return (1, 2)


async def ticks():
    """A repeating asyncio timer: three ticks of 400 ms. Known answer: 3 at 1200 ms."""
    loop = asyncio.get_running_loop()
    done = loop.create_future()
    n = [0]

    def tick():
        n[0] += 1
        if n[0] == 3:
            done.set_result(None)
        else:
            loop.call_later(0.4, tick)

    loop.call_later(0.4, tick)
    await done
    return n[0]


async def later_call(ping):
    """Returns at once and calls the stand-in 500 ms later: returned at 0 ms, the stand-in was called once."""
    asyncio.get_running_loop().call_later(0.5, ping)
    return "now"


def blocking_sleep():
    """time.sleep moves the virtual clock: returned 2.5 at 2500 ms."""
    time.sleep(2.5)
    return time.monotonic()


def nested_run():
    """asyncio.run inside a plain function runs on the virtual clock too: returned at 750 ms."""
    async def inner():
        await asyncio.sleep(0.75)
        return "inner done"

    return asyncio.run(inner())


def big_int():
    """An integer beyond 2^53: JSON numbers in Atlas (JavaScript numbers) cannot hold it exactly."""
    return 2 ** 64


def js_numbers():
    """Numbers written the way JavaScript writes them."""
    return [0.1 + 0.2, 1e21, 5e-7, -0.0, 100.0, 2 ** 53]
