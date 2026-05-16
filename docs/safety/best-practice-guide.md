# Zeus RPG PromptKit - Best Practice Guide

## 1. Overview

Zeus RPG PromptKit is a Node.js and Java-based analysis toolchain for IBM i source estates. In practice it does four things:

- acquires IBM i source members and IFS exports into a local, UTF-8-friendly workspace
- parses RPG, SQLRPGLE, CL, DDS, binder source, and related source files into a canonical dependency model
- enriches that model with DB2 catalog evidence and optional governed sample data
- emits artifacts optimized for developer review, architecture analysis, impact analysis, documentation, and AI-assisted workflows

This is not a code generator and not an AI provider integration. It is a context-preparation and evidence-packaging tool. Its value is that it turns scattered IBM i assets into a repeatable, inspectable set of artifacts that humans and AI systems can both consume.

### Key Value Proposition

- IBM i source becomes locally analyzable without losing source provenance.
- RPG, CL, DDS, binder, SQL, and cross-program dependencies are normalized into a single model.
- DB2 metadata is linked back to source evidence instead of being dumped as isolated catalog output.
- Prompt-ready artifacts are generated without locking you to a specific AI API.
- Output is reproducible, bundleable, and optionally sanitized for sharing.

### Target Users

- IBM i application developers
- technical architects
- modernization teams
- QA and test engineers
- onboarding and documentation owners
- reviewers performing dependency or impact analysis before change

### Typical Use Cases

- understand an unfamiliar RPG program quickly
- prepare a change impact review before touching a table or called program
- generate architecture and onboarding packets
- derive test scenarios from SQL, native I/O, procedures, and DB2 metadata
- create safe-to-share bundles for external review or AI usage
- stage modernization assessments with evidence rather than intuition

## 2. Architecture & Components

### 2.1 Node.js CLI

The CLI entrypoint is `cli/zeus.js`. It exposes six commands:

- `zeus fetch`
- `zeus analyze`
- `zeus workflow`
- `zeus bundle`
- `zeus impact`
- `zeus serve`

The runtime requires Node.js 20 or later.

### 2.2 Java Helpers

The repository compiles and runs Java helpers from `java/` on demand through `src/java/javaRuntime.js`. They are used for IBM i and DB2 access that is awkward or unavailable in plain Node.js:

- `IbmiCommandRunner`
- `IbmiMemberLister`
- `IbmiIfsDownloader`
- `IbmiSourceMemberExporter`
- `Db2MetadataExporter`
- `Db2ExternalObjectResolver`
- `Db2TestDataExtractor`
- `Db2DiagnosticQueryRunner`

Operational consequence:

- `javac` and `java` must be available when using IBM i fetch, DB2 metadata export, test-data export, or JT400-based transfers.

### 2.3 Data Acquisition

The tool supports two acquisition categories.

#### IBM i source export

`zeus fetch` exports source members from QSYS source files to IFS stream files with `CPYTOSTMF`, then downloads the IFS directory locally.

Supported transports:

- `sftp`
- `jt400`
- `ftp`
- `auto`

`auto` tries `sftp`, then `jt400`, then `ftp`.

Default source files are:

- `QRPGLESRC`
- `QCPYSRC`
- `QCLSRC`
- `QCLLESRC`
- `QSQLRPGLESRC`
- `QDDSSRC`

The default stream file CCSID is `1208` (UTF-8).

Important IBM i-specific behavior:

- source export uses `CPYTOSTMF ... STMFCODPAG(<ccsid>)`
- if `CPYTOSTMF` fails due to `CPDA08C` or `CCSID 65535`, the tool can fall back to JDBC-based source-member export
- member names are mapped to local extensions by source file, for example `QRPGLESRC -> .rpgle`, `QSQLRPGLESRC -> .sqlrpgle`, `QCLLESRC -> .clle`

#### Local source analysis

`zeus analyze` works on any local directory. It does not require the fetch step if your source tree is already available locally.

### 2.4 Processing Pipeline

The analysis pipeline is stage-based and ordered through a registry:

1. collect and validate source files
2. scan source semantics
3. build canonical and context projections
4. run optional source investigations
5. optimize prompt context
6. export DB2 metadata
7. export governed test data
8. run optional diagnostic packs
9. write artifacts

Important internal property:

- the stage registry is extensible in code, so the repository can be embedded or extended programmatically even though the CLI does not yet expose plugin loading flags

