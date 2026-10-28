// X1 review B2: the Python standard library's top-level module names, so `import logging` or `import json` is never
// matched to a local file that happens to share the name.
//
// Source: CPython 3.14.7's `sys.stdlib_module_names` (297 names), copied once with
// `python3 -c "import sys; print(sorted(sys.stdlib_module_names))"` on 2026-10-27. Names added or removed in other
// CPython versions (for example `distutils`, removed in 3.12) are not in it: such an import is treated like any
// other name (resolved from the codebase's import roots, else an outside package).

export const PYTHON_STDLIB_VERSION = "3.14.7";

export const PYTHON_STDLIB: ReadonlySet<string> = new Set([
  "__future__", "_abc", "_aix_support", "_android_support", "_apple_support", "_ast", "_ast_unparse", "_asyncio",
  "_bisect", "_blake2", "_bz2", "_codecs", "_codecs_cn", "_codecs_hk", "_codecs_iso2022", "_codecs_jp", "_codecs_kr",
  "_codecs_tw", "_collections", "_collections_abc", "_colorize", "_compat_pickle", "_contextvars", "_csv", "_ctypes",
  "_curses", "_curses_panel", "_datetime", "_dbm", "_decimal", "_elementtree", "_frozen_importlib",
  "_frozen_importlib_external", "_functools", "_gdbm", "_hashlib", "_heapq", "_hmac", "_imp", "_interpchannels",
  "_interpqueues", "_interpreters", "_io", "_ios_support", "_json", "_locale", "_lsprof", "_lzma", "_markupbase",
  "_md5", "_multibytecodec", "_multiprocessing", "_opcode", "_opcode_metadata", "_operator", "_osx_support",
  "_overlapped", "_pickle", "_posixshmem", "_posixsubprocess", "_py_abc", "_py_warnings", "_pydatetime",
  "_pydecimal", "_pyio", "_pylong", "_pyrepl", "_queue", "_random", "_remote_debugging", "_scproxy", "_sha1",
  "_sha2", "_sha3", "_signal", "_sitebuiltins", "_socket", "_sqlite3", "_sre", "_ssl", "_stat", "_statistics",
  "_string", "_strptime", "_struct", "_suggestions", "_symtable", "_sysconfig", "_thread", "_threading_local",
  "_tkinter", "_tokenize", "_tracemalloc", "_types", "_typing", "_uuid", "_warnings", "_weakref", "_weakrefset",
  "_winapi", "_wmi", "_zoneinfo", "_zstd", "abc", "annotationlib", "antigravity", "argparse", "array", "ast",
  "asyncio", "atexit", "base64", "bdb", "binascii", "bisect", "builtins", "bz2", "cProfile", "calendar", "cmath",
  "cmd", "code", "codecs", "codeop", "collections", "colorsys", "compileall", "compression", "concurrent",
  "configparser", "contextlib", "contextvars", "copy", "copyreg", "csv", "ctypes", "curses", "dataclasses",
  "datetime", "dbm", "decimal", "difflib", "dis", "doctest", "email", "encodings", "ensurepip", "enum", "errno",
  "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "fractions", "ftplib", "functools", "gc",
  "genericpath", "getopt", "getpass", "gettext", "glob", "graphlib", "grp", "gzip", "hashlib", "heapq", "hmac",
  "html", "http", "idlelib", "imaplib", "importlib", "inspect", "io", "ipaddress", "itertools", "json", "keyword",
  "linecache", "locale", "logging", "lzma", "mailbox", "marshal", "math", "mimetypes", "mmap", "modulefinder",
  "msvcrt", "multiprocessing", "netrc", "nt", "ntpath", "nturl2path", "numbers", "opcode", "operator", "optparse",
  "os", "pathlib", "pdb", "pickle", "pickletools", "pkgutil", "platform", "plistlib", "poplib", "posix", "posixpath",
  "pprint", "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc", "pydoc_data", "pyexpat", "queue",
  "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter", "runpy", "sched", "secrets", "select",
  "selectors", "shelve", "shlex", "shutil", "signal", "site", "smtplib", "socket", "socketserver", "sqlite3",
  "sre_compile", "sre_constants", "sre_parse", "ssl", "stat", "statistics", "string", "stringprep", "struct",
  "subprocess", "symtable", "sys", "sysconfig", "syslog", "tabnanny", "tarfile", "tempfile", "termios", "textwrap",
  "this", "threading", "time", "timeit", "tkinter", "token", "tokenize", "tomllib", "trace", "traceback",
  "tracemalloc", "tty", "turtle", "turtledemo", "types", "typing", "unicodedata", "unittest", "urllib", "uuid",
  "venv", "warnings", "wave", "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xml", "xmlrpc", "zipapp",
  "zipfile", "zipimport", "zlib", "zoneinfo",
]);

/**
 * X1 review round 3 (R3-B1, S1): modules CPython finds before it looks at any folder: the built-in ones
 * (`sys.builtin_module_names`) and the frozen ones (`_imp._frozen_module_names()`), CPython 3.14.7.
 * Every other standard-library module is found on the path, so a script's own sibling file (scripts/queue.py next to
 * scripts/worker.py) wins over it, as CPython does.
 */
export const PYTHON_FOUND_FIRST: ReadonlySet<string> = new Set(["_abc", "_ast", "_codecs", "_collections", "_contextvars", "_datetime", "_functools", "_imp", "_io", "_locale", "_opcode", "_operator", "_signal", "_sre", "_stat", "_string", "_suggestions", "_symtable", "_sysconfig", "_thread", "_tokenize", "_tracemalloc", "_types", "_typing", "_warnings", "_weakref", "atexit", "builtins", "errno", "faulthandler", "gc", "itertools", "marshal", "posix", "pwd", "sys", "time", "_collections_abc", "_frozen_importlib", "_frozen_importlib_external", "_sitebuiltins", "abc", "codecs", "genericpath", "importlib.machinery", "importlib.util", "io", "ntpath", "os", "posixpath", "runpy", "site", "stat", "zipimport"]);
