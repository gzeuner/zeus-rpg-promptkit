# Project-Neutral Knowledge Pipeline

This directory contains the privacy-gated project-neutral knowledge pipeline.

Current status:

- raw, sanitized, and final catalog contracts with a fail-closed privacy gate
- a neutral PUI structural extractor with synthetic test coverage
- recursive `.dds` batch extraction with a separate local-only inventory
- final catalog persistence is available through `knowledgePipeline.js`
- read-only catalog filtering is available through `zeus.queryKnowledge()`
- no MCP exposure; CLI remains the canonical integration surface
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
- batch extraction writes decoded projections, source-relative paths, and hashes only
  to a separately supplied local root:
  `private/<run-id>/pui-private-inventory.json`
- the private inventory is sensitive local work data; it must not be committed,
  packaged, or exposed through MCP
- tests and examples in this area must stay synthetic
- old `.zeus/knowledge/*`, `.local` audit/session-note records, and raw export artifacts must not be migrated
- DDDL remains local raw interchange only and is not project-neutral toolkit knowledge

## CLI-first usage

Single-file extraction remains useful for a focused check:

```text
node cli/zeus.js knowledge extract \
  --mode ui-patterns \
  --file ./display/example.dds \
  --out ./output \
  --run-id run-001 \
  --json
```

For a source directory, the final catalog and the local-only inventory must use
different, non-overlapping roots:

```text
node cli/zeus.js knowledge extract \
  --mode ui-patterns \
  --source ./display \
  --out ./output \
  --private-out ./local-only \
  --run-id run-001 \
  --json
```

The final catalog contains only controlled structural UI patterns such as grids,
forms, selection controls, validation feedback, dialogs, navigation, and
toolbar/action controls. It never contains source paths, field identifiers,
labels, tooltips, or decoded PUI values. The batch classifier is heuristic and
describes structure, not business meaning.

The API provides deterministic, read-only filtering after the same validation
and privacy gate:

```js
zeus.queryKnowledge({
  catalogPath: './output/knowledge/run-001/project-neutral-knowledge.json',
  kinds: ['ui.form', 'ui.selection'],
  features: ['form-control-layout'],
  domain: 'ui',
});
```
