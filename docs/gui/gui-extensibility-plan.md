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

Current gap:

- the existing Configure view is still closer to a metadata browser plus a `doctor` action than to a guided IBM i onboarding flow
- this is too flat for beginners and too implicit for safe remote-read discovery planning

## Guided Configuration Wizard Direction

The next useful GUI layer is a guided configuration wizard on top of the existing config and command contracts.

The wizard should not replace CLI/runtime configuration. It should:

- explain the existing profile/runtime model
- group fields by guided step instead of raw config section only
- show safety level per step and per discovery action
- map user intent to required, recommended, optional, and not-needed areas
- generate safe CLI previews without secrets
- keep discovery explicit, read-only, and preview-first

Foundation steps:

1. Workspace
2. System Profile
3. Source Discovery
4. Data and Metadata Libraries
5. Object Discovery
6. Analysis Intent
7. Review and Save

## Discovery Actions: Current Boundary

Read-only discovery actions are useful, but they must not fake success in the browser.

Near-term rule:

- allow local config-derived previews before any remote-read backend exists
- keep broader discovery explicit with status like `stubbed-preview-only` or `not-ready`
- show intended safety level and expected scope
- show command/contract preview where possible
- do not simulate data that was never read
- do not add a generic "scan everything" button

Examples of acceptable first-step discovery actions:

- discover source libraries
- discover source physical files
- discover members
- discover DB2 tables/views
- discover object types

Current implemented midpoint:

- source library preview may be derived from the resolved fetch profile locally
- source physical file preview may be derived from resolved fetch scope and Zeus defaults locally
- member preview may show whether bounded member filters already exist in the profile
- DB2/object inventory remains preview-only until dedicated read-only backends are wired

This keeps the UI honest: profile-derived guidance is allowed, fake live inventory is not.

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

## Non-Goals For This Iteration

- no remote write behavior
- no plain-password storage
- no browser-driven arbitrary command execution
- no MCP tool broad exposure by default
- no full inventory scan without preview and explicit confirmation
- no GUI-specific config model that bypasses existing CLI/runtime contracts

## How Future Discovery Actions Should Be Added

New discovery actions should be added contract-first:

1. define action metadata:
   - id
   - title
   - description
   - safety level
   - scope
   - expensive yes/no
   - CLI or backend preview if available
2. add strict payload validation in the UI action service
3. return explicit status values:
   - `not-ready`
   - `planned`
   - `preview-only`
   - `completed`
   - `warning`
   - `failed`
4. add tests that prove the action does not overreach or fake-success
5. keep resolved or secret-bearing values masked in all responses

## Implementation-Oriented Next Step

A follow-up coding iteration can start with:

1. endpoint/module that returns config + command metadata to UI
2. minimal GUI shell with 6 workflow cards
3. "Configure" screen auto-generated from config metadata
4. "Doctor" execution integration with status badges
5. one end-to-end path: Configure -> Fetch -> Analyze -> Review

Updated incremental step:

1. keep the existing shell and cards
2. add a guided configuration payload on top of config metadata
3. add wizard-step grouping, intent classification, and safe CLI previews
4. add config-derived source-scope previews without pretending a live scan happened
5. keep DB2/object discovery explicit preview-first stubs
6. keep `doctor` as the first executable readiness action
