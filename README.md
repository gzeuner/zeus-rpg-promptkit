# Zeus RPG PromptKit

Zeus RPG PromptKit is a Node.js CLI that prepares structured context bundles and AI-ready prompts for analyzing IBM i (AS/400) RPG programs.

It helps teams quickly produce consistent analysis artifacts from legacy RPG source code, including dependencies, SQL usage, and documentation prompts.

## Features

- Scans RPG, CL, and DDS source files from a configurable root directory
- Exports IBM i source members to Windows-readable UTF-8 stream files by default during `zeus fetch`
- Writes a fetch import manifest and validates imported source files before scanning
- Normalizes supported BOM-marked local sources into a consistent analyze-time text contract
- Classifies RPG, CL, and DDS sources before scanner dispatch
- Optionally scans sources and imported artifacts for likely IFS path usage with evidence-backed outputs
- Optionally runs full-text search workflows for configurable terms across local and imported analysis inputs
- Optionally executes structured read-only diagnostic query packs for table, program, and object investigation
- Detects common dependencies using practical heuristics:
  - F-spec and `dcl-f` table/file declarations
  - CL command, `CALL PGM`, and object/file usage hints
  - DDS record formats and referenced file hints
  - Native file I/O semantics including read/write/update/delete, workstation/printer behavior, and record-format hints
  - Embedded SQL semantics including read/write intent, cursor activity, host variables, dynamic SQL flags, and uncertainty markers
  - Module, service-program, binder-source, and binding-directory relationships where source evidence exists
  - Program calls (`CALL`, `CALLP`, `CALLB`, `CALLPRC`)
  - Copy/include directives (`/COPY`, `/INCLUDE`, `COPY`)
  - Embedded SQL blocks (`EXEC SQL` + statement content)
- Builds a normalized analysis context JSON
- Generates a Markdown report with key sections
- Generates an automatic architecture report with dependency and data-flow overview
- Performs reverse dependency impact analysis for tables and programs
- Generates AI prompt files from reusable templates
- Supports profile-based configuration (`--profile`)
- Includes Java helpers (`JT400/JDBC compatible`) for DB2 metadata export and test data extraction

## Project Structure

- `cli/zeus.js` - CLI entry point
- `src/collector/sourceCollector.js` - Source file discovery
- `src/scanner/rpgScanner.js` - RPG heuristics scanner
- `src/scanner/clScanner.js` - CL command and object-usage scanner
- `src/scanner/ddsScanner.js` - DDS metadata and file-reference scanner
- `src/scanner/dependencyScanner.js` - Aggregated dependency extraction
- `src/source/sourceType.js` - Source-type classification helpers
- `src/context/canonicalAnalysisModel.js` - Canonical semantic analysis model builder and validator
- `src/context/contextBuilder.js` - Backward-compatible `context.json` projection builder
- `src/dependency/dependencyGraphBuilder.js` - Deterministic dependency graph model builder
- `src/dependency/crossProgramGraphBuilder.js` - Recursive multi-program dependency graph builder
- `src/analyze/stageRegistry.js` - Registry-backed analyzer stage and lifecycle hook wiring
- `src/dependency/programSourceResolver.js` - Local program name to source file resolver
- `src/dependency/graphSerializer.js` - Dependency graph serializers (JSON/Mermaid/Markdown wrapper)
- `src/viewer/architectureViewerGenerator.js` - Generates interactive `architecture.html` from `program-call-tree.json`
- `src/impact/impactAnalyzer.js` - Computes reverse dependency impact from `program-call-tree.json`
- `src/report/markdownReport.js` - Markdown report generation
- `src/report/architectureReport.js` - Architecture report generation
- `src/report/jsonReport.js` - JSON report writer
- `src/prompt/promptBuilder.js` - Prompt generation from templates
- `src/prompt/promptRegistry.js` - Prompt contract metadata and workflow mapping
- `src/prompt/promptEvaluationHarness.js` - Fixture-driven prompt contract evaluation
- `src/prompt/templates/*.md` - Prompt templates
- `java/Db2MetadataExporter.java` - DB2 table metadata exporter
- `java/Db2TestDataExtractor.java` - DB2 sample row extractor
- `config/profiles.example.json` - Example profiles

## Requirements

- Node.js 20+
- Java 11+ (for DB2 helpers)
- Optional: DB2/JT400 JDBC driver for metadata export and test data extraction
- IBM i SSH/SFTP enabled for `zeus fetch`
- `java/lib/jt400.jar` available for local Java helper compilation and runtime

## Installation

```bash
npm install
```

For local command usage:

```bash
npm link
```

Then run:

```bash
zeus analyze --source ./rpg --program ORDERPGM
```

Without `npm link`, run directly:

```bash
node cli/zeus.js analyze --source ./rpg --program ORDERPGM
npm run analyze -- --source ./rpg --program ORDERPGM
```

Run the default CI-oriented test flow with:

```bash
npm test
```

Additional test tiers:

```bash
npm run test:contract
npm run test:smoke
npm run test:unit
npm run test:corpus
npm run test:benchmark
```

