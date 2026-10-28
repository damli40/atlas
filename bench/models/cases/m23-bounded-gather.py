import asyncio


async def fetch_all(fetch, ids, limit):
    gate = asyncio.Semaphore(limit)
    order = []

    async def one(i):
        async with gate:
            value = await fetch(i)
            order.append(i)
            return value

    values = await asyncio.gather(*(one(i) for i in ids))
    return {"values": values, "finished": order}
