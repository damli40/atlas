# The trusted part of Atlas's Python "call-function" harness. It calls ONE top-level function of pasted Python
# code, on a VIRTUAL clock, and writes down what happened in one signed line. It runs inside the OS sandbox
# (runners/executor/sandbox-exec-python.ts), in the same process as the pasted code.
#
# ---- Why the result cannot be forged, in plain words ----
#
# The JavaScript harness (runners/ts/call-worker.ts) keeps a per-run key in a closure the code cannot reach and
# signs its result with it. Python has no such privacy: from any function object the code can read and rewrite
# that function's module globals (fn.__globals__) and closure cells (fn.__closure__[i].cell_contents), and none
# of those reads raises an audit event (checked on CPython 3.14). gc.get_objects() and stack frames reach
# everything else.
#
# We considered a design with no secret in this process: a supervisor (the Node parent) that owns the clock and
# the stand-in counts and reads reports from the code process over a pipe. It does not remove the problem. How
# the call ENDED (returned what, threw what, when) only exists inside the process that runs the function, so the
# report of it must come from here, and the pasted code can write to any pipe this process holds (os.write on a
# guessed fd number). Whatever the parent receives, the code could have written instead. So some in-process
# boundary is unavoidable; the question is only how small it can be made.
#
# The boundary chosen:
# 1. The key and everything that decides a measured fact live ONLY in the local variables of running functions
#    in this file (main(), its run loop, and one generator per stand-in). Nothing in this file is ever handed to
#    the code, stored in a module, or reachable from sys.modules. In CPython the only ways into another
#    function's local variables are stack frames (sys._getframe, sys._current_frames, traceback.tb_frame,
#    generator gi_frame, coroutine cr_frame, async-generator ag_frame, trace/profile hooks, signal handlers) and
#    the garbage collector's object lists (gc.get_objects / get_referrers / get_referents).
# 2. An audit hook (PEP 578), added before the code exists, refuses every one of those routes. Python offers no
#    way to remove an audit hook from Python code. Signal handlers raise no audit event, so the signal functions
#    are replaced instead, and so are the functions that would hand back fresh originals (_imp.create_builtin
#    and friends). Any refused route makes the whole run "can't check".
# 3. The functions the code IS handed (stand-ins, time.time, the event loop) live in runners/py/exposed.py,
#    which is assumed hostile. Changing them only changes what the code itself sees (like monkeypatching the real
#    thing), or pushes the run to "can't check". Each stand-in's script and call count live in a generator here;
#    the code gets only that generator's `send`, so it can call the stand-in but never rewind or recount it.
# 4. The returned value is read only if it is made of exact built-in types (dict, list, str, int, float, bool,
#    None), whose reading runs no code; anything else (a dict subclass, a float subclass, an object with __eq__
#    or __repr__ overrides) is "not plain JSON". The line is built by this file's own JSON writer, with this file's
#    own copy of the built-ins (boot.py), so patching json, builtins, sys.stdout or the code's own modules cannot
#    change what is signed.
# 5. The parent (runners/py/py-runner.ts, through the same check as JavaScript) accepts exactly one line signed
#    with HMAC-SHA256 under the per-run key; an unsigned, wrongly signed or second line means "tampering".
#
# What this does NOT cover: a bug in CPython itself that lets pure Python read arbitrary memory. Code objects and
# marshal data (the usual way to build such a bug) are refused, but CPython has known crashers. See
# tests/evidence/E2/README.md.
#
# ---- How a call is measured ----
# - Plain functions are called directly (no event loop is running, so asyncio.run inside them works). If the call
#   returns a coroutine, it is run as a task on Atlas's virtual event loop, which this file drives itself: run
#   every ready callback; when none is left, jump the clock to the next timer; stop at the watch limit.
# - "never_settled": the task is not done, no callback is ready and no timer is left. "still_running": the next
#   timer, or a blocking time.sleep, is past the watch limit.
# - After the call settles, leftover timers keep running up to the watch limit (so a stand-in called later is
#   counted), exactly as in the JavaScript harness.


