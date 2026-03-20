# Host Operator Workflows

## 1) Inspect an allowed app

```bash
scripts/host-status.sh
scripts/host-overview.sh com.apple.Safari
scripts/host-perceive.sh accessibility com.apple.Safari
```

## 2) Capture UI + screenshot

```bash
scripts/host-perceive.sh composite com.apple.Safari
```

Composite results may include artifact paths under `/config/.dune/system/host-operator/`.

## 3) Perform a host action

```bash
scripts/host-act.sh '{"action":"launch","bundleId":"com.google.Chrome"}'
scripts/host-act.sh '{"action":"navigate","bundleId":"com.google.Chrome","url":"http://example.com"}'
scripts/host-act.sh '{"action":"focus","bundleId":"com.apple.Safari"}'
scripts/host-act.sh '{"action":"click","bundleId":"com.apple.Safari","point":{"x":320,"y":240}}'
scripts/host-act.sh '{"action":"type","bundleId":"com.apple.Safari","text":"hello world"}'
```

## 4) Use allowed filesystem paths

```bash
scripts/host-fs.sh '{"op":"list","path":"/Users/admin/Documents"}'
scripts/host-fs.sh '{"op":"search","path":"/Users/admin/Documents","query":"roadmap"}'
scripts/host-fs.sh '{"op":"write","path":"/Users/admin/Documents/note.txt","content":"updated by dune"}'
```

All host-operator requests block until they reach a terminal state. In the default approval-required mode that means waiting for human admin approval; agents configured to dangerously skip permissions run immediately after backend allowlist validation.
