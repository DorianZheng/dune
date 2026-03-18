"""
Mailbox Daemon — polls backend mailbox summary, triggers agent response.

Runs persistently inside SkillBox container. When actionable unread mail exists
and there is no active leased batch, it asks the backend to wake the agent with
a count-only mailbox notice. The agent then fetches unread mail itself.

Env vars (set by agent-manager.ts):
  DUNE_API_URL   — bootstrap backend URL
  DUNE_API_ENDPOINTS_FILE — optional dynamic backend endpoints file
  DUNE_AGENT_ID  — this agent's UUID
"""

import os
import time

from backend_url_resolver import BackendTransportError, BackendUrlResolver, decode_json_or_text

API_RESOLVER = BackendUrlResolver(
    os.environ.get("DUNE_API_URL"),
    os.environ.get("DUNE_API_ENDPOINTS_FILE"),
)
AGENT_ID = os.environ["DUNE_AGENT_ID"]
POLL_INTERVAL = max(1, int(os.environ.get("DUNE_MAILBOX_POLL_INTERVAL", "5")))
BUSY_FLAG = "/tmp/agent-busy"

def api(method, path, body=None, timeout=30):
    status, _, payload = API_RESOLVER.request(
        method,
        path,
        body=body,
        headers={"Content-Type": "application/json"} if body else {},
        timeout=timeout,
    )
    result = decode_json_or_text(payload)
    if 200 <= status < 300:
        return result
    if isinstance(result, dict):
        result.setdefault("status", status)
        return result
    return {"error": str(result), "status": status}

print(f"Mailbox daemon started for agent {AGENT_ID}", flush=True)

while True:
    try:
        if os.path.exists(BUSY_FLAG):
            time.sleep(2)
            continue

        mailbox = api("GET", f"/api/agents/{AGENT_ID}/mailbox")
        unread_count = int(mailbox.get("unreadCount", 0) or 0)
        active_lease = mailbox.get("activeLease")

        if unread_count > 0 and not active_lease:
            print(f"Found {unread_count} unread mailbox messages, triggering respond", flush=True)
            # Respond can take up to 5 min (CLI timeout is 300s)
            result = api("POST", f"/api/agents/{AGENT_ID}/respond", {"mode": "mailbox"}, timeout=360)
            print(f"Respond finished: {json.dumps(result)[:200]}", flush=True)

    except (BackendTransportError, OSError) as e:
        print(f"Mailbox poll error: {e}", flush=True)
    except Exception as e:
        print(f"Mailbox unexpected error: {e}", flush=True)

    time.sleep(POLL_INTERVAL)
