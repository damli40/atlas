// The sentences Atlas shows when it will not report anything from a Python "call-function" run (whole-run can't
// check), plus the list of Python's standard-library module names.
//
// Plain words: the same cause must always get the same words, whether Atlas spots it by reading the pasted file
// before running it (src/pasted-python.ts) or the sandbox spots it at run time (runners/py/harness.py). The
// harness cannot import TypeScript, so runners/py/py-runner.ts sends these sentences to it inside request.json,
// with "{what}" / "{name}" / "{type}" where the detail goes. This file imports nothing.

/** What Atlas says when the module name is not a plain string in the code. */
export const PY_NAMED_AT_RUN_TIME = "a module named at run time";
export const PY_RELATIVE_IMPORT = "a module next to this file (a relative import)";

/** A module name as shown in a sentence: long or odd names are cut, never echoed whole. */
export function describePyModule(name: string): string {
  if (name === PY_NAMED_AT_RUN_TIME || name === PY_RELATIVE_IMPORT) return name;
  return name.length > 80 ? `${name.slice(0, 79)}…` : name;
}

/** D24: the code imports something that is not in Python's standard library. */
export const pyNeedsPackageReason = (name: string) =>
  `the code needs ${describePyModule(name)}; Atlas runs one pasted file on its own, with no packages or other modules`;

/** The code imports a standard-library module Atlas does not load into its sandbox. */
export const pyStdlibNotLoadedReason = (name: string) =>
  `the code imports the standard-library module ${describePyModule(name)}, which Atlas does not load into its Python sandbox (it loads a fixed list before the code runs)`;

export const pyMissingFunctionReason = (name: string) => `the code has no top-level function named "${name}"`;
export const pyNotAFunctionReason = (name: string, type: string) => `"${name}" is defined but is not a function (it is ${type})`;

/** Python could not compile the file. */
export const pySyntaxReason = (text: string) => `Python could not run the code as written: ${text}`;
/** The file raised while Atlas loaded it. */
export const pyLoadFailedReason = (text: string) => `the code raised an error while it was being loaded: ${text}`;

/** The code changed Atlas's own machinery in a way that would change what Atlas reports. */
export const PY_TAMPER_REASON = (what: string) =>
  `the code changed Atlas's own measuring machinery (${what}), so nothing Atlas measured in this run can be trusted`;

/** Python's standard-library top-level module names (sys.stdlib_module_names, CPython 3.14), for the static scan. */
export const PY_STDLIB_MODULES: readonly string[] = [
  "__future__", "_abc", "_aix_support", "_android_support", "_apple_support", "_ast", "_ast_unparse", "_asyncio", "_bisect", "_blake2",
  "_bz2", "_codecs", "_codecs_cn", "_codecs_hk", "_codecs_iso2022", "_codecs_jp", "_codecs_kr", "_codecs_tw",
  "_collections", "_collections_abc", "_colorize", "_compat_pickle", "_contextvars", "_csv", "_ctypes",
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
  "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "fractions", "ftplib", "functools", "gc", "genericpath",
  "getopt", "getpass", "gettext", "glob", "graphlib", "grp", "gzip", "hashlib", "heapq", "hmac", "html", "http",
  "idlelib", "imaplib", "importlib", "inspect", "io", "ipaddress", "itertools", "json", "keyword", "linecache",
  "locale", "logging", "lzma", "mailbox", "marshal", "math", "mimetypes", "mmap", "modulefinder", "msvcrt",
  "multiprocessing", "netrc", "nt", "ntpath", "nturl2path", "numbers", "opcode", "operator", "optparse", "os",
  "pathlib", "pdb", "pickle", "pickletools", "pkgutil", "platform", "plistlib", "poplib", "posix", "posixpath",
  "pprint", "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc", "pydoc_data", "pyexpat", "queue",
  "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter", "runpy", "sched", "secrets", "select",
  "selectors", "shelve", "shlex", "shutil", "signal", "site", "smtplib", "socket", "socketserver", "sqlite3",
  "sre_compile", "sre_constants", "sre_parse", "ssl", "stat", "statistics", "string", "stringprep", "struct",
  "subprocess", "symtable", "sys", "sysconfig", "syslog", "tabnanny", "tarfile", "tempfile", "termios", "textwrap",
  "this", "threading", "time", "timeit", "tkinter", "token", "tokenize", "tomllib", "trace", "traceback",
  "tracemalloc", "tty", "turtle", "turtledemo", "types", "typing", "unicodedata", "unittest", "urllib", "uuid",
  "venv", "warnings", "wave", "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xml", "xmlrpc", "zipapp",
  "zipfile", "zipimport", "zlib", "zoneinfo",
];

/** Something the code started failed with nobody catching it (an asyncio callback or task). */
export const PY_UNCAUGHT_REASON = (what: string) =>
  `something the code started failed with nobody catching it (${what}); Atlas does not report how the call ended when part of the run failed unseen`;

/** The code ran its own event loop inside a plain function, and that loop can never wake. */
export const PY_NESTED_HANG_REASON =
  "the code runs its own event loop inside a plain function (asyncio.run) and that loop has nothing left that could ever wake it; a real run would hang there, so Atlas does not report how the call ended";

/** The code reached for Python's own internals (stack frames, the garbage collector's object lists, code objects). */
export const PY_INTERNALS_REASON = (what: string) => `the code tried to reach Python's internals (${what}), which Atlas does not allow`;
