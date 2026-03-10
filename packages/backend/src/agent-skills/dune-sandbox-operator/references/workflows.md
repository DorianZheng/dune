# Sandbox Workflows

## 1) Create and run a persistent box

```bash
scripts/sandbox-box.sh create '{"name":"tooling","image":"alpine:latest","durability":"persistent","autoRemove":false}'
scripts/sandbox-box.sh start <boxId>
scripts/sandbox-exec.sh create <boxId> sh -lc 'uname -a'
```

## 2) Investigate exec output

```bash
scripts/sandbox-exec.sh list <boxId>
scripts/sandbox-exec.sh get <boxId> <execId>
scripts/sandbox-exec.sh events <boxId> <execId> 0 200
scripts/sandbox-exec.sh sse <boxId> <execId>
```

## 3) Upload, import, download

```bash
scripts/sandbox-files.sh upload-file <boxId> /workspace/app/config.json ./config.json
scripts/sandbox-files.sh import-host <boxId> /absolute/host/project /workspace/project
scripts/sandbox-files.sh download <boxId> /workspace/app/config.json
```

## 4) Runtime sandbox operations

Runtime sandboxes are listed in `GET /boxes` and can be operated through this skill.

```bash
scripts/sandbox-box.sh list
scripts/sandbox-box.sh start <runtimeBoxId>
scripts/sandbox-exec.sh create <runtimeBoxId> sh -lc 'ls -la /config'
```

## 5) Attach passthrough (explicitly unimplemented)

```bash
scripts/sandbox-box.sh attach <boxId>
```

Expected response today:
- HTTP `501`
- body includes `attach_not_implemented`
