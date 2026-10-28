# The part of Atlas's Python harness that the pasted code CAN reach. Nothing in this file is trusted.
#
# Plain words: the pasted code runs in the same Python process as Atlas's harness (runners/py/harness.py), and
# Python has no private variables: from any function the code is handed (a stand-in, time.time, the event loop's
# methods) it can read and rewrite that function's module globals (__globals__) and closure cells
# (__closure__[i].cell_contents). So this file is written on the assumption that the code may change anything in
# it. Everything here is either:
#   - a stand-in for something real (the clock, the event loop) whose tampering only changes what the code itself
#     sees, the same as if the code had monkeypatched the real thing; or
#   - a refusal that can only push the run towards "can't check" (sys.audit("atlas.cantcheck", ...)), never
#     towards a measured fact.
# Every measured fact (how the call ended, the returned value, the virtual time it settled, how many times each
# stand-in was called) is decided in harness.py, in places the code cannot reach. See the top of harness.py.
#
# harness.py runs this file with exec() into a fresh dictionary (it is never imported as a module) and calls
# install() once, before any pasted code exists.

import sys
import time as _time
import asyncio
import asyncio.base_events
import asyncio.events
import datetime as _dtmod
import math as _math
import operator as _operator
import os as _os
import posix as _posix
import random as _random_mod

_audit = sys.audit

#: The virtual clock: seconds since Atlas's virtual epoch, in a one-item list shared by the time functions and the
#: event loop. harness.py reads it, refuses to let it go backwards, and moves it forwards to the next timer. Every
#: move made here is also announced to harness.py's audit hook ("atlas.clock"), so a later move backwards is seen.
CLOCK = [0.0]
#: Atlas's watch limit for the current run, in virtual seconds (harness.py sets it per run).
WATCH = [30.0]
#: 2026-01-01T00:00:00Z, the same virtual epoch as the JavaScript harness.
EPOCH = 1767225600.0


def cant(code, what=""):
    """Tell harness.py that nothing in this run can be trusted (it shows its own sentence for `code`)."""
    _audit("atlas.cantcheck", code, what)


class AtlasRefused(RuntimeError):
    """Raised into the code when Atlas refuses something. The whole run is already marked "can't check"."""


def refuse(code, what):
    cant(code, what)
    raise AtlasRefused("Atlas refused this: " + what)


class AtlasWatchLimit(Exception):
    """Raised into the code when a blocking sleep carries the virtual clock past Atlas's watch limit."""


def refuser(code, what):
    def refused(*args, **kwargs):
        refuse(code, what)

    refused.__name__ = what.rsplit(".", 1)[-1][:40] or "refused"
    return refused


# ---- R1 (D42): conditions ----
# Each read of the clock, each use of randomness and each read of the local time zone or locale is announced to
# harness.py's audit hook, which keeps the run's list of conditions where the code cannot reach it. Faking an event
# only adds a condition (or pushes the run to "can't check"); it can never make a measured fact.

CONDITION_KINDS = ("randomness", "time-zone-or-locale")


def _read():
    _audit("atlas.clockread", CLOCK[0])


def _note(kind):
    _audit("atlas.condition", kind)


# ---- the virtual clock behind the time module ----

def _now():
    return EPOCH + CLOCK[0]


def v_time():
    _read()
    return EPOCH + CLOCK[0]


def v_time_ns():
    _read()
    return int(EPOCH) * 1_000_000_000 + int(round(CLOCK[0] * 1e9))


def v_monotonic():
    _read()
    return CLOCK[0]


def v_monotonic_ns():
    _read()
    return int(round(CLOCK[0] * 1e9))


