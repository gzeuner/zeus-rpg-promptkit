# Zeus RPG PromptKit

Zeus RPG PromptKit is an evidence-first analysis toolkit for IBM i source estates. It helps teams fetch, normalize, analyze, enrich, and package RPG-centric legacy systems into artifacts that are useful for developers, architects, QA, modernization initiatives, and AI-assisted workflows.

It does **not** generate business code and it does **not** depend on any specific AI provider. Instead, it prepares structured, inspectable context so humans and AI tools can work from the same grounded evidence.

## Why this exists

Legacy IBM i systems usually spread knowledge across RPG, SQLRPGLE, CL, DDS, binder source, DB2 metadata, and tribal memory. Zeus RPG PromptKit turns that scattered estate into a repeatable workflow:

- acquire IBM i sources into a local, UTF-8-friendly workspace
- scan and classify source semantics across multiple IBM i file types
- build a canonical dependency and evidence model
- enrich source findings with DB2 catalog metadata and optional governed sample data
- generate reports, graphs, prompt packs, and review bundles

The result is a workflow that is much better for:

- understanding unfamiliar programs
- impact analysis before changes
- documentation and onboarding
- test creation, extension, and repair
- architecture review
- modernization planning
- safe artifact sharing with internal or external reviewers

## Core idea

Think of Zeus RPG PromptKit as an **evidence-preparation layer**.

It prepares high-quality analysis artifacts that can be consumed by:

- a developer in VS Code
- GitHub Copilot Chat
- a browser-based AI chat
- a local or remote LLM CLI
- a reviewer using Markdown, JSON, HTML, or the built-in local UI

That means the tool is valuable even if you never use an AI API at all.

## What it does

### Source acquisition and provenance

- exports IBM i source members from QSYS source files to IFS stream files
- downloads them locally using `sftp`, `jt400`, `ftp`, or `auto`
- defaults to UTF-8 stream file export via CCSID `1208`
- writes `zeus-import-manifest.json` with provenance, transport, checksums, and validation details

### Source normalization and integrity checks

- validates imported files before scanning
- supports UTF-8 directly
- normalizes BOM-marked UTF-8 and UTF-16 local sources into the analyze-time UTF-8 contract
- normalizes line endings for scanner and prompt workflows
- records invalid UTF-8, checksum drift, and newline issues as explicit diagnostics

### Multi-language IBM i source analysis

Zeus scans more than RPG.

It supports practical analysis across:

- RPG / RPGLE / SQLRPGLE
- CL / CLLE
- DDS
- binder source

Detected semantics include:

- program calls
- procedure calls and prototypes
- copy/include dependencies
- embedded SQL statements and intent classification
- host variables and cursor usage
- native file I/O behavior
- CL object and file references
- DDS file kinds, record formats, and references
- binding directories, service-program hints, and binder exports

### Dependency and impact analysis

- builds deterministic dependency graphs
- builds cross-program call trees
- resolves local source members recursively
- tracks unresolved and ambiguous references explicitly
- computes reverse impact analysis for tables and programs

### DB2 metadata enrichment

- exports schema metadata for detected tables
- captures columns, keys, foreign keys, descriptions, triggers, derived objects, and row-count hints
- links DB2 findings back to source evidence
- resolves certain external IBM i objects beyond what source alone can prove

### Governed test-data extraction

- exports bounded sample rows for detected tables
- supports allowlists, denylists, and masking policies
- ties sample data back to source-linked table evidence
- keeps the workflow read-only and review-oriented

### Prompt and context preparation

- builds canonical and reduced context artifacts
- creates workflow-specific AI prompt files
- supports context optimization and token budgeting
- preserves evidence references and uncertainty markers

### Investigation and review support

- scans for likely IFS path usage
- supports full-text search workflows
- runs structured read-only diagnostic packs
- renders graphs as Markdown, Mermaid, JSON, and HTML
- serves completed runs via a local browser UI

### Packaging and safe sharing

- creates portable ZIP bundles
- supports reproducible output mode
- supports safe-sharing mode with deterministic redaction placeholders
- records bundle and redaction manifests for traceability

## Who it is for

Zeus RPG PromptKit is especially useful for:

