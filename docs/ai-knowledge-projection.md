# AI Knowledge Projection

`ai-knowledge.json` is the versioned prompt-ready projection emitted by `zeus analyze`.

It is derived from `canonical-analysis.json` and enriched with compatibility summaries from `context.json` and, when enabled, selection hints from `optimized-context.json`.

## Schema

Top-level fields:

- `schemaVersion`: current projection schema version, currently `1`
- `kind`: fixed discriminator, currently `ai-knowledge-projection`
- `generatedAt`: ISO-8601 timestamp
- `program`: normalized root program name
- `sourceRoot`: absolute analysis root
- `provenance`: source artifact and canonical-schema metadata
- `summary`: high-level summary derived from the canonical/context projection
- `riskMarkers`: normalized AI-facing risk hints
- `uncertaintyMarkers`: normalized uncertainty markers aggregated across semantic slices
- `evidenceIndex`: deduplicated evidence references with file, line, and snippet data
- `entities`: prompt-facing semantic sections
- `workflows`: workflow-specific prompt sections

## Entity Sections

Current `entities` blocks include:

- `tables`
- `programCalls`
- `procedureCalls`
- `copyMembers`
- `sqlStatements`
- `nativeFiles`
- `db2Tables`
- `externalObjects`
- `ifsPaths`
- `searchFindings`
- `diagnosticPacks`
- `binding`
- `modules`

Each section is prompt-oriented and may carry:

- normalized names
- semantic flags
- `evidenceRefs` into `evidenceIndex`
- uncertainty markers where relevant

`db2Tables` is a prompt-facing projection of the compact `context.db2Metadata.tables` summary. It keeps DB2 catalog rows tied to source-backed evidence with:

- `requestedName`
- `displayName`
- `schema`
- `table`
- `systemSchema`
- `systemName`
- `matchStatus`
- `matchedBy`
- `lookupStrategy`
- `objectType`
- `estimatedRowCount`
- structural counts such as `columnCount` and `foreignKeyCount`
- review counts such as `triggerCount` and `derivedObjectCount`
- evidence-backed `evidenceRefs`

`programCalls` and `procedureCalls` also carry `resolutionSource` plus catalog classification fields when Zeus resolved an external reference through IBM i object metadata rather than local source.

`externalObjects` is the prompt-facing projection of catalog-resolved IBM i programs, service programs, modules, or related objects that were linked to unresolved source references.

## Workflow Sections

Current workflow blocks:

- `documentation`
- `errorAnalysis`

Each workflow may include:

- `summary`
- `tokenBudget`
- `estimatedTokens`
- `tables`
- `programCalls`
- `copyMembers`
- `sqlStatements`
- `nativeFiles`
- `db2Tables`
- `riskMarkers`
- `uncertaintyMarkers`
- `evidencePacks`
- `evidenceHighlights`
- `rankedEvidence`
- `dependencyGraphSummary`
- `testData`
- `ifsPaths`
- `searchFindings`
- `diagnosticPacks`

Workflow `db2Tables` is selected from the projected DB2 table set using the workflow's semantic table focus rather than a second ranking system.

Workflow `testData` remains the compact compatibility summary from `context.json`, but when DB2 linkage is available Zeus narrows `testData.tables` to source-relevant DB2 tables for that workflow. This keeps sample rows available to prompts without flooding the workflow payload.

Workflow `ifsPaths`, `searchFindings`, and `diagnosticPacks` are included only when those optional investigation features are present. This keeps prompt noise controlled while still making search and diagnostic evidence available to specialized prompt packs.

`evidencePacks` currently groups ranked evidence into:

- `sql`
- `calls`
- `fileUsage`
- `conditionals`
- `errorPaths`

## Versioning

- `schemaVersion` must be incremented explicitly for breaking projection changes
- prompt generation should read `ai-knowledge.json` rather than reconstructing prompt payloads from `context.json`
- `context.json` and `optimized-context.json` remain compatibility projections