### 2.5 Output Formats

The tool emits multiple output classes:

- canonical JSON models
- derived context JSON
- optimized AI context JSON
- Markdown reports
- Mermaid graph files
- interactive HTML architecture view
- prompt bundles in Markdown
- manifests for fetch, analyze, workflow, bundles, and safe sharing
- optional DB2 metadata and test-data artifacts
- optional investigation artifacts for IFS paths, full-text search, and diagnostic packs

## 3. Capabilities (Complete List)

## 3.1 Source Acquisition and Provenance

### Source extraction from IBM i

- exports members from QSYS source files to IFS stream files
- supports member filtering and source-file filtering
- supports transport fallback from SFTP to JT400 to FTP
- writes a `zeus-import-manifest.json` describing origin, transport, encoding policy, command used, checksum, and validation status

Why it matters:

- analysis remains traceable back to IBM i member identity
- teams can verify whether the local source set still matches what was fetched

### Local provenance tracking

- source files are recorded with relative paths, source type, normalization status, and import-manifest provenance when available
- source cataloging resolves ambiguity when the same member name exists in multiple local files

Why it matters:

- cross-program analysis on IBM i often fails if duplicate member names are not handled explicitly

## 3.2 Encoding and Source Integrity

- validates source readability before scanning
- accepts UTF-8 directly
- converts UTF-16LE and UTF-16BE with BOM into the UTF-8 analysis contract during analyze
- strips BOMs and normalizes line endings to LF for analysis
- detects invalid UTF-8, mixed newlines, CR-only newlines, and source drift versus import-manifest checksums

Important nuance:

- fetch-time manifest validation is strict UTF-8-oriented
- analyze-time source normalization is more tolerant and can convert UTF-16 BOM-based files

Why it matters:

- IBM i source flows often break on encoding long before parsing breaks
- prompt quality drops sharply when text normalization is inconsistent

## 3.3 Multi-language Source Scanning

The scanner is broader than RPG-only.

### RPG and SQLRPGLE

- program calls
- copy members
- embedded SQL statements
- SQL statement intent classification: read, write, call, cursor, transaction, other
- SQL table extraction
- host-variable extraction
- cursor action extraction
- dynamic SQL detection
- unresolved SQL detection
- procedures and subroutines
- prototypes
- procedure-call resolution: internal, external, dynamic, unresolved
- native file declarations
- native file access operations such as `CHAIN`, `READ`, `WRITE`, `UPDATE`, `DELETE`, `EXFMT`
- module, binding-directory, and service-program hints from control options
- binder source export matching and unresolved binder export diagnostics

### CL and CLLE

- command detection
- object usage extraction from keywords such as `FILE`, `TOFILE`, `FROMFILE`, `MSGF`, `DTAARA`, `OUTQ`, `JOBQ`
- program call detection from `CALL PGM(...)`
- file/object references treated as dependencies

### DDS, DSPF, PRTF, PF, LF

- DDS file kind detection: disk, workstation, printer
- record-format extraction
- reference extraction from `PFILE`, `REF`, `JFILE`

### Binder source

- service program detection
- export symbol extraction
- signature-level capture

Why it matters:

- many real IBM i workflows depend on CL wrappers, DDS artifacts, and binder semantics, not just RPG source

## 3.4 Dependency Detection

The tool detects dependencies at several layers.

### Direct source dependencies

- called programs
- copy members
- tables referenced by SQL
- native file usage
- procedures and prototypes
- binding directories
- service programs
- DDS referenced files

### Cross-program dependency graph

- recursively resolves called programs to local source members
- builds a program call tree across the local source estate
- tracks unresolved and ambiguous programs explicitly
- enforces graph growth limits to avoid runaway analysis

### Reverse impact analysis

- `zeus impact` reads the cross-program graph and computes upstream callers or affected programs
- works for both program targets and table targets

Why it matters:

- this is the core of blast-radius analysis before change

## 3.5 DB2 Metadata Enrichment

This is a major capability, not a side feature.

- builds JDBC URLs from host or direct URL configuration
- resolves a default schema/library
- exports catalog metadata for detected tables
- captures columns, keys, foreign keys, triggers, derived objects, descriptions, and estimated row counts
- links exported catalog objects back to source evidence, SQL statements, and native file usage
- records unresolved or ambiguous table matches
- resolves external IBM i objects for called programs, imported procedures, and unresolved procedure references through catalog/object metadata
- folds DB2 findings back into the canonical model as new entities and relations

