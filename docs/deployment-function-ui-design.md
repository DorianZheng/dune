# Deployment Function + UI Design (v2, Directory-Based)

## Goals

- Agent provides a directory to deploy.
- Support start/stop deployment actions.
- Keep Vercel-like semantics, but simpler.
- Every deployment run uses a brand new sandbox.

## Why This Design

Using `repoUrl/branch` is unnecessary in this product. The deploy unit is the current filesystem content prepared by the agent.

So the system should deploy from a directory snapshot, not from git.

## Core Model

### DeploymentSpec

```ts
export type DeploymentTarget = 'preview' | 'production'

export type DeploymentSpec = {
  id: string
  agentId: string
  name: string
  sourceDir: string             // absolute path inside source agent sandbox, e.g. /config/miniapps/my-app
  installCommand: string        // optional, default: ""
  buildCommand: string          // required for most apps
  startCommand: string          // required
  runtimePort: number           // default: 3000
  env: Record<string, string>
  targetDefault: DeploymentTarget
  createdAt: number
  updatedAt: number
}
```

### SourceSnapshot

```ts
export type SourceSnapshot = {
  id: string
  agentId: string
  specId: string
  sourceDir: string
  artifactPath: string          // host path, content-addressed tarball
  contentHash: string           // sha256 of file tree content
  fileCount: number
  sizeBytes: number
  createdAt: number
}
```

### DeploymentRun

```ts
export type DeploymentStatus =
  | 'queued'
  | 'capturing'
  | 'provisioning'
  | 'building'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopping'
  | 'stopped'

export type DeploymentRun = {
  id: string
  agentId: string
  specId: string
  specSnapshot: DeploymentSpec
  snapshotId: string
  sandboxId: string
  status: DeploymentStatus
  target: DeploymentTarget
  url: string | null
  createdAt: number
  updatedAt: number
  stoppedAt?: number
  error?: string
}
```

## Hard Constraints

- `start` MUST create a new `DeploymentRun` and new `sandboxId`.
- No in-place restart for a run.
- `stop` only stops one run.
- A run always references an immutable `snapshotId`.

## Deployment Pipeline

### 1) Capture Source

Input: `sourceDir` from spec.

- Validate `sourceDir` exists in source agent sandbox.
- Create a tarball snapshot from `sourceDir`.
- Save tarball to host artifact store.
- Compute `contentHash`.
- Create `SourceSnapshot` record.

### 2) Provision Fresh Sandbox

- Create a new deployment sandbox (never reused).
- Copy/extract snapshot artifact into sandbox work dir (e.g. `/workspace/app`).

### 3) Build + Start

- Run install/build/start commands in order.
- On success, expose run URL and mark `ready`.
- On failure, mark `failed` and persist logs.

### 4) Stop

- Stop target run sandbox.
- Mark run `stopped`.

## Better Than "copy out + copy in" (but compatible)

The system still does "copy out then copy in", but through a first-class snapshot artifact layer.

Benefits:
- Reproducible runs (each run tied to exact snapshot).
- Auditable (`contentHash`, file count, snapshot time).
- Easy future rollback (redeploy older snapshot to new sandbox).
- Better UX for run history.

## Snapshot Mechanics (Implementation Detail)

Artifact store:
- Host path: `data/deployments/artifacts/<agentId>/<contentHash>.tar.zst`
- Metadata store tracks `snapshotId -> contentHash -> artifactPath`.

Capture strategy:
- Fast path: if `sourceDir` is backed by a known host mount, package directly on host.
- Fallback path: create archive inside source sandbox, write to shared staging mount, then move to artifact store.
- Both paths produce the same `contentHash` and `SourceSnapshot`.

Suggested ignore defaults while capturing:
- `.git/`
- `node_modules/`
- `.next/cache/`
- `dist/`
- `build/`
- `*.log`

Safety and scale guards:
- Max snapshot size (v1): `1 GiB` compressed.
- Max file count (v1): `100,000`.
- Reject symlinks escaping source root.
- Per-agent deploy concurrency: 1 active start pipeline at a time.