`npm run test:corpus` validates the curated sanitized scanner corpus described in `docs/scanner-corpus.md` so scanner heuristics can be regression-tested against deterministic source fixtures.

## Usage

Command syntax:

```bash
zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.sqlrpgle,.rpg] [--mode <name>] [--list-modes] [--list-diagnostic-packs] [--optimize-context] [--scan-ifs-paths] [--search-terms <csv>] [--search-ignore <csv>] [--search-max-results <n>] [--diagnostic-packs <csv>] [--diagnostic-params <k=v,...>] [--host <hostname>] [--user <username>] [--password <password>] [--safe-sharing] [--emit-diagnostics] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--verbose]
```

Workflow command syntax:

```bash
zeus workflow --preset <name> --source <path> --program <name> [--profile <name>] [--out <path>] [--bundle-output <path>] [--extensions .rpgle,.sqlrpgle,.rpg] [--list-presets] [--safe-sharing] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--verbose]
```

Guided analyze modes:

- use `--list-modes` to inspect supported workflow presets
- use `--mode architecture` for structure, graph, and architecture-report oriented review
- use `--mode documentation` for documentation-first prompt packaging
- use `--mode error-analysis` or `--mode defect-analysis` for failure-oriented evidence packaging
- use `--mode modernization` for modernization prompt generation and extraction-boundary review
- use `--mode refactoring` for dependency-aware refactoring guidance
- use `--mode test-generation` for evidence-backed scenario and fixture planning
- use `--mode impact` to highlight dependency artifacts and the next `zeus impact` step

When a guided mode is selected, Zeus records the mode and derived behavior in `analyze-run-manifest.json`, writes `analysis-index.json`, and may auto-enable context optimization for prompt-heavy workflows.

Use `--safe-sharing` when you need a redacted sharing packet. Zeus writes a parallel `safe-sharing/` artifact set with deterministic placeholders for identifiers, source paths, and extracted values.
Use `--reproducible` when you need stable timestamps and content fingerprints for repeated analyze, impact, workflow, and bundle runs.

Named workflow presets build on top of those guided modes and package a shareable bundle in one step:

- `architecture-review`
- `modernization-review`
- `onboarding`
- `dependency-risk`
- `refactoring-review`
- `test-generation-review`

Use `zeus workflow --list-presets` to inspect the available presets and `zeus workflow --preset modernization-review ...` to run analyze plus bundle with one command.

Guided modes and workflow presets now also expose opinionated review metadata:

- intended audience
- key questions answered
- expected decisions
- interpretation guidance
- recommended outputs for sharing

`zeus analyze --list-modes` and `zeus workflow --list-presets` print the audience and decision framing so users can choose a workflow by review intent, not only by file list.

Investigation options extend the same analyze pipeline and output contract:

- `--scan-ifs-paths` writes `ifs-paths.json` and `ifs-paths.md`
- `--search-terms ORDERS,INVPGM` writes `search-results.json` and `search-results.md`
- `--diagnostic-packs table-investigation --diagnostic-params table=ORDERS` writes `diagnostic-query-packs.json`, `diagnostic-query-packs.md`, and `diagnostic-query-pack-manifest.json`
- `--list-diagnostic-packs` prints the bundled starter packs and their parameters
- `--emit-diagnostics` writes `analysis-diagnostics.json` with machine-readable stage timings, warnings, cache status, and diagnostics

Analyze now runs through a split runtime contract:

- `runAnalyzeCore(...)` executes semantic analysis without writing reports, prompts, or viewer files
- core analyze stages are registered through a deterministic stage registry so new internal stages can be added without rewriting CLI control flow
- the CLI applies an explicit artifact-writer adapter afterwards so future UI/API layers can reuse the same core result contract
- source scans are cached by content hash and tool version under `output/.zeus-cache/source-scans/`
- DB2 metadata and test-data artifacts are reused through `analysis-cache.json` when inputs are unchanged
- cross-program traversal now applies explicit safety limits for depth, program count, nodes, edges, scanned files, and per-program outgoing calls
- when those limits are reached, Zeus keeps the run successful but records truncation and limit diagnostics in `context.json`, `report.md`, and the analyze manifest instead of silently over-walking large trees
- stage definitions, stage metadata, and stage diagnostics are recorded in `analysis-diagnostics.json` and `analyze-run-manifest.json`

Bundle command syntax:

```bash
zeus bundle --program <name> [--output <path>] [--source-output-root <path>] [--include-json] [--include-md] [--include-html] [--safe-sharing] [--reproducible] [--profile <name>] [--verbose]
```

Impact command syntax:

```bash
zeus impact --target <name> [--program <name>] [--out <path>] [--profile <name>] [--source <path>] [--reproducible] [--verbose]
```

Local UI shell syntax:

```bash
zeus serve [--source-output-root <path>] [--profile <name>] [--host 127.0.0.1] [--port <n>] [--verbose]
```

Fetch source syntax:

