# Host Operator Workflows

## Workspace command

```bash
scripts/host-exec.sh workspace /workspace ls -la
```

## Full-host command

```bash
scripts/host-exec.sh full-host /Users/admin uname -a
```

The request blocks until it completes. In the default approval-required mode that means waiting for human admin approval; agents configured to dangerously skip permissions will run immediately.
