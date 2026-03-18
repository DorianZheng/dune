# CLAUDE.md

## Project Overview

Dune is a local-first agent workspace — a monorepo with `packages/frontend` (Lit SPA), `packages/backend` (Hono + SQLite), `packages/shared` (schemas/types), and `packages/electron` (desktop shell).

## Common Commands

Use `make` targets for all standard workflows:

| Task | Command |
|---|---|
| Bootstrap fresh clone | `make deploy` |
| Build all packages | `make build` |
| Run backend tests | `make test` |
| Pre-PR gate (build + test) | `make check` |
| Start dev servers + Electron | `make dev` |
| Package app (current platform) | `make package` |
| Package .dmg for macOS | `make package-mac` |
| Package for Linux | `make package-linux` |
| Package for Windows | `make package-win` |
| Clean build artifacts | `make clean` |

## Dev Workflow

- `make dev` starts backend, frontend, and Electron together.
- `make run` starts the built backend and serves the built SPA from `packages/frontend/dist`.
- Backend dev server uses `tsx --watch` with hot reload on port 3100.
- Frontend Vite dev server runs on port 5173 and proxies `/api` + `/ws` to the backend.
- Run `make check` before opening a PR.

## Code Conventions

- Backend tests use Node's built-in `node:test` runner — no Jest/Vitest.
- Frontend uses Lit web components with shadow DOM. State lives in `packages/frontend/src/state/app-state.ts`.
- Shared types/schemas are in `packages/shared/src/schemas/`.
- Agent orchestration and lifecycle logic is in `packages/backend/src/agents/agent-manager.ts`.
- SQLite stores are in `packages/backend/src/storage/`.
