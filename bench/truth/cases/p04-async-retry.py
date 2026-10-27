# Retries on ConnectionError with backoff (0.1 s, then 0.2 s, ...). Other errors go straight through.
import asyncio


async def fetch_with_retry(fetch, attempts):
    delay = 0.1
    for i in range(attempts):
        try:
            return await fetch()
        except ConnectionError:
            if i == attempts - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2