Implicit capability enabled by the code:

- DB2 enrichment is not just descriptive; it upgrades semantic analysis by adding trigger, foreign-key, derived-object, and external-object relationships that were not observable from source alone

Why it matters:

- AI and human reviewers can reason about data shape, referential risk, and external resolution with source-backed evidence

## 3.6 Governed Test Data Extraction

- optional bounded sample-row extraction per table
- row limit is configurable
- rows can be ordered by detected primary keys
- allowlists and denylists can restrict which tables are eligible
- global masked columns can be configured
- table-specific mask rules can override masking values
- extracted test-data artifacts are linked back to source-linked table evidence

Why it matters:

- this supports test design and AI prompting without forcing teams to expose unrestricted production-like data

## 3.7 Context Building and AI Preparation

The repository builds several progressively more AI-friendly representations.

### Canonical analysis model

- normalized entity/relation model
- provenance-aware source file inventory
- summary metrics
- risk hints
- binding analysis
- native file usage
- source normalization data
- source type analysis

### Context projection

- simplified developer-facing view of dependencies, SQL, procedures, native I/O, graph summaries, DB2 status, and test-data status

### Optimized context

- salience-ranked evidence selection
- per-workflow token budgets
- ranked evidence packs for documentation and error-analysis workflows
- snippet extraction from source
- soft token limit warnings

### AI knowledge projection

- evidence index with stable evidence references
- workflow-specific evidence packs
- risk markers and uncertainty markers
- workflow-focused views for documentation and error analysis

Why it matters:

- this is what makes the tool useful with Copilot, ChatGPT, local LLMs, and provider-specific pipelines without hard-coding one provider

## 3.8 Prompt Generation

Prompt generation is contract-based, budgeted, and workflow-aware.

Supported prompt templates:

- `documentation`
- `error-analysis`
- `defect-analysis`
- `modernization`
- `architecture-review`
- `refactoring-plan`
- `test-generation`

The prompt system:

- validates required inputs per template
- enforces prompt token budgets
- emits Markdown prompt files
- prefers AI knowledge projections over raw context

Why it matters:

- prompts are generated from structured evidence instead of ad hoc summaries

## 3.9 Investigation Features

These are optional but materially useful in real estates.

### IFS path scanning

- scans source text for likely IFS paths
- classifies families such as `QSYS_LIB`, `HOME`, `TEMP`, `WEB`, generic `IFS`

### Full-text search

- searches normalized source text for arbitrary terms
- supports ignore patterns
- caps result counts
- distinguishes imported versus local files

### Diagnostic packs

- runs named, read-only investigation packs
- supports safe catalog SQL and allowlisted CL commands only
- currently includes table, program, and generic object investigation packs

Why it matters:

- these features extend the tool from "static parser" to "guided investigation workspace"

## 3.10 Output Governance and Sharing

- analyze-run manifests capture stages, options, diagnostics, artifacts, checksums, and source snapshots
- reproducible mode removes unstable runtime details from outputs
- safe-sharing mode redacts identifiers, paths, schemas, members, and extracted values into placeholder tokens
- bundle generation can package either normal artifacts or safe-sharing artifacts

Why it matters:

- teams can move artifacts into review, CI, AI chats, or external collaboration without losing governance

## 3.11 Visualization and Serving

- renders dependency graphs as JSON, Mermaid, Markdown, and HTML
- embeds `vis-network` directly in `architecture.html`
- serves runs via a loopback-only local UI with JSON APIs
- local UI exposes runs, views, and raw artifact content

Why it matters:

- not every workflow needs a terminal or an AI chat first

## 4. Output Artifacts Explained

## 4.1 Source Acquisition Artifact

### `zeus-import-manifest.json`

Created by `zeus fetch`.

Use it for:

- proving where local files came from
- checking transport used
- checking CCSID/export policy
- diagnosing invalid or changed files
- resolving ambiguous local member names during later analysis

## 4.2 Core Analysis Artifacts

### `canonical-analysis.json`

The semantic source of truth.

Contains:

- source file inventory
- entities
- relations
- enrichments
- provenance and notes

Use it for:

- auditable machine processing
- building internal tooling
- verifying claims made by prompts or reports
- deeper graph and evidence inspection

### `context.json`

A developer-friendly projection of the canonical model.

