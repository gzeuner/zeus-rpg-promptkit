---
Title: Local UI Shell
Description: Dokumentation zur lokalen Viewer- und UI-Shell fuer erzeugte Analyseartefakte.
Last Updated: 2026-06-02
---

# Local UI Shell

The local UI keeps the run explorer mostly read-only while also exposing a small allowlisted local action surface: Doctor readiness checks, Analyze Workspace for existing local source trees, and Prompt Workbench actions such as preview generation, template persistence, and prompt-seed import. It still avoids introducing a separate parsing layer in the browser.

## Command

```bash
zeus serve --source-output-root ./output --port 4782
```

Behavior:

- binds to loopback only (`127.0.0.1` by default)
- serves a local HTML shell plus local-only JSON routes
- reads existing analyze output directories
- can trigger allowlisted local analysis for an already configured workspace source root
- reuses the current manifest and artifact contracts instead of introducing a parallel storage model

## API endpoints

- `GET /api/health`
- `GET /api/ui-metadata`
- `POST /api/ui-actions/doctor`
- `POST /api/ui-actions/analyze-existing-workspace`
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
- `analyze-existing-workspace` via `POST /api/ui-actions/analyze-existing-workspace`

Security behavior:

- request and response format is JSON only
- server-side validation blocks unsafe profile values
- `analyze-existing-workspace` accepts only `profile`, `program`, `member`, and `safeSharing`
- browser payloads do not provide `sourceRoot`; the action always uses the selected profile's configured local source root
- browser payloads cannot provide arbitrary shell commands, absolute paths, or traversal-style filesystem input
- responses keep diagnostics structured and do not expose resolved secret values or raw env values
- runtime guardrail conflicts between profile DB targets and env overrides are surfaced as warnings, not automatic aborts
- conflict diagnostics remain allowlisted and redacted; the UI never exposes passwords or full credential-bearing JDBC URLs

Analyze Workspace behavior:

- runs the existing local `analyze` core against an already available local workspace/source root
- does not fetch remote sources
- does not connect to IBM i, DB2, SFTP, or other remote systems
- returns structured status values such as `completed`, `warning`, and `failed`
- can link back to the generated run summary and `report.md` when that artifact exists
- keeps raw action details collapsed in the browser by default

## Doctor readiness diagnostics

The Configure panel can surface safe runtime guardrail diagnostics after `Check Readiness`.

Behavior:

- `ready` means no doctor failures or guardrail warnings were detected
- `warning` means doctor passed but surfaced one or more structured warnings such as env/profile target conflicts
- `failed` means doctor checks reported critical failure
- `error` means the UI action endpoint itself failed

Current structured runtime diagnostic:

- `ENV_PROFILE_CONFLICT`

Example meaning:

- selected profile: `primary-readonly`
- profile field: `db.host`
- profile target: `primary-system`
- environment override: `ZEUS_DB_HOST`
- effective target: `secondary-system`

The Local UI still does not execute arbitrary browser commands. It only invokes the allowlisted `doctor` and `analyze-existing-workspace` actions and renders the resulting diagnostics as escaped text.
