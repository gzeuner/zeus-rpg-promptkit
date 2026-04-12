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
  - includes the root program plus scanned/called program owners discovered by the analyzer
  - `role` is `ROOT`, `SCANNED`, or `CALLED`
- `entities.tables`
  - deduplicated table dependencies including SQL-only tables
- `entities.nativeFiles`
  - deduplicated native file declarations with file kind, declared access, and keyed hints
- `entities.modules`
  - deduplicated module declarations with source file, module kind, bind directories, and imported procedure hints
- `entities.servicePrograms`
  - deduplicated service program references and binder-backed exports
- `entities.bindingDirectories`
  - deduplicated `BNDDIR` references discovered from source evidence
- `entities.copyMembers`
  - deduplicated copy member dependencies
- `entities.sqlStatements`
  - normalized SQL statements with statement type, intent, read/write flags, dynamic/unresolved markers, host variables, cursor actions, table names, and evidence
- `entities.procedures`
  - local free-form procedures and fixed-form subroutines with owner, source range, and export metadata
- `entities.prototypes`
  - declared prototypes with import/export hints and external names when present
- `entities.procedureReferences`
  - synthetic targets for dynamic and unresolved procedure calls

## Relation Types

- `HAS_SOURCE`: root program to scanned source file
- `USES_TABLE`: root program to table
- `USES_NATIVE_FILE`: root program to native file with file-level usage attributes
- `CALLS_PROGRAM`: root program to called program
- `INCLUDES_COPY`: root program to copy member
- `OWNS_PROCEDURE`: program to local procedure or subroutine
- `DECLARES_PROTOTYPE`: program to prototype
- `HAS_MODULE`: program to module compiled from source
- `USES_BINDING_DIRECTORY`: module to binding directory
- `BINDS_SERVICE_PROGRAM`: module to service program hint or binder-backed service program
- `IMPORTS_PROCEDURE`: module to imported prototype symbol
- `EXPORTS_PROCEDURE`: service program to exported local procedure when binder exports can be resolved
- `EXECUTES_SQL`: root program to SQL statement
- `SQL_REFERENCES_TABLE`: SQL statement to referenced table
- `CALLS_PROCEDURE`: procedure/program owner to a local procedure, prototype, or explicit unresolved/dynamic reference
- `ACCESSES_NATIVE_FILE`: procedure/program owner to a native file access site with opcode, access kind, and record-format hints

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
- `sourceType`
- `normalization`
- `provenance.origin`: `local` or `imported`
- `provenance.import`: populated when the source file came from `zeus-import-manifest.json`

`normalization` currently carries analyze-time ingest metadata such as:

- `detectedEncoding`
- `newlineStyle`
- `normalizedNewlineStyle`
- `status`

Imported provenance currently carries:

- `sourceLib`
- `sourceFile`
- `member`
- `memberPath`
- `remotePath`
- `localPath`
- `sourceType`
- `sha256`
- `transportRequested`
- `transportUsed`
- `fetchedAt`
- `encodingPolicy`
- `normalizationPolicy`
- `exportStatus`
- `validationStatus`

Top-level `provenance.importManifest` also summarizes the import contract when present, including:

- `schemaVersion`
- `transportRequested`
- `transportUsed`
- `streamFileCcsid`
- `encodingPolicy`
- `normalizationPolicy`
- `fileCount`
- `exportedFileCount`
- `failedFileCount`
- `invalidFileCount`
- `traceableFileCount`

## Enrichments

`enrichments` stores data derived from the semantic core but not required to define it:

- `summary`
- `aiContext`
- `graph`
- `crossProgramGraph`
- `sourceNormalization`
- `sourceTypeAnalysis`
- `ifsPaths`
- `searchResults`
- `diagnosticPacks`
- `sourceCatalog`
- `nativeFileUsage`
- `bindingAnalysis`
- `db2Metadata`
- `testData`

`db2Metadata` and `testData` remain compatibility enrichments rather than first-class semantic entities. When present, they should preserve explicit linkage back to canonical source evidence, SQL references, and native file usage so downstream AI/report projections can stay evidence-backed without reparsing DB2 artifacts.

`ifsPaths`, `searchResults`, and `diagnosticPacks` are also compatibility enrichments. They extend investigation and prompt workflows without changing the canonical entity graph, and they should remain deterministic, evidence-backed, and safe to bundle or redact.

## SQL Semantics

Each SQL statement entity may include:

- `type`: normalized statement type such as `SELECT`, `UPDATE`, `DECLARE_CURSOR`, `FETCH`, `PREPARE`, or `EXECUTE`
- `intent`: coarse semantic category such as `READ`, `WRITE`, `CURSOR`, `CALL`, `TRANSACTION`, or `OTHER`
- `readsData` / `writesData`: boolean access markers
- `dynamic`: true when the statement uses dynamic SQL patterns such as `PREPARE`, `EXECUTE`, or `EXECUTE IMMEDIATE`
- `unresolved`: true when the statement depends on runtime SQL text or unresolved table identity
- `hostVariables`: normalized host variable names referenced by the statement
- `cursors`: normalized cursor name/action pairs
- `uncertainty`: explicit markers such as `DYNAMIC_SQL`, `UNRESOLVED_SQL`, or `UNRESOLVED_TABLES`

`EXECUTES_SQL` relations mirror the key SQL access attributes so downstream projections can reason over SQL intent without reparsing statement text.

## Binding Semantics

Modules, service programs, and binding directories are modeled directly when source evidence exists.

Current heuristics cover:

- `ctl-opt` or fixed-form `H`-spec binding hints such as `BNDDIR(...)`, `BNDSRVPGM(...)`, and `NOMAIN`
- binder source members that contain `STRPGMEXP`, `EXPORT SYMBOL`, and `ENDPGMEXP`
- imported procedure symbols inferred from external prototypes

Binding uncertainty is preserved through:

- unresolved binding diagnostics when imported procedures lack explicit bind evidence
- unresolved binder export diagnostics when exported symbols cannot be matched to a local exported procedure

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
- `ai-knowledge.json` is the versioned prompt-ready AI projection derived from the canonical model
- `optimized-context.json` remains a token-budgeted compatibility projection, now driven by salience-ranked workflow evidence packs
- DB2 metadata and test-data exports may extend compatibility projections with source-linked summaries, unresolved matches, and bounded evidence counts without changing the canonical entity graph
- `canonical-analysis.json` is the new internal truth model for future typed analyzers and AI knowledge projection
- if a future change requires breaking the canonical schema, `schemaVersion` must be incremented explicitly
