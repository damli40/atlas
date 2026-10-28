class OutOfStock(Exception):
    pass


def apply_orders(stock, orders):
    left = dict(stock)
    for item, qty in orders:
        have = left.get(item, 0)
        if qty > have:
            raise OutOfStock(f"{item}: wanted {qty}, have {have}")
        left[item] = have - qty
    return {k: v for k, v in left.items() if v > 0}
