# Sandboxes UI Manual Verification Checklist

Use this checklist after backend and frontend are running from the repo root.

## Preconditions

1. Install dependencies and build once:
```bash
make deploy
```
2. Start backend in a separate terminal:
```bash
PORT=3100 DATA_DIR=./test-results/manual-checks/data pnpm --filter @dune/backend dev
```
3. Start the frontend dev server in another terminal:
```bash
pnpm --filter @dune/frontend dev -- --host localhost --port 4173
```
4. Open `http://localhost:4173`.

## Automated Playwright Coverage (Files Tab)

The scripted Finder workflow coverage runs against a live managed runtime sandbox.

Run from the repo root:

1. Default managed frontend mode:
```bash
pnpm --filter @dune/frontend e2e:sandbox-files
```
2. Attach mode (frontend already running on `localhost:4173`):
```bash
SANDBOX_E2E_ATTACH_FRONTEND=1 pnpm --filter @dune/frontend e2e:sandbox-files:attach
```
3. Optional env overrides:
- `SANDBOX_E2E_BASE_URL` (default `http://localhost:3100`)
- `SANDBOX_E2E_FRONTEND_URL` (default `http://localhost:4173`)
- `SANDBOX_E2E_BOX_ID` (optional; if unset, the test auto-discovers a running managed sandbox)
- `SANDBOX_E2E_SYSTEM_ACTOR_ID` (default `agent:operator`)
- `SANDBOX_E2E_HUMAN_ACTOR_ID` (default `admin`)
- `SANDBOX_E2E_HOST_ROOT` (default repo-local `test-results/e2e-host-import`)

If auto-discovery cannot find a running managed sandbox, start an agent runtime first or set `SANDBOX_E2E_BOX_ID` explicitly.

Automated checks currently include:
- Human guardrail behavior on Dorian Files tab.
- System actor Finder-style Files flow with temp-path create/rename/search/download/import/large-preview/delete.
- Per-test cleanup of sandbox temp paths and host temp files.

## Checklist

1. Sidebar navigation:
- Click `Sandboxes`.
- Expected: Sandboxes page opens.
- Expected controls visible: `Refresh`, search input, `New sandbox`.

2. Create modal:
- Click `New sandbox`.
- Verify defaults are present (`image`, durability, resource fields).
- Create sandbox with valid values.
- Expected: new sandbox card appears in list.

3. Create error state:
- Open `New sandbox`.
- Use invalid image/path-like values that backend rejects.
- Expected: visible error message in modal.

4. Card and detail panel:
- Open a sandbox card.
- Switch tabs: `Overview`, `Execs`, `Files`, `Attach`.
- Expected: tab state updates and no blank/error layout.

5. Lifecycle actions:
- In `Overview`, click `Start`.
- Expected: status transitions to `running`.
- Click `Stop`.
- Expected: status transitions to `stopped` (or removed if ephemeral).
- Click `Delete`.
- Expected: card disappears from list.

6. Exec flow:
- Start sandbox.
- In `Execs`, run `echo ui-manual-smoke`.
- Expected: exec appears in history, status completes, output/event rows update.

7. Files flow:
- In `Files`, confirm Finder-like layout is visible: left folder tree + right file list + preview.
- Expected controls visible: breadcrumb path, `Up`, `Refresh`, hidden toggle, search, actions menu, `Download`, `Delete`.
- Create a new folder from actions menu.
- Create/upload a text file from actions menu and open it from the list.
- Expected: file appears in list and inline preview shows decoded text (for small files).
- Rename selected file from actions menu.
- Expected: list updates with new name and preview remains functional.
- Download selected file.
- Expected: browser downloads file with expected content.
- Delete selected file/folder.
- For non-empty directory, confirm recursive-delete confirmation behavior.
- Expected: deleted items disappear from list/tree.
- Toggle hidden files.
- Expected: dotfiles appear/disappear accordingly.

8. Host import flow:
- In `Files` actions menu, open `Import host path`.
- Import a valid host path into sandbox.
- Expected: imported file appears in list/tree and can be opened/downloaded.
- Try invalid path (outside allowed root).
- Expected: user-facing error displayed.

9. Attach behavior:
- Open `Attach` tab.
- Expected: explicit not-implemented response for attach (`501` / `attach_not_implemented`), not silent failure.

10. Search and refresh:
- Search by sandbox name.
- Expected: list filters as typed.
- Clear search, click `Refresh`.
- Expected: list re-syncs without UI errors.

11. Visual parity quick scan:
- Compare spacing/typography/control sizes with target codex-skills-like design.
- Verify both light/dark themes.

## Still Manual

These surfaces are intentionally out of scope for the current Playwright Files harness:
- Create modal default/error validation outside Files workflow.
- Lifecycle actions (`Start`, `Stop`, `Delete`) on non-managed sandboxes.
- Exec tab command/event flow.
- Attach tab response handling.
- Broad visual parity and cross-theme polish review.

## Pass Criteria

- All expected behaviors above are observed.
- No persistent console errors during core actions.
- No blocked/hanging UI interactions for start/stop/exec/files/import.