- IBM i developers onboarding into old systems
- architects reviewing dependencies and system shape
- QA/test engineers deriving scenarios from legacy behavior
- modernization teams identifying extraction seams and blockers
- reviewers performing impact analysis before risky changes
- teams who want AI help without throwing raw source dumps at a model

## What it is not

Zeus RPG PromptKit is **not**:

- an RPG compiler
- a runtime debugger
- a code generator
- an AI provider integration
- a replacement for human review

It is a context and evidence toolkit. Its job is to make analysis more structured, reproducible, and verifiable.

---

## Architecture at a glance

### Node.js CLI

Main entry point:

- `cli/zeus.js`

Primary commands:

- `zeus fetch`
- `zeus analyze`
- `zeus workflow`
- `zeus bundle`
- `zeus impact`
- `zeus serve`

### Java helpers

The toolkit uses on-demand Java helpers for IBM i and DB2-specific tasks such as:

- `IbmiCommandRunner`
- `IbmiMemberLister`
- `IbmiIfsDownloader`
- `IbmiSourceMemberExporter`
- `Db2MetadataExporter`
- `Db2ExternalObjectResolver`
- `Db2TestDataExtractor`
- `Db2DiagnosticQueryRunner`

These are invoked through the runtime bridge in `src/java/javaRuntime.js`.

### Analysis pipeline

The analyze workflow is stage-based and registry-driven. In broad terms it does this:

1. collect and validate source files
2. classify and scan source semantics
3. build canonical and developer-facing projections
4. optionally run investigations
5. optionally optimize context
6. optionally export DB2 metadata
7. optionally extract governed test data
8. optionally emit diagnostics
9. write reports, graphs, prompts, and manifests

This design keeps the core pipeline reusable for CLI, workflows, bundles, and the local UI.

---

## Requirements

- Node.js 20+
- Java 11+
- optional: `java/lib/jt400.jar` for IBM i / DB2 helper workflows
- optional: IBM i SSH/SFTP enabled for `zeus fetch`
- optional: DB2/JT400 JDBC driver access for metadata export and test data extraction

## Installation

```bash
npm install
```

For local command usage:

```bash
npm link
```

Then:

```bash
zeus analyze --source ./rpg --program ORDERPGM
```

Without `npm link`:

```bash
node cli/zeus.js analyze --source ./rpg --program ORDERPGM
npm run analyze -- --source ./rpg --program ORDERPGM
```

Run tests:

```bash
npm test
npm run test:unit
npm run test:smoke
npm run test:contract
npm run test:corpus
npm run test:benchmark
```

---

## Quick start

### 1. Analyze a local source tree

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

This is the best first step when the source is already available locally.

### 2. Fetch from IBM i, then analyze

