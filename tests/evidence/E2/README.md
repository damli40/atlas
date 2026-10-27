# E2: the Python "call-function" runner and its macOS sandbox

Date: 2026-10-27 (WAT) · no model call ($0) · CPython 3.14.7 (Homebrew) on macOS (Darwin 25), Node 25.8.1.

## Where to look first

- **What now works:** a person pastes one Python file. Atlas calls one top-level function once, with plain JSON
  arguments and stand-ins, inside the operating system's own sandbox, on a virtual clock. It measures the same
  fields as the JavaScript runner (E1): how the call ended (`returned`, `threw`, `never_settled`,
  `still_running_at_watch_limit`), the returned value as JSON, the error's class name and message, the virtual
  time it took, and how many times each stand-in was called. A pasted target with language `py` runs through the
  same entry point as JavaScript (`tsRunner().run`).
- **Same behaviour, same facts:** seven pairs of JavaScript and Python functions that behave the same give
  **identical** measured fields (retry with backoff that recovers, the same retry when every call fails, a call
  that never settles, a 10-minute wait, NaN, plain JSON with JavaScript's number forms, a stand-in called after the
  call returned). Ten ordinary Python functions (debounce, retry, parser, rate limiter, currency formatter, deep
  merge, task pool, a class, an async generator, logging and print) give facts worked out by hand from the code.
- **The decision that matters most: how the result is protected.** Python has no private variables, so E1's trick
  (a key in a closure) does not carry over. The design and why it was chosen are in "The result channel" below.
  In one line: the key and every measured fact live only in local variables of running functions, and an audit
  hook added before the code exists refuses every way Python offers to reach another function's local variables.
