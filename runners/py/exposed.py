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


#: R2 (D45): the second run of the double run plays the code as if its work took time. Each repeated read at one
#: virtual moment adds NUDGE[0] seconds (0.010) to the run's drift, for every clock: the stopwatch (monotonic,
#: perf_counter) and the calendar (time.time, time_ns, datetime). R2 review B3: a smaller calendar step was lost to
#: rounding (int((time.time() - t) * 1000), float precision near 1.7e9 s). The drift stays added for the rest of the
#: run, as real time would. Only readings move, never CLOCK or a timer. 0.0 in the first run; harness.py sets it when
#: each run starts and checks after each run that it still holds its value.
NUDGE = [0.0]
#: R2 (D45): [CLOCK value of the last read, the run's drift in seconds]. harness.py resets it when each run starts.
_REPEATS = [None, 0.0]


def _read(stopwatch=False):  # R2 review B3: both clocks now move the same 10 ms; the flag stays for clarity
    """Announce a read of the clock; return the reading (CLOCK, plus the second run's drift)."""
    _audit("atlas.clockread", CLOCK[0])
    now = CLOCK[0]
    if _REPEATS[0] is not None and _REPEATS[0] == now:
        _REPEATS[1] = _REPEATS[1] + NUDGE[0]
    _REPEATS[0] = now
    return now + _REPEATS[1]


def _note(kind):
    _audit("atlas.condition", kind)


# ---- the virtual clock behind the time module ----

def _now():
    return EPOCH + CLOCK[0]


def v_time():
    return EPOCH + _read()


def v_time_ns():
    return int(EPOCH) * 1_000_000_000 + int(round(_read() * 1e9))


def v_monotonic():
    return _read(True)


def v_monotonic_ns():
    return int(round(_read(True) * 1e9))


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


# ---- U2 (D53): the fake network libraries ----
# When a test carries a network fake, the pasted file's `import requests` / `import httpx` / `import urllib.request`
# gets one of these modules instead of the real library (requests and httpx are not even installed; the network stays
# blocked either way). Each call asks harness.py's generator (through _NET[0], set per run) what to do, and the module
# builds the library's own kind of answer: a response object, or the library's own exception class, so code that
# catches `requests.exceptions.Timeout` catches the fake's timeout. Changing anything here only changes what the code
# sees; the call count lives in harness.py.

import json as _json_mod

#: The current run's fake network (a generator's `send`), or None. harness.py sets it and checks it after each run.
_NET = [None]


def _net_ask():
    send = _NET[0]
    if send is None:
        refuse("access", "the network (no fake network was answering at that moment)")
    return send(())


