"""KeepTradeCut: a near-empty parse is a page that moved, not a successful fetch.

The scrape reads a `var playersArray = [...]` out of the dynasty-rankings page and keeps the
rows whose position/slug/playerName all read. When KTC renames one of those fields every row
fails the filter and the parse comes back with two or three stragglers — and the build printed
" ok (2 players)" and wrote them to the cache. The seed guard caught the collapse (ktc: 928 → 4,
floor 80%) and kept the previous block, so nothing bad ever shipped; but the log claimed the
fetch had worked, the poisoned cache was handed to the next build, and the issue it opened
pointed at the hand-maintained February inputs, which have nothing to do with it.
"""
import importlib.util
import json
import os
import sys
import tempfile

_BS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build_seed.py")
spec = importlib.util.spec_from_file_location("build_seed", _BS)
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)

P = F = 0


def chk(c, label):
    global P, F
    if c:
        P += 1
        print("  PASS:", label)
    else:
        F += 1
        print("  FAIL:", label)


def page(rows):
    return "<html><script>var playersArray = " + json.dumps(rows) + ";</script></html>"


GOOD = [{"playerName": f"Player {i}", "slug": f"player-{i}-{1000+i}", "position": "WR"} for i in range(400)]
# what a rename looks like: the rows are all there, under different names
MOVED = [{"name": f"Player {i}", "playerSlug": f"player-{i}", "pos": "WR"} for i in range(400)]

print("=== the page as it was: every ranked player read ===")
got = bs.parse_ktc_players(page(GOOD))
chk(len(got) == 400, f"a healthy page parses its whole pool ({len(got)})")
chk(got.get("player 1", {}).get("slug") == "player-1-1001", "with the slug the player card links to")

print("=== the page after a rename: not a success ===")
chk(len(bs.parse_ktc_players(page(MOVED))) == 0, "renamed fields mean no row survives the filter")
chk(bs.KTC_MIN_PLAYERS > 10, f"and there is a floor under what counts as a fetch ({bs.KTC_MIN_PLAYERS})")


class _Resp:
    def __init__(self, body): self._b = body.encode()
    def read(self): return self._b
    def __enter__(self): return self
    def __exit__(self, *a): return False


def run_build(html):
    """build_ktc against a page, with the cache pointed at a scratch dir."""
    tmp = tempfile.mkdtemp()
    real_dir, real_open = bs.CACHE_DIR, bs.request.urlopen
    bs.CACHE_DIR = tmp
    bs.request.urlopen = lambda *a, **k: _Resp(html)
    try:
        out = bs.build_ktc(True)
        cached = os.path.exists(os.path.join(tmp, "ktc", "players.json"))
        return out, cached
    finally:
        bs.CACHE_DIR, bs.request.urlopen = real_dir, real_open


out, cached = run_build(page(GOOD))
chk(len(out) == 400, "a healthy page builds the map")
chk(cached, "and caches it")

out, cached = run_build(page(MOVED))
chk(out == {}, "a moved page builds NOTHING, rather than two stragglers the log calls ok")
chk(not cached, "and writes no cache — a bad scrape must not be handed to the next build")

# the seed guard is what stands behind this: an emptied block falls back to the previous seed
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import seed_refresh as SR  # noqa: E402
chk(SR.GUARDS.get("ktc", {}).get("never_empty") is True,
    "and the seed guard keeps the previous block rather than shipping an empty one")

print("=== the failure names what the rows carry now ===")
import io
import contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    run_build(page(MOVED))
msg = buf.getvalue()
chk("shape has moved" in msg, "the log says the page moved")
chk("'name'" in msg and "'pos'" in msg,
    "and prints the field names the rows carry now, so the fix is a rename and not another guess")
chk("parsed 0 of 400 rows" in msg, "with how many rows were there against how many read")

print(f"\nRESULT: {P}/{P + F} " + ("ALL PASS" if not F else "SOME FAILED"))
sys.exit(1 if F else 0)
