#!/usr/bin/env python3
"""Serve the Pages artifact locally, the way GitHub Pages actually serves it.

Opening index.html from the filesystem is not a faithful test: file:// blocks fetch(), so the
seed never auto-loads and no service worker can register. This builds the same _site/ the
Actions workflow builds and serves it over http with Pages-like headers, so what you see in the
browser is what the deploy will do.

    python3 tools/preview.py                 # build + serve on http://localhost:8080
    python3 tools/preview.py --minify        # ...with the deploy's minify step applied
    python3 tools/preview.py --compare       # build BOTH, serve unminified :8080 + minified :8081
    python3 tools/preview.py --host-encoded  # simulate Vercel/Cloudflare (Content-Encoding: gzip)

With --compare, open both ports and run tools/tc-selfcheck.js in each. They are different
origins, so each gets its own service worker and cache — no cross-contamination.

Headers, matching GitHub Pages:
  * .json.gz is served as an opaque application/gzip body with NO Content-Encoding, so the app
    inflates it itself. --host-encoded flips that to Content-Encoding: gzip (the browser
    inflates it) to exercise the other code path.
  * ETag + Cache-Control: max-age=600, so cache behaviour matches too.
  * html/js/css/json are gzipped on the fly when the client asks, like Pages does — without
    this, comparing "bytes over the wire" between builds would be meaningless.

Python 3 standard library only, like build.py and bake_seed.py.
"""
import argparse
import gzip as gziplib
import hashlib
import http.server
import os
import posixpath
import shutil
import socketserver
import subprocess
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
}


SEEDS_DIR = "seeds"


def build_site(dest, minify):
    """Mirror .github/workflows/pages.yml."""
    subprocess.run([sys.executable, os.path.join(ROOT, "build.py")], check=True,
                   cwd=ROOT, stdout=subprocess.DEVNULL)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(os.path.join(dest, "seeds"))
    os.makedirs(os.path.join(dest, "images"))
    shutil.copy(os.path.join(ROOT, "index.html"), os.path.join(dest, "index.html"))
    for name in ("app-icon.png", "ktc.png"):
        src = os.path.join(ROOT, "images", name)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(dest, "images", name))
    seeds = SEEDS_DIR if os.path.isabs(SEEDS_DIR) else os.path.join(ROOT, SEEDS_DIR)
    for f in sorted(os.listdir(seeds)):
        if f.endswith(".json.gz"):
            shutil.copy(os.path.join(seeds, f), os.path.join(dest, "seeds", f))
    for extra in ("manifest.webmanifest",):
        src = os.path.join(ROOT, extra)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(dest, extra))
    sw = os.path.join(ROOT, "sw.js")
    if os.path.exists(sw):
        with open(sw, encoding="utf-8") as fh:
            body = fh.read()
        # The workflow stamps this with the commit SHA; locally, mark it clearly as a preview
        # so the self-check's "was this the artifact?" probe reports honestly.
        body = body.replace("__BUILD_ID__", "local-" + ("min" if minify else "raw"))
        with open(os.path.join(dest, "sw.js"), "w", encoding="utf-8") as fh:
            fh.write(body)
    if minify:
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "minify_site.py"),
                        os.path.join(dest, "index.html")], check=False, cwd=ROOT)
    size = os.path.getsize(os.path.join(dest, "index.html"))
    print(f"  {os.path.basename(dest)}: index.html {size:,} bytes"
          f" ({'minified' if minify else 'unminified'})")


class Handler(http.server.BaseHTTPRequestHandler):
    directory = "."
    host_encoded = False

    def log_message(self, *a):
        pass

    def _resolve(self):
        path = self.path.split("?")[0].split("#")[0]
        path = posixpath.normpath(path)
        if path.endswith("/"):
            path += "index.html"
        local = os.path.join(self.directory, path.lstrip("/"))
        if os.path.isdir(local):
            local = os.path.join(local, "index.html")
        return local

    def do_HEAD(self):
        self._respond(head_only=True)

    def do_GET(self):
        self._respond(head_only=False)

    def _respond(self, head_only):
        local = self._resolve()
        if not os.path.isfile(local):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            if not head_only:
                self.wfile.write(b"404")
            return
        with open(local, "rb") as fh:
            body = fh.read()
        is_gz = local.endswith(".gz")
        base = local[:-3] if is_gz else local
        ext = os.path.splitext(base)[1].lower()
        etag = '"%s"' % hashlib.sha1(body).hexdigest()[:16]
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        self.send_response(200)
        if is_gz and self.host_encoded:
            # Vercel / Cloudflare / nginx gzip_static: the BROWSER inflates it.
            self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
            self.send_header("Content-Encoding", "gzip")
        elif is_gz:
            # GitHub Pages: opaque bytes, the app inflates it.
            self.send_header("Content-Type", "application/gzip")
        else:
            self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        # Pages gzips text responses when the client advertises support. Match that, or every
        # "bytes over the wire" number measured here is wrong by 3-4x.
        if (not is_gz
                and ext in (".html", ".js", ".css", ".json", ".svg", ".webmanifest")
                and "gzip" in (self.headers.get("Accept-Encoding") or "")):
            body = gziplib.compress(body, 6)
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=600")
        self.send_header("ETag", etag)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve(directory, port, host_encoded):
    handler = type("H", (Handler,), {"directory": directory, "host_encoded": host_encoded})
    srv = Server(("", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minify", action="store_true", help="apply the deploy's minify step")
    ap.add_argument("--compare", action="store_true", help="serve unminified and minified side by side")
    ap.add_argument("--host-encoded", action="store_true",
                    help="serve .gz with Content-Encoding: gzip (simulates Vercel/Cloudflare)")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--seeds", default="seeds",
                    help="seed directory to serve as /seeds/ (e.g. seeds_tm from build_seed.py --as-of --out-dir)")
    args = ap.parse_args()
    global SEEDS_DIR
    SEEDS_DIR = args.seeds

    print("Building…")
    if args.compare:
        raw = os.path.join(ROOT, "_preview_raw")
        mini = os.path.join(ROOT, "_preview_min")
        build_site(raw, minify=False)
        build_site(mini, minify=True)
        serve(raw, args.port, args.host_encoded)
        serve(mini, args.port + 1, args.host_encoded)
        print(f"\n  unminified  http://localhost:{args.port}/")
        print(f"  minified    http://localhost:{args.port + 1}/")
        print("\nOpen both, let each finish loading, open Rankings, and run tools/tc-selfcheck.js in each.")
    else:
        dest = os.path.join(ROOT, "_preview")
        build_site(dest, minify=args.minify)
        serve(dest, args.port, args.host_encoded)
        print(f"\n  http://localhost:{args.port}/")
    if args.host_encoded:
        print("  (.gz served with Content-Encoding: gzip — the Vercel/Cloudflare code path)")
    print("\nCtrl-C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
