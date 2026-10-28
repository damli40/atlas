# Loads ids concurrently; failures become "error: <message>" instead of stopping the rest.
import asyncio


async def load_all(load, ids):
    results = await asyncio.gather(*(load(i) for i in ids), return_exceptions=True)
    return [f"error: {r}" if isinstance(r, Exception) else r for r in results]


async def yield_once():
    await asyncio.sleep(0)
    return "after"
