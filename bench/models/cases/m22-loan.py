from decimal import Decimal, ROUND_HALF_UP


def schedule(principal, yearly_rate_pct, months):
    p = Decimal(str(principal))
    r = Decimal(str(yearly_rate_pct)) / Decimal(1200)
    if r == 0:
        pay = (p / months).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        pay = (p * r / (1 - (1 + r) ** -months)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    balance = p
    for _ in range(months):
        interest = (balance * r).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        balance = balance + interest - pay
    return {"payment": str(pay), "left_over": str(balance)}
