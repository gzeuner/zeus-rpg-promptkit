# Local UI Shell

The first local UI slice is intentionally small and read-only. It exists to browse generated analysis runs without introducing a separate parsing layer in the browser.

## Command

```bash
zeus serve --source-output-root ./output --port 4782
```

Behavior:

- binds to loopback only (`127.0.0.1` by default)
- serves a local HTML shell and a read-only JSON API
- reads existing analyze output directories; it does not run analysis itself
- reuses the current manifest and artifact contracts instead of introducing a parallel storage model

## API endpoints

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/:program`
- `GET /api/runs/:program/views`
- `GET /api/runs/:program/artifacts/content?path=...`
- `GET /runs/:program/artifacts/raw?path=...`

The browser shell consumes only those endpoints. It does not parse output directories directly.

## Current shell scope

- list analysis runs under the configured output root
- show manifest-derived run summary details
- provide a graph explorer with node-level links to related artifacts and prompts
- provide dedicated DB2 metadata and test-data table views
- provide side-by-side prompt comparison for generated prompt packs
- enumerate available artifacts, including `safe-sharing/` variants
- preview JSON, Markdown, and HTML artifacts on demand

Large-output behavior:

- focused views are derived on the server from existing artifacts
- the browser fetches prompt and artifact content only on selection
- the shell uses simple filtering instead of eager full-page rendering of every artifact body

This is the API-and-shell foundation for future richer views. It is not yet the full interactive exploration layer described in the later UI issues.
