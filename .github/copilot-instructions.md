# Zeus RPG PromptKit — Copilot Instructions

This workspace is `zeus-rpg-promptkit`: a Node.js CLI that extracts,
normalizes, scans, and packages IBM i RPG/CL/DDS source estates into structured AI context
artifacts. The canonical workflow is: **fetch → analyze → bundle → review**.

**Primary interface: terminal.** Everything runs via `node cli/zeus.js <command>`.
Env-vars must always be set by the user (security boundary). AI and users share the same CLI.

---

## 1. Project Architecture

**Authoritative source:** See `docs/architecture/index.md` and the ADRs (001–005) for the accepted product kernel definition, dependency direction rules, versioned contract policy, capability registry strategy, and safety trust zones (S0–S4). The diagram and notes below reflect the implementation at the time the baseline was captured.

```
cli/zeus.js                    Entry point. Routes commands to src/cli/commands/.
src/
  cli/commands/                One file per CLI command (analyze, fetch, impact, …)
  cli/helpers/                 Shared output helpers (asciiTable, sourceSnippet, …)
  config/runtimeConfig.js      Profile loading, env-var expansion, validation
  scanner/
    rpgScanner.js              Primary heuristic scanner for RPG/SQLRPGLE/CL/DDS/binder
    clScanner.js               CL-specific scanner
    ddsScanner.js              DDS file/record scanner
    dependencyScanner.js       Cross-file dependency resolution
    sourceScanCache.js         File-level scan cache (invalidation by mtime/checksum)
  context/
    canonicalAnalysisModel.js  Builds the canonical evidence model (tables, SQL, calls, …)
    contextBuilder.js          Summary context for prompts and reports
  ai/
    knowledgeProjection.js     AI-facing artifact: evidence index + workflow projections
    contextOptimizer.js        Token-aware pruning of the context object
    tokenEstimator.js          Token counting helper
  analyze/
    analyzePipeline.js         Orchestrates the full staged analysis
    runStages.js               Executes registered stage list
    stageRegistry.js           Declares + validates stage registry
    analyzeArtifactWriter.js   Writes all output files after analysis
    analyzeRunManifest.js      Manifest contract for analyze runs
  prompt/
    promptRegistry.js          Workflow → template contract mapping
    promptBuilder.js           Fills templates from AI knowledge projection
    templates/                 Markdown prompt templates (documentation, defect-analysis, …)
  workflow/
    workflowModeRegistry.js    Named modes (architecture, documentation, defect-analysis, …)
    workflowPresetRegistry.js  Preset bundles that combine mode + bundle artifacts
  dependency/
    dependencyGraphBuilder.js  Single-program dependency graph
    crossProgramGraphBuilder.js Cross-program call tree
  db2/
    metadataExportService.js   DB2 catalog export (tables, columns, keys, triggers)
    testDataExportService.js   Governed sample-data export with masking
    readOnlyQueryService.js    Validated read-only DB2 query runner
  fetch/
    fetchService.js            IBM i source export + local download
    importManifest.js          Provenance and validation manifest writer
  investigation/
    ifsPathScanner.js          IFS path heuristics
    fullTextSearch.js          Workspace text search
    diagnosticPackRunner.js    Structured read-only diagnostic packs
  security/secretMasking.js    Credential scrubbing for outputs
  source/
    sourceType.js              File type classification (RPGLE, CL, DDS, …)
    sourceIntegrity.js         UTF-8 validation, checksum, line-ending checks
  sharing/                     ZIP bundling and safe-share sanitization
  viewer/                      Mermaid/HTML architecture viewer generator
config/
  profiles.json                Local profiles (gitignored)
  profiles.example.json        Example with all env-var references
```

---

## 2. Core Data Contracts

### Canonical Analysis Model (`canonical-analysis.json`)

Produced by `buildCanonicalAnalysisModel()`. Key fields:

- `entities.tables[]` — tables with evidence (file, startLine, endLine)
- `entities.sqlStatements[]` — SQL with type, intent, tables, hostVariables, cursors
- `entities.programCalls[]` — called programs with evidence
- `entities.copyMembers[]` — COPY/INCLUDE members
- `entities.nativeFiles[]` — files used via native I/O opcodes
- `entities.procedures[]` — procedure calls and prototypes
- `entities.modules[]`, `entities.servicePrograms[]` — ILE binding units
- `sourceFiles[]` — all scanned files with type metadata
- `relations[]` — typed edges between entities with evidence

### AI Knowledge Projection (`ai-knowledge.json`)

Produced by `buildAiKnowledgeProjection()`. Key fields:

- `kind: "ai-knowledge-projection"`, `schemaVersion: 1`
- `program` — root program name
- `evidenceIndex[]` — all evidence with IDs (EV0001…), file, line, snippet
- `workflows.documentation` — token-optimized slice for documentation tasks
- `workflows.errorAnalysis` — token-optimized slice for error/defect tasks
- `uncertaintyMarkers[]` — DYNAMIC_SQL, UNRESOLVED_TABLES, etc.

