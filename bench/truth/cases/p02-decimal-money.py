# Invoice money with Decimal: prices go through str() so 19.99 stays 19.99.
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP


def invoice_total(lines, tax_rate):
    subtotal = sum((Decimal(str(line["price"])) * line["qty"] for line in lines), Decimal("0"))
    tax = (subtotal * Decimal(str(tax_rate))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"subtotal": str(subtotal), "tax": str(tax), "total": str(subtotal + tax)}


def round_cents_both(text):
    x = Decimal(text)
    cent = Decimal("0.01")
    return [str(x.quantize(cent, rounding=ROUND_HALF_UP)), str(x.quantize(cent, rounding=ROUND_HALF_EVEN))]


def raw_decimal():
    return Decimal("1.10")