```bash
zeus fetch --host <hostname> --user <username> --password <password> --source-lib <lib> --ifs-dir <ifsPath> --out <localPath> [--files <list>] [--members <list>] [--replace true|false] [--streamfile-ccsid <ccsid>] [--profile <name>] [--verbose]
```

Download transport option:

```bash
--transport auto|sftp|jt400|ftp
```

Default is `auto` and tries in order: `sftp -> jt400 -> ftp`.

Fetch encoding option:

```bash
--streamfile-ccsid 1208
```

Default behavior:

- `zeus fetch` exports source members as UTF-8 stream files using IBM i CCSID `1208`
- this keeps downloaded RPG, CL, and DDS sources readable in common Windows editors and terminals without manual conversion
- the Windows-readable local source contract is transport-independent across `sftp`, `jt400`, and `ftp`, but it is only guaranteed for `CCSID 1208`
- `zeus fetch` writes `zeus-import-manifest.json` into the local source root to persist source member origin, member path, transport, checksum, encoding policy, normalization policy, and validation details for imported members
- `analyze-run-manifest.json` and `bundle-manifest.json` reuse that provenance summary so downstream review flows can reference imported-member identity without re-deriving it from file names

Imported source validation:

- when `zeus-import-manifest.json` is present, `zeus analyze` validates imported files before scanning
- invalid UTF-8 sources are skipped with explicit diagnostics instead of being scanned implicitly
- checksum drift and newline problems are surfaced as warnings in the analyze stage metadata and notes

Analyze-time source ingest:

- BOM-marked UTF-8 and UTF-16 inputs are normalized in memory before scanning
- line endings are normalized to a clean LF analysis contract for scanner, snippet, and prompt flows
- unsupported encodings fail with explicit per-file diagnostics instead of silent parser errors
- CL and DDS files are scanned with dedicated heuristics instead of being pushed through RPG-only logic

### Basic analyze

```bash
node cli/zeus.js analyze --source ./rpg --program ORDERPGM
```

### Basic analyze with context optimization

```bash
node cli/zeus.js analyze --source ./rpg --program ORDERPGM --optimize-context
```

### Analyze using profile

```bash
node cli/zeus.js analyze --profile default --program ORDERPGM
```

### Override profile output location

```bash
node cli/zeus.js analyze --profile default --program ORDERPGM --out ./output
```

### Fetch IBM i source to local folder

```bash
node cli/zeus.js fetch --host myibmi.example.com --user MYUSER --password MYPASSWORD --source-lib SOURCEN --ifs-dir /home/zeus/rpg_sources --out ./rpg_sources --members ORDERPGM
```

### Typical pipeline

```bash
node cli/zeus.js fetch --host myibmi.example.com --user MYUSER --password MYPASSWORD --source-lib SOURCEN --ifs-dir /home/zeus/rpg_sources --out ./rpg_sources
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM
```

## Output Contract

The command writes files into:

`output/<program>/`

Generated files:

- `canonical-analysis.json`
- `context.json`
- `optimized-context.json` (when `--optimize-context` is enabled)
- `ai-knowledge.json`
- `analysis-index.json`
- `analyze-run-manifest.json`
- `workflow-run-manifest.json` (when `zeus workflow` is executed)
- `ifs-paths.json` (when `--scan-ifs-paths` is enabled)
- `ifs-paths.md` (when `--scan-ifs-paths` is enabled)
- `search-results.json` (when `--search-terms` is used)
- `search-results.md` (when `--search-terms` is used)
- `diagnostic-query-packs.json` (when `--diagnostic-packs` is used)
- `diagnostic-query-packs.md` (when `--diagnostic-packs` is used)
- `diagnostic-query-pack-manifest.json` (when `--diagnostic-packs` is used)
- `analysis-diagnostics.json` (when `--emit-diagnostics` is enabled)
- `safe-sharing/redaction-manifest.json` (when `--safe-sharing` is enabled)
- `report.md`
- `architecture-report.md`
- `ai_prompt_documentation.md`
- `ai_prompt_error_analysis.md`
- `ai_prompt_defect_analysis.md` (when `--mode defect-analysis` is selected)
- `ai_prompt_architecture_review.md` (when `architecture`, `modernization`, or `refactoring` modes are selected)
- `ai_prompt_modernization.md` (when `--mode modernization` is selected)
- `ai_prompt_refactoring_plan.md` (when `--mode refactoring` is selected)
- `ai_prompt_test_generation.md` (when `--mode test-generation` is selected)
- `dependency-graph.json`
- `dependency-graph.mmd`
- `dependency-graph.md`
- `program-call-tree.json`
- `program-call-tree.mmd`
- `program-call-tree.md`
- `db2-metadata.json` (when DB2 metadata export succeeds)
- `db2-metadata.md` (when DB2 metadata export succeeds)
- `test-data.json` (when test data extraction runs)
- `test-data.md` (when test data extraction runs)
- `bundle-manifest.json` (when `zeus bundle` is executed)
- `impact-analysis.json` (when `zeus impact` is executed)
- `impact-analysis.md` (when `zeus impact` is executed)
- `architecture.html`

