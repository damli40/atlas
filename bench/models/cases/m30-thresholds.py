from bisect import bisect_left, bisect_right


def band(limits, x):
    return {"left": bisect_left(limits, x), "right": bisect_right(limits, x)}
