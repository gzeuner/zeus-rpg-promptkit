# GUI Extensibility Plan (Foundation)

This is a foundation plan for a modular GUI, not a full UI implementation.

## Goals

- reduce cognitive load through progressive disclosure
- present clear "what to do next" workflow actions
- keep runtime behavior aligned with existing CLI/profile contracts
- allow new commands and capabilities without redesigning core navigation

## UX Direction: Workflow Cards First

Default landing view should be a small set of workflow cards:

1. Configure
2. Fetch Sources
3. Analyze Workspace
4. Query DB2
5. Review Reports
6. Generate AI Context

Each card should show:

- status summary (ready/warning/missing config)
- primary action
- minimal required fields
- optional "advanced" drawer
- recommended next card after completion

## Configuration in GUI

Use `src/config/configUiMetadata.js` as the UI contract source for forms.

The GUI should:

- render sections (`profile`, `workspace`, `db2`, `fetch`, `analysis`, `workflow`)
- show env/profile linkage for each field
- mask sensitive values and never persist plaintext secrets in browser storage
- support "profile default + command override" preview before execution

Suggested GUI behavior for secrets:

- show as "set via env" when placeholders/env keys are used
- allow one-time runtime entry (optional), not auto-save by default
- clearly mark fields with `sensitive=true`

## Multiple Systems / Connections

Model connection cards around existing `systems` and role routing:

- base system definitions (dev/readonly/etc.)
- role mapping (`db`, `dbRoles.metadata`, `dbRoles.testData`, `fetch`)
- resolved preview of effective host/schema per command capability

This enables a user to understand where fetch/query/analyze will run before execution.

## Source Libraries and Source Files

Fetch UI should separate:

- connection setup
- source scope (`sourceLibrary`, `sourceFiles`, `members`)
- transport tuning (advanced)

Provide presets for common source-file sets and keep advanced transport flags collapsed by default.

## Fetch and Analysis Workflows

Proposed flow:

1. Configure profile + connection basics
2. Run doctor (readiness check)
3. Fetch (optional when source is remote)
4. Analyze selected program/member
5. Open report in review view
6. Optionally bundle for AI context

Show only the next needed action prominently. Keep all other controls secondary.

## DB2 / Query Workflows

Query flows should reuse DB metadata fields and role config:

- Query Table (guided form)
- Query SQL (advanced editor)

Add guardrails in UI:

- read-only badge
- max row defaults
- schema/default connection preview

## Command Discovery and Metadata

`src/cli/commandMetadata.js` is introduced as a GUI-friendly command contract layer.

Use it to power:

- card titles and summaries
- category grouping
- common vs advanced options
- output artifact hints
- recommended next command links

As new commands are added, extend metadata instead of hardcoding GUI navigation logic.

## Progressive Disclosure Pattern

For every card/screen:

- show only required inputs first
- hide advanced options by default
- keep safety/risk hints visible but concise
- provide "why this field matters" help text from metadata

This should replace the current all-fields-at-once presentation pattern.

## Implementation-Oriented Next Step

A follow-up coding iteration can start with:

1. endpoint/module that returns config + command metadata to UI
2. minimal GUI shell with 6 workflow cards
3. "Configure" screen auto-generated from config metadata
4. "Doctor" execution integration with status badges
5. one end-to-end path: Configure -> Fetch -> Analyze -> Review
