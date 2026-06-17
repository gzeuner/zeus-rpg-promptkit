# Knowledge Skeleton

This directory contains a minimal skeleton for a future project-neutral knowledge pipeline.

Current status:

- skeleton contracts only
- no extractor implementation
- no catalog persistence
- no MCP/API exposure
- local profile-scoped known facts stay separate from this project-neutral pipeline

Boundaries:

- `raw/` contains sensitive evidence contracts only
- `sanitized/` contains redacted/tokenized candidate contracts only
- `final/` contains the final project-neutral catalog contract
- `privacy/` contains a fail-closed privacy gate
- `localKnownFactsStore.js` writes project-local annotations only to `config/local-only/known-facts/*.json`

Safety rules:

- raw evidence is sensitive and must never be treated as final knowledge
- sanitized does not mean safe and must still pass privacy validation
- final catalog candidates must pass `privacy/privacyGate.js` before any downstream use
- tests and examples in this area must stay synthetic
- old `.zeus/knowledge/*`, `.local` audit/session-note records, and raw export artifacts must not be migrated
- DDDL remains local raw interchange only and is not project-neutral toolkit knowledge
