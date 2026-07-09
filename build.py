#!/usr/bin/env python3
"""Concatenate the editable src/ partials back into the single-file index.html.

TripleCrown ships as ONE self-contained index.html (works offline from file://, bakes onto a
phone, zero runtime deps). That single file is great for USERS but painful to EDIT, so the source
is kept split under src/:

    src/index.template.html   the HTML shell, with @@CSS_PARTIALS@@ / @@JS_PARTIALS@@ tokens
    src/css/*.css             the stylesheet, split by feature (concatenated in filename order)
    src/js/*.js               the app JS, split by feature  (concatenated in filename order)

Running this script re-assembles index.html. Concatenation (not module bundling) keeps every
function/global in the one shared scope the app + test harness rely on, and the numeric filename
prefixes fix the order so top-level `let`/`const` initialise exactly as before. The output is
byte-for-byte what you'd get hand-editing index.html — nothing about the shipped app changes.

Usage:
    python build.py            # rebuild index.html from src/
    python build.py --check    # verify src/ rebuilds the current index.html (no write); exit 1 if not
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "index.html")
CSS_TOKEN = "@@CSS_PARTIALS@@"
JS_TOKEN = "@@JS_PARTIALS@@"
# The seed-loading UI (📦 Seed button + hidden file input) is wrapped in these markers so the
# build can include or drop it. It's OFFLINE-only: hosted copies auto-load triplecrown_seed.json
# (so a manual loader is redundant), while a local file:// copy with no server may still want it.
SEED_UI_RE = re.compile(r"[ \t]*<!--@@SEED_UI@@-->\n(.*?)[ \t]*<!--@@/SEED_UI@@-->\n", re.DOTALL)


def _read_partial(path):
    """Read one partial. Each is stored with a single trailing newline for editor-friendliness;
    strip exactly one so re-joining the partials with '\\n' reproduces the original block exactly."""
    with open(path, "r") as f:
        s = f.read()
    if s.endswith("\n"):
        s = s[:-1]
    return s


def _concat(dirpath):
    """Concatenate every partial in a directory, in filename order, joined by newlines."""
    files = sorted(f for f in os.listdir(dirpath) if not f.startswith("."))
    return "\n".join(_read_partial(os.path.join(dirpath, f)) for f in files), files


def build(offline=False):
    """Assemble the single-file index.html string from the src/ partials.

    `offline=True` keeps the seed-loading UI (📦 Seed button + file input); the default
    (online) build strips it — hosted copies auto-load triplecrown_seed.json, so a manual
    loader is redundant clutter there."""
    with open(os.path.join(SRC, "index.template.html"), "r") as f:
        template = f.read()
    css, css_files = _concat(os.path.join(SRC, "css"))
    js, js_files = _concat(os.path.join(SRC, "js"))
    if CSS_TOKEN not in template or JS_TOKEN not in template:
        raise SystemExit(f"template is missing {CSS_TOKEN} or {JS_TOKEN}")
    out = template.replace(CSS_TOKEN, css).replace(JS_TOKEN, js)
    # Include the seed UI (keep only the inner content) or strip it entirely.
    out = SEED_UI_RE.sub((lambda m: m.group(1)) if offline else "", out)
    return out, css_files, js_files


def main():
    check = "--check" in sys.argv
    offline = "--offline" in sys.argv
    # Optional custom output path (e.g. `--out index_offline.html`); defaults to index.html.
    out_path = OUT
    if "--out" in sys.argv:
        i = sys.argv.index("--out")
        if i + 1 < len(sys.argv):
            out_path = os.path.abspath(sys.argv[i + 1])
    out, css_files, js_files = build(offline=offline)
    mode = "offline" if offline else "online"
    if check:
        current = open(OUT).read() if os.path.exists(OUT) else ""
        if out != current:
            print(f"✗ src/ does NOT rebuild the current index.html ({mode} build — run `python build.py`).")
            sys.exit(1)
        print(f"✓ src/ rebuilds index.html exactly ({mode}; {len(css_files)} css + {len(js_files)} js partials).")
        return
    with open(out_path, "w") as f:
        f.write(out)
    print(f"Built {os.path.basename(out_path)} ({len(out):,} bytes, {mode}) from {len(css_files)} css + {len(js_files)} js partials.")


if __name__ == "__main__":
    main()
