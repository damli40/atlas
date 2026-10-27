# A blocking throttle: at most per_second calls a second, spaced evenly, using time.sleep.
import time


def throttled_calls(send, n, per_second):
    interval = 1.0 / per_second
    next_at = time.monotonic()
    stamps = []
    for i in range(n):
        now = time.monotonic()
        if now < next_at:
            time.sleep(next_at - now)
        send(i)
        stamps.append(round(time.monotonic() * 1000))
        next_at = max(next_at, time.monotonic()) + interval
    return stamps


def now_epoch():
    return time.time()
