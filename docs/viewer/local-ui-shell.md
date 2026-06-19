---
Title: Local UI Shell
Description: Dokumentation zur optionalen lokalen Viewer- und experimentellen UI-Shell fuer erzeugte Analyseartefakte.
Last Updated: 2026-06-19
---

# Local UI Shell

The Local UI is an optional, local-only, experimental viewer around existing Zeus artifacts and a small allowlisted helper surface.

The supported product workflow remains:

1. load env explicitly in the shell
2. run `doctor`
3. use CLI or MCP commands from `docs/tool-catalog.md`
4. generate artifacts and reports
5. optionally inspect those artifacts with `zeus serve`

The Local UI is not the primary onboarding, configuration, fetch, query, or prompt-generation workflow. It is also not a general browser command executor.

## Command

```bash
zeus serve --source-output-root ./output --port 4782
```

Behavior:

- binds to loopback only (`127.0.0.1` by default)
- serves a local HTML shell plus local-only JSON routes
- reads existing analyze output directories
- can trigger a very small set of allowlisted helper actions for an already configured local workspace
- reuses the current manifest and artifact contracts instead of introducing a parallel storage model

## API endpoints

- `GET /api/health`
- `GET /api/ui-metadata`
- `POST /api/ui-actions/doctor`
- `POST /api/ui-actions/generate-ai-session-prompt`
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

- not required for CLI or MCP usage
- not a replacement for shell env loading
- not a replacement for `doctor`, `fetch`, `query-table`, `query-sql`, `resolve-object`, or other CLI/MCP commands
- not a general browser command runner
- most useful after artifacts already exist under the output root
- able to list analysis runs, summarize manifests, and preview local artifacts on demand
- able to show grouped read-only report views such as Overview, Graph, DB2/Test Data, Prompt Compare, and Artifacts
- able to surface a small set of local helper views such as config metadata, `doctor` diagnostics, and AI Session Starter prompt generation
- able to keep specialist tools such as Prompt Workbench under a clearly secondary Advanced / Tools area

The current top-level navigation still contains:

- Setup
- Reports
- Advanced / Tools

Interpretation guidance:

- treat Reports as the main viewer-oriented area
- treat Setup as an optional helper view, not the supported onboarding path
- treat Advanced / Tools as optional specialist utilities only

UI hardening behavior:

- a visible primary action must either work, be clearly disabled, or be moved out of high-visibility areas
- unfinished browser workflows such as remote fetch, DB2 query execution, and AI context generation are marked as deferred instead of being presented as normal live actions
- Doctor is the first real browser action
- Prompt Workbench remains available, but is intentionally secondary
- Reports is the main read-only viewing area once output exists
- Advanced / Tools is optional and should not be mistaken for onboarding

Large-output behavior:

- focused views are derived on the server from existing artifacts
- the browser fetches prompt and artifact content only on selection
- the shell uses simple filtering instead of eager full-page rendering of every artifact body

This remains an API-and-shell foundation for optional local viewing. It is not the primary Zeus product surface.

## Allowlisted UI actions

The local UI action surface is intentionally explicit and small:

- only allowlisted actions are supported
- arbitrary command execution is not supported
- raw shell command payloads are rejected
- payload keys are strictly validated
- unknown action names return deterministic errors

Current supported action:

- `doctor` readiness check via `POST /api/ui-actions/doctor`
- `generate-ai-session-prompt` via `POST /api/ui-actions/generate-ai-session-prompt`
- `analyze-existing-workspace` via `POST /api/ui-actions/analyze-existing-workspace`

Security behavior:

- request and response format is JSON only
- server-side validation blocks unsafe profile values
- `generate-ai-session-prompt` accepts only `profile`, optional `environment`, `goal`, `includeDoctorSummary`, and optional compact `doctorSummary`
- `analyze-existing-workspace` accepts only `profile`, `program`, `member`, and `safeSharing`
- browser payloads do not provide `sourceRoot`; the action always uses the selected profile's configured local source root
- browser payloads cannot provide arbitrary shell commands, absolute paths, or traversal-style filesystem input
- browser payloads cannot provide env dumps, raw secrets, or credential-bearing JDBC text for AI session generation
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

Setup now also includes `Start AI Session`:

- it generates a guided assistant prompt from `docs/ai/session-prompt.md`
- it keeps prompt generation server-side so the browser only submits validated JSON
- it can include a compact Doctor summary, but it still instructs the assistant to run Doctor first
- it reminds the user that env loading is shell/process scoped and remains authoritative
- it shows helper commands for `config/load-env.ps1` and `config/load-env.sh`
- it does not inject env vars into the user's already-open terminal
- it does not expose credentials, resolved env values, or full connection strings
- it treats `docs/tool-catalog.md` as the authoritative CLI/MCP command reference

AI Session Starter guidance:

- use it only as a helper after shell env loading and preferably after `Check Readiness`
- keep credentials in env or other local-only mechanisms, not in the goal text
- generated prompts can mention allowlisted Zeus MCP tools if available, but they must not invent unsupported MCP capabilities
- risky CLI or MCP operations still require explicit approval according to the tool catalog safety levels

Env vars are shown as metadata only, for example:

- `ZEUS_DB_HOST can override db.host`
- `ZEUS_DB_PASSWORD` may exist, but its value is never rendered

## Reports

The Reports tab is the main viewer-oriented area:

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

- start with CLI/MCP and generated artifacts outside the browser
- use Reports for normal read-only output review
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
- it is optional and specialist-oriented, not part of the supported primary workflow
- shell env loading plus CLI/MCP artifact generation should already be understood before using it
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

- Reports is the main useful read-only area for existing output
- Setup remains a helper area, not the supported primary onboarding path
- specialist features move under Advanced / Tools until they are ready to stand on their own
- deferred workflows stay visible only as clearly non-production placeholders

## Local-only Notes

Local planning, status, and handover notes belong under `.local/` and must remain untracked. They are not part of the public Local UI documentation surface.
