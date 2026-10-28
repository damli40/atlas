# Downloads a page.
import urllib.request


def fetch_text(url):
    with urllib.request.urlopen(url, timeout=5) as res:
        return res.read().decode("utf-8")
