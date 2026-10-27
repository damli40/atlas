# Parses "1h30m15s" into seconds. Anything else is a ValueError.
import re

_UNITS = {"h": 3600, "m": 60, "s": 1}


def parse_duration(text):
    if not re.fullmatch(r"(\d+[hms])+", text):
        raise ValueError(f"not a duration: {text!r}")
    return sum(int(n) * _UNITS[u] for n, u in re.findall(r"(\d+)([hms])", text))