```bash
zeus fetch --host myibmi.example.com --user MYUSER --password MYPASSWORD --source-lib SOURCEN --ifs-dir /home/zeus/rpg_sources --out ./rpg_sources --transport auto
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

Use this when your source still lives on IBM i and you want a local, UTF-8-friendly mirror first.

### 3. Run a bundled workflow preset

```bash
zeus workflow --preset onboarding --source ./rpg_sources --program ORDERPGM --out ./output --bundle-output ./bundles
```

Use workflow presets when you want a more opinionated, ready-to-share artifact set.

### 4. Inspect results in a browser

```bash
zeus serve --source-output-root ./output
```

Use this when you or other reviewers prefer a local UI over reading raw files.

---

## CLI overview

### Analyze

```bash
zeus analyze --source <path> --program <name> [options]
```

Important options include:

- `--profile <name>`
- `--out <path>`
- `--extensions .rpgle,.sqlrpgle,.rpg`
- `--mode <name>`
- `--list-modes`
- `--optimize-context`
- `--scan-ifs-paths`
- `--search-terms <csv>`
- `--search-ignore <csv>`
- `--search-max-results <n>`
- `--diagnostic-packs <csv>`
- `--diagnostic-params <k=v,...>`
- `--safe-sharing`
- `--emit-diagnostics`
- `--reproducible`
- `--test-data-limit <n>`
- `--skip-test-data`
- `--verbose`

### Workflow

```bash
zeus workflow --preset <name> --source <path> --program <name> [options]
```

Typical presets include:

- `architecture-review`
- `modernization-review`
- `onboarding`
- `dependency-risk`
- `refactoring-review`
- `test-generation-review`

### Bundle

```bash
zeus bundle --program <name> [--output <path>] [--source-output-root <path>] [--include-json] [--include-md] [--include-html] [--safe-sharing] [--reproducible]
```

### Impact

```bash
zeus impact --target <name> [--program <name>] [--out <path>] [--profile <name>] [--source <path>] [--reproducible]
```

### Serve

```bash
zeus serve [--source-output-root <path>] [--profile <name>] [--host 127.0.0.1] [--port <n>]
```

### Fetch

```bash
zeus fetch --host <hostname> --user <username> --password <password> --source-lib <lib> --ifs-dir <ifsPath> --out <localPath> [options]
```

Transport:

```bash
--transport auto|sftp|jt400|ftp
```

Encoding:

```bash
--streamfile-ccsid 1208
```

---

## Recommended ways to use it

## Scenario A: Understand a legacy RPG program

**Goal:** understand what a program does, what it depends on, and where the evidence is.

Run:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

Start with:

- `report.md`
- `architecture-report.md`
- `ai_prompt_documentation.md`

Verify with:

- `context.json`
- `canonical-analysis.json`

Best pattern:

1. orient yourself with the Markdown summaries
2. inspect the call tree if the program orchestrates many others
3. use the generated prompt with Copilot, ChatGPT, or a CLI model
4. verify important claims back against canonical artifacts

## Scenario B: Impact analysis before a change

**Goal:** estimate blast radius before touching a program or table.

Run:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output
zeus impact --program ORDERPGM --target INVPGM --out ./output
zeus impact --program ORDERPGM --target ORDERS --out ./output
```

Use:

- `program-call-tree.md`
- `impact-analysis.md`
- `db2-metadata.md` when data shape matters

Best pattern:

- never ignore unresolved or ambiguous references
- treat unresolved calls as real confidence gaps
- use impact results to guide regression test scope

## Scenario C: Documentation generation

**Goal:** create technical documentation grounded in source evidence.

Run:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --mode documentation --out ./output
```

Or:

```bash
zeus workflow --preset onboarding --source ./rpg_sources --program ORDERPGM --out ./output --bundle-output ./bundles
```

Use:

- `ai_prompt_documentation.md`
- `report.md`
- `architecture-report.md`

Best pattern:

- generate from structured artifacts, not raw source dumps
- require explicit uncertainty callouts
- verify every important statement against the canonical model

## Scenario D: Preparing modernization

**Goal:** identify extraction seams, blockers, and sequencing.

Run:

```bash
zeus workflow --preset modernization-review --source ./rpg_sources --program ORDERPGM --out ./output --bundle-output ./bundles
```

Use:

- `ai_prompt_modernization.md`
- `ai_prompt_architecture_review.md`
- `architecture-report.md`
- `program-call-tree.md`
- `canonical-analysis.json`

Best pattern:

- treat dynamic SQL, unresolved calls, and mutating native I/O as modernization risks until reviewed
- use bundles for cross-team review instead of giant raw output folders

## Scenario E: Test creation

**Goal:** derive initial regression scenarios from source and DB2 evidence.

Run:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --profile sample-db2 --mode test-generation --out ./output --test-data-limit 25
```

Use:

- `ai_prompt_test_generation.md`
- `db2-metadata.md`
- `test-data.md`
- `context.json`

Best pattern:

- use sample rows as fixture inspiration, not production truth
- include metadata whenever keys, nullability, or triggers affect expected behavior

## Scenario F: Test extension

**Goal:** expand coverage after code changes or after discovering missed risk.

Run:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --profile sample-db2 --mode test-generation --out ./output --test-data-limit 25 --emit-diagnostics
```

Use:

- `analysis-diagnostics.json`
- `db2-metadata.json`
- `test-data.json`
- `analyze-run-manifest.json`

Best pattern:

- extend tests around risky branches, write SQL, external calls, triggers, and FK-sensitive updates first

## Scenario G: Test repair

**Goal:** repair brittle tests after source, data-shape, or dependency changes.

Run:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --profile sample-db2 --mode refactoring --out ./output --test-data-limit 25
```

