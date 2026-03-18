"""
Shared backend URL resolver for in-box Dune communication daemons.

The resolver keeps a preferred active backend URL in memory, reloads the
published backend-endpoints.json file when it changes, and fails over across
ordered candidates when transport-level errors occur.
"""

import json
import os
import socket
import threading
from http.client import RemoteDisconnected
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class BackendTransportError(Exception):
    pass


def is_transport_error(error):
    if isinstance(error, HTTPError):
        return False
    return isinstance(
        error,
        (
            URLError,
            OSError,
            TimeoutError,
            socket.timeout,
            RemoteDisconnected,
            ConnectionResetError,
            ConnectionAbortedError,
            BrokenPipeError,
            EOFError,
        ),
    )


def decode_json_or_text(raw):
    if not raw:
        return {}
    text = raw.decode()
    try:
        return json.loads(text)
    except Exception:
        return text


class BackendUrlResolver:
    def __init__(self, bootstrap_url=None, endpoints_file=None):
        self.bootstrap_url = (bootstrap_url or "").strip()
        self.endpoints_file = endpoints_file
        self._active_url = self.bootstrap_url or None
        self._file_mtime_ns = None
        self._preferred_url = None
        self._file_urls = []
        self._lock = threading.Lock()
        self._reload_candidates(force=True)

    def request(self, method, path, body=None, headers=None, timeout=30):
        request_headers = dict(headers or {})
        payload = body
        if body is not None and not isinstance(body, (bytes, bytearray)):
            if isinstance(body, str):
                payload = body.encode()
            else:
                payload = json.dumps(body).encode()
                request_headers.setdefault("Content-Type", "application/json")
        elif isinstance(body, bytearray):
            payload = bytes(body)

        last_transport_error = None
        attempted = []

        while True:
            candidates = self._candidate_urls(exclude=attempted)
            if not candidates:
                break

            base_url = candidates[0]
            request = Request(
                f"{base_url}{path}",
                data=payload if payload else None,
                headers=request_headers,
                method=method,
            )

            try:
                with urlopen(request, timeout=timeout) as response:
                    response_body = response.read()
                    self._mark_success(base_url)
                    return int(response.status), dict(response.headers.items()), response_body
            except HTTPError as error:
                self._mark_success(base_url)
                return int(error.code), dict(error.headers.items()) if error.headers else {}, error.read()
            except Exception as error:
                if not is_transport_error(error):
                    raise
                last_transport_error = error
                attempted.append(base_url)
                self._mark_transport_failure(base_url)

        raise BackendTransportError(str(last_transport_error or "No backend URL candidates configured"))

    def _candidate_urls(self, exclude=None):
        exclude = set(exclude or [])
        with self._lock:
            self._reload_candidates()
            ordered = self._normalize_urls(
                [
                    self._active_url,
                    self._preferred_url,
                    *self._file_urls,
                    self.bootstrap_url,
                ]
            )
            return [url for url in ordered if url not in exclude]

    def _mark_success(self, url):
        with self._lock:
            self._active_url = url

    def _mark_transport_failure(self, failed_url):
        with self._lock:
            if self._active_url == failed_url:
                self._active_url = None
            self._reload_candidates(force=True)

    def _reload_candidates(self, force=False):
        if not self.endpoints_file:
            return

        try:
            stat = os.stat(self.endpoints_file)
        except OSError:
            if force:
                self._file_mtime_ns = None
                self._preferred_url = None
                self._file_urls = []
            return

        if not force and self._file_mtime_ns == stat.st_mtime_ns:
            return

        try:
            with open(self.endpoints_file, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            self._file_mtime_ns = stat.st_mtime_ns
            self._preferred_url = None
            self._file_urls = []
            return

        preferred_url = payload.get("preferredUrl")
        urls = payload.get("urls")
        self._file_mtime_ns = stat.st_mtime_ns
        self._preferred_url = preferred_url.strip() if isinstance(preferred_url, str) else None
        self._file_urls = self._normalize_urls(urls if isinstance(urls, list) else [])

        if self._active_url and self._active_url in self._file_urls:
            return
        if self._preferred_url:
            self._active_url = self._preferred_url
            return
        if self._file_urls:
            self._active_url = self._file_urls[0]

    @staticmethod
    def _normalize_urls(urls):
        seen = set()
        normalized = []
        for url in urls:
            if not isinstance(url, str):
                continue
            trimmed = url.strip()
            if not trimmed or trimmed in seen:
                continue
            seen.add(trimmed)
            normalized.append(trimmed)
        return normalized
