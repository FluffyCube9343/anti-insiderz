"""Run: python3 kalshi_server.py. Open http://127.0.0.1:8001/login.html."""
import json
import time
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

ENDPOINT = "https://external-api.kalshi.com/trade-api/v2/markets?limit=30&status=open&mve_filter=exclude"
ROOT = Path(__file__).resolve().parent
CACHE = None
CACHED_AT = 0
LOCK = threading.Lock()


def fetch_markets():
    global CACHE, CACHED_AT
    with LOCK:
        if CACHE is not None and time.monotonic() - CACHED_AT < 30:
            return CACHE
        request = Request(ENDPOINT, headers={"Accept": "application/json", "User-Agent": "NotAnInsiderDemo/1.0"})
        with urlopen(request, timeout=12) as response:
            data = json.load(response)
        if not isinstance(data.get("markets"), list):
            raise ValueError("Invalid market response")
        CACHE = {"markets": data["markets"], "source": ENDPOINT,
                 "fetchedAt": datetime.now(timezone.utc).isoformat()}
        CACHED_AT = time.monotonic()
        return CACHE


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/kalshi/markets":
            try:
                payload, status = fetch_markets(), 200
            except Exception as error:
                print("Kalshi fetch failed:", error, flush=True)
                payload, status = {"error": "Kalshi is unavailable. Check network access and try again."}, 502
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        allowed = {"/", "/index.html", "/login.html", "/markets.html", "/profile.html",
                   "/api-docs.html", "/kalshi.js", "/styles.css"}
        if path not in allowed:
            self.send_error(404)
            return
        self.path = "/index.html" if path == "/" else path
        super().do_GET()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


if __name__ == "__main__":
    print("Kalshi preview: http://127.0.0.1:8001/login.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8001), Handler).serve_forever()