Use:

- `ai_prompt_refactoring_plan.md`
- `ai_prompt_test_generation.md`
- `db2-metadata.md`
- `test-data.md`
- `dependency-graph.md`

Best pattern:

- preserve scenario intent, not brittle fixture structure
- repair fixtures before assertions when data shape changed
- repair doubles and call-path assumptions when dependency structure changed

## Scenario H: Browser-first or safe-sharing review

### Local browser review

```bash
zeus serve --source-output-root ./output
```

Best for:

- non-terminal users
- walkthroughs
- local inspection of prompts, graphs, DB2 metadata, and manifests

### Safe sharing

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output --safe-sharing
zeus bundle --program ORDERPGM --source-output-root ./output --output ./bundles --safe-sharing
```

Best for:

- external AI tools
- vendor review
- internal review where real identifiers should not leave the core team

---

## Working with AI without AI APIs

One of the strongest things about Zeus RPG PromptKit is that it works perfectly well **without** direct model-provider integration.

### VS Code + GitHub Copilot

Recommended approach:

1. run analysis locally
2. open the output directory in the workspace
3. start with `report.md`, `architecture-report.md`, and the relevant `ai_prompt_*.md`
4. keep `canonical-analysis.json` or `db2-metadata.json` nearby for fact-checking

Typical flow:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
zeus serve --source-output-root ./output
```

Use cases:

- `ai_prompt_documentation.md` for program understanding
- `ai_prompt_architecture_review.md` for design review
- `ai_prompt_test_generation.md` for test planning

Best practice:

- paste the prompt artifact first
- add supporting artifacts only as needed
- anchor Copilot back to canonical artifacts if it starts freewheeling

### CLI-based AI workflows

Any model CLI that can read stdin or files can consume Zeus artifacts.

Example:

```bash
cat ./output/ORDERPGM/ai_prompt_documentation.md | your-llm-cli
cat ./output/ORDERPGM/ai_prompt_test_generation.md | your-llm-cli
```

Best practice:

- use the generated prompt as the base input
- add `context.json` or `db2-metadata.json` only when needed
- treat `canonical-analysis.json` as the verification layer, not the first thing you send

### Browser-based AI chats

Recommended pattern:

1. start with one prompt artifact
2. add one supporting artifact if needed
3. ask for an evidence-backed answer
4. verify against local JSON and Markdown artifacts

Best practice:

- do **not** paste an entire output directory into a browser chat
- use the prompt artifacts as the primary entry point
- split large analyses into several smaller review steps

---

## Output artifacts

All analysis output is written under:

```text
output/<program>/
```

### Core artifacts

- `canonical-analysis.json` — semantic source of truth
- `context.json` — developer-facing projection
- `optimized-context.json` — reduced, salience-ranked projection when enabled
- `ai-knowledge.json` — prompt-ready evidence projection
- `analysis-index.json` — workflow/task-oriented artifact index
- `analyze-run-manifest.json` — run traceability, stages, options, diagnostics, inventory

### Human-readable reports

- `report.md`
- `architecture-report.md`

### Graph and dependency artifacts

- `dependency-graph.json`
- `dependency-graph.mmd`
- `dependency-graph.md`
- `program-call-tree.json`
- `program-call-tree.mmd`
- `program-call-tree.md`
- `impact-analysis.json`
- `impact-analysis.md`

### Prompt artifacts

Examples:

- `ai_prompt_documentation.md`
- `ai_prompt_error_analysis.md`
- `ai_prompt_defect_analysis.md`
- `ai_prompt_architecture_review.md`
- `ai_prompt_modernization.md`
- `ai_prompt_refactoring_plan.md`
- `ai_prompt_test_generation.md`

### DB2 and test-data artifacts

- `db2-metadata.json`
- `db2-metadata.md`
- `test-data.json`
- `test-data.md`

### Investigation artifacts

- `ifs-paths.json`
- `ifs-paths.md`
- `search-results.json`
- `search-results.md`
- `diagnostic-query-packs.json`
- `diagnostic-query-packs.md`
- `diagnostic-query-pack-manifest.json`

### Visualization and UI artifacts

- `architecture.html`
- local UI exposed through `zeus serve`

