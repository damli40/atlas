import asyncio


async def first_ok(primary, backup):
    for name, source in (("primary", primary), ("backup", backup)):
        try:
            value = await asyncio.wait_for(source(), timeout=0.2)
            return {"from": name, "value": value}
        except (asyncio.TimeoutError, ConnectionError):
            continue
    raise LookupError("no source answered")