def v_sleep(secs):
    # The same argument checks as time.sleep, so code that relies on them sees the same errors.
    if isinstance(secs, bool) or not isinstance(secs, (int, float)):
        try:
            secs = float(secs)
        except (TypeError, ValueError):
            raise TypeError("'%s' object cannot be interpreted as an integer or float" % type(secs).__name__) from None
    if secs != secs:
        raise ValueError("Invalid value NaN (not a number)")
    if secs < 0:
        raise ValueError("sleep length must be non-negative")
    CLOCK[0] = CLOCK[0] + float(secs)
    _audit("atlas.clock", CLOCK[0])
    if CLOCK[0] > WATCH[0]:
        raise AtlasWatchLimit("Atlas's watch limit of virtual time ran out during time.sleep")


_real_localtime = _time.localtime
_real_gmtime = _time.gmtime
_real_ctime = _time.ctime
_real_asctime = _time.asctime
_real_strftime = _time.strftime


_real_mktime = _time.mktime


def v_localtime(secs=None):
    _note("time-zone-or-locale")  # local time: Atlas's pinned UTC, not the machine's zone
    return _real_localtime(v_time() if secs is None else secs)


def v_gmtime(secs=None):
    return _real_gmtime(v_time() if secs is None else secs)


def v_ctime(secs=None):
    _note("time-zone-or-locale")
    return _real_ctime(v_time() if secs is None else secs)


def v_asctime(t=None):
    if t is None:
        _note("time-zone-or-locale")
    return _real_asctime(_real_localtime(v_time()) if t is None else t)


def v_strftime(fmt, t=None):
    if t is None:
        _note("time-zone-or-locale")
    return _real_strftime(fmt, _real_localtime(v_time()) if t is None else t)


def v_mktime(t):
    _note("time-zone-or-locale")
    return _real_mktime(t)


def _install_time():
    t = _time
    t.time = v_time
    t.time_ns = v_time_ns
    t.monotonic = v_monotonic
    t.monotonic_ns = v_monotonic_ns
    t.perf_counter = v_monotonic
    t.perf_counter_ns = v_monotonic_ns
    t.sleep = v_sleep
    t.localtime = v_localtime
    t.gmtime = v_gmtime
    t.ctime = v_ctime
    t.asctime = v_asctime
    t.strftime = v_strftime
    t.mktime = v_mktime
    # Clocks of real CPU time have no honest virtual stand-in: refused, as in the JavaScript harness.
    for name in ("process_time", "process_time_ns", "thread_time", "thread_time_ns", "clock_gettime",
                 "clock_gettime_ns", "pthread_getcpuclockid", "clock_settime", "clock_settime_ns"):
        if hasattr(t, name):
            setattr(t, name, refuser("realtime", "time." + name))


# ---- datetime: now() / today() read the virtual clock ----

_RealDatetime = _dtmod.datetime
_RealDate = _dtmod.date


class datetime(_RealDatetime):
    @classmethod
    def now(cls, tz=None):
        return cls.fromtimestamp(v_time(), tz)

    @classmethod
    def utcnow(cls):
        return cls.fromtimestamp(v_time(), _dtmod.timezone.utc).replace(tzinfo=None)

    @classmethod
    def today(cls):
        return cls.fromtimestamp(v_time())

    @classmethod
    def fromtimestamp(cls, t, tz=None):
        if tz is None:
            _note("time-zone-or-locale")  # a naive local time
        return super(datetime, cls).fromtimestamp(t, tz)

    def astimezone(self, tz=None):
        if tz is None:
            _note("time-zone-or-locale")
        return _RealDatetime.astimezone(self, tz)


class date(_RealDate):
    @classmethod
    def today(cls):
        return cls.fromtimestamp(v_time())

    @classmethod
    def fromtimestamp(cls, t):
        _note("time-zone-or-locale")
        return super(date, cls).fromtimestamp(t)


datetime.__module__ = "datetime"
date.__module__ = "datetime"


def _install_datetime():
    _dtmod.datetime = datetime
    _dtmod.date = date


# ---- the virtual event loop ----

_BaseLoop = asyncio.base_events.BaseEventLoop


class _NeverWakes(BaseException):
    """Unwinds a nested event loop that has nothing left that could ever wake it (a real run would hang)."""


