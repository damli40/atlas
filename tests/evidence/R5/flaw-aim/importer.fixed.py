# Import customer records in batches, skipping duplicates.
from typing import Callable, Iterable


def normalize(record: dict) -> dict:
    email = record["email"].strip().lower()
    return {"email": email, "name": record.get("name", "").strip()}


def dedupe(records: Iterable[dict], seen: set = None) -> list:
    seen = set() if seen is None else seen
    unique = []
    for record in records:
        if record["email"] in seen:
            continue
        seen.add(record["email"])
        unique.append(record)
    return unique


def chunks(items: list, size: int) -> list:
    return [items[i : i + size] for i in range(0, len(items), size)]


def write_batch(batch: list, sink: Callable[[list], int]) -> int:
    if not batch:
        return 0
    return sink(batch)


def run_import(raw: list, sink: Callable[[list], int], batch_size: int = 2) -> int:
    cleaned = [normalize(r) for r in raw]
    unique = dedupe(cleaned)
    written = 0
    for batch in chunks(unique, batch_size):
        written += write_batch(batch, sink)
    return written


def import_twice(raw: list, sink: Callable[[list], int]) -> tuple:
    first = run_import(raw, sink)
    second = run_import(raw, sink)
    return first, second
