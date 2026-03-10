# Dune

This repo is source-only. Local tool state in `.claude/` and `.codex/`, runtime data in `data/`, and generated artifacts such as `test-results/`, `coverage/`, `dist/`, and `packages/backend/.port` are intentionally local-only and git-ignored.

Local setup is intentionally small:

```bash
git clone <repo-url>
cd dune
make deploy
make check
make run
```

`make deploy` installs dependencies, creates `.env` from `.env.example` if it does not already exist, and builds the app.

`make test` runs the backend test suite.

`make check` runs the required pre-PR validation gate: build plus backend tests.

`make run` starts the production app in the foreground.

`make clean` removes build and dev artifacts such as `dist/`, `.release/`, `test-results/`, `coverage/`, and the backend `.port` file, but keeps local tool directories and runtime data.

Runtime data lives under `data/` by default: the SQLite database is stored in `data/db/dune.db`, agent files live in `data/agents/`, and BoxLite state lives in `data/boxlite/`. If you want to isolate local runs or manual verification from the default data set, point `DATA_DIR` at another ignored path such as `./test-results/manual-checks/data`.

You can edit `.env` after the first deploy if you need to change ports or move the whole data root with `DATA_DIR`. The default app URL is `http://localhost:3100`.
