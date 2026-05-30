---
Title: Local UI Shell
Description: Dokumentation zur lokalen Viewer- und UI-Shell fuer erzeugte Analyseartefakte.
Last Updated: 2026-05-17
---

# Local UI Shell

The local UI keeps the run explorer read-only while also exposing local-only Prompt Workbench actions such as preview generation, template persistence, and prompt-seed import. It still avoids introducing a separate parsing layer in the browser.

## Command

```bash
zeus serve --source-output-root ./output --port 4782
```

Behavior:

- binds to loopback only (`127.0.0.1` by default)
- serves a local HTML shell plus local-only JSON routes
- reads existing analyze output directories; it does not run analysis itself
- reuses the current manifest and artifact contracts instead of introducing a parallel storage model

## API endpoints

- `GET /api/health`
- `GET /api/ui-metadata`
- `POST /api/ui-actions/doctor`
- `GET /api/runs`
- `GET /api/runs/:program`
- `GET /api/runs/:program/views`
- `GET /api/runs/:program/artifacts/content?path=...`
- `GET /runs/:program/artifacts/raw?path=...`
- `GET /api/prompt-builder/contracts`
- `GET /api/prompt-builder/use-cases`
- `GET /api/prompt-builder/modules`
- `POST /api/prompt-builder/preview`
- `GET|POST|PUT|DELETE /api/prompt-builder/templates[...]`
- `GET /api/prompt-builder/context-sources`
- `GET /api/prompt-builder/context-sources/:program/prompts`
- `POST /api/prompt-builder/context-sources/import`

The browser shell consumes only those endpoints. It does not parse output directories directly.

## Current shell scope

- metadata-driven workflow shell landing with six workflow cards:
  - Configure
  - Fetch Sources
  - Analyze Workspace
  - Query DB2
  - Review Reports
  - Generate AI Context
- metadata-driven read-only Configure panel (section-grouped field contract preview)
- list analysis runs under the configured output root
- show manifest-derived run summary details
- provide a graph explorer with node-level links to related artifacts and prompts
- provide dedicated DB2 metadata and test-data table views
- provide side-by-side prompt comparison for generated prompt packs
- provide Prompt Workbench canvas, live preview, and local template CRUD
- import existing `ai_prompt_*.md` artifacts as Prompt Canvas seeds
- enumerate available artifacts, including `safe-sharing/` variants
- preview JSON, Markdown, and HTML artifacts on demand

Large-output behavior:

- focused views are derived on the server from existing artifacts
- the browser fetches prompt and artifact content only on selection
- the shell uses simple filtering instead of eager full-page rendering of every artifact body

This is the API-and-shell foundation for future richer views. It is not yet the full interactive exploration layer described in the later UI issues.

## Allowlisted UI actions

The local UI action surface is intentionally explicit and small:

- only allowlisted actions are supported
- arbitrary command execution is not supported
- raw shell command payloads are rejected
- payload keys are strictly validated
- unknown action names return deterministic errors

Current supported action:

- `doctor` readiness check via `POST /api/ui-actions/doctor`

Security behavior:

- request and response format is JSON only
- server-side validation blocks unsafe profile values
- responses keep diagnostics structured and do not expose resolved secret values or raw env values
