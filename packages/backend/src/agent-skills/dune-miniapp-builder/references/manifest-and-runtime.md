# Manifest and Runtime Notes

## Folder Contract

- Root: `/config/miniapps/<slug>/`
- Required manifest: `/config/miniapps/<slug>/app.json`
- Runtime URL shape:
  - `http://localhost:<guiHttpPort>/miniapps/<slug>/<entry>`

## Manifest Example

```json
{
  "slug": "task-tracker",
  "name": "Task Tracker",
  "description": "Simple task workflow app",
  "collection": "Published",
  "status": "published",
  "entry": "index.html",
  "order": 100,
  "tags": ["ops", "tasks"]
}
```

## Normalization Rules (miniapp-store)

- Slug defaults to folder name if `slug` is missing.
- Status defaults to `published` when invalid/missing.
- Entry defaults to `index.html` when missing.
- Entry must stay inside app folder after path resolution.
- Missing entry file forces effective status `error` and `openable=false`.

## Openability

App is openable only when:
- `entryExists=true`
- effective status is not `archived`
- effective status is not `error`
