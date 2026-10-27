# A trailing-edge debounce on asyncio: each call cancels the pending one.
import asyncio


class Debouncer:
    def __init__(self, fn, wait):
        self.fn = fn
        self.wait = wait
        self._task = None

    def __call__(self, *args):
        if self._task is not None:
            self._task.cancel()
        self._task = asyncio.get_running_loop().create_task(self._later(args))

    async def _later(self, args):
        await asyncio.sleep(self.wait)
        self.fn(*args)


async def type_then_wait(on_search):
    search = Debouncer(on_search, 0.2)
    search("a")
    await asyncio.sleep(0.05)
    search("ab")
    await asyncio.sleep(0.05)
    search("abc")
    await asyncio.sleep(0.5)
    return "done"
