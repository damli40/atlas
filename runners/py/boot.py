# Entry point inside the Python sandbox for a "call-function" run (runners/executor/sandbox-exec-python.ts).
#
# Plain words: this file does three things and keeps nothing at module level.
# 1. Reads the per-run result key from stdin, then closes stdin for good (fd 0). The key is never in argv, the
#    environment or a file, so the pasted code has no way to read it from the outside.
# 2. Loads runners/py/harness.py with exec() into a fresh dictionary that is NOT a module (it is never in
#    sys.modules), giving it its own private copy of the built-in functions, so the pasted code can neither find
#    it nor change the built-ins it uses.
# 3. Calls the harness. The key is passed as an argument: it lives only in this function's local variables and
#    the harness's, which nothing can read without a stack frame, and harness.py refuses every way to get one.
# The harness writes the one result line and ends the process itself; it never returns here.


def _boot():
    import posix
    import builtins

    chunks = []
    while len(chunks) < 16:
        b = posix.read(0, 4096)
        if not b:
            break
        chunks.append(b)
    posix.close(0)
    key = b"".join(chunks).strip().decode("ascii", "replace")
    chunks = None
    with open("harness.py", "rb") as f:
        source = f.read()
    namespace = {"__name__": "atlas_harness", "__builtins__": dict(builtins.__dict__)}
    exec(compile(source, "harness.py", "exec"), namespace)
    run = namespace.pop("main")
    run(key)


_boot()