---

## 3. How to Add Features

### New Scanner Rule (RPG heuristic)

1. Edit `src/scanner/rpgScanner.js`
2. Add regex pattern inside the appropriate scan function
3. Call `addEntity()` or `addStructuredItem()` with evidence `{ file, startLine, endLine, text }`
4. Add test fixture in `tests/fixtures/` and a case in `tests/scanner-corpus.test.js`
5. Ensure the new entity type is picked up in `buildCanonicalAnalysisModel()`

### New Risk Assessment Feature (v0.2+)

1. Extend `src/impact/riskAssessmentAnalyzer.js` with new assessment functions
2. Add assessment rules to `assessCanonicalModel()` or new `assessXxxPattern()` function
3. Create corresponding CLI command wrapper in `src/cli/commands/assessXxxCommand.js`
4. Register command in `cli/zeus.js` with `--xyz-risk` option or new command name
5. Update help text in `printHelp()` in `cli/zeus.js`

### New Test/Deployment Planning Feature (v0.2+)

1. Add generator function in `src/investigation/testScenarioGenerator.js` or `src/report/deploymentChecklistBuilder.js`
2. Create CLI command wrapper in `src/cli/commands/generateXxxCommand.js`
3. Register in `cli/zeus.js`
4. Test with: `node cli/zeus.js generate-xxx --program TESTPROG --verbose`

### New Workflow Mode

1. Add entry to `WORKFLOW_MODE_REGISTRY` in `src/workflow/workflowModeRegistry.js`
2. Add entry to `WORKFLOW_PRESET_REGISTRY` in `src/workflow/workflowPresetRegistry.js`
3. Add prompt template in `src/prompt/templates/<name>.md`
4. Add entry to `PROMPT_REGISTRY` in `src/prompt/promptRegistry.js`
5. Add token budget in `DEFAULT_WORKFLOW_TOKEN_BUDGETS` in `src/ai/contextOptimizer.js`

### New CLI Command

1. Create `src/cli/commands/<name>Command.js`
2. Export `run(args, config)` (async)
3. Register in `cli/zeus.js`
4. Add env-var checks to `src/cli/commands/doctorCommand.js`
5. Document in `config/profiles.example.json`

### New Prompt Template

1. Create `src/prompt/templates/<name>.md` with `{{variable}}` slots
2. Register in `src/prompt/promptRegistry.js` (name, templateFile, workflow, requiredInputs)
3. Wire template filling in `src/prompt/promptBuilder.js`

---

## 4. Code Conventions

- **One command = one file** in `src/cli/commands/`
- **No `process.exit()` outside** `cli/zeus.js`
- **All DB2 queries via** `runReadOnlyDb2Query()` from `src/db2/readOnlyQueryService.js`
- **Credentials never in code** — only via env-var references in profiles.json
- **Evidence always has** `{ file, startLine, endLine, text }` — never bare strings
- **Sorted, deterministic output** — use `sort()` before writing arrays
- **Fail loudly, recover gracefully** — unknown profiles → explicit error with hint
- **Env-var expansion pattern**: `${env:ZEUS_FOO}` in profiles → resolved at runtime

---

## 5. Key Env-Vars

```
ZEUS_DB_HOST / ZEUS_DB_URL / ZEUS_DB_USER / ZEUS_DB_PASSWORD
ZEUS_DB_DEFAULT_LIBRARY / ZEUS_DB_DEFAULT_SCHEMA
ZEUS_FETCH_HOST / ZEUS_FETCH_USER / ZEUS_FETCH_PASSWORD
ZEUS_FETCH_SOURCE_LIB / ZEUS_FETCH_IFS_DIR / ZEUS_FETCH_OUT
ZEUS_OUTPUT_ROOT / ZEUS_SOURCE_ROOT
```

---

## 6. Test Strategy

```bash
npm test                    # full suite (contract + smoke + unit)
npm run test:unit           # unit tests only
npm run test:contract       # artifact contract tests
npm run test:smoke          # end-to-end smoke tests
npm run test:corpus         # scanner corpus tests (fixture-based)
node --test tests/<file>    # single test file
```

Key test categories:

- `tests/scanner-corpus.test.js` — scanner output against known fixtures
- `tests/analyze-run-manifest.test.js` — analyze artifact contract
- `tests/ai-knowledge-projection.test.js` — AI projection schema
- `tests/fetch-transport-contract.test.js` — fetch encoding contract

---

## 7. IBM i Platform Knowledge (critical for correct scanner/DB2 work)