- **The control:** before any verdict counts, 13 known cases run on a hand-written reference file
  (`runners/py/reference.py`) through the same sandbox and harness: the same 9 as JavaScript plus 4 for Python
  (a blocking `time.sleep`, `asyncio.run` inside a plain function, an integer JSON numbers cannot hold, and
  JavaScript's way of writing numbers). A harness whose clock is 1 ms off fails the control, and every verdict
  measured by it is "can't check".
- **Two bugs I found in my own first version** (both fixed, both with a test): the harness sorted JSON keys through
  Python's codec registry, which runs ordinary Python code the pasted code can patch; and moving the virtual clock
  backwards was only noticed relative to the last time the harness looked. Details in "Found in my own review".

## The command and the counts

```
pnpm vitest run tests/unit/py-sandbox.test.ts tests/unit/py-contract.test.ts tests/unit/py-call.test.ts tests/unit/py-parity.test.ts --reporter=verbose
pnpm test          # the full suite
npx tsc -p .       # the type check
```

| | Before E2 (commit 5f28a6c) | After E2 |
|---|---|---|
| Test files | 82 | 86 |
| Tests passed | 920 | 1,057 (+137: 19 sandbox, 8 contract, 91 run and attack, 19 parity) |
| Skipped | 19 | 19 (unchanged) |
| Type check | 0 errors | 0 errors |

The full suite ran clean 3 times in a row (`full-suite.txt`). `no-local-paths.test.ts` and the wording lint pass.
Files: `test-output.txt` (every E2 test by name), `full-suite.txt`, `tsc-output.txt`. The Python tests skip on a
machine with no Python 3.12+ (they ran here, none skipped).

## What was built (files)

| File | What it is |
|---|---|
| `runners/executor/sandbox-exec-python.ts` | The executor: Python inside macOS `sandbox-exec`, refuses on other OSes |
| `runners/py/boot.py` | Reads the per-run key from stdin, closes stdin, loads the harness into a private namespace |
| `runners/py/harness.py` | The trusted part: the audit hook, the event-loop driver, the stand-in generators, the JSON writer, the signed line |
| `runners/py/exposed.py` | The part the pasted code can reach: virtual time, the virtual event loop, stand-in adapters, refusals |
| `runners/py/reference.py` | The control's hand-written reference functions |
| `runners/py/py-runner.ts` | TypeScript side: the 13 control cases, the run, the same signed-line check as JavaScript |
| `runners/py/py-words.ts` | The sentences for Python's whole-run reasons, and the standard-library module list |
| `src/pasted-python.ts` | Plain-code reading of pasted Python: top-level functions with lines, every import |
| `src/pasted-code.ts` | Two additions: `exportedFunctionsFor(source, language)`, `staticRefusalFor(source, language)` |
| `runners/ts/control.ts` | `tsRunner(executor, pyExecutor)`: a pasted `py` target goes to the Python runner |

`src/types.ts` is unchanged.

## The sandbox (the operating system's own boundary)

`sandbox-exec` is macOS's kernel-enforced sandbox: its rules hold even if code escapes everything Atlas does
inside Python. The profile starts from **deny everything** and allows only:
- executing the one interpreter binary (not the `python3` launcher, which re-spawns it: spawning is denied);
- reading the Python installation, the run's temp folder, `/usr/lib`, the dyld shared cache and the root
  folder's entry (the loader needs those); mapping code from the same places.

Python runs as `python -I -S -B` (isolated: no `PYTHON*` variables and no user site folder; no `site`, so no
third-party packages exist at all; no `.pyc` writes) with an **empty environment** and a hard wall-clock kill.
Which Python: the first of `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3` that is 3.12
or newer, always in that order; the version actually used is reported inside the signed result and recorded in
every run's trace (`python` and `call_checks` events). On any OS but macOS the executor refuses to run; hosted runs
are E4 (Modal).

**Each denial is proven by a raw-Python test with none of Atlas's in-process checks** (`py-sandbox.test.ts`):
opening a network connection, listening on a port, writing a file in its own folder, writing in `/private/tmp`,
reading a file under `~/.config`, listing the home folder, reading `/etc/passwd`, starting a program, `os.fork`,
loading `ctypes`. Every one fails with the operating system's `PermissionError` (errno 1). One thing the OS does
NOT stop: importing the raw `_ctypes` extension (it lives inside the Python installation). The harness refuses it
in-process (tested in `py-call.test.ts`).

## The result channel: what was chosen and why

**The problem.** The pasted code runs in the same process as the harness that measures it. E1 (JavaScript) keeps
its per-run key in a closure, which JavaScript code cannot open. Python has no such thing: from any function the
code is handed, it can read and rewrite that function's module globals (`fn.__globals__`) and closure cells
(`fn.__closure__[i].cell_contents`). I checked on CPython 3.14 that **none of those reads raises an audit event**.
`gc.get_objects()` and stack frames reach everything else.

**The design I rejected: a supervisor process with no secret.** The brief suggested a separate process that owns
the clock and the measurements and validates what the code process reports. I worked it through and it does not
remove the problem: how the call *ended* (returned what, raised what, when) only exists inside the process that
runs the function, so that report has to come from there, and the pasted code can write to any pipe that process
holds (`os.write` on a guessed fd number). Whatever the supervisor receives, the code could have written. A
supervisor with no secret would make the "forged line + `os._exit`" attack *easier*, not harder.

**The design used: the smallest in-process boundary, with the OS sandbox behind it.**
1. **Only local variables of running functions hold anything that decides a fact.** The key, the HMAC pads, the
   run loop's state, and each stand-in's script and call count live only in local variables of `main()`, its run
   loop, and one generator per stand-in (`harness.py`). Nothing in `harness.py` is ever handed to the code, stored
   in a module, or listed in `sys.modules`; it runs from a private namespace with its own copy of the built-ins.
   In CPython the only ways into another function's locals are stack frames and the garbage collector's lists.
2. **An audit hook (PEP 578), added before the code exists, refuses every route to a frame or to those lists:**
   `sys._getframe`, `sys._current_frames`, `traceback.tb_frame`, generator `gi_frame`, coroutine `cr_frame`,
   async-generator `ag_frame`, `sys.settrace` / `setprofile` / `sys.monitoring`, `gc.get_objects` /
   `get_referrers` / `get_referents`, building code objects or functions by hand, `marshal`, adding another audit
   hook, threads. Python offers no way to remove an audit hook from Python code. After the code is loaded the hook
   **denies any event it does not know** (fail closed). Routes that raise **no** audit event were closed another
   way: signal handlers (they are handed the interrupted frame) and real-time signal timers are replaced; the
   `_imp` functions that would hand back fresh originals are replaced; re-importing a loaded module is refused;
   `gc.set_debug` is refused (with `DEBUG_SAVEALL`, `gc.garbage` collects objects with no event).
3. **What the code can reach is assumed hostile** (`exposed.py`: the clock, the event loop, stand-in adapters).
   Changing it either changes only what the code itself sees (like monkeypatching the real thing), or pushes the
   run to "can't check". The stand-in the code is handed only passes calls to a generator's `send`, so the code can
   call a stand-in but never rewind or recount it. Editing `exposed.py`'s globals or loop classes (for example to
   silence a refusal) is caught against a snapshot. The clock can only move forwards: every move is announced to
   the hook, and a move backwards is "can't check".
