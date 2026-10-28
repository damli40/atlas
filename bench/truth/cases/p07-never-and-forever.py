# A future nobody resolves, and a poll that never stops.
import asyncio


async def wait_for_signal(register):
    fut = asyncio.get_running_loop().create_future()
    register("ready")
    return await fut


async def poll_forever(check):
    while True:
        await check()
        await asyncio.sleep(2)