When `--safe-sharing` is enabled, Zeus also writes a parallel redacted artifact set under:

`output/<program>/safe-sharing/`

The safe-sharing directory reuses the same artifact filenames where possible, but replaces business-specific identifiers, source paths, and extracted values with deterministic placeholders such as `PROGRAM_001`, `TABLE_001`, `SCHEMA_001`, `SOURCE_FILE_001.rpgle`, and `VALUE_001`.

`context.json` contains top-level keys:

- `program`
- `scannedAt`
- `sourceRoot`
- `sourceFiles`
- `summary`
- `dependencies`
- `procedureAnalysis`
- `bindingAnalysis`
- `nativeFileUsage`
- `sql`
- `graph`
- `crossProgramGraph`
- `ifsPaths`
- `searchResults`
- `diagnosticPacks`
- `analysisCache`
- `db2Metadata`
- `testData`
- `aiContext`
- `notes`

`ai-knowledge.json` is a versioned prompt-ready projection derived from the canonical model. It preserves evidence references, risk markers, uncertainty markers, and workflow-specific sections for prompt generation.

`analysis-index.json` is a deterministic task-oriented index that maps common workflows to the relevant artifacts, prompt contracts, intended audience, expected decisions, interpretation guidance, and recommended next actions.

`workflow-run-manifest.json` records which named workflow preset produced the run, which guided analyze mode it resolved to, which review metadata shaped the run, and which bundle was emitted for sharing.

`safe-sharing/redaction-manifest.json` records which artifacts were redacted, which placeholder categories were used, and which safe-sharing files were written. Reverse mappings are intentionally not exported.
Analyze, bundle, workflow, and impact outputs also record reproducibility metadata when repeated-run verification is required.
`analyze-run-manifest.json` and `analysis-diagnostics.json` now also record cache status, stage timings, warnings, generated artifact inventory, configured analysis limits, and applied test-data policy in machine-readable form.

`canonical-analysis.json` is now the semantic source of truth for the analyze pipeline.

`context.json` remains the backward-compatible AI-ready projection. Prompt generation and report generation still consume this projection today, and `graph` provides compact references to dependency graph artifacts.

`procedureAnalysis` exposes detected local procedures, subroutines, prototypes, and classified procedure call sites so internal, external, dynamic, and unresolved procedure calls are no longer conflated with program calls.

`nativeFileUsage` exposes native IBM i file semantics including per-file read-only versus mutating usage, workstation and printer behavior, keyed/native I/O hints, procedure ownership, and detected record formats where feasible.

`sql` now exposes structured embedded SQL semantics including statement intent, read/write behavior, host variables, cursor names/actions, dynamic SQL markers, and unresolved dependency hints.

`bindingAnalysis` exposes module-level bind metadata including `BNDDIR` references, service-program hints, binder-source exports, imported procedure symbols, and unresolved bind diagnostics where explicit binding evidence is missing.

When `--optimize-context` is enabled, `optimized-context.json` becomes a salience-ranked workflow projection with token budgets, evidence packs, and ranked source references. The AI knowledge projection uses it as a selection helper, but prompt generation still reads `ai-knowledge.json`.

The canonical schema and invariants are documented in `docs/canonical-analysis-model.md`.

`report.md` includes sections:

- `Overview`
- `Source Files`
- `IFS Path Usage`
- `Full-Text Search`
- `Diagnostic Query Packs`
- `Analysis Cache`
- `Tables`
- `Program Calls`
- `Procedure Semantics`
- `Native File I/O`
- `Copy Members`
- `SQL Statements`
- `DB2 Metadata`
- `Test Data Extract`
- `Dependency Graph`
- `Cross Program Dependency Graph`
- `Impact Analysis`
- `Interactive Architecture Viewer`
- `Architecture`
- `Next Steps`

## Dependency Graph

Purpose:

- provide a deterministic central dependency model for reports and AI prompts
- represent `program -> program calls`, `program -> tables`, and `program -> copy members`
- keep output stable (uppercase identifiers, alphabetical ordering, deduplicated nodes/edges)

Generated files in `output/<program>/`:

- `dependency-graph.json`
- `dependency-graph.mmd`
- `dependency-graph.md`

Mermaid rendering:

- GitHub renders Mermaid code blocks directly in Markdown views
- VSCode renders Mermaid in Markdown preview when Mermaid support is enabled

Example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM
```

Outputs:

- `output/ORDERPGM/dependency-graph.json`
- `output/ORDERPGM/dependency-graph.mmd`
- `output/ORDERPGM/dependency-graph.md`

## Cross-Program Dependency Graph

Purpose:

- recursively follow local program calls starting from the analyzed root program
- build a multi-program call chain view for architecture analysis
- list unresolved called programs when local source files are not available

Generated files in `output/<program>/`:

- `program-call-tree.json`
- `program-call-tree.mmd`
- `program-call-tree.md`

Scope and limitation:

- recursion follows only source members that exist locally under `--source`
- unresolved calls are tracked in the graph summary and Markdown wrapper
- recursion is loop-safe via a visited program set

Example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM
```