| Topic                     | Rule                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| Source file priority      | QRPGLESRC → QSRVSRC → QCPYSRC → QCLLESRC → QCLSRC → QSQLSRC → QDDSSRC             |
| CCSID contract            | Always use stream file CCSID 1208 (UTF-8) for local analysis                      |
| Schema discovery          | Never hardcode schema — query QSYS2.SYSTABLES first                               |
| Column names              | Short IBM i names diverge from logical names — use COLUMN_ALIASES + resolveColumn |
| No ROW_COUNT in SYSTABLES | Neither ROW_COUNT nor NUMBER_ROWS are universal — omit both                       |
| SQL qualifier syntax      | Use SCHEMA.TABLE not LIBRARY/FILE in SQL contexts                                 |
| QSYS2 UDTFs               | Call `QSYS2.OBJECT_STATISTICS` via `FROM TABLE(...) AS X`, never as a plain table |
| Unknown object library    | If the library is unknown, search `*ALLUSR` first and never guess a library       |
| Service program source    | BOUND_MODULE_INFO → fallback to OBJECT_STATISTICS → fallback to member convention |
| Fixed-format RPG columns  | Column 6 = indicator area, col 7 = form type (C/F/D/P/…), col 8–80 = spec         |
| Free-format RPG           | Starts with `/FREE` or uses `**FREE` header; column layout does not apply         |

---

## 8. Safety Rules (always enforce)

- **Read-only on ALL IBM i systems by default** — `secondary-system` and `primary-system` alike.
- **Code changes go into the local workspace copy only** — never write directly to IBM i source members.
  After every local edit, show the user a clear diff (file, line, before/after) so they can transfer it manually.
- Never deploy, compile, or push objects to IBM i without explicit user approval.
- Never expose credentials, connection strings, tokens, or passwords.
- Require explicit user confirmation for any write operation, on any system.

### Code change protocol

1. Make the change locally in the workspace file.
2. Show the user a precise diff: which file, which lines, what changed.
3. Tell the user: "Diese Änderung ist nur lokal. Bitte übertrage den Code manuell auf IBM i."
4. Never overwrite fetched originals directly — always work on the workspace copy.

### Data change confirmation protocol

Any operation that could change data, objects, or structure on IBM i **must** follow this protocol:

1. Formulate the operation (SQL statement or CL command) and show it to the user.
2. State explicitly: "Diese Operation verändert Daten. Bitte bestätigen."
3. Wait for explicit user approval ("ja", "mach das", "ausführen", etc.).
4. Only after approval: execute via `query-sql` or `IbmiCommandRunner`.
5. If no approval: hand the statement to the user for manual execution in ACS.

**Never auto-execute:** INSERT, UPDATE, DELETE, MERGE, CREATE, DROP, ALTER,
CALL on production, CRTPGM, CRTRPGMOD, CRTSQLRPGI, CPYF, DLTOBJ, or any
CL command that changes objects or data.

**`primary-system` is never touched with write operations — ever.**
**`secondary-system` requires the same confirmation protocol for all write operations.**

---

## 9. Java Tool Integration

All Java helpers live in `java/` and are pre-compiled to `java/bin/`. They are invoked
through `src/java/javaRuntime.js` (central bridge using `child_process.spawnSync`).

| Java Class                  | Called from (Node.js)                                             | CLI command                           |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| `IbmiCommandRunner`         | `src/fetch/jt400CommandRunner.js` → `runClCommand()`              | `fetch`                               |
| `IbmiMemberLister`          | `src/fetch/jt400CommandRunner.js` → `listMembers()`               | `fetch`                               |
| `IbmiSourceMemberExporter`  | `src/fetch/jt400CommandRunner.js` → `exportSourceMemberViaJdbc()` | `fetch`                               |
| `IbmiIfsDownloader`         | `src/fetch/jt400Downloader.js` → `downloadDirectoryViaJt400()`    | `fetch`                               |
| `Db2DiagnosticQueryRunner`  | `src/db2/readOnlyQueryService.js` → `runReadOnlyDb2Query()`       | `query-sql`, `query-table`, `analyze` |
| `Db2MetadataExporter`       | `src/db2/metadataExportService.js` → `exportDb2Metadata()`        | `analyze`                             |
| `Db2ExternalObjectResolver` | `src/db2/metadataExportService.js` → `resolveExternalObjects()`   | `analyze`                             |
| `Db2TestDataExtractor`      | `src/db2/testDataExportService.js` → `exportTestData()`           | `analyze`                             |

**Direct Java invocation** (diagnostic / scripting use):

```powershell
cd java
java -cp "bin;lib\jt400.jar" IbmiCommandRunner <host> <user> <pw> "<CL-Command>"
java -cp "bin;lib\jt400.jar" Db2DiagnosticQueryRunner "<jdbc-url>" <user> <pw> "<SQL>" <maxRows>
```

Display commands (`DSP*`, `WRK*`) return no output — use `QSYS2.*` SQL views instead.

---

## 10. Environment Setup (Project)

Standard env load for project development sessions:

```powershell
cd C:\Users\Developer.User\Tools\zeus-rpg-promptkit
. .\config\load-env.ps1 -Environment project   # loads .env.local + .env.project.local
node cli/zeus.js doctor --profile development --show-resolved
```

Systems:

- **secondary-system** — active development / read-oriented integration system, profile `development`
- **primary-system** — protected system, metadata read-only, NEVER write

Session prompt template: `docs/ai/session-prompt.md`
