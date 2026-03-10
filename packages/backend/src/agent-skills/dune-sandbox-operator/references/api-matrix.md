# Sandbox API Matrix

Base URL:
- `http://localhost:3200/sandboxes/v1`

## Boxes

- `GET /boxes`
- `POST /boxes`
- `GET /boxes/:boxId`
- `PATCH /boxes/:boxId`
- `DELETE /boxes/:boxId`
- `POST /boxes/:boxId/start`
- `POST /boxes/:boxId/stop`
- `GET /boxes/:boxId/status`

## Exec

- `POST /boxes/:boxId/execs`
- `GET /boxes/:boxId/execs`
- `GET /boxes/:boxId/execs/:execId`
- `GET /boxes/:boxId/execs/:execId/events?afterSeq=<n>&limit=<n>`
- `GET /boxes/:boxId/execs/:execId/events` with `Accept: text/event-stream`

## Files

- `POST /boxes/:boxId/files` (JSON payload)
- `POST /boxes/:boxId/files?path=<path>&overwrite=<bool>` (raw upload)
- `GET /boxes/:boxId/files?path=<path>`
- `GET /boxes/:boxId/files/:path`
- `GET /boxes/:boxId/fs/list?path=<abs>&includeHidden=<bool>&limit=<n>`
- `GET /boxes/:boxId/fs/read?path=<abs>&maxBytes=<n>`
- `POST /boxes/:boxId/fs/mkdir`
- `POST /boxes/:boxId/fs/move`
- `DELETE /boxes/:boxId/fs?path=<abs>&recursive=<bool>`
- `POST /boxes/:boxId/import-host-path`

## Attach

- `GET /boxes/:boxId/attach`
- Current backend runtime adapter behavior: `501 attach_not_implemented`.

## Actor Identity

No manual actor headers required from script callers.
Proxy injects:
- `X-Actor-Type: system`
- `X-Actor-Id: agent:<AGENT_ID>`
