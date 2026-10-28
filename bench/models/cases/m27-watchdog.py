import asyncio


async def count_beats(beat, rounds):
    seen = 0
    for _ in range(rounds):
        try:
            await asyncio.wait_for(beat(), timeout=1.0)
            seen += 1
        except asyncio.TimeoutError:
            return {"beats": seen, "stopped": "missed a beat"}
    return {"beats": seen, "stopped": None}
