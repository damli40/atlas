def normalize_phone(raw):
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) != 11 or not digits.startswith("1"):
        raise ValueError(f"unexpected number: {digits}")
    return f"+{digits[0]} {digits[1:4]}-{digits[4:7]}-{digits[7:]}"
