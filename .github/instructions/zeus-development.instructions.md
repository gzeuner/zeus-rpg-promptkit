---
applyTo: "**"
---

# Zeus RPG PromptKit — Developer Instructions

This file is the authoritative reference for **implementing and extending** this codebase.
It covers patterns, APIs, fallbacks, and implementation rules for every subsystem.

---

## 1. CLI Command Pattern

Every CLI command lives in `src/cli/commands/<name>Command.js` and exports:
```js
async function run(args, config) { /* ... */ }
module.exports = { run };
```

- `args` — parsed CLI arguments (object, e.g. `{ profile: 'default', member: 'MYPGM' }`)
- `config` — resolved profile config from `src/config/runtimeConfig.js`
- No `process.exit()` inside command files — throw errors instead
- Registration in `cli/zeus.js` — one entry per command
- Doctor checks in `src/cli/commands/doctorCommand.js` for new env-vars

### Adding a new command (checklist)
```
1. src/cli/commands/<name>Command.js   — create, export run(args, config)
2. cli/zeus.js                         — register command + --help text
3. src/cli/commands/doctorCommand.js   — add env-var checks if needed
4. config/profiles.example.json        — document new profile keys
```

---

## 2. Scanner Pattern — Adding a New RPG Heuristic

Scanner functions live in `src/scanner/rpgScanner.js`.

**Entity model:**
```js
addEntity(mapName, entityName, {
  name: 'NORMALIZED_NAME',
  evidence: { file: relativeFilePath, startLine: n, endLine: n, text: rawLine }
});
```

**Structured item model (e.g. SQL, procedures):**
```js
addStructuredItem(mapName, uniqueKey, {
  type: 'PROCEDURE_CALL',
  name: 'PROC_NAME',
  evidence: [{ file, startLine, endLine, text }]
});
```

**Rules:**
- All names must be normalized to UPPERCASE via `normalizeName()`
- Evidence `file` must be relative to `sourceRoot` (use `path.relative(sourceRoot, absPath)`)
- All output arrays must be sorted before returning
- Add test fixture in `tests/fixtures/<name>.rpgle` and a case in `tests/scanner-corpus.test.js`

**Key scanner areas to understand before editing:**
- Lines 1–50: `NATIVE_IO_OPCODES` set, normalization helpers
- `scanRpgFile()` — main entry point; routes to fixed/free-format detection
- Fixed-format RPG: column-based parsing (col 7 = form type)
- Free-format RPG: line-by-line regex matching after `**FREE` or `/FREE`
- SQL extraction: `C/EXEC SQL` ... `C/END-EXEC` blocks extracted verbatim

---

## 3. Canonical Analysis Model Contract

`buildCanonicalAnalysisModel(scanResults, options)` → `canonical-analysis.json`

**Top-level shape:**
```json
{
  "schemaVersion": 1,
  "program": "ROOT_PROGRAM",
  "sourceFiles": [{ "path": "...", "type": "RPGLE", ... }],
  "entities": {
    "tables":        [{ "name": "...", "evidenceCount": n, "evidence": [...] }],
    "sqlStatements": [{ "type": "SELECT", "intent": "READ", "tables": [...], ... }],
    "programCalls":  [{ "name": "...", "evidence": [...] }],
    "copyMembers":   [{ "name": "...", "evidence": [...] }],
    "nativeFiles":   [{ "name": "...", "evidence": [...] }],
    "procedures":    [{ "name": "...", "kind": "CALL|PROTOTYPE", "evidence": [...] }],
    "modules":       [{ "name": "...", "evidence": [...] }],
    "servicePrograms":[{ "name": "...", "evidence": [...] }]
  },
  "relations": [{ "type": "CALLS|READS|WRITES|COPIES", "from": "...", "to": "...", "evidence": [...] }]
}
```

**Key rule:** Every entity in this model MUST have at least one evidence entry with `{ file, startLine, endLine, text }`. Never bare strings.

---

## 4. AI Knowledge Projection Contract

`buildAiKnowledgeProjection(canonicalAnalysis, context, options)` → `ai-knowledge.json`

```json
{
  "kind": "ai-knowledge-projection",
  "schemaVersion": 1,
  "program": "ROOT_PROGRAM",
  "evidenceIndex": [
    { "id": "EV0001", "category": "TABLE", "label": "...", "file": "...", "startLine": n, "snippet": "..." }
  ],
  "workflows": {
    "documentation": { "summary": "...", "tables": [...], "sqlStatements": [...], "evidenceHighlights": [...] },
    "errorAnalysis":  { "summary": "...", "sqlStatements": [...], "riskMarkers": [...], "evidenceHighlights": [...] }
  },
  "uncertaintyMarkers": ["DYNAMIC_SQL", "UNRESOLVED_TABLES"]
}
```

