# Text facts in Python, where len() counts code points.
import unicodedata


def text_facts(s):
    nfc = unicodedata.normalize("NFC", s)
    return {"len": len(s), "nfc_len": len(nfc), "upper": s.upper(), "utf8_bytes": len(s.encode("utf-8"))}


def pair():
    return ("a", 1)
