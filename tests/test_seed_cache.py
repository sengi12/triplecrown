"""The nflverse asset cache: a download that dies half-way must not poison it forever.

This is the bug that took the daily seed refresh red. `urlretrieve` writes straight to its
destination, so an interrupted transfer left a TRUNCATED csv sitting at the cache path. The
cache is keyed on existence alone and CI restores it by prefix, so every later run reused the
half-file; `pd.read_csv` threw; and every caller of _aux_csv swallows exceptions and degrades
quietly. The coaching builder therefore emitted a 2025 sidecar shaped like a pre-FTN season —
no motion, no play-action — and test_playbook_insights caught it as "2025: play-action and
motion are charted", with nothing in the log saying why.
"""
import os
import sys
import tempfile
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    import pandas as pd  # noqa: F401,E402
except Exception:  # pragma: no cover
    print("SKIP: pandas not available")
    sys.exit(0)
from src.nflverse import nflverse as N  # noqa: E402

P = F = 0


def chk(c, label):
    global P, F
    if c:
        P += 1
        print("  PASS:", label)
    else:
        F += 1
        print("  FAIL:", label)


GOOD = "a,b\n1,2\n3,4\n"
TRUNCATED = 'a,b\n1,2\n3,"unterminated\n'

calls = {"n": 0}


def fake_urlretrieve(url, dest):
    """Stand in for the network. First call dies mid-write, leaving a partial behind."""
    calls["n"] += 1
    if calls["n"] == 1 and url.endswith("die-midway.csv"):
        with open(dest, "w") as fh:
            fh.write(TRUNCATED)
        raise OSError("connection reset mid-transfer")
    with open(dest, "w") as fh:
        fh.write(GOOD)


def install(tmp):
    """Point the cache at a scratch dir and the network at the fake."""
    import urllib.request
    urllib.request.urlretrieve = fake_urlretrieve
    N._FAILED_REMOTE.clear()
    N._REFRESHED_LIVE_REMOTE.clear()
    N._AUX_CACHE.clear()
    N.CACHE_DIR = tmp        # module-level; everything resolves under it


with tempfile.TemporaryDirectory() as tmp:
    install(tmp)

    print("=== a download that dies half-way leaves nothing behind ===")
    url = "https://example.invalid/die-midway.csv"
    try:
        N._cache_remote(url)
        chk(False, "the failed download raises")
    except Exception:
        chk(True, "the failed download raises")
    path = N._md5_cache_path(url)
    chk(not os.path.exists(path),
        "no truncated file is left at the cache path — this is the bug that poisoned CI")
    chk(not os.path.exists(path + ".part"), "and the .part scratch file is cleaned up too")

    print("=== so the next attempt actually re-fetches, and succeeds ===")
    got = N._cache_remote(url, force=True)
    chk(open(got).read() == GOOD, "the retry gets the whole file")
    chk(calls["n"] == 2, "it really went back to the source rather than reusing the corpse")

    print("=== a cache already poisoned (restored from CI) heals itself ===")
    N._AUX_CACHE.clear()
    N._FAILED_REMOTE.clear()
    url2 = "https://example.invalid/already-bad.csv"
    bad = N._md5_cache_path(url2)
    os.makedirs(os.path.dirname(bad), exist_ok=True)
    with open(bad, "w") as fh:          # exactly what CI restores from the old cache
        fh.write(TRUNCATED)
    before = calls["n"]
    df = N._aux_csv(url2)
    chk(list(df.columns) == ["a", "b"] and len(df) == 2,
        "_aux_csv returns real data instead of raising into a silent degrade")
    chk(calls["n"] == before + 1, "it re-downloaded exactly once to get there")
    chk(open(bad).read() == GOOD, "and the bad entry is replaced, so later runs are clean")

    print("=== current-season FTN charting refreshes once per build ===")
    N._AUX_CACHE.clear()
    N._REFRESHED_LIVE_REMOTE.clear()
    live = f"https://example.invalid/ftn_charting_{date.today().year}.csv"
    live_path = N._md5_cache_path(live)
    with open(live_path, "w") as fh:
        fh.write("a,b\n0,0\n")
    before = calls["n"]
    first = N._aux_csv(live)
    second = N._aux_csv(live)
    chk(len(first) == 2 and len(second) == 2,
        "the live FTN frame replaces an earlier partial-season cache")
    chk(calls["n"] == before + 1, "the evolving file downloads once, not once per reader")
    historical = "https://example.invalid/ftn_charting_2024.csv"
    historical_path = N._md5_cache_path(historical)
    with open(historical_path, "w") as fh:
        fh.write("a,b\n9,9\n")
    before = calls["n"]
    chk(len(N._aux_csv(historical)) == 1 and calls["n"] == before,
        "a finished season remains download-once")

    print("=== a source that is genuinely gone still fails, loudly ===")
    N._AUX_CACHE.clear()
    N._FAILED_REMOTE.clear()

    def always_die(url, dest):
        calls["n"] += 1
        raise OSError("404")
    import urllib.request
    urllib.request.urlretrieve = always_die
    try:
        N._cache_remote("https://example.invalid/gone.csv")
        chk(False, "a missing source raises rather than inventing an empty file")
    except Exception:
        chk(True, "a missing source raises rather than inventing an empty file")
    chk(not os.path.exists(N._md5_cache_path("https://example.invalid/gone.csv")),
        "and leaves nothing cached to be reused")

print(f"\nRESULT: {P}/{P + F} " + ("ALL PASS" if not F else "SOME FAILED"))
sys.exit(1 if F else 0)
