---
Title: Local UI Shell
Description: Dokumentation zur lokalen Viewer- und UI-Shell fuer erzeugte Analyseartefakte.
Last Updated: 2026-06-18
---

# Local UI Shell

The local UI is now hardened around a Setup-first browser flow. The first production-ready area is onboarding, configuration understanding, and readiness checking. Reports remain available as a read-only follow-up area, now with grouped report views, while Prompt Workbench and other specialist features are demoted into an Advanced / Tools area instead of competing with setup.

## Command

```bash
zeus serve --source-output-root ./output --port 4782
```

Behavior:

- binds to loopback only (`127.0.0.1` by default)
- serves a local HTML shell plus local-only JSON routes
- reads existing analyze output directories
- can trigger allowlisted local analysis for an already configured workspace source root as an advanced local-only tool
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

- Setup is the default landing tab and the first production-ready browser flow
- Setup focuses on:
  - selected/default profile overview
  - env/profile precedence explanation
  - safe config metadata overview
  - Doctor readiness checks
  - runtime guardrail conflict warnings
  - clear recommended next steps
- the local-only profile wizard remains available inside Setup, but behind an expandable details area so onboarding does not start with a dense editing surface
- Reports remains available as a read-only follow-up area for generated artifacts
- Reports now acts as the read-only landing area and parent navigation area for existing runs and report views
- Reports explains:
  - whether any runs exist
  - which report views are available for the selected run
  - that Overview, Graph, DB2/Test Data, Prompt Compare, and artifact preview are report views over existing local output
  - that all of those views stay read-only in this iteration
- top-level navigation is intentionally reduced to:
  - Setup
  - Reports
  - Advanced / Tools
- report-view navigation is grouped under Reports:
  - Overview
  - Graph
  - DB2/Test Data
  - Prompt Compare
  - Artifacts
- advanced and specialist tools are demoted into Advanced / Tools instead of appearing as primary workflow actions
- Advanced / Tools is intentionally secondary and grouped into:
  - Prompt Tools
  - Local Analysis Tools
  - Experimental / Coming Later
- metadata-driven read-only Setup panel (section-grouped field contract preview)
- list analysis runs under the configured output root
- show manifest-derived run summary details
- provide a graph explorer with node-level links to related artifacts and prompts
- provide dedicated DB2 metadata and test-data table views
- provide side-by-side prompt comparison for generated prompt packs
- provide Prompt Workbench canvas, live preview, and local template CRUD
- import existing `ai_prompt_*.md` artifacts as Prompt Canvas seeds
- enumerate available artifacts, including `safe-sharing/` variants
- preview JSON, Markdown, and HTML artifacts on demand

UI hardening behavior:

- a visible primary action must either work, be clearly disabled, or be moved out of the primary Setup flow
- unfinished browser workflows such as remote fetch, DB2 query execution, and AI context generation are marked as deferred instead of being presented as normal live actions
- Doctor is the first real browser action
- Prompt Workbench remains available, but no longer dominates the initial landing area
- Reports is the next production-ready tab after Setup
- Advanced / Tools is optional and should not be mistaken for onboarding

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
- no arbitrary browser command execution is supported
- no plaintext secrets are persisted in browser storage

Analyze Workspace behavior:

- runs the existing local `analyze` core against an already available local workspace/source root
- does not fetch remote sources
- does not connect to IBM i, DB2, SFTP, or other remote systems
- returns structured status values such as `completed`, `warning`, and `failed`
- can link back to the generated run summary and `report.md` when that artifact exists
- keeps raw action details collapsed in the browser by default

## Setup and precedence

The Setup tab explains precedence in simple terms:

- CLI overrides env
- env overrides profile
- profile overrides defaults
- env vars are powerful and can change the effective target
- Doctor checks the effective configuration after those rules are applied
- secret values are never shown

Env vars are shown as metadata only, for example:

- `ZEUS_DB_HOST can override db.host`
- `ZEUS_DB_PASSWORD` may exist, but its value is never rendered

## Reports

The Reports tab is the next read-only step after Setup:

- Reports use existing local artifacts only
- Reports do not fetch remote sources
- Reports do not execute DB2 browser queries
- Reports do not modify remote or local runtime configuration

Reports help the user answer:

- are there any runs to inspect?
- which run is selected?
- which report views are available for that run?
- where should they go next: Graph, DB2/Test Data, Prompt Compare, or artifact preview?

Reports group the existing read-only report views under a single parent area:

- Overview is the default Reports landing view
- Graph stays available as a report view
- DB2/Test Data stays available as a report view
- Prompt Compare stays available as a report view
- Artifacts stay available as a report view

When no runs are present, Reports explains that output must be generated outside the browser flow before report views can be inspected.

## Advanced / Tools

Advanced / Tools is intentionally secondary:

- start in Setup for onboarding, profile understanding, and readiness
- continue to Reports for normal read-only output review
- use Advanced / Tools only when you need a specialist local utility

Current grouping:

- Prompt Tools
  - Prompt Workbench
  - prompt templates
  - prompt import from existing runs
  - local prompt previews
- Local Analysis Tools
  - Analyze Workspace
  - local-only shortcuts back into Reports
- Experimental / Coming Later
  - Fetch Sources
  - Query DB2
  - Generate AI Context

Advanced / Tools still follows the same safety rules:

- no arbitrary browser command execution
- no remote fetch action
- no browser-triggered DB2 query execution
- no secret exposure
- Analyze Workspace stays local-only

Prompt Workbench behavior:

- Prompt Workbench lives under Advanced / Tools / Prompt Tools
- it is optional and specialist-oriented, not part of the default onboarding path
- Setup should be completed first so profile, env precedence, and readiness are already understood
- Reports remains the normal place to inspect existing generated output
- Preview Prompt is local and safe; it does not persist anything by itself
- Save Local Template and Delete Local Template change only local prompt template data
- Import From Report Artifact reads existing local `ai_prompt_*.md` artifacts as seeds for a new draft
- Advanced Options expose lower-level canvas controls such as module order and additional requirements
- the browser does not execute arbitrary commands and Prompt Workbench does not contact remote systems
- Prompt Workbench responses stay escaped and do not expose secret values

## Doctor readiness diagnostics

The Setup tab can surface safe runtime guardrail diagnostics after `Check Readiness`.

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

## Hardening approach

The Local UI is being hardened tab by tab instead of growing more actions all at once:

- Setup is the first production-ready tab
- Reports is the next production-ready read-only tab
- specialist features move under Advanced / Tools until they are ready to stand on their own
- deferred workflows stay visible only as clearly non-production placeholders

## Local-only Notes

Local planning, status, and handover notes belong under `.local/` and must remain untracked. They are not part of the public Local UI documentation surface.
