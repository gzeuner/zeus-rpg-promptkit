# Zeus RPG PromptKit

Zeus RPG PromptKit is a Node.js CLI that prepares structured context bundles and AI-ready prompts for analyzing IBM i (AS/400) RPG programs.

It helps teams quickly produce consistent analysis artifacts from legacy RPG source code, including dependencies, SQL usage, and documentation prompts.

## Features

- Scans RPG source files from a configurable root directory
- Detects common dependencies using practical heuristics:
  - F-spec and `dcl-f` table/file declarations
  - Program calls (`CALL`, `CALLP`, `CALLB`, `CALLPRC`)
  - Copy/include directives (`/COPY`, `/INCLUDE`, `COPY`)
  - Embedded SQL blocks (`EXEC SQL` + statement content)
- Builds a normalized analysis context JSON
- Generates a Markdown report with key sections
- Generates an automatic architecture report with dependency and data-flow overview
- Generates AI prompt files from reusable templates
- Supports profile-based configuration (`--profile`)
- Includes a Java helper (`JT400/JDBC compatible`) for DB2 metadata export

## Project Structure

- `cli/zeus.js` - CLI entry point
- `src/collector/sourceCollector.js` - Source file discovery
- `src/scanner/rpgScanner.js` - RPG heuristics scanner
- `src/scanner/dependencyScanner.js` - Aggregated dependency extraction
- `src/context/contextBuilder.js` - Context JSON builder
- `src/dependency/dependencyGraphBuilder.js` - Deterministic dependency graph model builder
- `src/dependency/crossProgramGraphBuilder.js` - Recursive multi-program dependency graph builder
- `src/dependency/programResolver.js` - Local program name to source file resolver
- `src/dependency/graphSerializer.js` - Dependency graph serializers (JSON/Mermaid/Markdown wrapper)
- `src/viewer/architectureViewerGenerator.js` - Generates interactive `architecture.html` from `program-call-tree.json`
- `src/report/markdownReport.js` - Markdown report generation
- `src/report/architectureReport.js` - Architecture report generation
- `src/report/jsonReport.js` - JSON report writer
- `src/prompt/promptBuilder.js` - Prompt generation from templates
- `src/prompt/templates/*.md` - Prompt templates
- `java/Db2MetadataExporter.java` - DB2 table metadata exporter
- `config/profiles.example.json` - Example profiles

## Requirements

- Node.js 20+
- Java 11+ (for metadata helper)
- Optional: DB2/JT400 JDBC driver for metadata export
- IBM i SSH/SFTP enabled for `zeus fetch`
- `JT400_JAR` environment variable set to your `jt400.jar` path for Java helpers

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

## Usage

Command syntax:

```bash
zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.sqlrpgle,.rpg] [--optimize-context] [--verbose]
```

Fetch source syntax:

```bash
zeus fetch --host <hostname> --user <username> --password <password> --source-lib <lib> --ifs-dir <ifsPath> --out <localPath> [--files <list>] [--members <list>] [--replace true|false] [--profile <name>] [--verbose]
```

Download transport option:

```bash
--transport auto|sftp|jt400|ftp
```

Default is `auto` and tries in order: `sftp -> jt400 -> ftp`.

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
- `Dependency Graph`
- `Cross-Program Graph`
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

## DB2 Metadata Export (Java Helper)

Compile:

```bash
javac java/Db2MetadataExporter.java
```

Run:

```bash
java -cp java Db2MetadataExporter "jdbc:as400://host;naming=system;libraries=MYLIB" MYUSER MYPASSWORD "ORDHDR,ORDDTL"
```

The helper prints JSON to stdout with table and column metadata.

## Configuration Profiles

Profiles are loaded from `config/profiles.json` when present, otherwise from `config/profiles.example.json`.

A profile can define:

- `sourceRoot`
- `outputRoot`
- `extensions`
- `db` (optional): `url`, `user`, `password`
- `fetch` (optional): `host`, `user`, `password`, `sourceLib`, `ifsDir`, `out`, `files`, `members`, `replace`
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