## API / Function Contract

### Spec APIs

1. `GET /api/agents/:id/deployments/spec`
- Returns current deployment spec.

2. `PUT /api/agents/:id/deployments/spec`
- Upserts spec.
- Required: `name`, `sourceDir`, `buildCommand`, `startCommand`.

### Run APIs

3. `GET /api/agents/:id/deployments`
- List runs (newest first).

4. `POST /api/agents/:id/deployments/start`
- Body:

```json
{
  "target": "preview",
  "note": "optional message"
}
```

- Behavior:
  - load spec,
  - capture source snapshot,
  - create run,
  - provision fresh sandbox,
  - build/start.

5. `POST /api/agents/:id/deployments/:runId/stop`
- Stop one run.

6. `GET /api/agents/:id/deployments/:runId/logs`
- Get logs for details panel.

7. `GET /api/agents/:id/deployments/snapshots`
- Optional in v1.1; useful for debugging and future rollback UX.

## Validation Rules

- `sourceDir` must be absolute sandbox path.
- `sourceDir` must not contain path traversal.
- `sourceDir` must be under allowed roots (for safety), for example:
  - `/config/miniapps`
  - `/config/memory/projects`
- `startCommand` required.
- `buildCommand` required (can be `"true"` for static/no-build apps).
- `runtimePort` must be in safe range (1024-65535).

## State Machine

```text
queued -> capturing -> provisioning -> building -> starting -> ready
queued -> capturing -> provisioning -> building -> failed
queued -> capturing -> failed
ready -> stopping -> stopped
failed -> stopping -> stopped
```

## UI Design

### Location

- Add `Deployments` tab to agent profile modal.
- Tabs: `Profile`, `Deployments`, `Computer`.

### Deployments Tab Sections

1. Spec Header
- Spec status chip (`Configured` / `Missing`).
- `Edit spec` action.
- `Start deployment` primary action.

2. Runs List (left on desktop, top on mobile)
- Run status, target, created time.
- Snapshot hash short id.
- Sandbox short id.

3. Run Details (right on desktop, bottom on mobile)
- URL (when ready).
- Commands used (from spec snapshot).
- Live logs.
- `Stop` button for active runs.

### Spec Editor Fields

- Name
- Source directory (required)
- Install command
- Build command
- Start command
- Runtime port
- Target default (`preview`/`production`)
- Env vars key/value

Footer:
- `Save spec`
- `Save and deploy`

### Wireframe

```text
┌────────────────────────────────────────────────────────────────────┐
│ Spec: Configured (/config/miniapps/foo)  [Edit spec] [Start]      │
├───────────────────────────────┬────────────────────────────────────┤
│ Runs                          │ Run details                        │
│ [ready] preview 2m            │ Status: ready                     │
│ snapshot: sha_7a12            │ URL: https://...                  │
│ sandbox: sbx_92f1             │ Snapshot: sha_7a12                │
│                               │ Sandbox: sbx_92f1                 │
│ [building] production 20s     │ Logs                               │
│ snapshot: sha_b3d4            │ > capturing source...             │
│ sandbox: sbx_ab18             │ > provisioning sandbox...         │
│                               │ > pnpm build                      │
│                               │                                    │
│                               │ [Stop]                            │
└───────────────────────────────┴────────────────────────────────────┘
```

## Realtime Events

Add websocket events:

- `deployment:run:new`
- `deployment:run:update`
- `deployment:log:append`
- `deployment:snapshot:created` (optional)

## v1 Scope

- One spec per agent.
- Start/stop only.
- No rollback UI yet.
- No custom domains.
- Always new sandbox per run.
- Deploy source is always a directory path.

## Future Extensions

- "Redeploy this snapshot" button.
- Diff between two snapshots.
- Auto-detect commands (`npm`, `pnpm`, static build).
- Promote preview run to production alias.
