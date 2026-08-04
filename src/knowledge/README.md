# Project-Neutral Knowledge Pipeline

This directory contains the privacy-gated project-neutral knowledge pipeline.

Current status:

- raw, sanitized, and final catalog contracts with a fail-closed privacy gate
- a neutral PUI structural extractor with synthetic test coverage
- final catalog persistence is available through `knowledgePipeline.js`
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
- `knowledgePipeline.js` writes only privacy-gated final catalogs to
  `output/knowledge/<run-id>/project-neutral-knowledge.json`
- tests and examples in this area must stay synthetic
- old `.zeus/knowledge/*`, `.local` audit/session-note records, and raw export artifacts must not be migrated
- DDDL remains local raw interchange only and is not project-neutral toolkit knowledge
