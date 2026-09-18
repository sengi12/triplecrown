#!/usr/bin/env python3
"""Render every formation the playbook can draw, and check each one is a legal, sane picture.

The playsheet draws a formation diagram per personnel grouping, and the name on the card comes
from a catalogue baked into src/templates/coaching-template.html. Names and pictures can drift
apart silently — nothing in the unit tests looks at where the dots land — so this renders all of
them in a real browser and measures the result.

What it asserts, per card:
    * exactly 11 players are on the field
    * the badges match the personnel code (11 personnel is one back and one tight end, always)
    * nobody stands in front of the line of scrimmage, and nobody is off the card
    * no two players overlap, except the deliberately tight pairs (a stacked receiver, the
      point man of a bunch), which are marked as such by the renderer

Usage:
    # against a baked, seeded build (what the app actually ships)
    python tools/formation_check.py --html /path/to/baked.html

    # against an already-served build
    python tools/formation_check.py --url http://127.0.0.1:8765/tc_full.html

    # also write a contact sheet you can open and LOOK at — the checks below catch illegal
    # pictures, not wrong ones. A formation can pass every rule and still not be the formation
    # it is named after, and the only way to find that is to compare it against the real thing.
    python tools/formation_check.py --html baked.html --sheet /tmp/formations.html

Needs: Google Chrome, and `pip install websocket-client`. Use the project interpreter
(~/.pyenv/versions/nfl/bin/python) — the repo's bare python3 is missing packages.
"""
import argparse, functools, http.server, json, os, re, socket, socketserver, subprocess
import sys, threading, time, urllib.request

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
]

# The card's own coordinate space: 330 wide, the line of scrimmage at y=196, badges r=9.
FIELD_W, LOS_Y, BADGE_R = 330, 196, 9


def _chrome():
    """The browser to drive: $CHROME_BIN, a system Chrome, or a Playwright-managed one.

    Linux CI images generally have no system Chrome but do ship Playwright's, whose path
    carries a build number that changes under you — so glob for it rather than pin one.
    """
    import glob
    cands = [os.environ["CHROME_BIN"]] if os.environ.get("CHROME_BIN") else []
    cands += CHROME_CANDIDATES
    pw = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or "/opt/pw-browsers"
    cands += sorted(glob.glob(os.path.join(pw, "chromium-*", "chrome-linux", "chrome")), reverse=True)
    for p in cands:
        if os.path.exists(p):
            return p
    raise SystemExit("No Chrome found — set $CHROME_BIN, or add a path to CHROME_CANDIDATES.")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(directory):
    """Serve a directory on a spare port; the app needs http:// rather than file://."""
    port = _free_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


