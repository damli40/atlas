# Numbers JSON cannot hold, or holds differently.
def nan_value():
    return float("nan")


def huge_int():
    return 2 ** 64


def neg_zero():
    return -0.0
