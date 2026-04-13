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
- `GET /api/runs/:program/artifacts/content?path=...`
- `GET /runs/:program/artifacts/raw?path=...`

The browser shell consumes only those endpoints. It does not parse output directories directly.

## Current shell scope

- list analysis runs under the configured output root
- show manifest-derived run summary details
- enumerate available artifacts, including `safe-sharing/` variants
- preview JSON, Markdown, and HTML artifacts on demand

This is the API-and-shell foundation for future richer views. It is not yet the full interactive exploration layer described in the later UI issues.