Produces:

- `output/ORDERPGM/program-call-tree.json`
- `output/ORDERPGM/program-call-tree.mmd`
- `output/ORDERPGM/program-call-tree.md`

## Interactive Architecture Viewer

Each analyze run now also generates:

- `output/<program>/architecture.html`

Purpose:

- browser-based interactive visualization of the cross-program dependency graph
- single self-contained HTML file (no local server required)
- graph data sourced from `program-call-tree.json`

Rendering details:

- visualization library: bundled `vis-network` pinned from the project lockfile and inlined into the generated HTML
- no external `<script src=...>` dependency at runtime
- node type colors:
  - `PROGRAM` -> blue
  - `TABLE` -> green
  - `COPY` -> orange
- hierarchical top-down layout (`UD`) to keep the root program at the top

Portability details:

- works offline after the output folder or bundle is copied elsewhere
- stays version-stable because the bundled viewer bytes come from the pinned dependency version, not a CDN
- safe-sharing artifacts reuse the same self-contained viewer strategy

Interactions:

- zoom and pan
- draggable nodes
- hover highlighting
- click node to highlight connected edges
- double-click node to focus/center it

Example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM
```

Output:

- `output/ORDERPGM/architecture.html`

## Local UI Shell

Zeus now also includes a first local-only UI shell over the existing output contract.

Purpose:

- browse completed analysis runs without reparsing artifacts in the browser
- expose a stable read-only internal API for future richer UI work
- keep CLI workflows and UI workflows on the same manifest and artifact model

Current behavior:

- `zeus serve --source-output-root ./output` starts a loopback-only HTTP server
- the HTML shell at `/` uses the JSON API instead of reading files directly
- the shell lists runs, shows manifest-derived summary metadata, and exposes focused views for graph exploration, DB2/test-data browsing, prompt comparison, and artifact preview
- prompt and artifact content is fetched lazily on selection so larger runs do not require eager browser-side loading

Current API endpoints:

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/:program`
- `GET /api/runs/:program/views`
- `GET /api/runs/:program/artifacts/content?path=...`
- `GET /runs/:program/artifacts/raw?path=...`

Example:

```bash
zeus serve --source-output-root ./output --port 4782
```

Open the printed local URL in a browser to inspect available runs.

## Impact Analysis

Purpose:

- provide reverse dependency lookup using `program-call-tree.json` as source of truth
- identify direct and indirect affected programs for a table or called program
- keep results deterministic (uppercase IDs, deduplicated, sorted)

Usage:

```bash
zeus impact --target ORDERS
zeus impact --target INVOICEPGM --program ORDERPGM
```

Generated files:

- `output/<program>/impact-analysis.json`
- `output/<program>/impact-analysis.md`

Example interpretation:

- Programs affected by table `ORDERS` may include:
  - `ORDERPGM`
  - `INVOICEPGM`

## Architecture Report

Each analyze run now generates `architecture-report.md` in `output/<program>/`.

Purpose:

- automatic architecture documentation for legacy IBM i RPG programs
- quick overview of program interactions with tables, called programs, copy members, and SQL activity
- embedded Mermaid dependency view based on generated graph artifacts

How it works:

- uses `context.json` as the primary structured source
- derives that file from `canonical-analysis.json` to keep existing output contracts stable
- reuses `dependency-graph.json` and `dependency-graph.mmd` (no duplicate dependency logic)
- optionally includes SQL examples from `optimized-context.json` when available