class _VirtualSelector:
    """What asyncio's own run_forever waits on, for loops the CODE runs itself (asyncio.run inside a plain function).

    The top-level call is driven by harness.py, which never calls this. Waiting jumps the virtual clock instead."""

    def select(self, timeout=None):
        if timeout is None:
            cant("nested_hang", "asyncio.run inside a plain function")
            raise _NeverWakes()
        if timeout > 0:
            CLOCK[0] = CLOCK[0] + timeout
            _audit("atlas.clock", CLOCK[0])
            if CLOCK[0] > WATCH[0]:
                raise AtlasWatchLimit("Atlas's watch limit of virtual time ran out")
        return []

    def close(self):
        pass


class VirtualLoop(_BaseLoop):
    """asyncio's own event loop, with Atlas's virtual clock and no access to the outside world."""

    def __init__(self):
        super().__init__()
        self._selector = _VirtualSelector()

    def time(self):
        return CLOCK[0]

    def _process_events(self, event_list):
        pass

    def _write_to_self(self):
        pass

    def call_exception_handler(self, context):
        # A callback or task failed with nobody to catch it. A real asyncio program logs it and carries on, but in
        # the JavaScript harness the same event (an uncaught failure) makes the whole run "can't check"; same here.
        what = ""
        try:
            exc = context.get("exception")
            if isinstance(exc, AtlasWatchLimit):
                return  # a blocking sleep crossed the watch limit; harness.py sees it on the clock

            what = type(exc).__name__ if exc is not None else str(context.get("message", ""))[:80]
        except BaseException:
            what = "an error"
        cant("uncaught", what)


def _refuse_method(code, what):
    def refused(self, *args, **kwargs):
        refuse(code, what)

    return refused


for _name in ("run_in_executor", "set_default_executor"):
    setattr(VirtualLoop, _name, _refuse_method("realtime", "a thread pool (loop." + _name + " / asyncio.to_thread)"))
for _name in ("add_reader", "add_writer", "remove_reader", "remove_writer", "sock_recv", "sock_recv_into",
              "sock_recvfrom", "sock_recvfrom_into", "sock_sendall", "sock_sendto", "sock_connect", "sock_accept",
              "sock_sendfile", "create_connection", "create_server", "create_datagram_endpoint",
              "create_unix_connection", "create_unix_server", "connect_accepted_socket", "getaddrinfo",
              "getnameinfo", "connect_read_pipe", "connect_write_pipe", "sendfile", "start_tls"):
    setattr(VirtualLoop, _name, _refuse_method("access", "loop." + _name))
for _name in ("subprocess_exec", "subprocess_shell", "add_signal_handler", "remove_signal_handler"):
    setattr(VirtualLoop, _name, _refuse_method("process", "loop." + _name))


def new_loop():
    return VirtualLoop()


def _install_asyncio():
    import warnings

    base = getattr(asyncio.events, "BaseDefaultEventLoopPolicy", None) or asyncio.events._BaseDefaultEventLoopPolicy

    class _Policy(base):
        _loop_factory = VirtualLoop

        def new_event_loop(self):
            return VirtualLoop()

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        asyncio.set_event_loop_policy(_Policy())
    # Code that builds a loop class by name gets the virtual one too.
    for mod in (asyncio, sys.modules.get("asyncio.unix_events")):
        if mod is None:
            continue
        for name in ("SelectorEventLoop", "EventLoop", "_UnixSelectorEventLoop"):
            if hasattr(mod, name):
                setattr(mod, name, VirtualLoop)
    # Waiting on file descriptors waits in real time, which the virtual clock does not control.
    sel = sys.modules.get("select")
    if sel is not None:
        for name in ("select", "poll", "kqueue", "kevent", "epoll", "devpoll"):
            if hasattr(sel, name):
                setattr(sel, name, refuser("realtime", "select." + name))


# ---- stand-ins ----
# harness.py owns each stand-in's script and call count, inside a generator the code cannot open. The function the
# code is handed only passes each call to that generator (`send`) and acts on the answer it gets back.

