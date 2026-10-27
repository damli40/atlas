import re
from collections import Counter


def top_words(text, k):
    words = re.findall(r"[a-z']+", text.lower())
    counts = Counter(words)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [[w, c] for w, c in ranked[:k]]