Example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM
```

Produces:

- `output/ORDERPGM/architecture-report.md`

## AI Prompt Templates

Prompt templates are stored in:

- `src/prompt/templates/`

Available prompt types today:

- `documentation`
- `error-analysis`
- `defect-analysis`
- `modernization`
- `architecture-review`
- `refactoring-plan`
- `test-generation`

Guided analyze modes reuse these prompt contracts instead of inventing a separate prompt-selection system.

The analyze pipeline loads templates from disk, resolves placeholders from the projected prompt context, and writes prompt files to `output/<program>/`.

Prompt rendering is now contract-driven:

- each template has registry metadata for version, workflow, required inputs, preferred output shape, and budget expectations
- prompt applicability is validated against `ai-knowledge.json` before rendering
- rendered prompts fail fast when the contract budget is exceeded
- fixture-driven prompt regression tests check completeness, evidence preservation, and prompt size

See `docs/prompt-contracts.md` for the contract model and fixture harness.

Supported placeholders include:

- `{{program}}`
- `{{summary}}`
- `{{tables}}`
- `{{programCalls}}`
- `{{copyMembers}}`
- `{{sqlStatements}}`
- `{{dependencyGraphSummary}}`
- `{{sourceSnippet}}`
- `{{ifsPaths}}`
- `{{searchResults}}`
- `{{diagnosticFindings}}`

To add a new template:

1. Create `src/prompt/templates/<name>.md`
2. Call `buildPrompt("<name>", context, outputPath)` or include the name in `buildPrompts(...)`

## DB2 Metadata Export

`zeus analyze` now attempts DB2 metadata export automatically after dependency/context analysis and before report and prompt generation.

Exported metadata includes:

- SQL name and system name
- schema or library
- object type and descriptive text
- estimated row count when catalog statistics are available
- column names
- column types
- length, precision, and scale when JDBC metadata provides them
- nullable flag
- primary key flag
- imported foreign keys, including delete and update rules when available
- trigger metadata and derived-object relationships when IBM i catalog views are available
- catalog-resolved external program, service-program, and module classifications for unresolved calls when available

Generated files in `output/<program>/` when export succeeds:

- `db2-metadata.json`
- `db2-metadata.md`

`context.json` also includes a compact `db2Metadata` block with file references and exported table count.

When DB2 metadata export succeeds, that compact summary also records source-linked table matches, unresolved or ambiguous catalog matches, and evidence counts that tie schema results back to SQL or native file usage.
Program-call and procedure-call projections also carry `resolutionSource` metadata so downstream reports and prompts can distinguish source-resolved references from catalog-resolved external objects.

Required configuration:

- `db.user`
- `db.password`
- either `db.url` or `db.host`
- optional `db.defaultSchema` or `db.defaultLibrary`
- `java/lib/jt400.jar` present in the project

Example profile:

```json
{
  "sample-db2": {
    "sourceRoot": "./rpg",
    "outputRoot": "./output",
    "db": {
      "host": "myibmi.example.com",
      "user": "MYUSER",
      "password": "MYPASSWORD",
      "defaultSchema": "MYLIB"
    }
  }
}
```

Behavior:

- if DB2 configuration is available, export runs automatically during `analyze`
- if DB2 configuration or Java/JT400 prerequisites are missing, analysis still succeeds
- `report.md` records whether metadata export ran or was skipped
- unresolved table lookups are added as notes in `context.json`

The Java helper can still be executed directly:

```bash
javac -cp java/lib/jt400.jar -d java/bin java/Db2MetadataExporter.java
java -cp "java/lib/jt400.jar;java/bin" Db2MetadataExporter "jdbc:as400://host;naming=system;libraries=MYLIB" MYUSER MYPASSWORD MYLIB "ORDHDR,ORDDTL"
```

## Test Data Extractor

`zeus analyze` now attempts DB2 test data extraction automatically after DB2 metadata export and before report and prompt generation.

Purpose:

- export representative sample rows for detected DB2 tables
- make reports and prompts more concrete without dumping full tables
- keep extraction bounded and read-only

Behavior:

- default limit is `50` rows per table
- override with `--test-data-limit <n>`
- skip explicitly with `--skip-test-data`
- if DB2 configuration is missing, `analyze` still succeeds and `report.md` records the skip
- if one table extraction fails, the remaining tables are still processed

Generated files in `output/<program>/` when extraction runs:

- `test-data.json`
- `test-data.md`

`context.json` includes a compact `testData` block with file references, extracted table count, and row limit.

When test data export succeeds, the compact `testData` summary also records which extracted tables were linked back to source evidence so prompts and reports can reason about sample rows together with SQL or native file usage.

Governance can be configured through the active profile:

```json
{
  "testData": {
    "limit": 50,
    "maskColumns": ["NAME", "EMAIL", "PHONE"],
    "allowTables": ["MYLIB.CUSTOMERS", "MYLIB.ORDERS"],
    "denyTables": ["MYLIB.AUDITLOG"],
    "maskRules": [
      {
        "schema": "MYLIB",
        "table": "CUSTOMERS",
        "columns": ["PHONE"],
        "value": "MASKED_PHONE"
      }
    ]
  }
}
```

Policy behavior:

- `maskColumns` applies a global column mask across eligible tables
- `allowTables` restricts extraction to an explicit allowlist when present
- `denyTables` blocks specific tables even if they were otherwise detected or allowlisted
- `maskRules` apply scoped per-table or per-schema overrides and optional replacement values

Masked columns are written as `MASKED` unless a rule-specific replacement value is configured.
The resulting policy decisions are recorded in `test-data.json`, `test-data.md`, `context.json`, `report.md`, and `analyze-run-manifest.json` so skipped and exported tables can be audited later without re-deriving policy from config files.

Safety constraints:

- read-only JDBC queries only
- no unlimited extraction
- no full table dumps
- no write-back operations

Example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --test-data-limit 25
```