When **adding a new workflow slice** (e.g. for a new workflow mode):
1. Add budget in `DEFAULT_WORKFLOW_TOKEN_BUDGETS` in `contextOptimizer.js`
2. Add WORKFLOW_KEYS entry in `contextOptimizer.js`
3. Build the projection slice in `knowledgeProjection.js`
4. Add the `workflows.<name>` shape to the schema contract in `tests/ai-knowledge-projection.test.js`

---

## 5. Workflow Mode Pattern

`src/workflow/workflowModeRegistry.js` — `WORKFLOW_MODE_REGISTRY` object:
```js
myMode: Object.freeze({
  name: 'my-mode',
  title: 'My Mode Title',
  description: 'What this mode does.',
  promptTemplates: Object.freeze(['documentation', 'my-template']),
  autoOptimizeContext: true,
  primaryArtifacts: Object.freeze([
    'analysis-index.json',
    'ai-knowledge.json',
    'ai_prompt_my_template.md',
  ]),
  reviewWorkflow: freezeReviewWorkflow({
    intendedAudience: ['...'],
    keyQuestionsAnswered: ['...'],
    expectedDecisions: ['...'],
    interpretationGuidance: ['...'],
    requiredInputs: ['...'],
    recommendedOutputs: [{ path: '...', purpose: '...' }],
  }),
}),
```

`src/workflow/workflowPresetRegistry.js` — matching preset:
```js
'my-preset': Object.freeze({
  name: 'my-preset',
  title: 'My Preset',
  description: '...',
  analyzeMode: 'my-mode',
  bundleArtifacts: Object.freeze(['analyze-run-manifest.json', 'ai-knowledge.json', ...]),
  reviewWorkflow: freezeReviewWorkflow({ ... }),
}),
```

---

## 6. Prompt Template Pattern

Templates live in `src/prompt/templates/<name>.md`. Variable slots use `{{variable}}`.

Available variables (filled by `promptBuilder.js`):
- `{{program}}` — root program name
- `{{summary}}` — narrative summary
- `{{tables}}` — formatted table list
- `{{programCalls}}` — formatted program calls
- `{{sqlStatements}}` — formatted SQL list
- `{{nativeFiles}}` — native I/O files
- `{{riskMarkers}}` — risk signal list
- `{{uncertaintyMarkers}}` — uncertainty signal list
- `{{dependencyGraphSummary}}` — graph summary text
- `{{sourceSnippet}}` — code snippet from evidence
- `{{evidencePackSummary}}` — evidence overview
- `{{contractBudget}}` — token budget info
- `{{ifsPaths}}` — IFS path references
- `{{searchResults}}` — full-text search findings
- `{{diagnosticFindings}}` — diagnostic pack output

Register in `src/prompt/promptRegistry.js`:
```js
'my-template': Object.freeze({
  name: 'my-template',
  version: 1,
  templateFile: 'my-template',         // → src/prompt/templates/my-template.md
  workflow: 'myWorkflowKey',           // key in ai-knowledge.json workflows
  outputFileName: 'ai_prompt_my_template.md',
  requiredInputs: Object.freeze([
    Object.freeze({ path: 'kind', equals: 'ai-knowledge-projection' }),
    Object.freeze({ path: 'program', type: 'string', nonEmpty: true }),
  ]),
  budget: Object.freeze({ targetTokens: 2000, maxTokens: 4000 }),
}),
```

---

## 7. DB2 Query Patterns

**Always use `runReadOnlyDb2Query()` — never raw JDBC:**
```js
const { runReadOnlyDb2Query } = require('../db2/readOnlyQueryService');
const result = await runReadOnlyDb2Query({ dbConfig, query, maxRows: 200 });
// result.rows = array of objects, result.columns = column name array
```

**Schema discovery (never hardcode schema):**
```js
const query = `SELECT TABLE_SCHEMA FROM QSYS2.SYSTABLES
               WHERE TABLE_NAME = ${escapeSqlLiteral(tableName)}
               ORDER BY TABLE_SCHEMA`;
```

**Safe SQL identifiers:** Use `validateSqlIdentifier()` and `escapeSqlLiteral()` from `readOnlyQueryService.js`.

**Never use:** `ROW_COUNT`, `NUMBER_ROWS` in `QSYS2.SYSTABLES` — not universally available on IBM i.

**Error recovery by SQL state:**
- `SQL0206` → column not found → retry with alias fallback
- `SQL0204` → table not found → retry with schema discovery
- `SQL0551` → no authority → try alternative schema