4. **The returned value is read only if it is made of exact built-in types** (`dict`, `list`, `str`, `int`,
   `float`, `bool`, `None`). Reading those runs no code. A dict subclass that lies about its items, a float
   subclass with a forged `repr`, an object whose `__class__` claims to be `dict`, or a `__json__` method are all
   "not plain JSON" with their class named. The signed line is written by the harness's own JSON writer with its own
   built-ins, so patching `json`, `builtins`, `sys.stdout`, `sys.modules` or `__import__` changes nothing signed.
5. **The parent check is E1's, unchanged** (`parseCallWorkerOutput`): exactly one line, HMAC-SHA256 under a fresh
   32-byte key that went to the harness on stdin only; an unsigned, wrongly signed or second line is tampering.

**Attack tests that prove it** (`py-call.test.ts`, "attacks on the result channel" and "poisoned returned
objects"):
- gc key hunt (`gc.get_objects`, `gc.get_referrers` on a stand-in): refused, whole run "can't check".
- frame walking through `sys._getframe`, a traceback's `tb_frame`, `inspect.stack`, `traceback.format_exc`, a
  coroutine's `cr_frame`, `sys.settrace`, `sys.setprofile`, `sys.monitoring`, adding an audit hook: each refused,
  even when the code catches the refusal and carries on.
- the stand-in's generator: opening its frame, throwing into it, closing it: refused. Rewiring the stand-in's
  closure only changes what the code sees; the call count stays the real one.
- a forged result line (HMAC under a guessed key) followed by `os._exit`: rejected. A forged line printed before
  returning normally: two lines, tampering. A returned object whose `__del__` writes a forged line: tampering.
- the key appears in no argv, environment variable, file Atlas writes or returned value (checked with a spy
  executor that sees the real key).
- six poisoned return values, a poisoned value nested in a plain dict, a poisoned dict key; patched builtins /
  json / stdout / sys.modules / `__import__` (facts unchanged); `time.time` replaced (only the code's view).
- moving the clock backwards through a function's globals; editing `exposed.py`'s globals to silence a refusal;
  replacing a function's `__code__`, `code.replace`, `marshal.loads`, `types.FunctionType`; `_imp.create_builtin`
  for a fresh signal module; `gc.set_debug(DEBUG_SAVEALL)`; lowering the recursion limit to break Atlas's reader.

## What was tested (beyond the attacks)

- **Contract (plain code, `py-contract.test.ts`):** top-level `def` / `async def` with lines (decorators,
  multi-line signatures and `def \` continuations counted; methods, nested and conditional functions not listed;
  words inside strings, docstrings, comments and f-strings ignored, including PEP 701 nested quotes); every import
  form (`import a, b as c`, dotted names, `from x import`, relative imports, imports after `;` and inside blocks,
  `__import__("x")`, `import_module(x)`); the standard library allowed, anything else refused before running; the
  standard-library list equals the interpreter's own `sys.stdlib_module_names`; the gate accepts a top-level
  function and refuses a method.
- **Runs (`py-call.test.ts`):** a sealed json bet matched and a `.atlas.json` that verifies (and fails when the
  source is edited); the TS runner's entry point dispatches Python; a stand-in's `KeyError` is a real `KeyError`;
  eleven non-JSON return values; 100 nesting levels kept, 101 not; text written exactly as JavaScript writes it
  (escapes, emoji, key order by UTF-16 units); exceptions (name, message, the code's own `PermissionError`, a
  `__str__` that raises); never settles; still running (async sleep, and a blocking `time.sleep` past the limit);
  `datetime`, `time.time`, `monotonic`, `strftime`, `date.today` on the virtual clock in UTC; an endless loop hits
  the real-time limit; an endless `await asyncio.sleep(0)` hits the step limit; a stand-in called by a timer after
  the call returned is counted, one still pending at the limit is not claimed; 20,000 stand-in calls counted
  exactly with the trace cut and marked; a 50-million-character string and a million-key dict refused quickly.
- **Whole-run "can't check" (the code catches the error and carries on, and it still counts as refused):**
  `/etc/passwd`, writing a file, listing a folder, a socket, a subprocess, `os.system`, `os.fork`, `ctypes`,
  `_ctypes`, a thread, a signal handler, a real-time signal timer, CPU time, `select` with a timeout, `input()`,
  `asyncio.to_thread`, `os._exit`, an uncaught callback error, a task whose error is never read, `atexit`, a gc
  callback, turning the garbage collector back on, an OS refusal escaping the call (never recorded as `threw`),
  a third-party import (before running, and inside the sandbox with the scan skipped), a module named at run time,
  a relative import, a standard-library module Atlas does not load, a fresh copy of a loaded module, a syntax
  error (Python's own message), a file that raises while loading, a missing function, a name that is not one.

## Spec deviations (the conservative choice each time)

1. **How a Python call is made.** A plain function is called directly, with no event loop running (so
   `asyncio.run` inside it works, as in a real script). If it returns a coroutine, Atlas runs that coroutine as a
   task on its virtual event loop. Only real coroutine objects are awaited; JavaScript awaits any "thenable".
2. **Code made from text is allowed in Python** (`eval`, `exec`, `compile`). JavaScript refuses `eval`. Python's
   own `dataclasses` and `collections.namedtuple` build their methods from text, so refusing it would refuse
   ordinary code, and generated code runs with the same powers as the pasted code. Code objects built from bytes
   (`marshal`) or by hand (`CodeType`, `code.replace`, `FunctionType`) stay refused: they are how pure Python
   reaches memory it should not.
3. **Standard-library modules are loaded before the code runs, from a fixed list** (in `harness.py`). Importing
   one that is not on it, even lazily inside the library (a codec, say), is a whole-run "can't check" with its own
   sentence. Loading module files after the code exists would mean letting the code run `marshal` data.
4. **`returnedType` words for Python-only types:** `tuple`, `set`, `frozenset`, `bytes`, `bytearray`,
   `coroutine`, `generator`, `class`, `object (ClassName)`. The JSON types use the JavaScript words (`object`,
   `array`, `string`, `number`, `boolean`, `null`), so the two languages compare.
5. **Integers beyond ±2^53 are not measured** (`returnedType` "number (an integer beyond 2^53)"). The judge
   compares canonical JSON text, and a bet's number is a JavaScript number, which cannot hold them exactly; writing
   the exact digits would make every bet on them "didn't match" for a reason that is not about the code. 2^53 itself
   is measured. Floats are written the way JavaScript writes numbers (`1e+21`, `5e-7`, `-0` as `0`, `3.0` as `3`).
6. **`thrownMessage` is `str(e)`**, which runs the class's own `__str__` when it has one (E1 likewise reads a
   `message` getter). `thrownName` is the class name. `thrownType` is always `Error` (Python can only raise
   exceptions). `KeyError('k')` therefore has the message `'k'` with quotes, as Python prints it.
7. **`sys.exit` is not always a refusal.** Uncaught, it ends the process: whole-run "can't check" (as JavaScript's
   `process.exit`). Caught by the code, it is an ordinary Python exception and the run is measured. Same for
   `KeyboardInterrupt`.
8. **A blocking `time.sleep` moves the virtual clock.** A call that settles after the watch limit this way is
   `still_running_at_watch_limit` (it was still running when Atlas stopped watching).
9. **Leftover timers after the call settles keep running up to the watch limit**, as in E1, so a stand-in called
   later is counted. A real `asyncio.run` would cancel leftover tasks instead.
10. **An exception in an asyncio callback, or a task whose error is never read, makes the whole run "can't
    check"** (E1's rule for an uncaught failure). Real asyncio would log it and carry on.
11. **Two sentences are Python's own:** "the code tried to reach Python's internals (...)" and the uncaught-failure
    sentence (E1's mentions Node). Every other reason reuses E1's wording from `call-words.ts`; the harness gets
    the sentences in `request.json`, so the TypeScript files stay the one source.
12. **The plain-code scan does not refuse text it cannot read**; Python then reports the exact `SyntaxError`
    (the spec's "the runtime's own message"). Every import is refused at run time anyway.
13. **The control has its own id** (`control:call-function:py`), 13 cases instead of 9, and checks the Python
    harness on `reference.py`. `Run.executor` stays `"local"` and `Run.runner` stays `"ts"` (no type change); the
    Python version is in the trace.
14. **Smaller environment changes:** SIGINT is reset to the OS default before the code loads (so `asyncio.run`
    does not install a Ctrl-C handler, which would need `signal.signal`); `logging` records "(unknown file)" as the
    caller, because finding the caller needs stack frames; `datetime.datetime` and `datetime.date` are subclasses
    whose `now()` / `today()` read the virtual clock; the garbage collector is off during runs (no collection at
    allocation-dependent moments); an async stand-in's delay counts from the call, as in JavaScript.

## Refused vs faked (what Atlas does with each thing that could reach outside the virtual run)

| Thing | Decision | Why |
|---|---|---|
| `time.time/time_ns/monotonic/perf_counter/sleep/localtime/gmtime/ctime/asctime/strftime`, `datetime.now/utcnow/today`, `date.today`, asyncio's loop time | **faked** (virtual clock from 2026-01-01T00:00:00Z, tested) | otherwise a "wait 5 s" loop would run for real |
| `asyncio.run` / `new_event_loop` / `SelectorEventLoop` created by the code | **faked** (the virtual loop, tested in the control) | the real loop waits in real time |
| `time.process_time`, `thread_time`, `clock_gettime` | refused | real CPU time has no honest virtual stand-in |
| threads, `run_in_executor`, `asyncio.to_thread`, `select`, signal handlers and timers, `atexit`, gc callbacks, `gc.enable` | refused (tested) | they run on real time or at moments the code does not control |
| files, network, programs, fork, `input()`, `ctypes` | refused in-process and by the OS (tested) | outside the run |
| stack frames, gc object lists, tracing, `sys.monitoring`, code objects, `marshal`, audit hooks, fresh module copies | refused (tested) | they reach Atlas's own local variables |
| `eval` / `exec` / `compile` of text | **allowed** (deviation 2) | the standard library needs it; it grants nothing new |
| randomness (`random`, `uuid4`, string hashing, `id()`) | real, not marked | see known limits |

## What this does NOT cover (known limits)

- **A bug in CPython itself.** If pure Python can read arbitrary memory through an interpreter bug, it can find the
  key. Building code objects and loading `marshal` data (the usual way to trigger such bugs) are refused, but
  CPython has known crashers and I have not proven none of them reads memory. The OS sandbox still holds in that
  case: no network, no files, no other program.
- **Not proven complete.** The audit-hook route list is my reading of CPython 3.14 plus every probe in the tests;
  the hook denies unknown events, so a missed *audited* route fails closed. A route that raises no audit event
  and that I did not find is the real risk; the ones I found (cells, globals, signals, `_imp`, `gc.garbage`) are
  handled above.
- **Randomness is real.** `random`, `uuid4`, `id()` and the order of a `set` of strings (Python randomises string
  hashing per process; isolated mode ignores `PYTHONHASHSEED`) differ between runs. A replay of such code may
  differ. Nothing marks such a run (same as `Math.random` in E1).
- **One clock stays real:** the original `datetime` class is still reachable (`datetime.datetime.__base__.now()`)
  and reads the real clock. It cannot wake work; it can make a returned value differ between runs.
- **Weak-reference callbacks** fire when an object's last reference goes (that is deterministic). With the garbage
  collector off, objects in reference cycles are never collected during a run, so a callback a real run would
  fire at some collection never fires.
- **Traceback formatting is "can't check":** `traceback.format_exc()` reads stack frames, which Atlas refuses
  (tested). `logging.exception()` and `Task.print_stack()` format tracebacks the same way, so they fall under the
  same rule (not tested one by one). Code that logs with tracebacks cannot be measured.
- **Tested on one interpreter:** CPython 3.14.7 (Homebrew). 3.12 and 3.13 are accepted but untested: audit event
  names, asyncio internals (`_ready`, `_scheduled`) and `_asyncio._set_running_loop` could differ. The
  standard-library list in `py-words.ts` is 3.14's.
- **macOS only.** `sandbox-exec` is deprecated by Apple but works on this Darwin 25 machine. The loader needs
  `/usr/lib` and the dyld shared cache readable (system libraries, not user data).
- **The code can choose the detail inside a "can't check" reason.** Any code can raise Atlas's own signal
  (`sys.audit("atlas.cantcheck", "access", "pretend")`); the result is only ever "can't check", never a measured
  fact, but the words in the brackets are the code's (cut to 80 characters, hidden characters escaped). Probed by
  hand, not in the test files. Calling the boot function again from the code fails (stdin is closed), and running a
  stand-in generator's code object fails (it needs its closure): both probed by hand too.
- **No memory limit**, as in E1. Output past 16 MB is cut, which loses the result line: "can't check".
- **No separate adversarial reviewer has looked at this yet.** The spec plans one per batch. My own review is in
  the next section.

## Found in my own review

1. **The JSON key sort went through Python code the pasted code can patch.** The first version sorted keys with
   `str.encode("utf-16-be")`, which looks the codec up through `encodings.search_function`, ordinary Python. Code
   that patched `builtins` crashed the harness (no result, so "can't check": it failed closed), and code that
   patched the codec search could in principle have changed the key order Atlas signs. Now the sort key is
   computed by arithmetic on code points. Test: "patching builtins, json, sys.stdout, sys.modules and __import__
   changes nothing Atlas reports" (it failed before the fix).
2. **A clock moved backwards between two looks was not seen.** `time.sleep(2)` then setting the clock to 0.5 gave
   `virtualMs 500`. Every clock move made by Atlas's own functions is now announced to the audit hook, and any value
   below the furthest announced one is "can't check". Test: "moving Atlas's virtual clock backwards through a
   function's globals is refused" (it failed before the fix).
3. Also from the review: `gc.set_debug` refused, the recursion limit restored before Atlas reads the result, the
   trace capped at 5,000 events (counts stay exact, the cut is marked), size guards so a 50-million-character string
   is refused without being walked. Each has a test.

## Unsafe thing noticed in E1, then fixed on this branch

- **Finding:** E1's local executor (`runners/executor/local.ts`) decoded stdout chunk by chunk
  (`b.toString("utf8")` per data event). A multi-byte character split across two pipe reads became two
  replacement characters, the HMAC no longer verified, and an honest JavaScript run was reported as "tampering"
  (can't check, never a false fact).
- **Fix:** the executor keeps the raw bytes and decodes once when the child exits (stdout and stderr). Nothing else
  in the executor changed.
- **Tests** (`tests/unit/local-executor-utf8.test.ts`, both failed on the old code, both pass now):
  - 750 KB of 2-, 3- and 4-byte characters, offset so the 64 KB pipe reads land mid-character, arrive whole.
  - A real signed result line, written in two pieces split inside a euro sign with a 100 ms pause between, is
    accepted by `parseCallWorkerOutput`. On the old code it came back "tampering: a result line that does not
    carry this run's key". The split is forced by the script because the real harness writes its line in one
    call: I tried 27 padding sizes, with and without stalling the parent, and the OS never split the harness's own
    line, so a natural reproduction is timing-dependent (it needs the pipe full while the parent is busy).
- **Counts after the fix:** 87 files, 1,059 passed, 19 skipped.
