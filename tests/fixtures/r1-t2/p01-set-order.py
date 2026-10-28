# A set of strings turned into a list: its order depends on the process's hash seed.
def fruit_list():
    return list({"apple", "banana", "cherry", "date", "elder", "fig", "grape"})


def int_keys():
    return {1: "a", True: "b", "1": "c"}


def tuple_inside():
    return [("a", 1)]


def float_two():
    return 2.0
