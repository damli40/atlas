# Adds numbers on threads.
import threading


def parallel_sum(nums):
    total = [0]
    lock = threading.Lock()

    def add(x):
        with lock:
            total[0] += x

    threads = [threading.Thread(target=add, args=(n,)) for n in nums]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return total[0]