Use it for:

- day-to-day review
- quick scripting
- feeding generic AI tools when you want less structure than the canonical model

### `optimized-context.json`

A reduced, salience-ranked context for prompt-sized workflows.

Use it for:

- token-constrained AI sessions
- comparing full versus reduced context
- deciding whether context optimization is safe enough for a task

### `ai-knowledge.json`

The prompt-ready evidence projection.

Use it for:

- direct input to prompt templates
- custom AI pipelines
- workflow-specific evidence extraction

### `analysis-index.json`

An index of guided modes, prompt applicability, primary artifacts, and suggested next actions.

Use it for:

- choosing the right workflow mode after analysis
- driving internal portals or custom review UIs
- onboarding users to available task flows

## 4.3 Graph Artifacts

### `dependency-graph.json`

Single-program dependency graph.

Use it for:

- program-level dependency reasoning
- custom graph tooling
- architecture or refactoring analysis

### `dependency-graph.mmd`

Mermaid rendering of the single-program dependency graph.

Use it for:

- Markdown-based documentation portals
- PR comments and wiki pages

### `dependency-graph.md`

Readable Markdown graph summary.

Use it when reviewers do not want raw JSON or Mermaid.

### `program-call-tree.json`

Cross-program graph rooted at the selected program.

Use it for:

- blast-radius analysis
- `zeus impact`
- identifying unresolved or ambiguous local source resolution

### `program-call-tree.mmd`

Mermaid rendering of the cross-program graph.

### `program-call-tree.md`

Readable cross-program summary.

## 4.4 Human-readable Reports

### `report.md`

General run summary.

Use it for:

- quick reading by humans
- onboarding
- validating whether the analysis found the expected dependencies

### `architecture-report.md`

Narrative architecture-facing summary generated from context and graph artifacts.

Use it for:

- architecture review
- modernization planning
- documentation packets

### `architecture.html`

Interactive graph viewer with bundled assets.

Use it for:

- workshop reviews
- live architecture sessions
- local browsing without external CDN dependencies

## 4.5 Prompt Artifacts

Examples:

- `ai_prompt_documentation.md`
- `ai_prompt_error_analysis.md`
- `ai_prompt_defect_analysis.md`
- `ai_prompt_modernization.md`
- `ai_prompt_architecture_review.md`
- `ai_prompt_refactoring_plan.md`
- `ai_prompt_test_generation.md`

Use them as:

- direct prompts in Copilot Chat, ChatGPT, Claude, local LLM CLIs, or internal model gateways
- starting points for iterative AI sessions
- standardized team prompt packs with evidence already embedded

## 4.6 DB2 and Test Data Artifacts

### `db2-metadata.json` and `db2-metadata.md`

Use them for:

- validating table identity and schema details
- enriching impact reviews with foreign keys, triggers, and derived objects
- grounding AI prompts in real schema information

### `test-data.json` and `test-data.md`

Use them for:

- test-case design
- fixture planning
- AI-assisted test generation

Treat them as:

- bounded, policy-governed sample data
- not a substitute for runtime truth or complete production distributions

## 4.7 Investigation Artifacts

Optional outputs:

- `ifs-paths.json`
- `ifs-paths.md`
- `search-results.json`
- `search-results.md`
- `diagnostic-query-packs.json`
- `diagnostic-query-packs.md`
- `diagnostic-query-pack-manifest.json`

Use them for:

- follow-up investigation
- narrowing AI prompts to suspicious filesystem paths or search hits
- documenting targeted IBM i or DB2 checks

## 4.8 Governance Artifacts

### `analyze-run-manifest.json`

Use it for:

- run traceability
- comparing runs
- cache diagnostics
- artifact inventories
- CI evidence

### `analysis-diagnostics.json`

Only emitted with `--emit-diagnostics`.

Use it for:

- machine-readable warnings and stage diagnostics
- CI gates or quality dashboards

### `bundle-manifest.json`

Written when bundling.

Use it for:

- verifying exactly which files were packaged
- provenance and checksum checks

### `workflow-run-manifest.json`

Written by `zeus workflow`.

Use it for:

- tracking which preset produced which analysis and bundle

### `safe-sharing/redaction-manifest.json`

Use it for:

- confirming that redacted artifacts were created
- reviewing placeholder counts and safe-sharing coverage

## 5. Usage Without AI APIs

