def parse_kv(text):
    out = {}
    for part in text.split(";"):
        part = part.strip()
        if not part:
            continue
        key, sep, value = part.partition("=")
        key = key.strip()
        if not sep:
            out[key] = None
        elif value.strip().isdigit():
            out[key] = int(value)
        else:
            out[key] = value.strip()
    return out