class Page:
    """The smallest CDP client that can drive the app: launch, evaluate, close."""

    def __init__(self, width=1180, height=1000):
        self.port, self._id = _free_port(), 0
        self.proc = subprocess.Popen(
            [_chrome(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
             "--remote-allow-origins=*", f"--remote-debugging-port={self.port}",
             f"--user-data-dir=/tmp/tc-formcheck-{os.getpid()}", "--no-first-run"]
            # Chrome's sandbox cannot start as root, which is how it runs in a container.
            + (["--no-sandbox", "--disable-dev-shm-usage"]
               if hasattr(os, "geteuid") and os.geteuid() == 0 else [])
            + ["about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import websocket  # imported here so --help works without it installed
        tabs = None
        for _ in range(120):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json"))
                break
            except Exception:
                time.sleep(0.25)
        if not tabs:
            raise SystemExit("Chrome did not start.")
        url = [t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"]
        self.ws = websocket.create_connection(url, timeout=180)
        for m in ("Page.enable", "Runtime.enable"):
            self.send(m)
        self.send("Emulation.setDeviceMetricsOverride",
                  {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})

    def send(self, method, params=None, timeout=180):
        self._id += 1
        mid = self._id
        self.ws.settimeout(timeout)
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == mid:
                if "error" in r:
                    raise RuntimeError(f"{method}: {r['error']}")
                return r.get("result", {})

    def ev(self, js, timeout=120):
        r = self.send("Runtime.evaluate",
                      {"expression": js, "awaitPromise": True, "returnByValue": True,
                       "timeout": timeout * 1000}, timeout=timeout + 10)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError((d.get("exception", {}).get("description") or d.get("text"))[:400])
        v = r.get("result", {})
        return v.get("value", v.get("description"))

    def open_playbook(self, url, team="CIN", season="2025"):
        self.send("Page.navigate", {"url": url})
        for _ in range(180):
            time.sleep(0.5)
            try:
                if self.ev("(typeof buildProjectionList==='function' && buildProjectionList().length>100)", 10) is True:
                    break
            except Exception:
                pass
        else:
            raise SystemExit(f"the app never finished loading from {url}")
        self.ev(f"openTeamCoachingScheme('{team}'); 1")
        self.ev("new Promise(r=>setTimeout(r,2500))")
        self.ev(f"schemeSeason='{season}'; _renderTeamCoachingScheme(); 1")
        self.ev("new Promise(r=>setTimeout(r,3000))")

    def close(self):
        try:
            self.ws.close()
        finally:
            self.proc.terminate()


# The playsheet renders inside <iframe srcdoc>, so the drawing functions live in that frame's
# scope and are reached through its contentWindow, not from the parent page.
FRAME = "document.querySelector('iframe.scheme-frame').contentWindow"

READ_CATALOGUE = f"""(()=>{{const w={FRAME};
  const cat = w.eval('FORMATION_NAMES');
  const out = [];
  for(const [k,v] of Object.entries(cat.f||{{}})) out.push([k, v[0], false]);
  for(const [k,v] of Object.entries(cat.e||{{}})) out.push([k, v[0], true]);
  return JSON.stringify(out);}})()"""

DRAW = """(()=>{const w=%s;
  const rb=%d, te=%d, wr=%d, backs=%d, assigns=[];
  for(let i=0;i<wr;i++) assigns.push({slot:'WR'+(i+1), name:'WR'+(i+1), routes:[]});
  for(let i=0;i<te;i++) assigns.push({slot:'TE'+(i+1), name:'TE'+(i+1), routes:[]});
  for(let i=0;i<rb;i++) assigns.push({slot:'RB'+(i+1), name:'RB'+(i+1), routes:[]});
  // ol is whatever is left of eleven once the quarterback and the skill players are placed
  // pbacks is what the personnel says; backs is what the charting saw line up back there.
  // They disagree on about a third of real plays, and that disagreement is where the bugs live.
  const g={p:String(rb)+String(te), align:'%s', name:'%s', backs: backs, pbacks:rb,
           te:te, wr:wr, ol:11-1-rb-te-wr, assigns, n:0, share:0};
  const vars=w.variantsFor(g), out=[];
  for(let i=0;i<vars.length;i++){ let svg='';
    try{ svg=w.fieldSvg(g,'none',{},0,i); }catch(e){ svg='ERR '+e.message; }
    out.push({name:vars[i].name, svg}); }
  return JSON.stringify(out);})()"""

BADGE = re.compile(
    r'<circle[^>]*cx="([-\d.]+)"[^>]*cy="([-\d.]+)"[^>]*r="9"(?P<snug>[^>]*data-snug)?'
    r'[^>]*/>\s*<text[^>]*>([A-Z]{2})</text>')


def badges(svg):
    """(x, y, role, snug) per player. `snug` marks a pair the renderer meant to keep tight."""
    return [(float(m.group(1)), float(m.group(2)), m.group(4), bool(m.group("snug")))
            for m in BADGE.finditer(svg)]


def check(card):
    """Every way this card could be an illegal or impossible picture."""
    bad, p = [], badges(card["svg"])
    linemen = len(re.findall(r"<rect", card["svg"]))
    if linemen + len(p) != 11:
        bad.append(f"{linemen + len(p)} players on the field, not 11")

    counts = {r: 0 for r in ("RB", "FB", "TE", "WR")}
    for _, _, r, _ in p:
        if r in counts:
            counts[r] += 1
    drew = (counts["RB"] + counts["FB"], counts["TE"], counts["WR"])
    want = (card["rb"], card["te"], card["wr"])
    if drew != want:
        bad.append(f"drew {drew[0]}RB/{drew[1]}TE/{drew[2]}WR but the personnel code says "
                   f"{want[0]}RB/{want[1]}TE/{want[2]}WR")

    for x, y, role, _ in p:
        if not (BADGE_R < x < FIELD_W - BADGE_R):
            bad.append(f"a {role} at x={x:.0f} hangs off the card")
        if y < LOS_Y - 1:
            bad.append(f"a {role} is in front of the line of scrimmage (y={y:.0f})")

    # Two badges may touch only where the renderer meant them to — a stacked receiver, or the
    # point man of a bunch. Both of those carry `snug`; anything else that close is a collision.
    for i, a in enumerate(p):
        for b in p[i + 1:]:
            if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 < 2 * BADGE_R and not (a[3] and b[3]):
                bad.append(f"the {a[2]} at x={a[0]:.0f} and the {b[2]} at x={b[0]:.0f} overlap")
    return bad


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--html", help="a baked, seeded build to serve and drive")
    src.add_argument("--url", help="a build already being served")
    ap.add_argument("--team", default="CIN")
    ap.add_argument("--season", default="2025")
    ap.add_argument("--sheet", help="write a contact sheet of every formation to this path")
    ap.add_argument("--json", help="write the raw rendered cards to this path")
    args = ap.parse_args()

    httpd = None
    if args.html:
        path = os.path.abspath(args.html)
        httpd, port = _serve(os.path.dirname(path))
        url = f"http://127.0.0.1:{port}/{os.path.basename(path)}"
    else:
        url = args.url

    page = Page()
    cards = []
    try:
        page.open_playbook(url, args.team, args.season)
        catalogue = json.loads(page.ev(READ_CATALOGUE))
        print(f"catalogue: {len(catalogue)} personnel groupings")
        for key, family, empty in catalogue:
            align, rb, te, wr = key.split("|")
            rb, te, wr = int(rb), int(te), int(wr)
            if empty:
                rb = 1  # an empty set still has a back on the field; he lined up split out
            # Sweep how many bodies the charting put in the backfield. Personnel decides WHO is
            # on the field, the backfield count only decides WHERE they stand, and the two
            # disagree constantly — a tight end motions in, a back splits out. Rendering only
            # the tidy case (backs == the personnel's RB count) misses exactly the bug that put
            # two running backs on an 11-personnel card.
            sweep = [0] if empty else sorted({rb, rb + 1} & set(range(0, rb + te + wr + 1)))
            for backs in sweep:
                looks = json.loads(page.ev(DRAW % (FRAME, rb, te, wr, backs, align, family)))
                for lk in looks:
                    cards.append(dict(align=align, rb=rb, te=te, wr=wr, backs=backs, empty=empty,
                                      family=family, personnel=f"{rb}{te}", name=lk["name"],
                                      svg=lk["svg"]))
    finally:
        page.close()
        if httpd:
            httpd.shutdown()

    broke = [c for c in cards if c["svg"].startswith("ERR")]
    faults = [(f'{c["name"]} [{c["backs"]} in the backfield]', c["personnel"], check(c))
              for c in cards if not c["svg"].startswith("ERR")]
    faults = [f for f in faults if f[2]]

    print(f"formations drawn: {len(cards)}   render errors: {len(broke)}")
    shapes = len({tuple(sorted(badges(c["svg"]))) for c in cards if not c["svg"].startswith("ERR")})
    print(f"distinct shapes:  {shapes} across {len(cards)} names")
    for c in broke[:10]:
        print(f"  BROKE  {c['name']}: {c['svg'][:90]}")
    for name, pers, msgs in faults[:40]:
        for m in msgs:
            print(f"  FAULT  {name} ({pers}): {m}")
    print(f"\n{len(faults)} card(s) with faults, {len(broke)} that would not draw at all")

    if args.json:
        json.dump(cards, open(args.json, "w"))
        print(f"cards written to {args.json}")
    if args.sheet:
        write_sheet(cards, args.sheet)
        print(f"contact sheet written to {args.sheet} — open it and compare against the real "
              f"formations; these checks cannot tell you a picture is wrong, only that it is illegal")
    return 1 if (faults or broke) else 0


def write_sheet(cards, path):
    import html as _h
    order = {"uc": 0, "gun": 1, "pistol": 2}
    cards = sorted(cards, key=lambda c: (order.get(c["align"], 9), c["empty"], -c["rb"], c["te"],
                                         c["name"], c["backs"]))
    out = []
    for c in cards:
        svg = re.sub(r'\sdata-[a-z-]+="[^"]*"', "", c["svg"])
        svg = re.sub(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', r'viewBox="0 174 \1 128"', svg, count=1)
        tag = " · empty backfield" if c["empty"] else (
            f' · {c["backs"]} in the backfield' if c["backs"] != c["rb"] else "")
        out.append(f'<figure><div class="d">{svg}</div><figcaption>{_h.escape(c["name"])}'
                   f'<em>{c["personnel"]} · {c["rb"]}RB {c["te"]}TE {c["wr"]}WR{tag}</em>'
                   f"</figcaption></figure>")
    open(path, "w").write(
        "<title>Formations</title><style>body{background:#e9e3d4;font-family:system-ui;margin:0;"
        "padding:10px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));"
        "gap:10px}figure{margin:0;background:#f8f5ec;border:1px solid #cfc6b0;border-radius:3px;"
        "overflow:hidden}.d svg{display:block;width:100%;height:auto}figcaption{padding:5px 8px;"
        "font:700 14px ui-monospace,monospace;border-top:1px solid #cfc6b0}em{display:block;"
        "font-style:normal;font-weight:400;color:#77705c;font-size:11.5px}</style>"
        f'<div class="g">{"".join(out)}</div>')


if __name__ == "__main__":
    sys.exit(main())