def make_sync_standin(name, send):
    def standin(*args, **kwargs):
        answer = send(args)
        if answer[0] == "ret":
            return answer[1]
        raise answer[1]

    standin.__name__ = name
    standin.__qualname__ = name
    return standin


async def _await_answer(answer, call_clock, fut):
    kind = answer[0]
    if kind == "ret":
        if fut is not None:
            return await fut
        after = answer[2]
        if after > 0:
            # Called with no loop running: the answer is due `after` seconds after the CALL, as in the JS harness.
            loop = asyncio.get_running_loop()
            f = loop.create_future()
            loop.call_at(call_clock + after, _settle, f, answer[1])
            return await f
        return answer[1]
    if kind == "never":
        return await asyncio.get_running_loop().create_future()
    raise answer[1]


def _settle(fut, value):
    if not fut.done():
        fut.set_result(value)


def make_async_standin(name, send):
    def standin(*args, **kwargs):
        answer = send(args)
        call_clock = CLOCK[0]
        fut = None
        if answer[0] == "ret" and answer[2] > 0:
            loop = asyncio.events._get_running_loop()
            if loop is not None:
                fut = loop.create_future()
                loop.call_at(call_clock + answer[2], _settle, fut, answer[1])
        return _await_answer(answer, call_clock, fut)

    standin.__name__ = name
    standin.__qualname__ = name
    return standin


# ---- imports from the pasted file ----

_real_import = __import__


def make_import_guard(stdlib_names):
    """The __import__ the pasted file sees: anything outside the standard library is "needs package X".

    This is for a clear reason only. The boundary is harness.py's audit hook, which sees every import Python
    actually performs (the code can reach the real __import__ through any function's __builtins__)."""

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level and level > 0:
            cant("needs_package", "relative")
            raise ImportError("attempted relative import with no known parent package")
        if type(name) is not str:
            cant("needs_package", "runtime")
            raise TypeError("module name must be str, not " + type(name).__name__)
        top = name.partition(".")[0]
        if top not in stdlib_names:
            cant("needs_package", name)
            err = ModuleNotFoundError("No module named '%s'" % top)
            err.name = top
            raise err
        mod = _real_import(name, globals, locals, fromlist, level)
        # R1 review round 2 (B1): the modules that describe the machine come back behind a noting proxy, however the
        # code names them (import sys as s, from sys import platform, getattr(sys, "platform")).
        return _HOST_PROXIES.get(id(mod), mod)

    return guarded_import


# ---- R1 review round 2 (B1): module proxies for machine details ----
# A module attribute (sys.platform, os.environ) cannot be watched on the module itself, so the pasted code gets a
# stand-in module that notes the read and hands back the real attribute. Everything else passes straight through.

import types as _types
import threading as _threading
import _thread

_SYS_HOST = {k: "sys." + k for k in ("platform", "version", "version_info", "hexversion", "implementation", "executable",
                                       "_base_executable", "prefix", "base_prefix", "exec_prefix", "base_exec_prefix",
                                       "argv", "orig_argv", "path", "byteorder", "maxsize", "thread_info",
                                       "getwindowsversion", "api_version", "abiflags", "platlibdir", "float_info",
                                       "int_info", "hash_info", "flags", "getfilesystemencoding")}
_OS_HOST = {k: "os." + k for k in ("environ", "environb", "getenv", "getenvb", "name", "uname", "cpu_count",
                                     "process_cpu_count", "getpid", "getppid", "getcwd", "getcwdb", "getuid", "getgid",
                                     "geteuid", "getegid", "getlogin", "getloadavg", "getgroups", "linesep", "pathsep",
                                     "times", "get_terminal_size", "supports_follow_symlinks")}
_THREAD_HOST = {k: "threading." + k for k in ("get_ident", "get_native_id", "main_thread", "current_thread",
                                                "TIMEOUT_MAX", "enumerate")}
_RAW_THREAD_HOST = {k: "_thread." + k for k in ("get_ident", "get_native_id", "TIMEOUT_MAX")}


