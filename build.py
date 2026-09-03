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
    python build.py            # rebuild the normal user-facing index.html from src/
    python build.py --dev      # rebuild a developer build (seed loader + developer-only UI)
    python build.py --check    # verify src/ rebuilds the current index.html (no write); exit 1 if not
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "index.html")
CSS_TOKEN = "@@CSS_PARTIALS@@"
JS_TOKEN = "@@JS_PARTIALS@@"
DEV_TOKEN = "__TC_DEV_MODE__"
# The seed-loading UI (📦 Seed button + hidden file input) is wrapped in these markers so the
# build can include or drop it. It is DEV-only: normal user-facing builds auto-load
# triplecrown_seed.json when hosted, while a developer build may still want the manual loader.
SEED_UI_RE = re.compile(r"[ \t]*<!--@@SEED_UI@@-->\n(.*?)[ \t]*<!--@@/SEED_UI@@-->\n", re.DOTALL)
INLINE_TEXT_RE = re.compile(r'__INLINE_TEXT__\("([^"]+)"\)')


def _inline_text_token(match):
    """Replace __INLINE_TEXT__("path") with a JSON-quoted file body.

    Paths are relative to src/. This keeps source partials readable while the final built
    index.html still ships the exact inline JS string the app expects.
    """
    rel = match.group(1)
    path = os.path.join(SRC, rel)
    with open(path, "r") as f:
        text = f.read()
    # Keep readable template sources as valid HTML in the editor, but convert script tags to
    # runtime placeholders before inlining them into the outer app <script> block. Otherwise a
    # literal </script> inside the template string would terminate the app script early.
    text = text.replace("<script>", "__TC_SCRIPT_OPEN__")
    text = text.replace("</script>", "__TC_SCRIPT_CLOSE__")
    return json.dumps(text)


def _read_partial(path):
    """Read one partial. Each is stored with a single trailing newline for editor-friendliness;
    strip exactly one so re-joining the partials with '\\n' reproduces the original block exactly."""
    with open(path, "r") as f:
        s = f.read()
    if s.endswith("\n"):
        s = s[:-1]
    s = INLINE_TEXT_RE.sub(_inline_text_token, s)
    return s


def _concat(dirpath):
    """Concatenate every partial in a directory, in filename order, joined by newlines."""
    files = sorted(f for f in os.listdir(dirpath) if not f.startswith("."))
    return "\n".join(_read_partial(os.path.join(dirpath, f)) for f in files), files


def build(dev=False):
    """Assemble the single-file index.html string from the src/ partials.

    `dev=True` keeps the seed-loading UI (📦 Seed button + file input) and any developer-only
    UI. The default build strips those extras so the shipped app stays user-facing."""
    with open(os.path.join(SRC, "index.template.html"), "r") as f:
        template = f.read()
    css, css_files = _concat(os.path.join(SRC, "css"))
    js, js_files = _concat(os.path.join(SRC, "js"))
    if CSS_TOKEN not in template or JS_TOKEN not in template:
        raise SystemExit(f"template is missing {CSS_TOKEN} or {JS_TOKEN}")
    out = template.replace(CSS_TOKEN, css).replace(JS_TOKEN, js)
    out = out.replace(DEV_TOKEN, "1" if dev else "0")
    # Static template can't call TC_ICON(), so @@ICON_name@@ placeholders are substituted here
    # with the same inline SVGs (kept in sync with src/js/03-icons.js).
    out = _sub_icons(out)
    # Include the seed UI (keep only the inner content) or strip it entirely.
    out = SEED_UI_RE.sub((lambda m: m.group(1)) if dev else "", out)
    return out, css_files, js_files


# Inline-SVG icon bodies mirroring src/js/03-icons.js (menu + header use the placeholder form
# because the template is static HTML). Keep these identical to the JS `paths` map.
_ICON_PATHS = {
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    "chat": '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/><path d="M8.5 10.5h7M8.5 13.5h4"/>',
    "scale": '<path d="M12 4v15M8 19h8M6 7l12-2"/><path d="m6 7-2.3 5.2a2.6 2.6 0 0 0 4.6 0L6 7ZM18 5l-2.3 5.2a2.6 2.6 0 0 0 4.6 0L18 5Z"/>',
    "clipboard": '<rect x="8" y="3" width="8" height="4" rx="1"/><rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 10h6M9 14h6M9 18h4"/>',
    "chart": '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
    "stadium": '<rect x="2.5" y="6" width="19" height="12" rx="6"/><ellipse cx="12" cy="12" rx="5.5" ry="3"/>',
    "trophy": ('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" fill="currentColor" stroke="none"/>'
               '<path d="M8 5H5.5A2.5 2.5 0 0 0 8 8.5M16 5h2.5A2.5 2.5 0 0 1 16 8.5"/>'
               '<path d="M12 13v3M9 20h6M10 20v-1.5a2 2 0 0 1 4 0V20"/>'),
    "refresh": '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 3v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16M4 21v-5h5"/>',
    "link": '<path d="M9 15l6-6M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5"/>',
    "export": '<path d="M12 15V4M8 8l4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
    "download": '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
    "box": '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    "undo": '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10"/>',
    "user": '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
    "folder": '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    "save": '<path d="M5 4h10l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M15 4v5H7V4M12 11v7M9 15l3 3 3-3"/>',
}
_ICON_RE = re.compile(r"@@ICON_([a-zA-Z]+)@@")


def _sub_icons(text):
    def repl(m):
        body = _ICON_PATHS.get(m.group(1))
        if body is None:
            return m.group(0)
        return (f'<svg viewBox="0 0 24 24" class="tc-ico" fill="none" stroke="currentColor" '
                f'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '
                f'aria-hidden="true">{body}</svg>')
    return _ICON_RE.sub(repl, text)


def main():
    check = "--check" in sys.argv
    dev = ("--dev" in sys.argv) or ("--offline" in sys.argv)
    # Optional custom output path (e.g. `--out index_offline.html`); defaults to index.html.
    out_path = OUT
    if "--out" in sys.argv:
        i = sys.argv.index("--out")
        if i + 1 < len(sys.argv):
            out_path = os.path.abspath(sys.argv[i + 1])
    out, css_files, js_files = build(dev=dev)
    mode = "dev" if dev else "normal"
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
