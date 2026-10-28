# Run-length encoding with itertools.groupby.
from itertools import groupby


def run_length(s):
    return [[ch, len(list(g))] for ch, g in groupby(s)]
