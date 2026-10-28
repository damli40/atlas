# SystemExit caught by the code, and SystemExit that escapes.
import sys


def safe_main(argv):
    try:
        if not argv:
            sys.exit(2)
        return "ran"
    except SystemExit as e:
        return f"exit {e.code}"


def hard_exit():
    sys.exit(3)