#: HTTP reason phrases for the statuses tests use most (the real libraries put them in messages and .reason).
_REASONS = {200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 301: "Moved Permanently", 302: "Found",
            304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
            408: "Request Timeout", 409: "Conflict", 422: "Unprocessable Entity", 429: "Too Many Requests",
            500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout"}


def _net_text(body):
    # Review M4: the body on the wire is the scripted body as compact JSON text, the same bytes as in JavaScript; .text
    # gives those bytes and .json() parses them, so the two always agree (a string body "nope" is the text "\"nope\"").
    return _json_mod.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _wait_sync(secs):
    v_sleep(secs)


def _wait_forever_sync():
    # A blocking call that never answers: the clock runs to past the watch limit (still running when Atlas stops).
    v_sleep(max(0.0, WATCH[0] - CLOCK[0]) + 0.001)
    raise AtlasWatchLimit("Atlas's watch limit of virtual time ran out while a network call never answered")


def _timeout_of(t, default=None):
    """A read timeout in seconds from requests/httpx/urllib forms: a number, a (connect, read) pair, or an object with .read."""
    if t is None:
        return default
    if isinstance(t, (int, float)) and not isinstance(t, bool):
        return float(t)
    if isinstance(t, tuple) and len(t) == 2:
        return _timeout_of(t[1], default)
    r = getattr(t, "read", None)
    if isinstance(r, (int, float)) and not isinstance(r, bool):
        return float(r)
    return default


def _sync_call(timeout, make_response, make_error, timeout_error):
    ans = _net_ask()
    kind = ans[0]
    if kind == "respond":
        after = ans[3]
        if after > 0:
            if timeout is not None and timeout < after:
                _wait_sync(timeout)
                raise timeout_error()
            _wait_sync(after)
        return make_response(ans[1], ans[2])
    if kind == "throw":
        raise make_error(ans[1], ans[2])
    if kind == "exhausted":
        raise ans[1]
    if timeout is not None:
        _wait_sync(timeout)
        raise timeout_error()
    _wait_forever_sync()


async def _async_call(timeout, make_response, make_error, timeout_error):
    ans = _net_ask()
    kind = ans[0]
    if kind == "respond":
        after = ans[3]
        if after > 0:
            if timeout is not None and timeout < after:
                await asyncio.sleep(timeout)
                raise timeout_error()
            await asyncio.sleep(after)
        return make_response(ans[1], ans[2])
    if kind == "throw":
        raise make_error(ans[1], ans[2])
    if kind == "exhausted":
        raise ans[1]
    if timeout is not None:
        await asyncio.sleep(timeout)
        raise timeout_error()
    return await asyncio.get_running_loop().create_future()


_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


def _module(name, **attrs):
    m = _types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    return m


def _make_requests():
    class RequestException(IOError):
        def __init__(self, *args, response=None, request=None, **kwargs):
            super().__init__(*args)
            self.response = response
            self.request = request

    class ConnectionError(RequestException): pass
    class HTTPError(RequestException): pass
    class Timeout(RequestException): pass
    class ConnectTimeout(ConnectionError, Timeout): pass
    class ReadTimeout(Timeout): pass
    class TooManyRedirects(RequestException): pass
    class JSONDecodeError(RequestException, ValueError): pass
    errors = {c.__name__: c for c in (RequestException, ConnectionError, HTTPError, Timeout, ConnectTimeout, ReadTimeout, TooManyRedirects)}

    class Response:
        def __init__(self, status, body, url):
            self.status_code = status
            self._body = body
            self.url = url
            self.reason = _REASONS.get(status, "")
            self.headers = {"Content-Type": "application/json"}
            self.text = _net_text(body)
            self.content = self.text.encode("utf-8")
            self.encoding = "utf-8"

        @property
        def ok(self):
            return self.status_code < 400

        def json(self, **kwargs):
            return _json_mod.loads(_json_mod.dumps(self._body))

        def raise_for_status(self):
            if 400 <= self.status_code < 500:
                raise HTTPError("%d Client Error: %s for url: %s" % (self.status_code, self.reason, self.url), response=self)
            if 500 <= self.status_code < 600:
                raise HTTPError("%d Server Error: %s for url: %s" % (self.status_code, self.reason, self.url), response=self)

        def close(self):
            pass

        def __repr__(self):
            return "<Response [%d]>" % self.status_code

    def request(method, url, **kwargs):
        return _sync_call(_timeout_of(kwargs.get("timeout")), lambda st, b: Response(st, b, url), lambda n, m: errors[n](m) if n in errors else RequestException(m), lambda: ReadTimeout("Read timed out. (read timeout=%s)" % kwargs.get("timeout")))

    class Session:
        def __init__(self):
            self.headers = {}
            self.params = {}

        def request(self, method, url, **kwargs):
            return request(method, url, **kwargs)

        def mount(self, prefix, adapter):
            pass

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    for meth in _METHODS:
        setattr(Session, meth, (lambda m: lambda self, url, **kw: request(m, url, **kw))(meth))
    exceptions = _module("requests.exceptions", JSONDecodeError=JSONDecodeError, **errors)
    top = _module("requests", request=request, Session=Session, session=Session, Response=Response, exceptions=exceptions, codes=_module("requests.codes", ok=200), **errors)
    for meth in _METHODS:
        setattr(top, meth, (lambda m: lambda url, **kw: request(m, url, **kw))(meth))
    return {"requests": top, "requests.exceptions": exceptions}


def _make_httpx():
    DEFAULT = 5.0  # httpx's own default timeout, in seconds
    UNSET = object()  # review M5: "not given" (httpx's 5 s); an explicit None means no timeout at all
    class HTTPError(Exception):
        def __init__(self, message, *, request=None, response=None):
            super().__init__(message)
            self.request = request
            self.response = response

    class RequestError(HTTPError): pass
    class TransportError(RequestError): pass
    class TimeoutException(TransportError): pass
    class ConnectTimeout(TimeoutException): pass
    class ReadTimeout(TimeoutException): pass
    class WriteTimeout(TimeoutException): pass
    class PoolTimeout(TimeoutException): pass
    class NetworkError(TransportError): pass
    class ConnectError(NetworkError): pass
    class ReadError(NetworkError): pass
    class ProtocolError(TransportError): pass
    class RemoteProtocolError(ProtocolError): pass
    class HTTPStatusError(HTTPError): pass
    errors = {c.__name__: c for c in (HTTPError, RequestError, TransportError, TimeoutException, ConnectTimeout, ReadTimeout, WriteTimeout, PoolTimeout, NetworkError, ConnectError, ReadError, ProtocolError, RemoteProtocolError, HTTPStatusError)}

    class Timeout:
        def __init__(self, timeout=UNSET, *, connect=UNSET, read=UNSET, write=UNSET, pool=UNSET):
            base = DEFAULT if timeout is UNSET else timeout
            self.read = base if read is UNSET else read
            self.connect = base if connect is UNSET else connect

    class Response:
        def __init__(self, status, body, url):
            self.status_code = status
            self._body = body
            self.url = url
            self.headers = {"content-type": "application/json"}
            self.text = _net_text(body)
            self.content = self.text.encode("utf-8")
            self.reason_phrase = _REASONS.get(status, "")

        @property
        def is_success(self):
            return 200 <= self.status_code < 300

        @property
        def is_error(self):
            return self.status_code >= 400

        def json(self, **kwargs):
            return _json_mod.loads(_json_mod.dumps(self._body))

        def raise_for_status(self):
            # Review m1: httpx raises for anything that is not 2xx (1xx, 3xx, 4xx, 5xx).
            if not (200 <= self.status_code < 300):
                kind = "Informational response" if self.status_code < 200 else "Redirect response" if self.status_code < 400 else "Client error" if self.status_code < 500 else "Server error"
                raise HTTPStatusError("%s '%d %s' for url '%s'" % (kind, self.status_code, self.reason_phrase, self.url), response=self)
            return self

        def __repr__(self):
            return "<Response [%d]>" % self.status_code


    def seconds(timeout):
        if timeout is UNSET:
            return DEFAULT
        if timeout is None:
            return None
        if isinstance(timeout, Timeout):
            return timeout.read
        return _timeout_of(timeout, None)

    def parts(url, timeout):
        return (lambda st, b: Response(st, b, url), lambda n, m: errors[n](m) if n in errors else RequestError(m), lambda: ReadTimeout("timed out"), seconds(timeout))

    def request(method, url, *, timeout=UNSET, **kwargs):
        mk, me, mt, t = parts(url, timeout)
        return _sync_call(t, mk, me, mt)

    class Client:
        def __init__(self, *, timeout=UNSET, **kwargs):
            self._timeout = timeout

        def request(self, method, url, *, timeout=UNSET, **kwargs):
            return request(method, url, timeout=timeout if timeout is not UNSET else self._timeout)

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class AsyncClient:
        def __init__(self, *, timeout=UNSET, **kwargs):
            self._timeout = timeout

        async def request(self, method, url, *, timeout=UNSET, **kwargs):
            mk, me, mt, t = parts(url, timeout if timeout is not UNSET else self._timeout)
            return await _async_call(t, mk, me, mt)

        async def aclose(self):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    for meth in _METHODS:
        setattr(Client, meth, (lambda m: lambda self, url, **kw: self.request(m, url, **kw))(meth))
        setattr(AsyncClient, meth, (lambda m: lambda self, url, **kw: self.request(m, url, **kw))(meth))
    top = _module("httpx", request=request, Client=Client, AsyncClient=AsyncClient, Timeout=Timeout, Response=Response, **errors)
    for meth in _METHODS:
        setattr(top, meth, (lambda m: lambda url, **kw: request(m, url, **kw))(meth))
    return {"httpx": top}


def _make_urllib():
    import urllib as _real_urllib

    class URLError(OSError):
        def __init__(self, reason, filename=None):
            super().__init__(reason)
            self.reason = reason

        def __str__(self):
            return "<urlopen error %s>" % self.reason

    class HTTPError(URLError):
        def __init__(self, url, code, msg, hdrs=None, fp=None, body=""):
            URLError.__init__(self, msg)
            self.url = url
            self.code = code
            self.status = code
            self.msg = msg
            self.hdrs = hdrs or {}
            self.headers = self.hdrs
            self._text = body

        def read(self):
            return self._text.encode("utf-8")

        def getcode(self):
            return self.code

        def __str__(self):
            return "HTTP Error %d: %s" % (self.code, self.msg)

    class Request:
        def __init__(self, url, data=None, headers=None, method=None, **kwargs):
            self.full_url = url
            self.data = data
            self.headers = dict(headers or {})
            self.method = method

        def add_header(self, k, v):
            self.headers[k] = v

        def get_method(self):
            return self.method or ("POST" if self.data is not None else "GET")

    class Response:
        def __init__(self, status, body, url):
            self.status = status
            self.code = status
            self.url = url
            self.headers = {"Content-Type": "application/json"}
            self.reason = "OK"
            self._data = _net_text(body).encode("utf-8")

        def read(self, n=-1):
            d = self._data
            self._data = b""
            return d

        def getcode(self):
            return self.status

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(url, data=None, timeout=None, **kwargs):
        u = url.full_url if isinstance(url, Request) else url

        def respond(status, body):
            if status >= 400:
                raise HTTPError(u, status, "Error", {}, None, _net_text(body))
            return Response(status, body, u)

        return _sync_call(_timeout_of(timeout), respond, lambda n, m: TimeoutError(m) if n == "TimeoutError" else URLError(m), lambda: TimeoutError("The read operation timed out"))

    error = _module("urllib.error", URLError=URLError, HTTPError=HTTPError, ContentTooShortError=URLError)
    request = _module("urllib.request", urlopen=urlopen, Request=Request, URLError=URLError, HTTPError=HTTPError)
    top = _module("urllib")
    for k, v in _real_urllib.__dict__.items():
        if not k.startswith("__"):
            setattr(top, k, v)
    top.request = request
    top.error = error
    return {"urllib": top, "urllib.request": request, "urllib.error": error}


_FAKE_MAKERS = {"requests": _make_requests, "httpx": _make_httpx, "urllib": _make_urllib}


# ---- imports from the pasted file ----

_real_import = __import__


def make_import_guard(stdlib_names, fake_libs=frozenset()):
    """The __import__ the pasted file sees: anything outside the standard library is "needs package X".

    This is for a clear reason only. The boundary is harness.py's audit hook, which sees every import Python
    actually performs (the code can reach the real __import__ through any function's __builtins__)."""

    fakes = {}
    for lib in fake_libs:
        made = _FAKE_MAKERS[lib]()
        fakes[lib.partition(".")[0]] = made

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level and level > 0:
            cant("needs_package", "relative")
            raise ImportError("attempted relative import with no known parent package")
        if type(name) is not str:
            cant("needs_package", "runtime")
            raise TypeError("module name must be str, not " + type(name).__name__)
        top = name.partition(".")[0]
        # U2 (D53): a faked network library comes from Atlas's fake modules; the real one is never imported.
        if top in fakes:
            want = name if fromlist else top
            mod = fakes[top].get(want)
            if mod is None and top == "urllib" and name == "urllib":
                mod = fakes[top]["urllib"]
            if mod is None:
                if top == "urllib":
                    return _real_import(name, globals, locals, fromlist, level)
                cant("needs_package", name)
                err = ModuleNotFoundError("No module named '%s'" % name)
                err.name = name
                raise err
            return mod
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
