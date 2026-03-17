# Zeus RPG PromptKit

Zeus RPG PromptKit is a Node.js CLI that prepares structured context bundles and AI-ready prompts for analyzing IBM i (AS/400) RPG programs.

It helps teams quickly produce consistent analysis artifacts from legacy RPG source code, including dependencies, SQL usage, and documentation prompts.

## Features

- Scans RPG source files from a configurable root directory
- Exports IBM i source members to Windows-readable UTF-8 stream files by default during `zeus fetch`
- Detects common dependencies using practical heuristics:
  - F-spec and `dcl-f` table/file declarations
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
- `src/scanner/dependencyScanner.js` - Aggregated dependency extraction
- `src/context/contextBuilder.js` - Context JSON builder
- `src/dependency/dependencyGraphBuilder.js` - Deterministic dependency graph model builder
- `src/dependency/crossProgramGraphBuilder.js` - Recursive multi-program dependency graph builder
- `src/dependency/programSourceResolver.js` - Local program name to source file resolver
- `src/dependency/graphSerializer.js` - Dependency graph serializers (JSON/Mermaid/Markdown wrapper)
- `src/viewer/architectureViewerGenerator.js` - Generates interactive `architecture.html` from `program-call-tree.json`
- `src/impact/impactAnalyzer.js` - Computes reverse dependency impact from `program-call-tree.json`
- `src/report/markdownReport.js` - Markdown report generation
- `src/report/architectureReport.js` - Architecture report generation
- `src/report/jsonReport.js` - JSON report writer
- `src/prompt/promptBuilder.js` - Prompt generation from templates
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

Run the smoke tests with:

```bash
npm test
```

## Usage

Command syntax:

```bash
zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.sqlrpgle,.rpg] [--optimize-context] [--test-data-limit <n>] [--skip-test-data] [--verbose]
```

Bundle command syntax:

```bash
zeus bundle --program <name> [--output <path>] [--source-output-root <path>] [--include-json] [--include-md] [--include-html] [--profile <name>] [--verbose]
```

Impact command syntax:

```bash
zeus impact --target <name> [--program <name>] [--out <path>] [--profile <name>] [--source <path>] [--verbose]
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

- `context.json`
- `optimized-context.json` (when `--optimize-context` is enabled)
- `report.md`
- `architecture-report.md`
- `ai_prompt_documentation.md`
- `ai_prompt_error_analysis.md`
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

`context.json` contains top-level keys:

- `program`
- `scannedAt`
- `sourceRoot`
- `sourceFiles`
- `summary`
- `dependencies`
- `sql`
- `graph`
- `crossProgramGraph`
- `db2Metadata`
- `testData`
- `aiContext`
- `notes`

`context.json` is the central AI-ready artifact. Prompt generation and report generation both consume this unified context model, and `graph` provides compact references to dependency graph artifacts.

When `--optimize-context` is enabled, prompts are generated from `optimized-context.json` instead of the full `context.json`.

`report.md` includes sections:

- `Overview`
- `Source Files`
- `Tables`
- `Program Calls`
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

- visualization library: `vis-network` loaded via CDN
- node type colors:
  - `PROGRAM` -> blue
  - `TABLE` -> green
  - `COPY` -> orange
- hierarchical top-down layout (`UD`) to keep the root program at the top

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

The analyze pipeline loads templates from disk, resolves placeholders from `context.json`, and writes prompt files to `output/<program>/`.

Supported placeholders include:

- `{{program}}`
- `{{summary}}`
- `{{tables}}`
- `{{programCalls}}`
- `{{copyMembers}}`
- `{{sqlStatements}}`
- `{{dependencyGraphSummary}}`
- `{{sourceSnippet}}`

To add a new template:

1. Create `src/prompt/templates/<name>.md`
2. Call `buildPrompt("<name>", context, outputPath)` or include the name in `buildPrompts(...)`

## DB2 Metadata Export

`zeus analyze` now attempts DB2 metadata export automatically after dependency/context analysis and before report and prompt generation.

Exported metadata includes:

- table name
- schema or library
- column names
- column types
- length, precision, and scale when JDBC metadata provides them
- nullable flag
- primary key flag
- imported foreign keys when available

Generated files in `output/<program>/` when export succeeds:

- `db2-metadata.json`
- `db2-metadata.md`

`context.json` also includes a compact `db2Metadata` block with file references and exported table count.

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

Optional masking is supported through profile configuration:

```json
{
  "testData": {
    "limit": 50,
    "maskColumns": ["NAME", "EMAIL", "PHONE"]
  }
}
```

Masked columns are written as `MASKED` in the exported rows.

Safety constraints:

- read-only JDBC queries only
- no unlimited extraction
- no full table dumps
- no write-back operations

Example:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --test-data-limit 25
```

