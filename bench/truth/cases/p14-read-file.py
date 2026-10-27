# Reads a file, falling back to a default when it cannot.
def load_config(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return "default"
