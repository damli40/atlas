import time


def call_with_retries(op, tries):
    last = None
    for attempt in range(tries):
        try:
            return {"value": op(), "attempts": attempt + 1}
        except ValueError as e:
            last = e
            time.sleep(0.5 * (attempt + 1))
    return {"value": None, "attempts": tries, "error": str(last)}
