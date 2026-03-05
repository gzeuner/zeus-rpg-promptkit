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
- Generates AI prompt files from reusable templates
- Supports profile-based configuration (`--profile`)
- Includes a Java helper (`JT400/JDBC compatible`) for DB2 metadata export

## Project Structure

- `cli/zeus.js` - CLI entry point
- `src/collector/sourceCollector.js` - Source file discovery
- `src/scanner/rpgScanner.js` - RPG heuristics scanner
- `src/scanner/dependencyScanner.js` - Aggregated dependency extraction
- `src/context/contextBuilder.js` - Context JSON builder
- `src/report/markdownReport.js` - Markdown report generation
- `src/report/jsonReport.js` - JSON report writer
- `src/prompt/promptBuilder.js` - Prompt generation from templates
- `src/prompt/templates/*.md` - Prompt templates
- `java/Db2MetadataExporter.java` - DB2 table metadata exporter
- `config/profiles.example.json` - Example profiles

## Requirements

- Node.js 20+
- Java 11+ (for metadata helper)
- Optional: DB2/JT400 JDBC driver for metadata export

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
zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.sqlrpgle,.rpg] [--verbose]
```

### Basic analyze

```bash
node cli/zeus.js analyze --source ./rpg --program ORDERPGM
```

### Analyze using profile

```bash
node cli/zeus.js analyze --profile default --program ORDERPGM
```

### Override profile output location

```bash
node cli/zeus.js analyze --profile default --program ORDERPGM --out ./output
```

## Output Contract

The command writes files into:

`output/<program>/`

Generated files:

- `context.json`
- `report.md`
- `ai_prompt_documentation.md`
- `ai_prompt_error_analysis.md`

`context.json` contains top-level keys:

- `program`
- `scannedAt`
- `sourceFiles`
- `tables`
- `calls`
- `copyMembers`
- `sqlStatements`
- `notes`

`report.md` includes sections:

- `Overview`
- `Source Files`
- `Tables`
- `Program Calls`
- `Copy Members`
- `SQL Statements`
- `Next Steps`

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

Example:

```json
{
  "default": {
    "sourceRoot": "./rpg",
    "outputRoot": "./output",
    "extensions": [".rpgle", ".rpg"]
  }
}
```

## Notes

This initial version is intentionally lightweight and heuristic-driven. It is designed to be easy to read, easy to extend, and safe to evolve toward deeper RPG/SQL parsing in future iterations.