class _HostModule(_types.ModuleType):
    def __getattribute__(self, name):
        d = object.__getattribute__(self, "__dict__")
        notes = d["_atlas_notes"]
        if name in notes:
            _host(notes[name])
        return getattr(d["_atlas_real"], name)

    def __setattr__(self, name, value):
        setattr(object.__getattribute__(self, "__dict__")["_atlas_real"], name, value)

    def __delattr__(self, name):
        delattr(object.__getattribute__(self, "__dict__")["_atlas_real"], name)

    def __dir__(self):
        return dir(object.__getattribute__(self, "__dict__")["_atlas_real"])

    def __repr__(self):
        return repr(object.__getattribute__(self, "__dict__")["_atlas_real"])


def _host_proxy(real, notes):
    p = _types.ModuleType.__new__(_HostModule)
    _types.ModuleType.__init__(p, real.__name__)
    d = object.__getattribute__(p, "__dict__")
    d["_atlas_real"] = real
    d["_atlas_notes"] = notes
    return p


_HOST_PROXIES = {}


def install_host_proxies():
    import platform as _platform
    for real, notes in ((sys, _SYS_HOST), (_os, _OS_HOST), (_threading, _THREAD_HOST), (_thread, _RAW_THREAD_HOST),
                        (_platform, {k: "platform." + k for k in dir(_platform) if not k.startswith("_")})):
        _HOST_PROXIES[id(real)] = _host_proxy(real, notes)


# ---- R1 review round 2 (B2): values hashed or ordered by memory address ----
_obj_hash = object.__hash__
_real_hash = hash
_real_set = set
_real_frozenset = frozenset


def _by_address(x):
    try:
        return type(x).__hash__ is _obj_hash
    except BaseException:
        return False


def _note_address():
    _audit("atlas.condition", "memory-address")


def v_hash(x):
    if _by_address(x):
        _note_address()
    return _real_hash(x)


class _SetType:
    """set / frozenset for the pasted code: the real type, plus a note when it is made from objects that hash by
    memory address (their order then depends on addresses). isinstance, subclassing and the methods work as usual."""

    __slots__ = ("_t",)

    def __init__(self, t):
        object.__setattr__(self, "_t", t)

    def __call__(self, *args, **kwargs):
        r = self._t(*args, **kwargs)
        n = 0
        for x in r:
            if _by_address(x):
                _note_address()
                break
            n += 1
            if n > 10000:
                break
        return r

    def __instancecheck__(self, x):
        return isinstance(x, self._t)

    def __subclasscheck__(self, c):
        return issubclass(c, self._t)

    def __mro_entries__(self, bases):
        return (self._t,)

    def __getattr__(self, name):
        return getattr(self._t, name)

    def __getitem__(self, item):
        return self._t[item]

    def __eq__(self, other):
        return other is self or other is self._t

    def __hash__(self):
        return _real_hash(self._t)

    def __repr__(self):
        return repr(self._t)


v_set = _SetType(_real_set)
v_frozenset = _SetType(_real_frozenset)


# ---- R1 (D42): seeded randomness ----
# The module's shared generator (random.random, random.choice, ...) is seeded with Atlas's seed; os.urandom (and
# with it uuid.uuid4, secrets and random.SystemRandom) and a Random() made without a seed draw from a second
# generator seeded from the same seed. Each use is announced (the "randomness" condition). Python's string-hash seed
# (set order) is pinned by PYTHONHASHSEED in the environment, which harness.py checks.

_RNG = [None]


def v_urandom(size):
    _note("randomness")
    n = _operator.index(size)
    if n < 0:
        raise ValueError("negative argument not allowed")
    return _RNG[0].randbytes(n)


def v_getrandom(size, flags=0):
    return v_urandom(size)


_real_random_seed = _random_mod.Random.seed


def v_seed(self, a=None, version=2):
    if a is None:
        _note("randomness")  # a generator seeded "from the machine": Atlas gives it a seed from its own
        a = _RNG[0].getrandbits(64)
    elif self is _random_mod._inst:
        _audit("atlas.condition", "self-seeded")  # random.seed(n): the code chose its own seed
    return _real_random_seed(self, a, version)