Investigation examples:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --scan-ifs-paths
zeus analyze --source ./rpg_sources --program ORDERPGM --search-terms ORDERS,INVPGM --search-ignore archive/,old/
zeus analyze --source ./rpg_sources --program ORDERPGM --diagnostic-packs table-investigation --diagnostic-params table=ORDERS
zeus analyze --list-diagnostic-packs
```

## Output Bundle Packaging

`zeus bundle` packages generated artifacts from a single `output/<program>/` folder into one portable ZIP archive.

When `analyze-run-manifest.json` is present, `zeus bundle` uses it as the source of truth for artifact selection and metadata. This keeps analyze and bundle aligned on one deterministic output contract, which is the same direction needed for future workflow presets and a local UI/API layer.

Default bundle location:

- `bundles/<program>-analysis-bundle.zip`

When `--safe-sharing` is used, the default bundle location becomes:

- `bundles/<program>-safe-sharing-bundle.zip`

Included by default:

- all `.json` files in `output/<program>/`
- all `.md` files in `output/<program>/`
- all `.html` files in `output/<program>/`

Use include filters to restrict the archive:

- `--include-json`
- `--include-md`
- `--include-html`

If any include filter is passed, only the selected file types are packaged.

The ZIP also contains:

- `manifest.json` with the included file list and summary counts
- `README.txt` with a short bundle description, intended audience, expected decisions, interpretation guidance, and recommended outputs for the selected workflow preset

When `--safe-sharing` is enabled, Zeus packages only the redacted `safe-sharing/` artifacts and records the redaction manifest path in the bundle metadata and README.

`zeus bundle` also writes `bundle-manifest.json` to `output/<program>/` for local reference.

Both bundle manifest files are versioned and include:

- `schemaVersion`
- tool/command metadata
- included file list
- artifact entries with `path`, `kind`, `sizeBytes`, and `sha256` when available
- analyze-run linkage metadata when the bundle was created from an analyze manifest
- workflow preset metadata, including intended audience, key questions answered, expected decisions, interpretation guidance, and recommended outputs, when the bundle was created from `zeus workflow` or an analyze run tagged with a workflow preset
- safe-sharing metadata when the bundle contains only redacted artifacts

Examples:

```bash
zeus bundle --program ORDERPGM
zeus bundle --program ORDERPGM --output ./bundles --include-json
zeus bundle --program ORDERPGM --source-output-root ./output --verbose
zeus bundle --program ORDERPGM --source-output-root ./output --safe-sharing
zeus workflow --preset architecture-review --source ./rpg_sources --program ORDERPGM
```

Produces:

- `bundles/ORDERPGM-analysis-bundle.zip`

## Configuration Profiles

Profiles are loaded from `config/profiles.json` when present, otherwise from `config/profiles.example.json`.

A profile can define:

- `sourceRoot`
- `outputRoot`
- `extensions`
- `extends` (optional): inherit from one or more other profiles
- `analysisLimits` (optional): `maxProgramDepth`, `maxPrograms`, `maxNodes`, `maxEdges`, `maxScannedFiles`, `maxProgramCallsPerProgram`
- `db` (optional): `url`, `host`, `user`, `password`, `defaultSchema`, `defaultLibrary`
- `testData` (optional): `limit`, `maskColumns`, `allowTables`, `denyTables`, `maskRules`
- `fetch` (optional): `host`, `user`, `password`, `sourceLib`, `ifsDir`, `out`, `files`, `members`, `replace`, `streamFileCcsid`, `transport`
- `contextOptimizer` (optional): `maxTables`, `maxProgramCalls`, `maxCopyMembers`, `maxSQLStatements`, `maxSourceSnippets`, `maxSnippetLines`, `softTokenLimit`, `workflowTokenBudgets`

Profiles merge from top-level defaults into the selected profile, and `extends` lets one profile build on another without copying the full contract. String placeholders in the form `${env:VAR_NAME}` are resolved from the process environment during load, which keeps credentials and other secrets out of committed profile files.

Example:

```json
{
  "contextOptimizer": {
    "maxTables": 20,
    "maxProgramCalls": 20,
    "maxCopyMembers": 10,
    "maxSQLStatements": 10,
    "maxSourceSnippets": 20,
    "maxSnippetLines": 12,
    "softTokenLimit": 3000,
    "workflowTokenBudgets": {
      "documentation": 2200,
      "errorAnalysis": 1600
    }
  },
  "analysisLimits": {
    "maxProgramDepth": 25,
    "maxPrograms": 500,
    "maxNodes": 5000,
    "maxEdges": 4000,
    "maxScannedFiles": 500,
    "maxProgramCallsPerProgram": 200
  },
  "testData": {
    "limit": 50,
    "maskColumns": ["NAME", "EMAIL", "PHONE"],
    "allowTables": ["MYLIB.CUSTOMERS", "MYLIB.ORDERS"],
    "denyTables": ["MYLIB.AUDITLOG"],
    "maskRules": [
      {
        "table": "CUSTOMERS",
        "columns": ["PHONE"],
        "value": "MASKED_PHONE"
      }
    ]
  },
  "default": {
    "sourceRoot": "./rpg",
    "outputRoot": "./output",
    "extensions": [".rpgle", ".rpg", ".sqlrpgle", ".rpgleinc"],
    "analysisLimits": {
      "maxProgramDepth": 15,
      "maxPrograms": 250
    },
    "contextOptimizer": {
      "maxTables": 20,
      "maxProgramCalls": 20,
      "maxCopyMembers": 10,
      "maxSQLStatements": 10,
      "maxSourceSnippets": 20,
      "maxSnippetLines": 12,
      "workflowTokenBudgets": {
        "documentation": 1800
      }
    }
  },
  "modernization-large": {
    "extends": "default",
    "outputRoot": "./output-modernization",
    "analysisLimits": {
      "maxProgramDepth": 40,
      "maxPrograms": 1000
    }
  },
  "sample-db2": {
    "sourceRoot": "./rpg",
    "outputRoot": "./output",
    "extensions": [".rpgle", ".rpg"],
    "db": {
      "host": "myibmi.example.com",
      "url": "jdbc:as400://myibmi.example.com;naming=system;libraries=MYLIB",
      "user": "${env:ZEUS_DB_USER}",
      "password": "${env:ZEUS_DB_PASSWORD}",
      "defaultSchema": "MYLIB"
    },
    "testData": {
      "limit": 50,
      "maskColumns": ["NAME", "EMAIL", "PHONE"],
      "allowTables": ["MYLIB.CUSTOMERS", "MYLIB.ORDERS"],
      "denyTables": ["MYLIB.AUDITLOG"],
      "maskRules": [
        {
          "schema": "MYLIB",
          "table": "CUSTOMERS",
          "columns": ["PHONE"],
          "value": "MASKED_PHONE"
        }
      ]
    }
  },
  "sample-fetch": {
    "fetch": {
      "host": "myibmi.example.com",
      "user": "MYUSER",
      "password": "MYPASSWORD",
      "sourceLib": "SOURCEN",
      "ifsDir": "/home/zeus/rpg_sources",
      "out": "./rpg_sources",
      "files": ["QRPGLESRC", "QSQLRPGLESRC", "QCLLESRC"],
      "streamFileCcsid": 1208,
      "replace": true,
      "transport": "auto"
    }
  }
}
```

## AI Context Optimization

Large RPG programs often exceed practical LLM context limits when full scan output is passed directly to prompts.  
`--optimize-context` adds a deterministic reduction step:

- keeps program metadata, dependency summary, tables, program calls, copy members, and SQL
- ranks semantic evidence by salience instead of trimming lists alphabetically
- builds workflow-specific evidence packs for SQL, calls, native file usage, conditionals, and error paths
- enforces configurable token budgets per workflow through `workflowTokenBudgets.documentation` and `workflowTokenBudgets.errorAnalysis`
- carries ranked file-and-line evidence references forward into `ai-knowledge.json` and the generated prompts

Token estimation uses a lightweight heuristic:

- `estimatedTokens ~= characters / 4`

During `analyze`, CLI output and `report.md` include:

- context token estimate
- optimized token estimate (when enabled)
- percentage reduction
- optional warning if optimized context exceeds `softTokenLimit`

Example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --optimize-context
```