---

## 8. Source Identity Rules

- All source paths must be **relative** to `sourceRoot` (POSIX separators)
- Normalize via `normalizeRelativePath(sourceRoot, absPath)`
- Program identity = `basename(filePath, ext).toUpperCase()`
- Duplicate member names across source files are a known limitation — track explicitly

---

## 9. IBM i RPG Scanner Knowledge

### Fixed-Format RPG Column Layout
```
Col 1-5:   Sequence number (ignored)
Col 6:     Form type indicator (H/F/D/I/C/O/P)
Col 7:     Comment indicator (* = comment line)
Col 8-80:  Spec content
```

### Free-Format RPG
Triggered by `**FREE` on line 1 or `/FREE` in source. Column layout does not apply.

### Key RPG Patterns to Detect
```
CALL '<program>'              → programCall (fixed-format CL-style)
CALLP <proc>(<args>)          → procedure call (free-format)
DCL-PROC / END-PROC           → procedure definition boundary
DCL-PR / END-PR               → prototype declaration
DCL-PI / END-PI               → procedure interface
/COPY <lib>/<file>,<member>   → copy member dependency
/INCLUDE <lib>/<file>,<member>→ copy member dependency (alias)
EXEC SQL ... END-EXEC         → embedded SQL block
C/EXEC SQL ... C/END-EXEC     → embedded SQL (fixed-format)
```

### ILE Binding
```
BNDDIR('<binding-dir>')       → binding directory reference
MODULE '<module>'             → module reference (in binder source)
EXPORT SYMBOL('<symbol>')     → exported symbol (in binder source)
```

### SQL Statement Classification
- `SELECT / WITH` → READ intent
- `INSERT / UPDATE / DELETE / MERGE` → WRITE intent  
- `DECLARE CURSOR ... FOR SELECT` → READ via CURSOR
- `PREPARE / EXECUTE` → DYNAMIC_SQL uncertainty marker
- Tables with host variables (`:varname`) in FROM clause → DYNAMIC_SQL marker

---

## 10. IBM i Platform Gotchas

| Problem | Rule |
|---|---|
| Schema vs library | Always use `SCHEMA.TABLE` SQL syntax, never `LIBRARY/FILE` |
| ROW_COUNT missing | Never query ROW_COUNT or NUMBER_ROWS from QSYS2.SYSTABLES |
| CCSID encoding | Local analysis contract = UTF-8 (CCSID 1208) only |
| Duplicate members | Source file name + member name = identity, not just member name |
| Service program source | Check BOUND_MODULE_INFO → fallback OBJECT_STATISTICS → fallback member convention |
| Source file priority | QRPGLESRC → QSRVSRC → QCPYSRC → QCLLESRC → QCLSRC → QSQLSRC → QDDSSRC |
| Column name aliases | Short IBM i names diverge from logical names — validate against SYSCOLUMNS first |
| Commitment control | SQLSTATE 55019 = commitment control error — read-only queries use `WITH NC` hint |

---

## 11. Test Structure

```
tests/
  scanner-corpus.test.js       # Scanner heuristics against fixtures in tests/fixtures/
  analyze-run-manifest.test.js # Analyze artifact output contract
  ai-knowledge-projection.test.js # AI knowledge schema contract
  canonical-analysis-model.test.js # Canonical model shape
  fetch-transport-contract.test.js # Fetch encoding contract
  binding-semantics.test.js    # ILE binding detection
  context-optimizer.test.js    # Token budget + pruning behavior
  workflow-presets.test.js     # Preset registry contract
  source-normalization.test.js # UTF-8 normalization
  source-integrity.test.js     # Checksum + BOM detection
  ...
```

**Adding a scanner test:**
1. Add fixture: `tests/fixtures/<name>.<ext>`
2. Add case in `tests/scanner-corpus.test.js`:
```js
test('<description>', () => {
  const result = runCorpusCase({ file: 'fixtures/<name>.<ext>' });
  assert.deepStrictEqual(result.tables, ['EXPECTED_TABLE']);
});
```

**Contract tests** (in `test:contract`) verify artifact shape — always update if you add fields to canonical-analysis.json or ai-knowledge.json.

---

## 12. Security Rules (always enforce)

- All DB2 queries → `runReadOnlyDb2Query()` only
- All user-provided strings in SQL → `validateSqlIdentifier()` or `escapeSqlLiteral()`
- All outputs → `maskSecretsInText()` from `src/security/secretMasking.js` before writing
- No credentials in code, config, or comments — only env-var references
- No path traversal — always validate paths against workspace root
- No `eval()`, `Function()`, or `child_process.exec` with user input
