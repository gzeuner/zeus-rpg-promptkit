# Canonical Analysis Model

`canonical-analysis.json` is the semantic source of truth produced by `zeus analyze`.

`context.json`, `optimized-context.json`, reports, prompts, graphs, and bundles are compatibility projections or artifact adapters derived from that model.

## Schema

Top-level fields:

- `schemaVersion`: current canonical schema version, currently `1`
- `kind`: fixed discriminator, currently `canonical-analysis`
- `generatedAt`: ISO-8601 timestamp for the analysis model
- `rootProgram`: normalized uppercase root program name
- `sourceRoot`: absolute source root used for the analysis run
- `provenance`: analysis provenance, currently import-manifest linkage when present
- `sourceFiles`: source inventory with path, size, line count, and provenance
- `entities`: typed semantic entities
- `relations`: typed edges between semantic entities
- `enrichments`: non-core derived data such as summaries, graph summaries, DB2 metadata, and AI hints
- `notes`: sorted diagnostic and analysis notes

## Entity Collections

- `entities.programs`
  - includes the root program and directly called programs currently discovered by the scanner
  - `role` is `ROOT` for the analyzed entry point and `CALLED` for discovered callees
- `entities.tables`
  - deduplicated table dependencies including SQL-only tables
- `entities.copyMembers`
  - deduplicated copy member dependencies
- `entities.sqlStatements`
  - normalized SQL statements with type, text, table names, and evidence

## Relation Types

- `HAS_SOURCE`: root program to scanned source file
- `USES_TABLE`: root program to table
- `CALLS_PROGRAM`: root program to called program
- `INCLUDES_COPY`: root program to copy member
- `EXECUTES_SQL`: root program to SQL statement
- `SQL_REFERENCES_TABLE`: SQL statement to referenced table

## Evidence Schema

Evidence is attached to entities and relations as an array of objects with these supported fields:

- `file`: source-root-relative path using forward slashes
- `line`: single line number when only one line is known
- `startLine`: start line of a range
- `endLine`: end line of a range
- additional scanner-specific fields may exist, but paths must remain source-root-relative

## Provenance Schema

Each `sourceFiles[]` entry contains:

- `id`: stable file identifier
- `path`: source-root-relative path
- `sizeBytes`
- `lines`
- `provenance.origin`: `local` or `imported`
- `provenance.import`: populated when the source file came from `zeus-import-manifest.json`

Imported provenance currently carries:

- `sourceLib`
- `sourceFile`
- `member`
- `remotePath`
- `sha256`
- `transportUsed`
- `fetchedAt`

## Enrichments

`enrichments` stores data derived from the semantic core but not required to define it:

- `summary`
- `aiContext`
- `graph`
- `crossProgramGraph`
- `sourceCatalog`
- `db2Metadata`
- `testData`

This split keeps the semantic model stable while allowing prompt/report/viewer outputs to evolve independently.

## Invariants

- `schemaVersion` must be `1`
- `kind` must be `canonical-analysis`
- `rootProgram` must be present and uppercase-normalized
- `sourceRoot` must be absolute
- entity ids must be unique
- the root program entity must exist as `PROGRAM:<rootProgram>`
- every relation must reference known entities, except `HAS_SOURCE` targets which reference `sourceFiles[].id`
- evidence file paths must use forward slashes and be relative to `sourceRoot`
- `notes` must be a sorted array of strings

## Compatibility Contract

- `context.json` remains the stable backward-compatible projection used by existing reports and prompt templates
- `optimized-context.json` remains a token-budgeted prompt projection
- `canonical-analysis.json` is the new internal truth model for future typed analyzers and AI knowledge projection
- if a future change requires breaking the canonical schema, `schemaVersion` must be incremented explicitly
