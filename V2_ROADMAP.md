# V2 Roadmap

## Epic (P1)

### Title
V1: AI Context Bundling and RPG Dependency Analysis

### Labels
`epic`, `enhancement`, `priority:P1`

### Description
Goal:
Create a production-ready CLI tool that prepares structured context bundles for AI analysis of IBM i (AS/400) RPG applications.

The tool scans RPG source code, extracts dependencies (tables, programs, copy members), optionally retrieves DB2 metadata, and generates AI-ready prompts and technical documentation.

Scope (In):
- Scan RPG source code
- Detect tables, program calls and COPY members
- Extract embedded SQL statements
- Generate structured JSON context
- Generate Markdown documentation
- Generate AI prompts for documentation and debugging
- Optional DB2 metadata export using JT400

Scope (Out):
- Full RPG syntax parser
- Complex static analysis or code rewriting
- Runtime instrumentation

Work items (Issues):
- [ ] CLI command `zeus analyze`
- [ ] RPG source scanner
- [ ] Dependency graph generation
- [ ] Context builder
- [ ] Prompt template system
- [ ] Markdown report generator
- [ ] DB2 metadata exporter integration
- [ ] Test data extractor
- [ ] Token/context optimizer for AI prompts
- [ ] Output bundle packaging

Epic acceptance criteria:
- [ ] CLI can scan a directory of RPG source files
- [ ] Dependencies (tables, programs, copy members) are detected
- [ ] AI prompts are generated automatically
- [ ] A complete analysis bundle is written to `output/<program>/`
- [ ] Documentation explains usage and architecture

---

## Issue Backlog

### 1) CLI command `zeus analyze` (Feature, P1)
Labels: `enhancement`, `priority:P1`
Part of: `#<EPIC>`

Problem / Value:
Provide a stable command line entry point for the analysis pipeline.

Scope (In):
- CLI command `zeus analyze`
- Parameters:
  - `--source`
  - `--program`
  - optional `--profile`
- Output folder creation
- Pipeline orchestration

Acceptance criteria:
- [ ] Command runs via `node cli/zeus.js analyze`
- [ ] CLI accepts source directory and program name
- [ ] Pipeline stages execute in order
- [ ] Output folder created

---

### 2) RPG source scanner (Feature, P1)
Labels: `enhancement`, `priority:P1`
Part of: `#<EPIC>`

Problem / Value:
Detect dependencies from RPG source code automatically.

Scope (In):
- Detect F-spec table usage
- Detect COPY members
- Detect CALL statements
- Detect embedded SQL

Acceptance criteria:
- [ ] Scanner parses RPG files
- [ ] Tables are extracted
- [ ] Program calls detected
- [ ] Copy members detected
- [ ] SQL statements detected

---

### 3) Dependency graph generation (Feature, P1)
Labels: `enhancement`, `priority:P1`
Part of: `#<EPIC>`

Problem / Value:
AI analysis benefits strongly from a dependency overview.

Scope (In):
- Build relationships:
  - program → tables
  - program → programs
  - program → copy members
- Store results in JSON

Acceptance criteria:
- [ ] Graph structure generated
- [ ] Stored inside `context.json`

---

### 4) Context builder (Feature, P1)
Labels: `enhancement`, `priority:P1`
Part of: `#<EPIC>`

Problem / Value:
Prepare structured AI context from scanned information.

Scope (In):
- Combine:
  - source files
  - dependencies
  - SQL
- Build JSON context model

Acceptance criteria:
- [ ] context.json created
- [ ] Includes program metadata
- [ ] Includes dependencies

---

### 5) Prompt template system (Feature, P1)
Labels: `enhancement`, `priority:P1`
Part of: `#<EPIC>`

Problem / Value:
AI prompts should be generated automatically.

Scope (In):
- Template engine for prompts
- Templates:
  - documentation
  - error analysis

Acceptance criteria:
- [ ] Templates loaded from `src/prompt/templates`
- [ ] Prompts generated in output folder

---

### 6) Markdown report generator (Feature, P2)
Labels: `enhancement`, `priority:P2`
Part of: `#<EPIC>`

Problem / Value:
Developers need a human readable report.

Scope (In):
- Markdown report
- Sections:
  - overview
  - dependencies
  - SQL
  - next steps

Acceptance criteria:
- [ ] report.md generated
- [ ] report includes all detected dependencies

---

### 7) DB2 metadata exporter integration (Feature, P2)
Labels: `enhancement`, `db2`, `priority:P2`
Part of: `#<EPIC>`

Problem / Value:
Database schema information improves AI analysis.

Scope (In):
- Java helper using JT400
- Export table metadata

Acceptance criteria:
- [ ] Metadata exported as JSON
- [ ] Integrated into context builder

---

### 8) Test data extractor (Feature, P3)
Labels: `enhancement`, `db2`, `priority:P3`
Part of: `#<EPIC>`

Problem / Value:
Example data improves debugging and AI understanding.

Scope (In):
- Export limited rows from tables
- JSON or CSV output

Acceptance criteria:
- [ ] SELECT sample rows
- [ ] Stored in output bundle

---

### 9) Token/context optimizer for AI prompts (Feature, P3)
Labels: `enhancement`, `priority:P3`
Part of: `#<EPIC>`

Problem / Value:
Large RPG programs may exceed LLM context limits.

Scope (In):
- Summarize source files
- Limit number of rows/data
- Include key snippets only

Acceptance criteria:
- [ ] Context size configurable
- [ ] AI prompts remain within token limits

---

### 10) Output bundle packaging (Feature, P3)
Labels: `enhancement`, `priority:P3`
Part of: `#<EPIC>`

Problem / Value:
Analysis results should be portable.

Scope (In):
- Bundle output files
- Optional ZIP export

Acceptance criteria:
- [ ] Bundle contains:
  - context.json
  - report.md
  - prompts
- [ ] Optional zipped bundle