import asyncio
import time


class RateLimiter:
    def __init__(self, rate: int, per: float = 1.0):
        self.rate = rate
        self.per = per
        self.tokens = rate
        self.last = time.monotonic()

    async def acquire(self):
        while True:
            now = time.monotonic()
            self.tokens = min(self.rate, self.tokens + (now - self.last) * self.rate / self.per)
            self.last = now
            if self.tokens >= 1:
                self.tokens -= 1
                return
            await asyncio.sleep((1 - self.tokens) * self.per / self.rate)


async def run_all(jobs, rate=2):
    limiter = RateLimiter(rate)
    results = []
    for job in jobs:
        await limiter.acquire()
        results.append(job * 2)
    return results
