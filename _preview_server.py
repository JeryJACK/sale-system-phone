"""Local mobile preview: static files + same-origin proxy to production API."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import ssl
import urllib.error
import urllib.request

UPSTREAM = "https://118.178.95.24"


class Handler(SimpleHTTPRequestHandler):
    def _proxy(self, method):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length")}
        req = urllib.request.Request(UPSTREAM + self.path, data=body, headers=headers, method=method)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        try:
            resp = urllib.request.urlopen(req, timeout=30, context=ctx)
        except urllib.error.HTTPError as exc:
            resp = exc
        except Exception as exc:
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write((f'{{"ok":false,"error":"preview proxy: {exc}"}}').encode("utf-8"))
            return
        self.send_response(resp.status)
        for key, value in resp.headers.items():
            if key.lower() in ("transfer-encoding", "connection", "content-encoding", "content-length"):
                continue
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(resp.read())

    def do_GET(self):
        if urlsplit(self.path).path.startswith("/api/"):
            self._proxy("GET")
        else:
            super().do_GET()

    def do_POST(self):
        self._proxy("POST")

    def do_PUT(self):
        self._proxy("PUT")

    def do_DELETE(self):
        self._proxy("DELETE")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PREVIEW_PORT", "8765"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
