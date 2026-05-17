---
Title: Prompt Workbench Quality Gates
Description: Testmatrix, Regression-Schutz und negative Validierungsfaelle fuer Prompt Workbench.
Last Updated: 2026-05-17
---

# Prompt Workbench Quality Gates

## Testmatrix

### API Contract und Routing
- Prompt Builder route discovery (`/api/prompt-builder/contracts`)
- Method guards (`405`) inkl. `Allow` Header
- Bestehende Run-Explorer-Routen weiterhin stabil (`/api/runs`, `/api/runs/:program`, artifacts)

### Prompt Rendering und Validation
- Preview success path
- Invalid JSON payload handling
- Missing required fields (`useCaseId`) -> `400`
- Invalid types (`moduleIds` not array) -> `400`

### Template Persistence
- Create/Read/Update/Delete success path
- Missing template errors (`404` via server mapping)
- Payload validation (`name`, `moduleIds`) boundaries

### Output Context Integration
- Context source list from `output/<PROGRAM>`
- Prompt artifact list for selected run
- Import existing `ai_prompt_*.md` as seed
- Invalid import path rejection (`report.md` etc.)
- Unknown run rejection (`404`)

## Regression-Schutz

- Existing Local UI run endpoints stay read-only and compatible.
- Prompt Builder routes are additive under `/api/prompt-builder/*`.
- No changes to analyze/workflow artifact contracts were introduced.

## Aktuelle Testdateien

- `tests/local-ui-server.test.js`
- `tests/prompt-workbench-service.test.js`
- `tests/prompt-workbench-template-store.test.js`

## Empfohlene naechste Gates

- UI-E2E smoke test for Prompt Canvas interactions.
- Snapshot-style rendering check for preview composition.
- Load test for large local template catalogs.
