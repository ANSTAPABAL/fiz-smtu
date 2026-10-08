"""Vercel's single Python Function adapter for the existing HTTP handler."""

import sys
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("APP_ENV", "production")

from server import App, init_db  # noqa: E402


init_db()


def original_request_path(path):
    """Restore the request path captured by vercel.json's API rewrite."""
    parsed = urlsplit(path)
    pairs = parse_qsl(parsed.query, keep_blank_values=True)
    route = next((value for key, value in pairs if key == "__vercel_path"), "")
    query = [(key, value) for key, value in pairs if key != "__vercel_path"]
    route_path = "/health" if route.lstrip("/") == "health" else "/api/" + route.lstrip("/")
    return route_path + ("?" + urlencode(query) if query else "")


class handler(App):
    def parse_request(self):
        valid = super().parse_request()
        if valid:
            self.path = original_request_path(self.path)
        return valid