The repository does not call a model provider. It prepares context and prompt artifacts. That makes it usable with any AI surface that can read files or pasted text.

## 5.1 VS Code + GitHub Copilot

Recommended approach:

1. Run analysis locally.
2. Open the generated output directory in the same workspace.
3. Start with `report.md`, `architecture-report.md`, and the relevant `ai_prompt_*.md` file.
4. Keep `canonical-analysis.json` and `context.json` open for fact checking.

Suggested commands:

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output --optimize-context
node .\cli\zeus.js serve --source-output-root .\output
```

Best practice with Copilot Chat:

- paste the relevant prompt artifact first
- attach or quote only the supporting files needed for the current question
- if Copilot starts generalizing, anchor it back to `canonical-analysis.json` or `db2-metadata.json`

Good usage pattern:

- `ai_prompt_documentation.md` for understanding
- `ai_prompt_architecture_review.md` for structure review
- `ai_prompt_test_generation.md` for test planning

## 5.2 CLI-based AI Workflows

Because prompts are plain Markdown files, they work with local or remote CLI tools.

Examples:

```powershell
Get-Content .\output\ORDERPGM\ai_prompt_documentation.md | your-llm-cli
Get-Content .\output\ORDERPGM\ai_prompt_test_generation.md | your-llm-cli
```

Recommended pattern:

- use the prompt file as the base input
- add `context.json` or `db2-metadata.json` only if the model needs supporting facts
- keep `canonical-analysis.json` as the verification source, not the first thing you send

Automation pattern:

- run `fetch` or copy source into a workspace
- run `analyze` or `workflow`
- archive artifacts with `bundle`
- feed selected prompt files into your model gateway
- capture the AI response as a review artifact, not as ground truth

## 5.3 Browser-based AI Usage

For ChatGPT or similar browser tools:

1. Start with one prompt file.
2. Add one supporting artifact if needed.
3. Ask for an evidence-backed answer.
4. Verify against the local JSON artifacts.

Chunking strategy for large systems:

- first prompt: `ai_prompt_documentation.md`
- second prompt: `program-call-tree.md` or `dependency-graph.md`
- third prompt: `db2-metadata.md` or `test-data.md` if data behavior matters

Do not paste the entire output directory into a browser chat. Use the prompt artifacts as the primary entry point.

## 6. Recommended Workflows

## Scenario A: Understanding a Legacy RPG Program

### Goal

Understand what a program does, which files and programs it depends on, and where the main evidence lives.

### Workflow

1. Get the source locally.
2. Run analysis with context optimization enabled.
3. Read the human summaries first.
4. Use the prompt artifact with your AI tool.
5. verify all important claims against context and canonical artifacts.

### Exact Tool Usage

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output --optimize-context
```

If source is still on IBM i:

```powershell
node .\cli\zeus.js fetch --host myibmi --user MYUSER --password MYPASS --source-lib MYLIB --ifs-dir /home/zeus/export --out .\rpg_sources --transport auto
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output --optimize-context
```

### Artifacts to Use

- `report.md`
- `architecture-report.md`
- `ai_prompt_documentation.md`
- `context.json`
- `canonical-analysis.json`

### AI Interaction Pattern

Prompt:

```markdown
Use the attached Zeus prompt and explain:
1. the program purpose
2. the high-level control flow
3. table access behavior
4. called programs
5. unclear or risky areas that require source verification
```

### Best Practice

- treat `report.md` as orientation
- treat `canonical-analysis.json` as the fact source
- inspect `program-call-tree.md` if the program looks like an orchestration entry point

## Scenario B: Impact Analysis Before Change

### Goal

Estimate blast radius before changing a table or called program.

### Workflow

1. Run `analyze` on a representative root program.
2. Inspect `program-call-tree.md`.
3. Run `zeus impact` on the target table or program.
4. review `impact-analysis.md` and the underlying call tree.

