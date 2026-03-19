#!/usr/bin/env python3
"""One-shot RPC CLI for agent skills.

Usage:
    python3 $DUNE_RPC_SCRIPT channels.sendMessage '{"channelId":"abc","content":"hello"}'

Opens a WebSocket to the Dune backend, sends one RPC call, prints the result, exits.
"""
import json
import os
import sys
import uuid

try:
    import websocket  # websocket-client
except ImportError:
    # Minimal fallback using websockets (async)
    import asyncio
    import websockets

    async def _call(url, method, params):
        async with websockets.connect(url) as ws:
            msg = json.dumps({"id": str(uuid.uuid4()), "method": method, "params": params})
            await ws.send(msg)
            raw = await ws.recv()
            return json.loads(raw)

    def _sync_call(url, method, params):
        return asyncio.get_event_loop().run_until_complete(_call(url, method, params))
else:
    def _sync_call(url, method, params):
        ws = websocket.create_connection(url, timeout=90)
        try:
            msg = json.dumps({"id": str(uuid.uuid4()), "method": method, "params": params})
            ws.send(msg)
            raw = ws.recv()
            return json.loads(raw)
        finally:
            ws.close()


def main():
    if len(sys.argv) < 2:
        print("Usage: rpc.py METHOD [PARAMS_JSON]", file=sys.stderr)
        sys.exit(1)

    method = sys.argv[1]
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}

    ws_url = os.environ.get("DUNE_WS_URL")
    if not ws_url:
        print("DUNE_WS_URL env var not set", file=sys.stderr)
        sys.exit(1)

    try:
        result = _sync_call(ws_url, method, params)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

    if "error" in result:
        print(json.dumps(result["error"]), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result.get("result", None)))


if __name__ == "__main__":
    main()
