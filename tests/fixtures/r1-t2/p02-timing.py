# Blocking sleep while an asyncio task is pending, wait_for, and CPU timing.
import asyncio
import time


async def block_then_await(fetch):
    t0 = time.monotonic()
    task = asyncio.create_task(fetch())
    await asyncio.sleep(0)
    time.sleep(0.5)
    v = await task
    return [v, round((time.monotonic() - t0) * 1000)]


async def deadline(fetch):
    try:
        return await asyncio.wait_for(fetch(), 0.1)
    except TimeoutError:
        return "timed out"


def cpu_elapsed():
    t0 = time.perf_counter()
    x = 0
    for i in range(3_000_000):
        x = (x + i) % 1000003
    return time.perf_counter() - t0 > 0.001
