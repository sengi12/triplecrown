#!/usr/bin/env python3
"""Minify the app script inside a built _site/index.html, in place.

Why this exists
---------------
TripleCrown ships as one self-contained index.html whose <script> block is the entire app —
about 1.1MB of source, comments and all. Gzip hides some of that on the wire, but the browser
still has to PARSE and COMPILE every byte before boot() runs, and on a mid-range phone that is
several hundred milliseconds of dead time before anything happens.

Minifying only the deployed copy keeps both properties we want:
  * src/ stays readable, and `python build.py --check` still verifies src/ against the
    committed (unminified) index.html — the source-parity guarantee is untouched.
  * only what the browser downloads gets squeezed.

Deliberately NOT passed to terser: --toplevel / --mangle toplevel. The app is 45 partials
concatenated into ONE shared scope and the HTML has inline onclick="someGlobal()" handlers, so
top-level names must survive verbatim. Local names inside functions are mangled freely.

If terser is unavailable or fails, this exits 0 and leaves the file untouched — a deploy must
never fail because an optimisation was unavailable.

Usage: python3 tools/minify_site.py [_site/index.html]
"""
import pathlib
import re
import subprocess
import sys

TARGET = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "_site/index.html")
# The app block is the LAST <script>...</script> in the document (the template puts it at the
# very end of <body>). Matching the last one avoids touching anything added to <head> later.
BLOCK = re.compile(r"<script>\n(.*)\n</script>", re.S)


def warn(msg):
    # GitHub Actions renders this as an annotation; harmless locally.
    print(f"::warning::{msg}")


def main():
    if not TARGET.exists():
        warn(f"{TARGET} not found — nothing to minify")
        return 0

    html = TARGET.read_text()
    matches = list(BLOCK.finditer(html))
    if not matches:
        warn("could not locate the app <script> block — shipping unminified")
        return 0
    m = matches[-1]
    js = m.group(1)

    try:
        out = subprocess.run(
            ["npx", "--yes", "terser@5", "-c", "-m", "--comments", "false"],
            input=js, capture_output=True, text=True, timeout=600,
        )
    except Exception as exc:  # npx missing, network down, timeout…
        warn(f"terser could not be run ({exc}) — shipping unminified")
        return 0

    if out.returncode != 0 or not out.stdout.strip():
        warn("terser failed — shipping unminified")
        sys.stderr.write(out.stderr[:2000])
        return 0

    mini = out.stdout
    before, after = len(js), len(mini)
    if after >= before:
        warn("minified output was not smaller — shipping unminified")
        return 0

    TARGET.write_text(html[: m.start(1)] + mini + html[m.end(1):])
    pct = 100 * (before - after) // before
    print(f"app JS {before:,} -> {after:,} chars ({pct}% smaller)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