## Output Bundle Packaging

`zeus bundle` packages generated artifacts from a single `output/<program>/` folder into one portable ZIP archive.

When `analyze-run-manifest.json` is present, `zeus bundle` uses it as the source of truth for artifact selection and metadata. This keeps analyze and bundle aligned on one deterministic output contract, which is the same direction needed for future workflow presets and a local UI/API layer.

Default bundle location:

- `bundles/<program>-analysis-bundle.zip`

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
- `README.txt` with a short bundle description

`zeus bundle` also writes `bundle-manifest.json` to `output/<program>/` for local reference.

Both bundle manifest files are versioned and include:

- `schemaVersion`
- tool/command metadata
- included file list
- artifact entries with `path`, `kind`, `sizeBytes`, and `sha256` when available
- analyze-run linkage metadata when the bundle was created from an analyze manifest

Examples:

```bash
zeus bundle --program ORDERPGM
zeus bundle --program ORDERPGM --output ./bundles --include-json
zeus bundle --program ORDERPGM --source-output-root ./output --verbose
```

Produces:

- `bundles/ORDERPGM-analysis-bundle.zip`

## Configuration Profiles

Profiles are loaded from `config/profiles.json` when present, otherwise from `config/profiles.example.json`.

A profile can define:

- `sourceRoot`
- `outputRoot`
- `extensions`
- `db` (optional): `url`, `host`, `user`, `password`, `defaultSchema`, `defaultLibrary`
- `testData` (optional): `limit`, `maskColumns`
- `fetch` (optional): `host`, `user`, `password`, `sourceLib`, `ifsDir`, `out`, `files`, `members`, `replace`, `streamFileCcsid`, `transport`
- `contextOptimizer` (optional): `maxTables`, `maxProgramCalls`, `maxCopyMembers`, `maxSQLStatements`, `maxSourceSnippets`, `maxSnippetLines`, `softTokenLimit`

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
    "softTokenLimit": 3000
  },
  "testData": {
    "limit": 50,
    "maskColumns": ["NAME", "EMAIL", "PHONE"]
  },
  "default": {
    "sourceRoot": "./rpg",
    "outputRoot": "./output",
    "extensions": [".rpgle", ".rpg"],
    "contextOptimizer": {
      "maxTables": 20,
      "maxProgramCalls": 20,
      "maxCopyMembers": 10,
      "maxSQLStatements": 10,
      "maxSourceSnippets": 20,
      "maxSnippetLines": 12
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
- prioritizes SQL and call/table signals
- limits section sizes using configurable caps
- extracts short evidence-based source snippets (default max: 12 lines)

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

## Notes

This initial version is intentionally lightweight and heuristic-driven. It is designed to be easy to read, easy to extend, and safe to evolve toward deeper RPG/SQL parsing in future iterations.

IBM i source export note:

- fetched source members are exported as UTF-8 stream files (`CCSID 1208`) by default
- analyzer components read local sources as UTF-8, so keeping fetch output on that contract avoids broken umlauts and Windows-side mojibake

## License

This project is licensed under the Apache License 2.0.

You may use, modify, and distribute this software in accordance with the terms of the Apache License.

See the LICENSE file for details.