Safe-sharing example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --safe-sharing
zeus bundle --program ORDERPGM --source-output-root ./output --safe-sharing
```

See [docs/safe-sharing.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/safe-sharing.md) for the safe-sharing rules for reports, prompts, bundles, fixtures, and issue text.
See [docs/fixture-sanitization.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/fixture-sanitization.md) for the shared sanitized fixture corpus rules and review checklist.
See [docs/reproducible-output-mode.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/reproducible-output-mode.md) for the reproducible output contract and stable-timestamp mode.
See [docs/import-manifest-contract.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/import-manifest-contract.md) for the public fetch provenance manifest contract.
See [docs/source-ingest-normalization.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/source-ingest-normalization.md) for the analyze-time normalization contract and current CL/DDS scanner depth.
See [docs/investigation-workflows.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/investigation-workflows.md) for the new IFS-path, full-text search, diagnostic-pack, and prompt-pack workflow additions.
See [docs/analyzer-stage-pipeline.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/analyzer-stage-pipeline.md) for the registry-backed analyze stage contract and plugin seam.
See [docs/local-ui-shell.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/local-ui-shell.md) for the read-only local UI shell and API contract.
See [docs/viewer-asset-strategy.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/viewer-asset-strategy.md) for the offline viewer packaging strategy and licensing note.

## Notes

This initial version is intentionally lightweight and heuristic-driven. It is designed to be easy to read, easy to extend, and safe to evolve toward deeper RPG/SQL parsing in future iterations.

IBM i source export note:

- fetched source members are exported as UTF-8 stream files (`CCSID 1208`) by default
- analyzer components read local sources as UTF-8, so keeping fetch output on that contract avoids broken umlauts and Windows-side mojibake
- non-default `--streamfile-ccsid` values remain best-effort; the guaranteed Windows-readable contract is documented in [docs/fetch-encoding-contract.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/fetch-encoding-contract.md)
- imported-member provenance and export diagnostics are documented in [docs/import-manifest-contract.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/import-manifest-contract.md)
- analyze-time source normalization and CL/DDS scan depth are documented in [docs/source-ingest-normalization.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/source-ingest-normalization.md)

## License

This project is licensed under the Apache License 2.0.

You may use, modify, and distribute this software in accordance with the terms of the Apache License.

See the LICENSE file for details.