### Governance and packaging artifacts

- `bundle-manifest.json`
- `workflow-run-manifest.json`
- `safe-sharing/redaction-manifest.json`

---

## How to read the artifacts

If you are new to the output, use this sequence:

### For understanding

1. `report.md`
2. `architecture-report.md`
3. `program-call-tree.md`
4. `ai_prompt_documentation.md`
5. `context.json`
6. `canonical-analysis.json`

### For impact review

1. `program-call-tree.md`
2. `impact-analysis.md`
3. `db2-metadata.md`
4. `canonical-analysis.json`

### For testing

1. `ai_prompt_test_generation.md`
2. `db2-metadata.md`
3. `test-data.md`
4. `context.json`

### For modernization

1. `architecture-report.md`
2. `program-call-tree.md`
3. `ai_prompt_modernization.md`
4. `ai_prompt_architecture_review.md`
5. `canonical-analysis.json`

---

## Investigation features

Zeus is not just a parser. It can also support directed investigation.

### IFS path scanning

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --scan-ifs-paths
```

Writes:

- `ifs-paths.json`
- `ifs-paths.md`

### Full-text search

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --search-terms ORDERS,INVPGM --search-ignore archive/,old/
```

Writes:

- `search-results.json`
- `search-results.md`

### Diagnostic packs

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --diagnostic-packs table-investigation --diagnostic-params table=ORDERS
zeus analyze --list-diagnostic-packs
```

Writes:

- `diagnostic-query-packs.json`
- `diagnostic-query-packs.md`
- `diagnostic-query-pack-manifest.json`

These are useful when static source evidence alone is not enough.

---

## Profiles and configuration

Profiles are loaded from:

- `config/profiles.json` when present
- otherwise `config/profiles.example.json`

Profiles can define:

- `sourceRoot`
- `outputRoot`
- `extensions`
- `extends`
- `analysisLimits`
- `db`
- `testData`
- `fetch`
- `contextOptimizer`

They support inheritance and `${env:VAR_NAME}` placeholders so secrets do not need to live in committed config.

### Example profile skeleton

```json
{
  "default": {
    "sourceRoot": "./rpg",
    "outputRoot": "./output",
    "extensions": [".rpgle", ".rpg", ".sqlrpgle", ".rpgleinc"]
  },
  "sample-db2": {
    "extends": "default",
    "db": {
      "host": "myibmi.example.com",
      "user": "${env:ZEUS_DB_USER}",
      "password": "${env:ZEUS_DB_PASSWORD}",
      "defaultSchema": "MYLIB"
    },
    "testData": {
      "limit": 50,
      "maskColumns": ["NAME", "EMAIL", "PHONE"]
    }
  }
}
```

---

## Best practices

### 1. Keep provenance intact

If you use `zeus fetch`, keep `zeus-import-manifest.json` with the fetched source set. It is the traceability bridge between IBM i and local analysis.

### 2. Normalize encoding early

Use UTF-8 export with CCSID `1208` unless you have a very specific reason not to. Encoding issues quietly poison downstream analysis quality.

### 3. Start with the right artifact

Do not open with giant raw source dumps if a prompt artifact or architecture report already exists. Zeus is strongest when you use its structured outputs as intended.

### 4. Use DB2 enrichment when data behavior matters

If the task depends on table shape, FK relationships, triggers, or nullability, include DB2 metadata. Otherwise you are reviewing only half the story.

### 5. Treat unresolved references seriously

Unresolved or ambiguous programs, procedures, and SQL are not cosmetic warnings. They are real uncertainty markers and should stay visible in reviews.

### 6. Keep AI grounded

Use generated prompt files first. Add support artifacts selectively. Verify conclusions against `canonical-analysis.json`, `db2-metadata.json`, or graph artifacts.

### 7. Use safe-sharing when needed

If artifacts leave the team or go into external AI chats, prefer `--safe-sharing` and bundle the redacted output rather than the raw run.

### 8. Use workflow presets for repeatable review packets

Presets are a strong fit when teams repeatedly do the same kind of review, such as onboarding, architecture review, modernization review, or dependency-risk review.

---

## Anti-patterns

Avoid these:

- sending raw source dumps to AI without Zeus artifacts
- skipping DB2 enrichment when schema behavior matters
- ignoring unresolved references because “the rest looks clean”
- mixing encodings in one source tree and assuming results are still trustworthy
- treating sample test data as full production truth
- treating AI output as authoritative without checking canonical artifacts
- bundling everything by default when a focused preset would reduce noise

---

## Local UI

Start the local UI:

```bash
zeus serve --source-output-root ./output --port 4782
```

Current API endpoints include:

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/:program`
- `GET /api/runs/:program/views`
- `GET /api/runs/:program/artifacts/content?path=...`
- `GET /runs/:program/artifacts/raw?path=...`

