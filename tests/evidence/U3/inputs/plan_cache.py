import time

_cache = {}


def cached(ttl_seconds):
    def wrap(fn):
        def inner(user_id):
            now = time.time()
            hit = _cache.get(user_id)
            if hit is not None and now - hit[0] < ttl_seconds:
                return hit[1]
            value = fn(user_id)
            _cache[user_id] = (now, value)
            return value
        return inner
    return wrap


@cached(ttl_seconds=60)
def get_user_plan(user_id):
    time.sleep(0.5)  # the database is slow
    return "pro" if user_id % 2 else "free"
