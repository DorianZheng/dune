"""
Dune Proxy — tiny HTTP server inside SkillBox container.
Runs on localhost:3200, proxies to backend API.
Resolves channel names → IDs, injects agent authorId for /send, and injects
system actor headers for /sandboxes/v1/*.

Env vars (set by agent-manager.ts):
  DUNE_API_URL   — backend URL (e.g. http://host.docker.internal:50011)
  DUNE_AGENT_ID  — this agent's UUID
  DUNE_AGENT_NAME — this agent's display name
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

API_URL = os.environ["DUNE_API_URL"]
AGENT_ID = os.environ["DUNE_AGENT_ID"]
AGENT_NAME = os.environ.get("DUNE_AGENT_NAME", "Agent")
PORT = int(os.environ.get("DUNE_PROXY_PORT", "3200"))

# Cache: channel name → id
_channel_cache = {}


def _decode_json_or_text(raw):
    if not raw:
        return {}
    text = raw.decode()
    try:
        return json.loads(text)
    except Exception:
        return text


def api_with_status(method, path, body=None):
    """Make a request to the backend API and return (status, parsed body)."""
    url = f"{API_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as resp:
            return int(resp.status), _decode_json_or_text(resp.read())
    except HTTPError as e:
        return int(e.code), _decode_json_or_text(e.read())
    except Exception as e:
        return 502, {"error": str(e), "status": 502}


def api(method, path, body=None):
    """Make a JSON request to the backend API."""
    status, payload = api_with_status(method, path, body)
    if 200 <= status < 300:
        return payload
    if isinstance(payload, dict):
        payload.setdefault("status", status)
        return payload
    return {"error": str(payload), "status": status}


def proxy_api_request(method, parsed, body_bytes, content_type, accept, api_path=None):
    """Forward a request to backend with system actor headers.
    If api_path is given, use it directly; otherwise prefix with /api."""
    query = f"?{parsed.query}" if parsed.query else ""
    path = api_path if api_path else f"/api{parsed.path}"
    url = f"{API_URL}{path}{query}"
    headers = {
        "X-Actor-Type": "system",
        "X-Actor-Id": f"agent:{AGENT_ID}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if accept:
        headers["Accept"] = accept

    req = Request(url, data=body_bytes if body_bytes else None, headers=headers, method=method)
    try:
        with urlopen(req, timeout=90) as resp:
            return (
                int(resp.status),
                dict(resp.headers.items()),
                resp.read(),
            )
    except HTTPError as e:
        return (
            int(e.code),
            dict(e.headers.items()) if e.headers else {},
            e.read(),
        )
    except Exception as e:
        payload = json.dumps({"error": str(e), "status": 502}).encode()
        return (502, {"Content-Type": "application/json"}, payload)


def resolve_channel(name):
    """Resolve channel name → ID, with caching."""
    if name in _channel_cache:
        return _channel_cache[name]
    ch = api("GET", f"/api/channels/by-name/{name}")
    if "id" in ch:
        _channel_cache[name] = ch["id"]
        return ch["id"]
    return None


import re

# Routes that proxy to /api/* with system actor headers (agent/channel lifecycle)
_LIFECYCLE_ROUTES = [
    # Agents
    (re.compile(r"^/agents/([^/]+)/(start|stop)$"), lambda m: f"/api/agents/{m.group(1)}/{m.group(2)}"),
    (re.compile(r"^/agents/([^/]+)$"), lambda m: f"/api/agents/{m.group(1)}"),
    (re.compile(r"^/agents$"), lambda m: "/api/agents"),
    # Channels
    (re.compile(r"^/channels/([^/]+)/subscribe$"), lambda m: f"/api/channels/{m.group(1)}/subscribe"),
    (re.compile(r"^/channels/([^/]+)$"), lambda m: f"/api/channels/{m.group(1)}"),
    (re.compile(r"^/channels$"), lambda m: "/api/channels"),
    # Todos
    (re.compile(r"^/api/todos/([^/]+)$"), lambda m: f"/api/todos/{m.group(1)}"),
    (re.compile(r"^/api/todos$"), lambda m: "/api/todos"),
]


def match_lifecycle_route(path):
    """Check if path matches an agent/channel lifecycle route. Returns backend API path or None."""
    for pattern, builder in _LIFECYCLE_ROUTES:
        m = pattern.match(path)
        if m:
            return builder(m)
    return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress request logs

    def _respond_json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body_bytes(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _proxy_passthrough(self, method):
        """Try to proxy sandboxes or lifecycle routes. Returns True if handled."""
        parsed = urlparse(self.path)

        # Check sandbox routes (all methods including GET)
        if parsed.path.startswith("/sandboxes/v1/"):
            api_path = None  # will use /api prefix
        elif parsed.path.startswith("/api/todos"):
            # Todo routes — proxy all methods including GET
            api_path = match_lifecycle_route(parsed.path)
            if api_path is None:
                return False
        elif method != "GET":
            # Lifecycle routes only for mutating methods — GET has dedicated handlers
            api_path = match_lifecycle_route(parsed.path)
            if api_path is None:
                return False
        else:
            return False

        body_bytes = self._read_body_bytes() if method in ("POST", "PATCH", "PUT", "DELETE") else b""
        content_type = self.headers.get("Content-Type")
        accept = self.headers.get("Accept")
        status, resp_headers, payload = proxy_api_request(
            method=method,
            parsed=parsed,
            body_bytes=body_bytes,
            content_type=content_type,
            accept=accept,
            api_path=api_path,
        )

        self.send_response(status)
        passthrough_headers = ["Content-Type", "Cache-Control", "Connection"]
        for key in passthrough_headers:
            value = resp_headers.get(key) or resp_headers.get(key.lower())
            if value:
                self.send_header(key, value)
        self.end_headers()
        if payload:
            self.wfile.write(payload)
        return True

    def do_GET(self):
        if self._proxy_passthrough("GET"):
            return

        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/channels":
            self._respond_json(200, api("GET", "/api/channels"))

        elif parsed.path == "/agents" or parsed.path == "/api/agents":
            self._respond_json(200, api("GET", "/api/agents"))

        elif parsed.path == "/messages":
            name = qs.get("channel", [None])[0]
            if not name:
                self._respond_json(400, {"error": "channel param required"})
                return
            cid = resolve_channel(name)
            if not cid:
                self._respond_json(404, {"error": f"channel '{name}' not found"})
                return
            limit = qs.get("limit", ["20"])[0]
            before = qs.get("before", [None])[0]
            suffix = f"?limit={limit}"
            if before:
                suffix += f"&before={before}"
            self._respond_json(200, api("GET", f"/api/channels/{cid}/messages{suffix}"))

        elif parsed.path == "/mailbox":
            self._respond_json(200, api("GET", f"/api/agents/{AGENT_ID}/mailbox"))

        else:
            self._respond_json(404, {"error": "not found"})

    def do_POST(self):
        if self._proxy_passthrough("POST"):
            return

        parsed = urlparse(self.path)
        if parsed.path == "/host/v1/exec":
            body_bytes = self._read_body_bytes()
            content_type = self.headers.get("Content-Type")
            accept = self.headers.get("Accept")
            status, resp_headers, payload = proxy_api_request(
                method="POST",
                parsed=parsed,
                body_bytes=body_bytes,
                content_type=content_type,
                accept=accept,
                api_path=f"/api/agents/{AGENT_ID}/host-commands",
            )

            self.send_response(status)
            passthrough_headers = ["Content-Type", "Cache-Control", "Connection"]
            for key in passthrough_headers:
                value = resp_headers.get(key) or resp_headers.get(key.lower())
                if value:
                    self.send_header(key, value)
            self.end_headers()
            if payload:
                self.wfile.write(payload)
            return

        if parsed.path == "/mailbox/fetch":
            status, result = api_with_status("POST", f"/api/agents/{AGENT_ID}/mailbox/fetch")
            self._respond_json(status, result if isinstance(result, dict) else {"error": str(result)})
            return

        if parsed.path == "/mailbox/ack":
            raw = self._read_body_bytes()
            try:
                body = json.loads(raw.decode()) if raw else {}
            except (json.JSONDecodeError, ValueError) as e:
                self._respond_json(400, {"error": f"Invalid JSON: {e}"})
                return
            status, result = api_with_status("POST", f"/api/agents/{AGENT_ID}/mailbox/ack", body)
            self._respond_json(status, result if isinstance(result, dict) else {"error": str(result)})
            return

        if parsed.path != "/send":
            self._respond_json(404, {"error": "not found"})
            return

        raw = self._read_body_bytes()
        try:
            body = json.loads(raw.decode()) if raw else {}
        except (json.JSONDecodeError, ValueError) as e:
            self._respond_json(400, {"error": f"Invalid JSON: {e}"})
            return

        name = body.get("channel")
        content = body.get("content")
        if not name or not content:
            self._respond_json(400, {"error": "channel and content required"})
            return

        cid = resolve_channel(name)
        if not cid:
            _channel_cache.pop(name, None)
            cid = resolve_channel(name)
        if not cid:
            self._respond_json(404, {"error": f"channel '{name}' not found"})
            return

        status, result = api_with_status("POST", f"/api/channels/{cid}/messages", {
            "authorId": AGENT_ID,
            "content": content,
        })
        if 200 <= status < 300 and isinstance(result, dict) and "id" in result:
            self._respond_json(201, result)
            return
        if status >= 400:
            if isinstance(result, dict):
                self._respond_json(status, result)
            else:
                self._respond_json(status, {"error": str(result)})
            return
        if isinstance(result, dict):
            self._respond_json(500, result)
        else:
            self._respond_json(500, {"error": str(result)})

    def do_PATCH(self):
        if self._proxy_passthrough("PATCH"):
            return
        self._respond_json(404, {"error": "not found"})

    def do_DELETE(self):
        if self._proxy_passthrough("DELETE"):
            return
        self._respond_json(404, {"error": "not found"})

    def do_PUT(self):
        if self._proxy_passthrough("PUT"):
            return
        self._respond_json(404, {"error": "not found"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Dune proxy for {AGENT_NAME} listening on :{PORT}", flush=True)
    server.serve_forever()