def main(key_text):
    # ---------------------------------------------------------------------------------------------------------
    # 0. Capture everything used after the code exists (C objects only; the built-ins here are boot.py's private
    #    copy, so later changes to the builtins module do not reach this file).
    import posix
    import _sha2
    import _heapq
    import _asyncio
    import json as _json
    import sys as _sys
    import gc as _gc
    import atexit as _atexit
    import builtins as _bi
    import types as _types
    import posixpath as _pp
    import time as _tm
    import _random
    import random as _rnd
    import locale as _locale
    import ast as _ast

    write = posix.write
    hard_exit = posix._exit
    sha256 = _sha2.sha256
    heappop = _heapq.heappop
    TaskCtor = _asyncio.Task
    set_running_loop = _asyncio._set_running_loop
    CoroType = _types.CoroutineType
    type_name = type.__dict__["__name__"].__get__
    exc_context = BaseException.__dict__["__context__"].__get__
    exc_cause = BaseException.__dict__["__cause__"].__get__
    os_errno = OSError.__dict__["errno"].__get__
    gc_callbacks = _gc.callbacks
    gc_garbage = _gc.garbage
    gc_get_debug = _gc.get_debug
    set_recursion_limit = _sys.setrecursionlimit
    base_recursion_limit = max(_sys.getrecursionlimit(), 1000)
    gc_isenabled = _gc.isenabled
    atexit_count = _atexit._ncallbacks
    stdlib_names = frozenset(_sys.stdlib_module_names)
    stdlib_dir = _pp.dirname(_pp.dirname(_json.__file__))
    INF = float("inf")
    # R1 (D36): real CPU time (exposed.py later refuses time.process_time to the code), the real localtime (to check
    # the pinned time zone), and the module-wide random generator's state, read through C so the code cannot fake it.
    cpu_clock = _tm.process_time
    real_localtime = _tm.localtime
    real_tzname = tuple(_tm.tzname)
    rand_getstate = _random.Random.getstate
    rand_inst = _rnd._inst
    locale_query = _locale.setlocale
    LOCALE_CATEGORIES = (_locale.LC_NUMERIC, _locale.LC_TIME, _locale.LC_COLLATE, _locale.LC_MONETARY)

    def die(why):
        write(2, ("atlas harness: " + why + "\n").encode("utf-8", "replace"))
        hard_exit(2)

    hexdigits = "0123456789abcdef"
    if type(key_text) is not str or len(key_text) != 64 or any(c not in hexdigits for c in key_text):
        die("started without a valid result key")
    # HMAC-SHA256 with the key's 64 ASCII characters as the key bytes (the same as Node's createHmac with the
    # hex text, which runners/ts/call-runner.ts resultMac uses to check the line).
    K = key_text.encode("ascii")
    ipad = bytes([b ^ 0x36 for b in K])
    opad = bytes([b ^ 0x5C for b in K])
    K = None
    key_text = None

    def sign(body):
        return sha256(opad + sha256(ipad + body).digest()).hexdigest()

    # ---------------------------------------------------------------------------------------------------------
    # 1. Read what to do (before the code exists).
    with open("request.json", "rb") as f:
        req = _json.loads(f.read().decode("utf-8"))
    with open("target.py", "rb") as f:
        target_bytes = f.read()
    with open("exposed.py", "rb") as f:
        exposed_source = f.read()
    words = req["words"]
    sandbox_dir = req.get("sandboxDir") or ""
    seed_text = req.get("seed")
    pins = req.get("pins") or {}
    py_version = "%d.%d.%d" % (_sys.version_info[0], _sys.version_info[1], _sys.version_info[2])
    py_impl = _sys.implementation.name

    # ---------------------------------------------------------------------------------------------------------
    # 2. JSON written by this file only, in the exact form JavaScript's JSON.stringify writes it.

    def utf16_len(s):
        n = len(s)
        for ch in s:
            if ord(ch) > 0xFFFF:
                n += 1
        return n

    def js_string(s, ascii_only):
        out = ['"']
        i = 0
        n = len(s)
        while i < n:
            ch = s[i]
            o = ord(ch)
            if ch == '"':
                out.append('\\"')
            elif ch == "\\":
                out.append("\\\\")
            elif o < 0x20:
                esc = {8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r"}.get(o)
                out.append(esc if esc is not None else "\\u%04x" % o)
            elif 0xD800 <= o <= 0xDBFF and i + 1 < n and 0xDC00 <= ord(s[i + 1]) <= 0xDFFF:
                # A surrogate pair stored as two code points: JavaScript sees one character.
                if ascii_only:
                    out.append("\\u%04x\\u%04x" % (o, ord(s[i + 1])))
                else:
                    out.append(chr(0x10000 + ((o - 0xD800) << 10) + (ord(s[i + 1]) - 0xDC00)))
                i += 1
            elif 0xD800 <= o <= 0xDFFF:
                out.append("\\u%04x" % o)
            elif ascii_only and o > 0x7E:
                if o > 0xFFFF:
                    o -= 0x10000
                    out.append("\\u%04x\\u%04x" % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
                else:
                    out.append("\\u%04x" % o)
            else:
                out.append(ch)
            i += 1
        out.append('"')
        return "".join(out)

    def js_number(x):
        """A finite float, or an int within +-2^53, as JavaScript's Number#toString writes it."""
        if type(x) is int:
            return str(x)
        if x == 0:
            return "0"
        if x < 0:
            return "-" + js_number(-x)
        r = repr(x)
        if "e" in r:
            mant, exp = r.split("e")
            e10 = int(exp)
        else:
            mant, e10 = r, 0
        if "." in mant:
            ip, fp = mant.split(".")
        else:
            ip, fp = mant, ""
        s = ip + fp
        point = len(ip) + e10
        stripped = s.lstrip("0")
        point -= len(s) - len(stripped)
        s = stripped.rstrip("0")
        k = len(s)
        n = point
        if k <= n <= 21:
            return s + "0" * (n - k)
        if 0 < n <= 21:
            return s[:n] + "." + s[n:]
        if -6 < n <= 0:
            return "0." + "0" * (-n) + s
        e = n - 1
        sign_ = "+" if e >= 0 else "-"
        if k == 1:
            return s + "e" + sign_ + str(abs(e))
        return s[0] + "." + s[1:] + "e" + sign_ + str(abs(e))

    def utf16_key(k):
        """JavaScript's sort order (UTF-16 code units), by arithmetic: no codec lookup, which would run Python
        code the pasted code can patch (encodings.search_function)."""
        units = []
        for ch in k:
            o = ord(ch)
            if o > 0xFFFF:
                o -= 0x10000
                units.append(0xD800 + (o >> 10))
                units.append(0xDC00 + (o & 0x3FF))
            else:
                units.append(o)
        return tuple(units)

    def dumps(v):
        """This file's own payload writer: every value here was built by this file (exact types only)."""
        t = type(v)
        if v is None:
            return "null"
        if t is bool:
            return "true" if v else "false"
        if t is int or t is float:
            if t is float and (v != v or v == INF or v == -INF):
                return "null"
            return js_number(v)
        if t is str:
            return js_string(v, True)
        if t is list:
            return "[" + ",".join([dumps(x) for x in v]) + "]"
        if t is dict:
            keys = sorted([k for k in v if type(k) is str], key=utf16_key)
            return "{" + ",".join([js_string(k, True) + ":" + dumps(v[k]) for k in keys]) + "}"
        return js_string("<not JSON>", True)

    # ---------------------------------------------------------------------------------------------------------
    # 3. Reading what the code produced, without running its code (the returned value) or with care (a message).

    MAX_JSON_DEPTH = 100
    RETURNED_MAX = 2048
    NAME_MAX = 200
    MESSAGE_MAX = 500
    MAX_SAFE = 2 ** 53
    NotJson = type("AtlasNotJson", (Exception,), {})

    def clean(s, limit=80):
        """A detail from the code, safe to show inside a sentence: cut, with hidden characters made visible."""
        if type(s) is not str:
            return "a value Atlas could not read"
        if len(s) > limit:
            s = s[: limit - 1] + "…"
        out = []
        for ch in s:
            o = ord(ch)
            if o < 0x20 or 0x7F <= o <= 0x9F or o in (0x061C, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2028,
                                                      0x2029, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xFEFF) \
                    or 0x202A <= o <= 0x202E or 0x2066 <= o <= 0x2069 or 0xD800 <= o <= 0xDFFF:
                out.append("\\u%04x" % o)
            else:
                out.append(ch)
        return "".join(out)

    def redact(s):
        if sandbox_dir and len(sandbox_dir) > 3:
            s = s.replace(sandbox_dir, "<sandbox>")
        return s

    def safe_class_name(t):
        try:
            n = type_name(t)
        except BaseException:
            return None
        if type(n) is not str or not n or len(n) > 40 or not (n[0].isalpha() or n[0] == "_"):
            return None
        for ch in n:
            if not (ch.isascii() and (ch.isalnum() or ch == "_")):
                return None
        return n

    def type_of(v):
        """The type Atlas reports, in the same words as the JavaScript harness where the types match."""
        t = type(v)
        if v is None:
            return "null"
        if t is bool:
            return "boolean"
        if t is int:
            return "number" if -MAX_SAFE <= v <= MAX_SAFE else "number (an integer beyond 2^53)"
        if t is float:
            if v != v:
                return "number (NaN)"
            if v == INF:
                return "number (Infinity)"
            if v == -INF:
                return "number (-Infinity)"
            return "number"
        if t is str:
            return "string"
        if t is list:
            return "array"
        if t is dict:
            return "object"
        for base, word in ((tuple, "tuple"), (set, "set"), (frozenset, "frozenset"), (bytes, "bytes"),
                           (bytearray, "bytearray"), (CoroType, "coroutine"), (_types.GeneratorType, "generator"),
                           (_types.FunctionType, "function"), (_types.BuiltinFunctionType, "function"),
                           (_types.MethodType, "function"), (_types.ModuleType, "object (module)")):
            if t is base:
                return word
        if t is type or isinstance(t, type) and t is not type and issubclass(t, type):
            return "class"
        n = safe_class_name(t)
        return "object (%s)" % n if n else "object (not a plain object)"

    def canonical(v, depth, seen, budget):
        if budget[0] < 0:
            raise NotJson("", "too big")
        t = type(v)
        if v is None:
            return "null"
        if t is bool:
            return "true" if v else "false"
        if t is int:
            if not (-MAX_SAFE <= v <= MAX_SAFE):
                raise NotJson(type_of(v), "it is an integer beyond 2^53, which Atlas's JSON numbers (JavaScript numbers) cannot hold exactly")
            return js_number(v)
        if t is float:
            if v != v or v == INF or v == -INF:
                word = "NaN" if v != v else ("Infinity" if v > 0 else "-Infinity")
                raise NotJson(type_of(v), "it is %s, which JSON cannot hold" % word)
            return js_number(v)
        if t is str:
            if len(v) > budget[0] or utf16_len(v) > budget[0]:
                raise NotJson("string", "too big")
            s = js_string(v, False)
            budget[0] -= utf16_len(s)
            return s
        if t is not list and t is not dict:
            word = type_of(v)
            if word == "tuple":
                raise NotJson(word, "it is a tuple, which Atlas does not store as JSON (only lists are)")
            if word in ("set", "frozenset"):
                raise NotJson(word, "it is a set, which JSON cannot hold")
            if word in ("bytes", "bytearray"):
                raise NotJson(word, "it is bytes, which JSON cannot hold")
            if word == "function":
                raise NotJson(word, "it is a function, which JSON cannot hold")
            if word == "class":
                raise NotJson(word, "it is a class, which JSON cannot hold")
            if word in ("coroutine", "generator"):
                raise NotJson(word, "it is a %s, which JSON cannot hold" % word)
            if isinstance(v, (dict, list, str, int, float)):
                raise NotJson(word, "it is not a plain object (it has its own class)")
            raise NotJson(word, "it is not a plain object (it has its own class)")
        if depth >= MAX_JSON_DEPTH:
            raise NotJson(type_of(v), "it is nested deeper than %d levels" % MAX_JSON_DEPTH)
        if len(v) > budget[0]:
            raise NotJson(type_of(v), "too big")  # each item costs at least one character: no need to read them
        ident = id(v)
        if ident in seen:
            raise NotJson(type_of(v), "it contains a cycle (an object inside itself)")
        seen.add(ident)
        if t is list:
            parts = []
            i = 0
            for item in list.__iter__(v):
                try:
                    parts.append(canonical(item, depth + 1, seen, budget))
                except NotJson as e:
                    raise inside(e, "[%d]" % i) from None
                budget[0] -= 1
                i += 1
            out = "[" + ",".join(parts) + "]"
        else:
            names = []
            for k in dict.__iter__(v):
                if type(k) is not str:
                    raise NotJson("object", "it has a key that is not text, which JSON would change")
                names.append(k)
            names = sorted(names, key=utf16_key)
            parts = []
            for k in names:
                ks = js_string(k, False)
                budget[0] -= utf16_len(ks) + 2
                try:
                    parts.append(ks + ":" + canonical(dict.__getitem__(v, k), depth + 1, seen, budget))
                except NotJson as e:
                    raise inside(e, key_step(k)) from None
            out = "{" + ",".join(parts) + "}"
        seen.discard(ident)
        if budget[0] < 0:
            raise NotJson(type_of(v), "too big")
        return out

    def inside(e, step):
        """R1 (review B-1): one more step of where inside the returned value the problem is (never for "too big")."""
        a = e.args
        kind = a[0] if len(a) > 0 else ""
        reason = a[1] if len(a) > 1 else ""
        path = a[2] if len(a) > 2 else ""
        if reason == "too big" or len(path) >= 80:
            return e
        return NotJson(kind, reason, step + path)

    def key_step(k):
        if len(k) <= 30 and str.isidentifier(k):
            return "." + k
        return "[" + js_string(k if len(k) <= 30 else k[:29] + "…", True) + "]"

    def classify_returned(v):
        """{"json", "type"} or {"type", "why"}, as runners/ts/call-harness.ts classifyReturned."""
        try:
            j = canonical(v, 0, set(), [RETURNED_MAX])
            n = utf16_len(j)
            if n > RETURNED_MAX:
                return {"type": type_of(v), "why": "it is %d characters as JSON; Atlas stores at most %d" % (n, RETURNED_MAX)}
            return {"json": j, "type": type_of(v)}
        except NotJson as e:
            kind = e.args[0] if len(e.args) > 0 else ""
            reason = e.args[1] if len(e.args) > 1 else "it is not plain JSON"
            if reason == "too big":
                size = " (%d characters of text)" % utf16_len(v) if type(v) is str and len(v) < 10_000_000 else ""
                return {"type": type_of(v), "why": "it is longer than %d characters as JSON%s; Atlas stores at most %d" % (RETURNED_MAX, size, RETURNED_MAX)}
            path = e.args[2] if len(e.args) > 2 else ""
            if path:
                # R1 (review B-1): the type is always the RETURNED value's own (a list holding a tuple is an array);
                # the item inside that JSON cannot hold is named in the reason, with where it is.
                return {"type": type_of(v), "why": "an item inside it (at %s%s) is not plain JSON: %s" % (path, (", " + kind) if kind else "", reason)}
            return {"type": kind or type_of(v), "why": reason}
        except RecursionError:
            return {"type": type_of(v), "why": "it is nested deeper than %d levels" % MAX_JSON_DEPTH}

    def describe_exc(e):
        try:
            n = type_name(type(e))
        except BaseException:
            n = "an error"
        try:
            m = str(e)
        except BaseException:
            m = None
        if type(m) is str and m:
            return clean(redact("%s: %s" % (n, m)), 160)
        return clean(n, 60)

    def classify_thrown(e):
        out = {"type": "Error"}
        try:
            n = type_name(type(e))
        except BaseException:
            n = None
        if type(n) is str and len(n) <= NAME_MAX:
            out["name"] = n
        else:
            out["nameWhy"] = "the thrown value's name is not text Atlas can store"
        try:
            m = str(e)
        except BaseException as err:
            out["messageWhy"] = "reading the thrown value's message threw " + describe_exc(err)
            return out
        if type(m) is not str:
            out["messageWhy"] = "the thrown value's message is not text (%s)" % type_of(m)
            return out
        m = redact(m)
        if utf16_len(m) > MESSAGE_MAX:
            out["messageWhy"] = "the thrown value's message is %d characters; Atlas stores at most %d" % (utf16_len(m), MESSAGE_MAX)
        else:
            out["message"] = m
        return out

    def is_access_denied(e):
        """The sandbox's refusal: an OSError carrying EPERM or EACCES, here or a few causes down."""
        for _ in range(5):
            if e is None:
                return False
            try:
                if isinstance(e, OSError) and os_errno(e) in (1, 13):
                    return True
                nxt = exc_cause(e)
                if nxt is None:
                    nxt = exc_context(e)
            except BaseException:
                return False
            e = nxt
        return False

    # ---------------------------------------------------------------------------------------------------------
    # 4. Whole-run reasons: the first one wins and nothing the code does can clear it.

    whole = [None]

    def word(key, **parts):
        s = words[key]
        for k in parts:
            s = s.replace("{" + k + "}", parts[k])
        return s

    def mark(reason):
        if whole[0] is None:
            whole[0] = reason

    def mark_code(code, what):
        what = clean(what)
        if code == "access":
            mark(word("access", what=what))
        elif code == "process":
            mark(word("process", what=what))
        elif code == "realtime":
            mark(word("realtime", what=what))
        elif code == "internals":
            mark(word("internals", what=what))
        elif code == "uncaught":
            mark(word("uncaught", what=what))
        elif code == "nested_hang":
            mark(word("nestedHang"))
        elif code == "needs_package":
            if what == "relative":
                mark(word("needsRelative"))
            elif what == "runtime":
                mark(word("needsRuntime"))
            else:
                mark(word("needsPackage", what=what))
        elif code == "stdlib":
            mark(word("stdlibNotLoaded", what=what))
        else:
            mark(word("tamper", what="an unknown Atlas signal"))

    def tamper(what):
        mark(word("tamper", what=what))

    # ---------------------------------------------------------------------------------------------------------
    # 5. Load Atlas's exposed half, preload the standard library, and close the routes that raise no audit event.

    PRELOAD = (
        "abc", "annotationlib", "array", "ast", "asyncio", "base64", "binascii", "bisect", "calendar", "cmath",
        "codecs", "collections", "collections.abc", "colorsys", "contextlib", "contextvars", "copy", "copyreg", "csv",
        "dataclasses", "datetime", "decimal", "difflib", "dis", "enum", "errno", "fnmatch", "fractions", "functools",
        "graphlib", "hashlib", "heapq", "hmac", "html", "html.parser", "inspect", "io", "ipaddress", "itertools",
        "json", "keyword", "linecache", "locale", "logging", "math", "numbers", "operator", "pathlib", "pickle",
        "pprint", "queue", "random", "re", "reprlib", "secrets", "shlex", "signal", "statistics", "string",
        "struct", "textwrap", "threading", "time", "token", "tokenize", "traceback", "types", "typing",
        "unicodedata", "urllib", "urllib.parse", "uuid", "warnings", "weakref", "zlib", "_strptime", "_sha1",
        "_sha2", "_sha3", "_md5", "_blake2", "_pydecimal", "_datetime", "_bisect", "_heapq", "_random", "_json",
        "_pickle", "_compat_pickle", "_struct", "_statistics", "_csv", "encodings.ascii", "encodings.latin_1",
        "encodings.utf_8", "encodings.utf_16", "encodings.utf_16_le", "encodings.utf_16_be", "encodings.utf_32",
        "encodings.cp1252", "encodings.unicode_escape", "encodings.raw_unicode_escape", "encodings.idna",
        "encodings.hex_codec", "encodings.base64_codec", "string.templatelib",
    )
    for name in PRELOAD:
        try:
            __import__(name)
        except Exception:
            pass

    E = {"__name__": "atlas_exposed", "__builtins__": _bi}
    exec(compile(exposed_source, "exposed.py", "exec"), E)
    E["install"](
        ("signal", "setitimer", "alarm", "pthread_kill", "raise_signal", "set_wakeup_fd", "siginterrupt", "sigwait",
         "sigwaitinfo", "sigtimedwait", "pthread_sigmask", "pidfd_send_signal"),
        ("create_builtin", "exec_builtin", "create_dynamic", "exec_dynamic", "get_frozen_object", "init_frozen",
         "_override_frozen_modules_for_tests", "_override_multi_interp_extensions_check"),
    )
    # R1 (D36): every random source the code can reach draws from Atlas's seed (exposed.py pin_randomness).
    if type(seed_text) is not str or not seed_text.isdigit() or len(seed_text) > 10 or seed_text[0] == "0":
        die("started without a valid seed")
    E["pin_randomness"](int(seed_text))
    CLOCK = E["CLOCK"]
    WATCH = E["WATCH"]
    WatchLimit = E["AtlasWatchLimit"]
    NeverWakes = E["_NeverWakes"]
    AtlasRefused = E["AtlasRefused"]
    new_loop = E["new_loop"]
    make_sync_standin = E["make_sync_standin"]
    make_async_standin = E["make_async_standin"]
    import_guard = E["make_import_guard"](stdlib_names)
    # exposed.py is hostile by design, but its globals and loop classes are what makes a refusal visible ("can't
    # check"). Code that edits them (to silence a refusal, say) is caught by comparing against this snapshot.
    exposed_snapshot = [(k, E[k]) for k in E]
    class_snapshots = [(c, [(k, c.__dict__[k]) for k in c.__dict__]) for c in (E["VirtualLoop"], E["_VirtualSelector"])]

    def exposed_change():
        try:
            if len(E) != len(exposed_snapshot):
                return "exposed.py's globals"
            for k, v in exposed_snapshot:
                if not dict.__contains__(E, k) or dict.__getitem__(E, k) is not v:
                    return "exposed.py's " + k
            for c, snap in class_snapshots:
                d = c.__dict__
                if len(d) != len(snap):
                    return type_name(c) + "'s methods"
                for k, v in snap:
                    if d.get(k) is not v:
                        return type_name(c) + "." + k
        except BaseException:
            return "exposed.py's globals"
        return None

    _gc.disable()
    base_atexit = atexit_count()
    base_gc_callbacks = len(gc_callbacks)

    # Exceptions a stand-in throws: Python's own class when one has that name, else a plain Exception subclass.
    builtin_errors = {}
    for k in list(_bi.__dict__):
        v = _bi.__dict__[k]
        if type(v) is type and issubclass(v, Exception):
            builtin_errors[k] = v
    custom_errors = {}

    def make_error(name, message):
        cls = builtin_errors.get(name)
        if cls is not None:
            try:
                return cls(message)
            except Exception:
                pass  # a built-in class that needs other arguments (UnicodeDecodeError): a plain class of that name
        cls = custom_errors.get(name)
        if cls is None:
            cls = type(name, (Exception,), {"__module__": "atlas"})
            custom_errors[name] = cls
        return cls(message)

    # ---------------------------------------------------------------------------------------------------------
    # 6. The audit hook. Before it is armed it lets everything through (Atlas is still setting up).

    armed = [False]
    clock_high = [0.0]  # the furthest the virtual clock has been announced to move this run (exposed.py tells the hook)
    modules_at_arm = [frozenset()]
    FRAME_ATTRS = frozenset(("tb_frame", "gi_frame", "cr_frame", "ag_frame", "f_back"))
    ALLOWED = frozenset((
        "exec", "compile", "builtins.id", "sys._getframemodulename", "object.__delattr__", "sys.excepthook",
        "sys.unraisablehook", "sys.set_asyncgen_hook_firstiter", "sys.set_asyncgen_hook_finalizer", "marshal.dumps",
        "array.__new__",
    ))
    ACCESS_PREFIXES = ("socket.", "urllib.", "http.", "ftplib.", "smtplib.", "poplib.", "imaplib.", "nntplib.",
                       "telnetlib.", "webbrowser.", "syslog.", "fcntl.", "mmap.", "shutil.", "tempfile.", "glob.",
                       "sqlite3.", "os.", "builtins.input", "msvcrt.", "winreg.", "ssl.", "pathlib.")
    PROCESS_EVENTS = frozenset(("os.system", "os.exec", "os.fork", "os.forkpty", "os.posix_spawn", "os.spawn",
                                "os.kill", "os.killpg", "os.abort", "os._exit", "subprocess.Popen", "pty.spawn",
                                "signal.pthread_kill", "resource.setrlimit", "resource.prlimit", "os.startfile",
                                "_posixsubprocess.fork_exec", "os.register_at_fork"))

    # R1 (D36): conditions. `current` is the run in progress (None while the file loads); kinds noticed while the file
    # loads count for every run. Two clock reads at one virtual moment with real CPU work between them mean the code
    # timed work, which takes no time on Atlas's clock: how the call ends is then not reported.
    current = [None]
    load_conds = set()

    def note(kind):
        c = current[0]
        if c is None:
            load_conds.add(kind)
        else:
            c["conds"].add(kind)

    def note_clock(v):
        note("clock")
        c = current[0]
        if c is None or (type(v) is not float and type(v) is not int):
            return
        cpu = cpu_clock()
        last = c["lastRead"]
        if last is not None and last[0] == v and cpu - last[1] >= 0.002:
            c["cpuWork"] = True
        c["lastRead"] = (v, cpu)

    def refuse(code, what, exc=None):
        mark_code(code, what)
        raise (exc if exc is not None else AtlasRefused("Atlas refused this: " + clean(what)))

    def hook(event, args):
        if not armed[0]:
            return
        if type(event) is not str:
            return
        if event == "atlas.clock":
            v = args[0] if len(args) > 0 else None
            if (type(v) is float or type(v) is int) and v == v and v > clock_high[0]:
                clock_high[0] = float(v)
            return
        if event == "atlas.cantcheck":
            code = args[0] if len(args) > 0 else ""
            what = args[1] if len(args) > 1 else ""
            mark_code(code if type(code) is str else "", what if type(what) is str else "")
            return
        if event == "atlas.clockread":
            note_clock(args[0] if len(args) > 0 else None)
            return
        if event == "atlas.condition":
            k = args[0] if len(args) > 0 else None
            if type(k) is str and k in ("randomness", "time-zone-or-locale"):
                note(k)
            return
        if event == "object.__getattr__":
            name = args[1] if len(args) > 1 else None
            if type(name) is not str or name in FRAME_ATTRS:
                refuse("internals", "a stack frame (." + clean(name if type(name) is str else "?", 20) + ")")
            return
        if event == "object.__setattr__":
            name = args[1] if len(args) > 1 else None
            if type(name) is not str or name == "__code__":
                refuse("internals", "replacing a function's code (__code__)")
            return
        if event in ALLOWED:
            return
        if event == "import":
            name = args[0] if len(args) > 0 else None
            if type(name) is not str:
                refuse("needs_package", "runtime", ImportError("Atlas refused an import"))
            top = name.partition(".")[0]
            if top not in stdlib_names:
                err = ModuleNotFoundError("No module named '%s'" % top)
                refuse("needs_package", name, err)
            if name in modules_at_arm[0]:
                refuse("internals", "importing " + name + " a second time (a fresh copy of a module)", ImportError("Atlas refused this import"))
            refuse("stdlib", name, ImportError("Atlas refused this import"))
        if event == "open":
            path = args[0] if len(args) > 0 else None
            mode = args[1] if len(args) > 1 else None
            ok = (type(path) is str and path.startswith(stdlib_dir + "/") and "/.." not in path
                  and (mode is None or (type(mode) is str and mode in ("r", "rb"))))
            if ok:
                return
            refuse("access", "open(" + (clean(path, 60) if type(path) is str else "a file descriptor") + ")")
        if event in ("sys._getframe", "sys._current_frames", "sys._current_exceptions"):
            refuse("internals", "stack frames (" + event + ")")
        if event.startswith("_thread.") or event.startswith("threading."):
            refuse("realtime", "threads (" + event + ")")
        if event in PROCESS_EVENTS or event.startswith("subprocess.") or event.startswith("os.exec") \
                or event.startswith("os.spawn") or event.startswith("os.posix_spawn"):
            refuse("process", event)
        if event == "time.sleep":
            refuse("realtime", "the real time.sleep")
        for p in ACCESS_PREFIXES:
            if event.startswith(p):
                refuse("access", event)
        refuse("internals", event)

    _sys.addaudithook(hook)

    # ---------------------------------------------------------------------------------------------------------
    # 7. Prepare every run before the code exists: arguments, stand-ins and their generators.

    QUERY = object()

    def fresh(v):
        t = type(v)
        if t is dict:
            return {k: fresh(v[k]) for k in v}
        if t is list:
            return [fresh(x) for x in v]
        return v

    def read_clock(ctx):
        """The virtual clock, as Atlas accepts it: a number that never goes backwards (else "can't check")."""
        v = CLOCK[0]
        last = ctx["clock"]
        if (type(v) is not float and type(v) is not int) or v != v or v == INF or v == -INF:
            tamper("the virtual clock was set to something that is not a number")
            CLOCK[0] = last
            return last
        if v < last or v < clock_high[0]:
            tamper("the virtual clock was moved backwards")
            CLOCK[0] = last
            return last
        ctx["clock"] = float(v)
        return ctx["clock"]

    def ms(seconds):
        m = round(seconds * 1000.0, 6)
        return int(m) if m == int(m) else m

    TRACE_MAX = 5000

    # E3 review r3 M1: the endings (and the start) are always kept past the cap, as in the JavaScript harness, so a
    # cut trace still says how the call ended and the proof file verifies. Dropped stand-in calls are tallied per name.
    ALWAYS_KEPT = ("python", "start", "returned", "threw", "never_settled", "still_running_at_watch_limit", "stopped_watching", "stopped_watching_after_settle")

    def emit(ctx, event, data=None):
        if len(ctx["trace"]) >= TRACE_MAX and event not in ALWAYS_KEPT:
            ctx["traceCut"] = ctx.get("traceCut", 0) + 1  # counts stay exact; only the event list is cut
            if event == "stand_in_call" and data is not None and type(data.get("name")) is str:
                dropped = ctx.setdefault("droppedCalls", {})
                dropped[data["name"]] = dropped.get(data["name"], 0) + 1
            return
        ev = {"t": ms(ctx["clock"]), "event": event}
        if data is not None:
            ev["data"] = data
        ctx["trace"].append(ev)

    def standin_gen(name, steps, then, is_async, ctx):
        """One stand-in's script and call count. Only `send` is handed out; the code can call it, never rewind it."""
        n = 0
        msg = yield None
        while True:
            try:
                if msg is QUERY:
                    msg = yield n
                    continue
                n += 1
                read_clock(ctx)
                data = {"name": name, "n": n}
                if ctx["settled"]:
                    data["afterSettle"] = True
                emit(ctx, "stand_in_call", data)
                if n <= len(steps):
                    step = steps[n - 1]
                elif then == "repeat_last":
                    step = steps[len(steps) - 1]
                else:
                    step = None
                if step is None:
                    err = make_error("AtlasStandInExhausted", "%s has no step for call %d (it has %d)" % (name, n, len(steps)))
                    emit(ctx, "stand_in_throws", {"name": name, "n": n, "errorName": "AtlasStandInExhausted"})
                    answer = ("throw", err)
                elif step[0] == "throw":
                    emit(ctx, "stand_in_throws", {"name": name, "n": n, "errorName": step[1]})
                    answer = ("throw", make_error(step[1], step[2]))
                elif step[0] == "never":
                    emit(ctx, "stand_in_never_answers", {"name": name, "n": n})
                    answer = ("never",)
                else:
                    after = step[2] if is_async else 0
                    emit(ctx, "stand_in_returns", {"name": name, "n": n, "afterMs": after} if after else {"name": name, "n": n})
                    answer = ("ret", fresh(step[1]), after / 1000.0)
                msg = yield answer
            except GeneratorExit:
                ctx["interfered"] = "a stand-in was closed from outside"
                return
            except BaseException:
                ctx["interfered"] = "a stand-in was interrupted from outside"
                msg = yield ("throw", make_error("AtlasStandInBroken", "Atlas's stand-in was interrupted"))

    runs = []
    for r in req["runs"]:
        ctx = {"trace": [], "settled": False, "clock": 0.0, "interfered": None, "conds": set(), "lastRead": None, "cpuWork": False}
        args = []
        gens = []
        for a in r["args"]:
            if a["kind"] == "json":
                args.append(_json.loads(a["json"]))
                continue
            steps = []
            for s in a["calls"]:
                if s["do"] == "return":
                    steps.append(("return", _json.loads(s["json"]), s.get("afterMs", 0) or 0))
                elif s["do"] == "throw":
                    steps.append(("throw", s["errorName"], s["message"]))
                else:
                    steps.append(("never",))
            is_async = a["async"] is True
            g = standin_gen(a["name"], steps, a["then"], is_async, ctx)
            next(g)
            args.append((make_async_standin if is_async else make_sync_standin)(a["name"], g.send))
            gens.append((a["name"], g))
        runs.append({"req": r, "ctx": ctx, "args": args, "gens": gens})

    # ---------------------------------------------------------------------------------------------------------
    # 8. Compile and load the code, with the hook armed.

    def finish(payload):
        armed[0] = False
        set_recursion_limit(base_recursion_limit)
        payload["python"] = {"version": py_version, "implementation": py_impl}
        body = dumps(payload).encode("ascii")
        line = b"\nATLAS_RESULT " + sign(body).encode("ascii") + b" " + body + b"\n"
        off = 0
        while off < len(line):
            try:
                off += write(1, line[off:])
            except BlockingIOError:
                pass
        hard_exit(0)

    def whole_payload():
        return {"wholeRun": whole[0]}

    # R1 (D36): the sandbox must have the pins Atlas asked for (the string-hash seed, UTC, the C locale), checked here
    # with Python's own answers before the code exists. If not, nothing from this run counts.
    def pin_problem():
        env_seed = posix.environ.get(b"PYTHONHASHSEED")
        if env_seed != seed_text.encode("ascii") or _sys.flags.hash_randomization != 1:
            return "the string-hash seed to %s (PYTHONHASHSEED is %s)" % (seed_text, clean(env_seed.decode("ascii", "replace") if type(env_seed) is bytes else "not set", 20))
        want_tz = pins.get("timeZone")
        lt = real_localtime(0)
        if want_tz != "UTC" or lt.tm_gmtoff != 0 or lt.tm_hour != 0 or real_tzname[0] != "UTC":
            return "the time zone to %s (it is %s)" % (clean(str(want_tz), 20), clean(str(real_tzname[0]), 40))
        want_locale = pins.get("locale")
        for cat in LOCALE_CATEGORIES:
            got = locale_query(cat, None)
            if got != want_locale:
                return "the locale to %s (it is %s)" % (clean(str(want_locale), 20), clean(str(got), 40))
        return None

    pin_failed = pin_problem()
    if pin_failed is not None:
        mark(word("pinFailed", what=pin_failed))
        finish(whole_payload())

    try:
        source = target_bytes.decode("utf-8")
    except UnicodeDecodeError:
        mark(word("syntax", what="the file is not UTF-8 text"))
        finish(whole_payload())
    try:
        code = compile(source, "<pasted code>", "exec", dont_inherit=True)
    except SyntaxError as e:
        line_no = e.lineno if type(e.lineno) is int else 0
        msg = e.msg if type(e.msg) is str else "invalid syntax"
        mark(word("syntax", what=clean("%s: %s (line %d)" % (type_name(type(e)), msg, line_no), 300)))
        finish(whole_payload())
    except (ValueError, TypeError) as e:
        mark(word("syntax", what=clean(describe_exc(e), 300)))
        finish(whole_payload())

    # R1 (D36): what plain reading of the code shows it leans on. A set (or hash()) means an order that comes from
    # Python's string-hash seed, which Atlas pins; time.timezone / tzname / altzone / daylight, astimezone and the
    # locale module mean the machine's zone or locale, which Atlas pins to UTC / C.
    static_conds = set()
    try:
        for node in _ast.walk(_ast.parse(source)):
            t = type(node)
            if t is _ast.Set or t is _ast.SetComp:
                static_conds.add("hash-seed")
            elif t is _ast.Call and type(node.func) is _ast.Name and node.func.id in ("set", "frozenset", "hash"):
                static_conds.add("hash-seed")
            elif t is _ast.BinOp and type(node.op) in (_ast.BitAnd, _ast.BitOr, _ast.BitXor, _ast.Sub) and any(
                    type(x) is _ast.Call and type(x.func) is _ast.Attribute and x.func.attr in ("keys", "items")
                    for x in (node.left, node.right)):
                static_conds.add("hash-seed")
            elif t is _ast.Attribute and (node.attr in ("tzname", "altzone", "daylight", "astimezone", "setlocale", "getlocale", "localeconv", "getencoding")
                                          or (node.attr == "timezone" and type(node.value) is _ast.Name and node.value.id == "time")):
                static_conds.add("time-zone-or-locale")
            elif (t is _ast.Import and any(a.name.partition(".")[0] == "locale" for a in node.names)) or (t is _ast.ImportFrom and node.module == "locale"):
                static_conds.add("time-zone-or-locale")
            elif t is _ast.ImportFrom and node.module == "time" and any(a.name in ("timezone", "tzname", "altzone", "daylight") for a in node.names):
                static_conds.add("time-zone-or-locale")
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        pass  # the file compiled above; a reader that cannot finish only means fewer disclosures, never a fact

    module = _types.ModuleType("target")
    target_builtins = dict(_bi.__dict__)
    target_builtins["__import__"] = import_guard
    module.__dict__["__builtins__"] = target_builtins
    _sys.modules["target"] = module
    moddict = module.__dict__
    keep = []  # loops and tasks stay referenced until the process ends (no __del__ between runs)

    modules_at_arm[0] = frozenset(_sys.modules)
    rand_at_load = rand_getstate(rand_inst)
    armed[0] = True
    try:
        exec(code, moddict)
    except BaseException as e:
        if whole[0] is None:
            if type(e) is SystemExit or type(e) is KeyboardInterrupt or isinstance(e, (SystemExit, KeyboardInterrupt)):
                mark(word("process", what=clean(type_name(type(e)))))
            elif is_access_denied(e):
                mark(word("access", what="the sandbox refused an access while the file loaded"))
            else:
                mark(word("loadFailed", what=describe_exc(e)))
    if whole[0] is not None:
        finish(whole_payload())
    if rand_getstate(rand_inst) != rand_at_load:
        load_conds.add("randomness")

    # ---------------------------------------------------------------------------------------------------------
    # 9. Run each call.

    MAX_TIMER_STEPS = 20000
    MAX_CALLBACK_RUNS = 200000

    def side_checks():
        changed = exposed_change()
        if changed is not None:
            tamper(changed)
        if atexit_count() != base_atexit:
            mark(word("process", what="atexit.register (a function run when the process ends, which Atlas never reaches)"))
        if len(gc_callbacks) != base_gc_callbacks:
            mark(word("realtime", what="gc.callbacks (garbage-collector timing)"))
        if gc_isenabled():
            mark(word("realtime", what="gc.enable (garbage-collector timing)"))
        if len(gc_garbage) != 0 or gc_get_debug() != 0:
            mark(word("internals", what="the garbage collector's saved objects (gc.set_debug / gc.garbage)"))

    def settle_from_exception(e, ctx):
        """("threw", facts), or None when the exception is not a fact about the code (whole run marked)."""
        t = type(e)
        if t is WatchLimit:
            if ctx["clock"] > ctx["watch"]:
                return ("limit", None)
            tamper("the code raised Atlas's own watch-limit signal itself")
            return None
        if t is NeverWakes:
            if whole[0] is None:
                tamper("the code raised Atlas's own never-wakes signal itself")
            return None
        if t is AtlasRefused or isinstance(e, AtlasRefused):
            if whole[0] is None:
                tamper("the code raised Atlas's own refusal itself")
            return None
        if isinstance(e, (SystemExit, KeyboardInterrupt)):
            mark(word("process", what=clean(type_name(t))))
            return None
        if is_access_denied(e):
            mark(word("access", what="the sandbox refused an access"))
            return None
        return ("threw", classify_thrown(e))

    def run_handle(h, ctx):
        try:
            h._run()
        except BaseException as e:
            if isinstance(e, (SystemExit, KeyboardInterrupt)):
                mark(word("process", what=clean(type_name(type(e)))))
            elif whole[0] is None:
                mark(word("uncaught", what=describe_exc(e)))

    def drive(loop, task, ctx, run_req):
        """Atlas's own event loop step: ready callbacks first, then jump the clock to the next timer."""
        watch_s = ctx["watch"]
        timer_steps = 0
        callback_runs = 0
        stop = None
        limit = False
        settled = None
        while True:
            if whole[0] is not None or ctx["interfered"] is not None:
                break
            now = read_clock(ctx)
            if settled is None and task.done():
                settled = settle_task(task, ctx)
                if settled is None:
                    break
            if now > watch_s:
                limit = True
                break
            ready = loop._ready
            sched = loop._scheduled
            while sched and sched[0]._cancelled:
                h = heappop(sched)
                h._scheduled = False
            if ready:
                n = len(ready)
                for _ in range(n):
                    if not ready:
                        break
                    h = ready.popleft()
                    if h._cancelled:
                        continue
                    callback_runs += 1
                    if callback_runs > MAX_CALLBACK_RUNS:
                        stop = "Atlas's step limit (%d callback runs, Atlas's limit, not the code's) ended the run before the code went quiet" % MAX_CALLBACK_RUNS
                        break
                    run_handle(h, ctx)
                    if whole[0] is not None:
                        break
                    read_clock(ctx)
                    if settled is None and task.done():
                        settled = settle_task(task, ctx)
                        if settled is None:
                            break
                if stop is not None or (settled is None and whole[0] is not None):
                    break
                continue
            if not sched:
                break
            when = sched[0]._when
            if (type(when) is not float and type(when) is not int) or when != when:
                tamper("a timer's time was set to something that is not a number")
                break
            if when > watch_s:
                limit = True
                break
            timer_steps += 1
            if timer_steps > MAX_TIMER_STEPS:
                stop = "Atlas's step limit (%d timer firings, Atlas's limit, not the code's) ended the run before the code went quiet" % MAX_TIMER_STEPS
                break
            if when > now:
                CLOCK[0] = float(when)
                ctx["clock"] = float(when)
                if clock_high[0] < ctx["clock"]:
                    clock_high[0] = ctx["clock"]
                now = ctx["clock"]
            while sched and sched[0]._when <= now:
                h = heappop(sched)
                h._scheduled = False
                ready.append(h)
        return settled, stop, limit

    def settle_task(task, ctx):
        """Reads a finished task. ("returned", value) / ("threw", facts) / ("limit", None); None = whole run."""
        ctx["settledAt"] = ctx["clock"]
        ctx["settled"] = True
        if task.cancelled():
            return ("threw", {"type": "Error", "name": "CancelledError", "message": ""})
        e = task.exception()
        if e is not None:
            return settle_from_exception(e, ctx)
        return ("returned", task.result())

    def run_one(run):
        r = run["req"]
        ctx = run["ctx"]
        watch_ms = r["watchLimitMs"]
        ctx["watch"] = watch_ms / 1000.0
        WATCH[0] = ctx["watch"]
        CLOCK[0] = 0.0
        ctx["clock"] = 0.0
        clock_high[0] = 0.0
        name = r["exportName"]
        names = [g[0] for g in run["gens"]]
        emit(ctx, "python", {"version": py_version, "implementation": py_impl})
        fn = dict.get(moddict, name)
        if fn is None and not dict.__contains__(moddict, name):
            mark(word("missingFunction", name=clean(name, 100)))
            return None
        if not callable(fn):
            t = type_of(fn)
            mark(word("notAFunction", name=clean(name, 100), type=("an " if t[:1] in "aeiou" else "a ") + t))
            return None
        emit(ctx, "start", {"exportName": name, "args": len(r["args"]), "watchLimitMs": watch_ms})

        settled = None
        stop = None
        limit = False
        rand_before = rand_getstate(rand_inst)
        current[0] = ctx
        try:
            value = fn(*run["args"])
        except BaseException as e:
            read_clock(ctx)
            ctx["settledAt"] = ctx["clock"]
            ctx["settled"] = True
            settled = settle_from_exception(e, ctx)
            if settled is None:
                return None
            if settled[0] == "limit":
                settled = None
                limit = True
        else:
            if type(value) is CoroType:
                loop = new_loop()
                keep.append(loop)
                set_running_loop(loop)
                try:
                    task = TaskCtor(value, loop=loop)
                    keep.append(task)
                    settled, stop, limit = drive(loop, task, ctx, r)
                except BaseException as e:
                    if whole[0] is None:
                        tamper("Atlas's event loop failed: " + describe_exc(e))
                finally:
                    set_running_loop(None)
                if settled is not None and settled[0] == "limit":
                    settled = None
                    limit = True
            else:
                read_clock(ctx)
                ctx["settledAt"] = ctx["clock"]
                ctx["settled"] = True
                settled = ("returned", value)
        current[0] = None
        if rand_getstate(rand_inst) != rand_before:
            ctx["conds"].add("randomness")
        set_recursion_limit(base_recursion_limit)  # the code may have lowered it to break Atlas's own readers
        side_checks()
        if whole[0] is not None or ctx["interfered"] is not None:
            if ctx["interfered"] is not None:
                tamper(ctx["interfered"])
            return None

        # A settle after the watch limit (a blocking sleep carried the clock past it) is "still running" at the limit.
        if settled is not None and ctx["settledAt"] > ctx["watch"]:
            settled = None
            limit = True

        # R1 (D36): the code timed work that ran without waiting. On Atlas's clock no time passed, so anything it
        # decided from that elapsed time is Atlas's, not the code's: how the call ended is not reported.
        if ctx["cpuWork"] and stop is None:
            stop = word("cpuWork")
            settled = None
            limit = False

        facts = None
        if settled is not None and settled[0] == "returned":
            facts = classify_returned(settled[1])
            emit(ctx, "returned", {"type": facts["type"]} if "json" in facts else {"type": facts["type"], "notJson": facts["why"]})
        elif settled is not None:
            facts = settled[1]
            data = {"type": facts["type"]}
            if "name" in facts:
                data["name"] = facts["name"]
            emit(ctx, "threw", data)
        side_checks()
        if whole[0] is not None:
            return None

        counts = {}
        for gname, g in run["gens"]:
            try:
                counts[gname] = g.send(QUERY)
            except BaseException:
                tamper("a stand-in was closed from outside")
                return None
            if type(counts[gname]) is not int:
                tamper("a stand-in's count was not a number")
                return None

        if ctx.get("traceCut"):
            ctx["trace"].append({"t": ms(ctx["clock"]), "event": "trace_cut", "data": {"eventsNotKept": ctx["traceCut"], "kept": len(ctx["trace"]), "droppedCalls": dict(ctx.get("droppedCalls", {}))}})
        if settled is None and stop is None and limit:
            emit(ctx, "still_running_at_watch_limit")
        elif settled is None and stop is not None:
            emit(ctx, "stopped_watching", {"reason": stop})
        elif settled is None:
            emit(ctx, "never_settled")
        elif stop is not None or limit:
            emit(ctx, "stopped_watching_after_settle", {"reason": stop or "Atlas's watch limit (%d ms of virtual time) ran out while the code's timers were still running after it settled" % watch_ms})

        # R1 (D36): the conditions this run noticed, in one event (src/conditions.ts reads it; verify rechecks it).
        kinds = set(static_conds) | load_conds | ctx["conds"]
        if ctx["cpuWork"]:
            kinds.add("clock-during-work")
        if kinds:
            ctx["trace"].append({"t": ms(ctx["clock"]), "event": "conditions", "data": {"kinds": sorted(kinds)}})

        measured = {}
        not_measured = {}
        limit_words = "Atlas's watch limit (%d ms of virtual time, Atlas's limit, not the code's)" % watch_ms
        if settled is None:
            if stop is not None:
                for k in ("outcome", "returnedJson", "returnedType", "thrownName", "thrownMessage", "virtualMs"):
                    not_measured[k] = stop + ", so how the call ends was not seen"
                for n in names:
                    not_measured["calls:" + n] = "%s; the count so far was %d" % (stop, counts[n])
            elif limit:
                measured["outcome"] = "still_running_at_watch_limit"
                why = "the call was still running when %s ran out" % limit_words
                for k in ("returnedJson", "returnedType", "thrownName", "thrownMessage", "virtualMs"):
                    not_measured[k] = why
                for n in names:
                    not_measured["calls:" + n] = "%s, so the final count was not seen; the count so far was %d" % (why, counts[n])
            else:
                measured["outcome"] = "never_settled"
                why = "the call never settled: it was still waiting with nothing left that could wake it"
                for k in ("returnedJson", "returnedType", "thrownName", "thrownMessage"):
                    not_measured[k] = why
                not_measured["virtualMs"] = why + ", so it has no settle time"
                for n in names:
                    measured["calls:" + n] = counts[n]
            return {"id": r["id"], "trace": ctx["trace"], "result": {"measured": measured, "notMeasured": not_measured}}

        measured["outcome"] = settled[0]
        measured["virtualMs"] = ms(ctx["settledAt"])
        if settled[0] == "returned":
            measured["returnedType"] = facts["type"]
            if "json" in facts:
                measured["returnedJson"] = facts["json"]
            else:
                not_measured["returnedJson"] = "the returned value is not stored as plain JSON: " + facts["why"]
            not_measured["thrownName"] = "the call returned, so nothing was thrown"
            not_measured["thrownMessage"] = "the call returned, so nothing was thrown"
        else:
            measured["thrownType"] = facts["type"]
            if "name" in facts:
                measured["thrownName"] = facts["name"]
            else:
                not_measured["thrownName"] = facts["nameWhy"]
            if "message" in facts:
                measured["thrownMessage"] = facts["message"]
            else:
                not_measured["thrownMessage"] = facts["messageWhy"]
            not_measured["returnedJson"] = "the call threw, so it returned nothing"
            not_measured["returnedType"] = "the call threw, so it returned nothing"
        if stop is not None or limit:
            why = stop if stop is not None else "the code still had timers running after the call settled when %s ran out" % limit_words
            for n in names:
                not_measured["calls:" + n] = "%s, so the final count was not seen; the count so far was %d" % (why, counts[n])
        else:
            for n in names:
                measured["calls:" + n] = counts[n]
        return {"id": r["id"], "trace": ctx["trace"], "result": {"measured": measured, "notMeasured": not_measured}}

    out_runs = []
    for run in runs:
        one = run_one(run)
        if whole[0] is not None:
            break
        if one is None:
            tamper("a run ended without a result")
            break
        out_runs.append(one)
    side_checks()
    if whole[0] is not None:
        finish(whole_payload())
    finish({"runs": out_runs})