# ---- R1 review B1: reads of the machine the code runs on ----

def _host(what):
    _audit("atlas.host", what)


def _host_wrap(mod, name, label):
    real = getattr(mod, name, None)
    if real is None:
        return

    def wrapped(*args, **kwargs):
        _host(label)
        return real(*args, **kwargs)

    wrapped.__name__ = name
    setattr(mod, name, wrapped)


_real_id = id


def v_id(obj):
    _note_address()  # R1 review round 2: id() is a memory address
    return _real_id(obj)


def install_host_notes():
    import platform as _platform
    import uuid as _uuid
    for name in ("getpid", "getppid", "getcwd", "getcwdb", "cpu_count", "process_cpu_count", "uname", "getuid", "getgid",
                 "geteuid", "getegid", "getlogin", "getloadavg", "getgroups"):
        for mod in (_os, _posix):
            _host_wrap(mod, name, "os." + name + "()")
    for name in ("system", "node", "machine", "platform", "processor", "release", "version", "uname", "python_version",
                 "python_implementation", "mac_ver", "libc_ver", "architecture", "freedesktop_os_release"):
        _host_wrap(_platform, name, "platform." + name + "()")
    # uuid1 is built from the REAL clock and the machine's network address: refused (the virtual clock cannot stand in).
    _uuid.uuid1 = refuser("realtime", "uuid.uuid1 (the real clock and the machine's network address)")
    _uuid.getnode = refuser("realtime", "uuid.getnode (the machine's network address)")


def pin_randomness(seed):
    """Called once by harness.py, before any pasted code exists."""
    _RNG[0] = _random_mod.Random(seed * 2 + 1)
    _random_mod.seed(seed)
    _os.urandom = v_urandom
    _posix.urandom = v_urandom
    _random_mod._urandom = v_urandom
    for mod in (_os, _posix):
        if hasattr(mod, "getrandom"):
            mod.getrandom = v_getrandom
    _random_mod.Random.seed = v_seed
    # random.seed is a method bound to the shared generator when random is imported: replace it too, so random.seed(n)
    # by the code is seen as the code's own seed (R1 review M3).
    _random_mod.seed = lambda a=None, version=2: v_seed(_random_mod._inst, a, version)
    install_host_notes()
    install_host_proxies()


def install(signal_names, imp_names):
    """Called once by harness.py before any pasted code exists."""
    _install_time()
    _install_datetime()
    _install_asyncio()
    # logging finds the caller's file and line by walking stack frames, which Atlas refuses (the frames lead to
    # Atlas's own). With no frame, logging still works and records "(unknown file)" as the caller.
    import logging
    logging.currentframe = lambda: None
    # A signal handler is handed the interrupted stack frame, and timers that raise signals run on real time.
    # Neither raises an audit event, so the functions themselves are replaced.
    import signal as _signal_mod
    import _signal
    # asyncio.run installs its own Ctrl-C handler only while SIGINT has Python's default one; with the operating
    # system's default (nothing sends SIGINT to the sandbox) it leaves signals alone, as a real run in a thread does.
    _signal.signal(_signal.SIGINT, _signal.SIG_DFL)
    for name in signal_names:
        for mod in (_signal, _signal_mod):
            if hasattr(mod, name):
                setattr(mod, name, refuser("process", "signal." + name))
    # gc.set_debug(gc.DEBUG_SAVEALL) makes gc.collect() keep every unreachable object in gc.garbage, a route to
    # objects that raises no audit event (gc.get_objects does, and is refused).
    import gc as _gc
    _gc.set_debug = refuser("internals", "gc.set_debug")
    # Making a fresh copy of a built-in module would hand back the originals replaced above.
    import _imp
    for name in imp_names:
        if hasattr(_imp, name):
            setattr(_imp, name, refuser("internals", "_imp." + name))