### Exact Tool Usage

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output
node .\cli\zeus.js impact --program ORDERPGM --target INVPGM --out .\output
node .\cli\zeus.js impact --program ORDERPGM --target ORDERS --out .\output
```

### Artifacts to Use

- `program-call-tree.json`
- `program-call-tree.md`
- `impact-analysis.json`
- `impact-analysis.md`
- `db2-metadata.md` when the target is a table

### AI Interaction Pattern

Prompt:

```markdown
Using the impact analysis and call-tree artifacts, identify:
1. directly affected programs
2. indirectly affected upstream callers
3. unresolved or ambiguous resolution risks
4. what should be regression-tested first
```

### Best Practice

- run impact analysis only after a meaningful cross-program graph exists
- do not ignore unresolved or ambiguous programs; they are explicit confidence gaps

## Scenario C: Documentation Generation

### Goal

Produce technical documentation grounded in source evidence.

### Workflow

1. Run analyze in documentation or onboarding mode.
2. Use the generated documentation prompt.
3. refine the result with context and architecture artifacts.

### Exact Tool Usage

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --mode documentation --out .\output
```

Or use the preset:

```powershell
node .\cli\zeus.js workflow --preset onboarding --source .\rpg_sources --program ORDERPGM --out .\output --bundle-output .\bundles
```

### Artifacts to Use

- `ai_prompt_documentation.md`
- `report.md`
- `architecture-report.md`
- `bundle-manifest.json` if packaging for others

### AI Interaction Pattern

Prompt:

```markdown
Draft developer documentation for this program.
Requirements:
- do not invent behavior not backed by the supplied artifacts
- cite uncertainties explicitly
- include tables, calls, and operational risks
```

### Best Practice

- generate documentation from prompt artifacts, not from raw source dumps
- include `architecture-report.md` when the program is not self-contained

## Scenario D: Preparing Modernization

### Goal

Identify safe extraction boundaries, blockers, and candidate seams before migration or refactoring.

### Workflow

1. Run the modernization preset.
2. review architecture and modernization prompts together.
3. validate every proposed seam against canonical and graph artifacts.

### Exact Tool Usage

```powershell
node .\cli\zeus.js workflow --preset modernization-review --source .\rpg_sources --program ORDERPGM --out .\output --bundle-output .\bundles
```

### Artifacts to Use

- `ai_prompt_modernization.md`
- `ai_prompt_architecture_review.md`
- `architecture-report.md`
- `canonical-analysis.json`
- `program-call-tree.md`
- bundle zip if sharing across teams

### AI Interaction Pattern

Prompt:

```markdown
Using the modernization prompt and supporting artifacts, identify:
1. candidate extraction seams
2. data and integration blockers
3. native I/O behaviors that complicate migration
4. a phased modernization order with verification checkpoints
```

### Best Practice

- dynamic SQL, unresolved calls, mutating native I/O, and unresolved binding dependencies should be treated as modernization blockers until reviewed

## Scenario E: Test Creation (RPG Programs)

### Goal

Create an initial regression test plan from code, DB2 metadata, and dependencies.

### Workflow

1. Run analyze with DB2 metadata enabled.
2. enable test-data export if policy allows it.
3. review SQL, native file usage, procedure calls, and DB2 enrichment.
4. use the test-generation prompt artifact.

### Exact Tool Usage

With DB2 configuration in a profile:

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --profile sample-db2 --mode test-generation --out .\output --test-data-limit 25
```

### Artifacts to Use

- `ai_prompt_test_generation.md`
- `db2-metadata.md`
- `test-data.md`
- `context.json`
- `canonical-analysis.json`

### Deriving Test Cases

From RPG logic:

- branches and conditionals in evidence highlights
- unresolved or dynamic procedure calls
- monitor/error-path clues in optimized evidence packs

From DB2 metadata:

- nullable versus mandatory columns
- foreign-key relationships
- triggers and derived objects
- estimated row counts and table identities

From dependencies:

- called programs
- native file mutations
- interactive workstation behavior

### Structure Tests Around

- inputs
- preconditions
- expected outputs
- expected database effects
- expected external calls
- edge cases

### AI Interaction Pattern

Prompt:

```markdown
Generate a test matrix for this RPG program.
For each case include:
- intent
- inputs
- preconditions
- expected DB changes or reads
- expected external interactions
- edge or failure condition covered
```

### Best Practice

- if `test-data.md` exists, use it as fixture inspiration, not as direct production truth
- include `db2-metadata.md` whenever assertions depend on nullability, keys, or trigger side effects

## Scenario F: Test Extension

### Goal

Expand existing coverage to include overlooked branches, data shapes, and integration paths.

### Workflow

1. Re-run analyze after recent code changes.
2. compare `analyze-run-manifest.json` and `analysis-index.json`.
3. focus on newly visible SQL, calls, native files, or DB2-enriched relations.
4. ask the AI tool for only the missing scenarios.

### Exact Tool Usage

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --profile sample-db2 --mode test-generation --out .\output --test-data-limit 25 --emit-diagnostics
```