This is useful for teams who want the analysis output accessible in a browser without re-parsing files client-side.

---

## Example review flows

### Flow 1: “I just inherited this RPG program. Help.”

Use:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context
```

Then read:

- `report.md`
- `architecture-report.md`
- `ai_prompt_documentation.md`

### Flow 2: “We need to change a table. What breaks?”

Use:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --out ./output
zeus impact --program ORDERPGM --target ORDERS --out ./output
```

Then read:

- `program-call-tree.md`
- `impact-analysis.md`
- `db2-metadata.md`

### Flow 3: “We want a shareable modernization packet.”

Use:

```bash
zeus workflow --preset modernization-review --source ./rpg_sources --program ORDERPGM --out ./output --bundle-output ./bundles
```

Then share:

- the bundle ZIP
- or a safe-sharing bundle if identifiers must be redacted

### Flow 4: “We need better regression tests.”

Use:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --profile sample-db2 --mode test-generation --out ./output --test-data-limit 25
```

Then use:

- `ai_prompt_test_generation.md`
- `db2-metadata.md`
- `test-data.md`

---

## Project structure

### Main entry points and notable modules

- `cli/zeus.js` — CLI entry point
- `src/collector/sourceCollector.js` — source file discovery
- `src/scanner/rpgScanner.js` — RPG heuristics scanner
- `src/scanner/clScanner.js` — CL scanner
- `src/scanner/ddsScanner.js` — DDS scanner
- `src/scanner/dependencyScanner.js` — aggregated dependency extraction
- `src/source/sourceType.js` — source-type classification
- `src/context/canonicalAnalysisModel.js` — canonical model builder
- `src/context/contextBuilder.js` — backward-compatible context projection
- `src/dependency/dependencyGraphBuilder.js` — deterministic dependency graph builder
- `src/dependency/crossProgramGraphBuilder.js` — recursive call graph builder
- `src/dependency/programSourceResolver.js` — source member resolution
- `src/report/markdownReport.js` — report generation
- `src/report/architectureReport.js` — architecture report generation
- `src/prompt/promptBuilder.js` — prompt rendering
- `src/prompt/promptRegistry.js` — prompt contract metadata
- `src/viewer/architectureViewerGenerator.js` — interactive HTML viewer
- `src/impact/impactAnalyzer.js` — reverse dependency impact analysis
- `src/analyze/stageRegistry.js` — stage pipeline registry
- `java/Db2MetadataExporter.java` — DB2 metadata export
- `java/Db2TestDataExtractor.java` — DB2 sample row extraction
- `config/profiles.example.json` — example profile config

---

## Documentation pointers

See the project docs for deeper contracts and implementation details, including:

- canonical analysis model
- prompt contracts
- safe sharing
- fixture sanitization
- reproducible output mode
- import manifest contract
- source ingest normalization
- analyzer stage pipeline
- investigation workflows
- local UI shell
- viewer asset strategy

If you keep those docs in the repository, prefer relative links from this README so the project remains portable across machines and operating systems.

---

## Notes

This project is intentionally practical and heuristic-driven. The goal is not theoretical perfection; the goal is to produce useful, auditable analysis artifacts that are easy to review, easy to extend, and safe to evolve.

The strongest usage pattern is simple:

1. get the source into a trustworthy local form
2. analyze it into structured evidence
3. enrich only as needed
4. use focused artifacts for the review at hand
5. verify conclusions before acting on them

That is where Zeus RPG PromptKit shines.

## License

This project is licensed under the Apache License 2.0.

See the `LICENSE` file for details.
