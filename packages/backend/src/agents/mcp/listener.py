#!/usr/bin/env python3
"""Persistent push event listener daemon for agent containers.

Connects to /ws/agent?agentId=XXX, listens for push events,
and triggers agent responses when new mail arrives.
"""
import json
import os
import subprocess
import sys
import time

BUSY_FLAG = "/tmp/agent-busy"


def main():
    agent_id = os.environ.get("AGENT_ID")
    if not agent_id:
        print("AGENT_ID env var required", file=sys.stderr)
        sys.exit(1)

    ws_url = os.environ.get("DUNE_WS_URL")
    if not ws_url:
        print("DUNE_WS_URL env var not set", file=sys.stderr)
        sys.exit(1)

    rpc_script = os.environ.get("DUNE_RPC_SCRIPT")
    if not rpc_script:
        print("DUNE_RPC_SCRIPT env var not set", file=sys.stderr)
        sys.exit(1)

    try:
        import websocket
    except ImportError:
        print("websocket-client not installed, falling back to polling", file=sys.stderr)
        # Fallback to mailbox polling (backward compat)
        _poll_fallback(agent_id, rpc_script)
        return

    while True:
        try:
            ws = websocket.create_connection(ws_url, timeout=300)
            print(f"[listener] connected to {ws_url}", file=sys.stderr)
            while True:
                raw = ws.recv()
                if not raw:
                    break
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                # Handle mailbox notify push events
                if msg.get("type") == "mailbox:notify":
                    if os.path.exists(BUSY_FLAG):
                        continue
                    _trigger_respond(agent_id, rpc_script)

        except (ConnectionError, TimeoutError, Exception) as e:
            print(f"[listener] disconnected: {e}, reconnecting in 5s...", file=sys.stderr)
            time.sleep(5)


def _trigger_respond(agent_id, rpc_script):
    """Trigger agent respond via RPC."""
    try:
        subprocess.run(
            [sys.executable, rpc_script, "agents.respond", json.dumps({"id": agent_id, "mode": "mailbox"})],
            timeout=360,
            capture_output=True,
        )
    except Exception as e:
        print(f"[listener] respond failed: {e}", file=sys.stderr)


def _poll_fallback(agent_id, rpc_script):
    """Fallback polling mode (5s interval) for environments without websocket-client."""
    while True:
        try:
            result = subprocess.run(
                [sys.executable, rpc_script, "agents.getMailbox", json.dumps({"id": agent_id})],
                timeout=30,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0 and result.stdout.strip():
                data = json.loads(result.stdout)
                if isinstance(data, dict) and data.get("unreadCount", 0) > 0:
                    if not os.path.exists(BUSY_FLAG):
                        _trigger_respond(agent_id, rpc_script)
        except Exception as e:
            print(f"[listener] poll error: {e}", file=sys.stderr)
        time.sleep(5)


if __name__ == "__main__":
    main()