### Artifacts to Use

- `ai_prompt_test_generation.md`
- `analysis-diagnostics.json`
- `db2-metadata.json`
- `test-data.json`
- `analyze-run-manifest.json`

### Strategies

- expand around dynamic or unresolved SQL first
- add scenarios for mutating native files before read-only paths
- cover catalog-resolved external programs and procedures
- add tests for tables with foreign-key or trigger implications

### AI Interaction Pattern

```markdown
Assume a baseline test suite already exists.
Using the supplied artifacts, identify only the missing high-value tests.
Prioritize:
1. risky branches
2. write SQL
3. external calls
4. trigger or FK-sensitive updates
```

## Scenario G: Test Repair / Refactoring

### Goal

Repair brittle tests or refactor them after source changes without dropping coverage.

### Workflow

1. Re-run analyze on the changed program.
2. inspect manifests, graphs, and DB2/test-data artifacts for shape drift.
3. use refactoring and test-generation prompts together.
4. repair tests by preserving scenario intent while updating fixtures and assertions.

### Exact Tool Usage

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --profile sample-db2 --mode refactoring --out .\output --test-data-limit 25
```

### Artifacts to Use

- `ai_prompt_refactoring_plan.md`
- `ai_prompt_test_generation.md` if also generated from a prior run or separate analysis
- `db2-metadata.md`
- `test-data.md`
- `dependency-graph.md`

### Strategies

- preserve regression intent, not brittle fixture shape
- if DB2 metadata changed, repair fixtures first
- if call chains changed, repair doubles or mocks before assertions
- if native file access changed from read to write, add mutation assertions

### AI Interaction Pattern

```markdown
These tests need repair after source changes.
Using the artifacts, identify:
1. which assertions likely broke because of data-shape change
2. which broke because of dependency or call-path change
3. how to refactor tests while preserving behavioral coverage
```

## Scenario H: Additional Valuable Scenarios

### H1 Architecture Review Packet

Use:

```powershell
node .\cli\zeus.js workflow --preset architecture-review --source .\rpg_sources --program ORDERPGM --out .\output --bundle-output .\bundles
```

Best for:

- architecture workshops
- design reviews
- sharing a focused packet instead of a full output directory

### H2 Dependency-Risk Triage

Use:

```powershell
node .\cli\zeus.js workflow --preset dependency-risk --source .\rpg_sources --program ORDERPGM --out .\output --bundle-output .\bundles
```

Best for:

- release risk reviews
- defect hypothesis sessions
- deciding whether more investigation is needed before change approval

### H3 Safe Sharing for External Review or AI

Use:

```powershell
node .\cli\zeus.js analyze --source .\rpg_sources --program ORDERPGM --out .\output --safe-sharing
node .\cli\zeus.js bundle --program ORDERPGM --source-output-root .\output --output .\bundles --safe-sharing
```

Best for:

- sending artifacts to external AI tools
- sharing with vendors or partners
- internal review when raw identifiers or extracted values should not leave the core team

### H4 Browser-first Local Review

Use:

```powershell
node .\cli\zeus.js serve --source-output-root .\output
```

Best for:

- non-terminal users
- walk-through sessions
- browsing runs, views, and raw artifacts from a local web UI

## 7. Best Practices

### Context Size Management

- use `--optimize-context` for AI-facing runs
- prefer `ai_prompt_*.md` and `optimized-context.json` over raw `canonical-analysis.json` in first-pass prompts
- add supporting artifacts incrementally
- use workflow presets when you want a bounded, review-specific bundle

### Encoding Handling

- export IBM i source to UTF-8 stream files with CCSID `1208` unless you have a strong reason not to
- keep imported files UTF-8-valid so fetch manifests stay trustworthy
- do not mix raw EBCDIC exports with UTF-8-normalized local files in one source root
- investigate normalization warnings before trusting downstream analysis

### Sensitive Data Handling

- configure `testData.allowTables`, `denyTables`, `maskColumns`, and `maskRules`
- use `--safe-sharing` before sending artifacts outside the team
- treat `test-data.json` as sensitive even when masked

### Prompt Engineering

- start from the generated prompt files
- ask for evidence-backed answers
- explicitly instruct the AI to call out uncertainty
- use the workflow-specific prompt that matches the task instead of reusing the documentation prompt for everything

### Avoiding Hallucinations

- treat `canonical-analysis.json` and `db2-metadata.json` as the verification layer
- do not let the AI infer missing program resolution or unresolved SQL semantics as fact
- include unresolved and ambiguous findings in your prompt, not just clean summaries

### Verification Techniques

- check `analyze-run-manifest.json` for stage diagnostics and cache status
- compare `context.json` with `canonical-analysis.json` when a summary looks too clean
- verify DB2-linked claims in `db2-metadata.md`
- verify blast-radius claims with `program-call-tree.json` and `impact-analysis.json`

## 8. Anti-Patterns

- sending raw source dumps to AI without the structured Zeus artifacts
- skipping DB2 enrichment when the task depends on table behavior or schema shape
- ignoring unresolved programs or ambiguous member resolution
- mixing encodings in the same source tree and assuming scan results are still reliable
- treating prompt output as authoritative without checking canonical artifacts
- using sample test data as if it represents complete production behavior
- bundling everything by default when a focused preset or prompt file would reduce noise

## 9. Integration Patterns

### CI/CD Pipelines

Recommended pattern:

1. fetch or stage source
2. run `analyze`
3. optionally run `workflow`
4. archive `output/<program>` or the generated bundle
5. publish selected Markdown artifacts

Good CI uses:

- architecture drift review
- dependency-risk review before release
- artifact publication for downstream documentation jobs

### Pre-analysis Workflows

- run `fetch` nightly or on demand to keep a local analysis mirror
- keep `zeus-import-manifest.json` with the fetched tree
- analyze locally from that mirror to avoid repeated IBM i export overhead

### Developer Onboarding

- generate `onboarding` bundles for key entry programs
- publish `report.md`, `architecture-report.md`, and `ai_prompt_documentation.md`

### Knowledge Base Generation

- use the documentation or onboarding workflows
- convert Markdown artifacts into wiki pages or internal docs
- keep canonical JSON artifacts adjacent for verification, even if not published broadly

### Documentation Pipelines

- run `analyze --mode documentation`
- feed `ai_prompt_documentation.md` into your approved AI drafting process
- require human review against `report.md` and `canonical-analysis.json`

## 10. Advanced Usage

### Combine Multiple Outputs Deliberately

Recommended pairings:

- understanding: `report.md` + `ai_prompt_documentation.md`
- architecture: `architecture-report.md` + `program-call-tree.md`
- test design: `ai_prompt_test_generation.md` + `db2-metadata.md` + `test-data.md`
- modernization: `ai_prompt_modernization.md` + `canonical-analysis.json`

### Iterative Analysis Loops

- first run without DB2 to validate source quality and dependency shape
- second run with DB2 metadata
- third run with test-data extraction if policy permits
- final run with the workflow preset that matches the review

### Cross-program Decomposition

For large systems:

- analyze several root programs separately
- compare call trees and table overlaps
- use bundles per subsystem rather than one oversized monolith

### Large-system Controls

Use profile-based analysis limits for estate size:

- `maxProgramDepth`
- `maxPrograms`
- `maxNodes`
- `maxEdges`
- `maxScannedFiles`
- `maxProgramCallsPerProgram`

This keeps recursive cross-program analysis usable in large estates.

### Configuration Patterns

Profiles support:

- inheritance via `extends`
- global and per-profile context optimizer settings
- global and per-profile test-data policy
- global and per-profile analysis limits
- fetch configuration
- DB configuration
- environment-variable placeholders such as `${env:NAME}`

Environment overrides exist for:

- `ZEUS_FETCH_*`
- `ZEUS_DB_*`

## 11. Summary & Recommendations

Use Zeus RPG PromptKit as an evidence-preparation layer, not as a documentation veneer.

Choose workflows based on the decision you need to make:

- use `documentation` or `onboarding` for orientation
- use `architecture-review` for structure-first review
- use `dependency-risk` and `impact` before risky change
- use `modernization-review` when identifying extraction seams and blockers
- use `test-generation` when building or extending regression coverage

For best results:

- keep source provenance intact with `zeus-import-manifest.json`
- normalize encoding early
- enrich with DB2 metadata whenever data behavior matters
- use optimized prompt artifacts rather than raw dumps
- treat unresolved and ambiguous findings as first-class review items
- verify AI conclusions against canonical and DB2 artifacts before acting on them
