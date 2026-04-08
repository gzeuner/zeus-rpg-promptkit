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
- `copyMembers`
- `sqlStatements`
- `nativeFiles`
- `binding`
- `modules`

Each section is prompt-oriented and may carry:

- normalized names
- semantic flags
- `evidenceRefs` into `evidenceIndex`
- uncertainty markers where relevant

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
- `riskMarkers`
- `uncertaintyMarkers`
- `evidencePacks`
- `evidenceHighlights`
- `rankedEvidence`
- `dependencyGraphSummary`
- `testData`

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
