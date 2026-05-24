---
Title: Project-Neutral Knowledgebase Architecture
Description: Architecture assessment and design proposal for privacy-safe pattern extraction and reusable knowledge in Zeus RPG PromptKit.
Last Updated: 2026-05-24
---

# Project-Neutral Knowledgebase Architecture

## 1. Executive Summary

Yes, a project-neutral knowledgebase is a good fit for Zeus RPG PromptKit.

It fits only if Zeus treats it as a privacy-gated pattern catalog derived from evidence, not as a persistent warehouse of extracted source artifacts.

The current local direction is mixed:

- good: the neutral PUI pattern extractor is moving toward generalized structural patterns
- bad: the new DDDL/template knowledge path persists reconstructable UI payloads and provenance inside `.zeus/knowledge`
- risky: the current MCP/API knowledge surface is safe-looking at the edge, but it is backed by an unsafe upstream persistence model

Recommended decision:

- keep and extend neutral pattern extraction
- stop treating raw DDDL/PUI exports as a reusable knowledgebase
- separate raw evidence, sanitized intermediate, and final safe knowledge into different modules and output roots
- fail closed with an explicit privacy gate before anything is persisted as toolkit knowledge or exposed via MCP

## 2. Decision: Recommended Direction

Recommended direction: proceed, but redesign the pipeline boundary before adding more functionality.

Architecture decision:

- a project-neutral knowledgebase should exist
- it should be a separate pipeline/module, not an implicit extension of `analyze`
- the final persisted artifact must be generated only after classification, normalization, and privacy validation
- raw/source-shaped artifacts must never be stored under a path named `knowledge` unless they are clearly isolated as local-only raw evidence and excluded from commit/publish/MCP

## 3. What Problem This Solves

This solves a real gap in Zeus:

- reusable pattern knowledge for AI/tooling without re-reading whole source trees
- better recognition of recurring UI, workflow, data-access, and program structures
- a safer bridge between evidence-first analysis and later assistant guidance
- a consistent taxonomy for CLI, MCP, prompt-building, and future pattern matching

This is aligned with Zeus because Zeus is already an evidence-preparation layer and not a blind code generator.

## 4. What Problem This Must Not Try To Solve Yet

Do not try to solve these yet:

- project memory or customer-specific knowledge retention
- source-code generation
- automatic UI reconstruction
- cross-project learning from stored raw examples
- semantic naming recovery from business labels or identifiers
- autonomous modernization decisions based on extracted project artifacts

## 5. Threat Model: How Project Information Could Leak

Primary leakage paths:

| Threat | Example |
|---|---|
| Raw artifact persistence | storing full `puiJson`, DDS-derived JSON, SQL text, source lines |
| Provenance persistence | source paths, source file names, member names, record formats |
| Label leakage | screen captions, button text, business terms, comments |
| Identifier leakage | field names, table names, library names, program names |
| Structural reconstruction | storing enough template detail to rebuild an original screen |
| Debug/report leakage | logs, error payloads, reports, summaries with raw values |
| MCP leakage | exposing raw or sanitized-but-still-sensitive intermediate artifacts |
| Test/documentation leakage | fixtures/docs/examples derived from real projects |
| Commit leakage | generated `.zeus` artifacts accidentally committed |

Threat boundary:

- useful extraction ends at generalized, taxonomy-bound observations
- leakage begins when a persisted artifact can identify a project or reconstruct a meaningful project screen/workflow

## 6. Proposed Layered Architecture

```text
source artifacts
  -> extractors
  -> raw evidence bundle (local-only, optional, short-lived)
  -> sanitizer / classifier / normalizer
  -> sanitized intermediate review bundle (sensitive)
  -> pattern candidate builder
  -> privacy gate
  -> project-neutral knowledge catalog JSON
  -> CLI / MCP / AI context readers
```

Layer rules:

### Layer A. Raw Evidence

- may contain raw DDS/RPG/CL/SQL/PUI details
- local-only
- short-lived
- never committed
- never exposed via MCP
- never called a knowledgebase

Suggested path:

- `output/knowledge-work/<run-id>/raw/`
or
- `.zeus/raw-evidence/<run-id>/`

### Layer B. Sanitized Intermediate

- may contain tokenized strings, redacted labels, hashed provenance, normalized roles
- still sensitive by default
- useful for human debugging of the classifier
- not MCP-safe
- not publish-safe unless separately approved

Suggested path:

- `output/knowledge-work/<run-id>/sanitized/`

### Layer C. Project-Neutral Knowledge

- final safe artifact
- schema-versioned
- taxonomy-bound
- contains only generalized patterns, roles, feature flags, hints, counts, confidence, limitations, and privacy assessment
- MCP-safe if and only if the privacy gate passes

Suggested path for MVP:

- `output/knowledge/<run-id>/project-neutral-knowledge.json`

Do not create a committed global toolkit knowledgebase yet.

## 7. Proposed Module / Package Boundaries

Recommended boundaries:

| Module | Responsibility |
|---|---|
| `src/knowledge/extractors/` | source-family-specific extraction to raw evidence |
| `src/knowledge/raw/` | raw evidence schemas and local-only IO |
| `src/knowledge/sanitize/` | redaction, tokenization, identifier classification |
| `src/knowledge/normalize/` | convert sanitized evidence into pattern candidates |
| `src/knowledge/privacy/` | fail-closed privacy gate and rejection reports |
| `src/knowledge/schema/` | final JSON schema, taxonomy, validation |
| `src/knowledge/catalog/` | read-only access to final safe catalog |
| `src/knowledge/cli/` | CLI commands for extract/validate/inspect |
| `src/knowledge/mcp/` | MCP adapters that read final safe catalog only |

Important architectural rule:

- `src/analyze/` may call the final read-only catalog if explicitly requested
- `src/analyze/` should not own raw knowledge extraction or persistent knowledge promotion

## 8. Proposed JSON Schema Draft

First stable iteration should be small and strict.

```json
{
  "schemaVersion": "1.0.0",
  "kind": "zeus-project-neutral-knowledge-catalog",
  "generatedAt": "2026-05-24T00:00:00.000Z",
  "generator": {
    "name": "zeus-rpg-promptkit",
    "version": "0.1.0",
    "extractorVersion": "knowledge-mvp-1"
  },
  "privacyMode": "strict",
  "sourcePolicy": {
    "rawEvidencePersisted": false,
    "intermediatePersisted": true,
    "projectIdentityAllowed": false
  },
  "taxonomyVersion": "2026-05-24",
  "summary": {
    "patternCount": 12,
    "domainCounts": {
      "ui": 7,
      "program": 3,
      "data": 2
    }
  },
  "patterns": [
    {
      "id": "ui.grid.001",
      "kind": "ui.grid",
      "domain": "ui",
      "technology": ["dds", "profound-ui"],
      "features": ["sortable-columns", "action-buttons", "selection-state"],
      "elements": [
        {
          "role": "grid",
          "intent": "list-and-act",
          "layoutHints": ["multi-column", "header-row"],
          "behaviorHints": ["selection", "refresh", "sort"]
        },
        {
          "role": "action-button",
          "intent": "row-action",
          "layoutHints": ["adjacent-to-grid"],
          "behaviorHints": ["dispatch", "confirm-possible"]
        }
      ],
      "confidence": {
        "level": "high",
        "score": 0.93
      },
      "evidenceSummary": {
        "category": "ui-structure",
        "signals": ["grid-present", "response-wiring", "subfile-control"],
        "sampleCountBand": "few"
      },
      "privacyAssessment": {
        "status": "passed",
        "checks": ["identifier-scan", "label-scan", "source-shape-scan"]
      },
      "limitations": [
        "No business meaning retained",
        "Action semantics inferred from structure only"
      ],
      "reviewStatus": "unreviewed"
    }
  ]
}
```

Schema rules:

- `schemaVersion` should be semantic, not integer-only
- `technology` should use controlled vocab terms
- `sampleCountBand` should be bands like `one`, `few`, `some`, `many`
- no free-text provenance identity
- no source file/member names
- no record format names
- no raw constants
- no embedded examples from source

## 9. Proposed Taxonomy Draft

Start with controlled vocabularies.

### Pattern kinds

- `ui.grid`
- `ui.button`
- `ui.toolbar`
- `ui.form`
- `ui.panel`
- `ui.dialog`
- `ui.selection`
- `ui.validation`
- `ui.navigation`
- `workflow.prompt-confirm-action`
- `workflow.search-select-return`
- `workflow.validate-then-submit`
- `program.crud`
- `program.lookup`
- `program.batch`
- `program.report`
- `data.table-access`
- `data.join-pattern`

### Domains

- `ui`
- `workflow`
- `program`
- `data`

### Technology tags

- `dds`
- `5250`
- `profound-ui`
- `rpgle`
- `sqlrpgle`
- `cl`
- `db2`

### Confidence levels

- `high`
- `medium`
- `possible`
- `unknown`

### Evidence categories

- `ui-structure`
- `ui-behavior`
- `program-flow`
- `data-access`
- `runtime-binding`

## 10. CLI Command Proposal

Smallest useful CLI surface:

```bash
node cli/zeus.js knowledge extract \
  --source ./some-source-root \
  --out ./output/knowledge \
  --mode ui-patterns \
  --privacy strict
```

Optional follow-up commands:

- `zeus knowledge validate --input ./output/knowledge/<run>/project-neutral-knowledge.json`
- `zeus knowledge inspect --input ./output/knowledge/<run>/project-neutral-knowledge.json`
- `zeus knowledge taxonomy`

Do not add:

- global mutable registry commands
- promote/activate commands
- auto-import into `analyze`
- commands that persist raw evidence under a `knowledge` name

## 11. MCP Tool Proposal

Keep MCP intentionally narrow.

Recommended tools:

- `zeus.knowledge.patterns`
- `zeus.knowledge.explain-pattern`
- `zeus.knowledge.search`
- `zeus.knowledge.taxonomy`

Rules:

- final safe catalog only
- no raw evidence
- no sanitized intermediate
- no template payloads
- no provenance identifiers
- default result limits and pagination
- deterministic refusal when no privacy-passed catalog exists

Recommendation for current branch:

- do not expand `zeus.knowledge` further until it is backed by the new final schema rather than the current derived library

## 12. Validation and Privacy Gate Proposal

The privacy gate must fail closed.

Checks should run on the final candidate artifact before write and again before MCP exposure.

### Required checks

- identifier pattern scan
- label/business-term scan
- source-like line scan
- path/URL/host/IP scan
- table/member/library/program naming scan
- long unique phrase scan
- entropy/uniqueness scan for suspicious literals
- unchanged-token ratio scan
- schema allowlist validation

### Reject on detection of

- all-caps member-like identifiers
- `LIB/FILE(MBR)`-style forms
- real file paths
- SQL object names
- field names with business meaning
- copied labels or captions
- copied source comments
- source-like DDS/RPG/CL/SQL lines
- URLs, hostnames, IPs, credentials
- raw constants that look project-specific

### Technical enforcement

- final schema validator allows only approved keys
- all string fields pass regex-based deny rules
- vocabulary-bound fields reject unknown values
- free text allowed only in bounded fields such as `limitations[]`
- optional dictionary-based domain-term detector for rare business nouns
- gate writes a sanitized rejection report only

Suggested rejection report:

```json
{
  "kind": "knowledge-privacy-rejection",
  "generatedAt": "...",
  "status": "rejected",
  "reasons": [
    {
      "code": "SUSPICIOUS_IDENTIFIER_PATTERN",
      "fieldPath": "patterns[3].elements[0].intent",
      "sample": "[redacted]"
    }
  ]
}
```

## 13. Test Strategy

Required tests before trust:

### Unit tests

- extractor emits raw evidence without touching final schema
- sanitizer removes names/labels/paths
- normalizer maps evidence to controlled taxonomy terms
- privacy gate rejects prohibited values
- privacy gate accepts known-safe synthetic cases

### Contract tests

- final schema validation
- MCP tool payloads contain no banned fields
- CLI output layout stays layer-separated

### Adversarial tests

- customer-like labels
- member-like identifiers
- SQL table names
- file paths
- URLs/tokens/hosts
- copied source lines
- mixed-language business text

### Regression tests

- synthetic corpora only
- no real project-derived fixtures
- snapshot tests for accepted safe artifacts and rejected unsafe ones

### Operational tests

- `.zeus`/raw outputs are ignored by git
- safe catalog generation works with zero persisted raw evidence

## 14. MVP Implementation Plan

Smallest useful MVP:

1. Create `src/knowledge/` scaffolding with explicit raw/sanitized/final boundaries.
2. Move neutral structural PUI extraction behind a new `knowledge extract --mode ui-patterns` path.
3. Emit only one final safe JSON artifact plus one sanitized rejection report when needed.
4. Add privacy gate with deny rules and schema validator.
5. Expose read-only CLI inspection for the final safe artifact.
6. Keep MCP disabled for knowledge until the final schema is proven.

MVP output scope:

- PUI/DDS UI structure patterns only
- no DDDL template persistence
- no global active registry
- no analyze auto-import

## 15. Explicit Non-Goals

- source-code generation
- project memory
- cross-run mutable knowledge activation
- template replay/reconstruction
- business-term recovery
- workflow cloning from a source project
- learning from raw project examples

## 16. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Neutral model still leaks via labels/identifiers | fail-closed privacy gate |
| Safe-looking summaries are backed by unsafe stores | separate storage and naming by layer |
| Profound UI overfits the core model | keep taxonomy domain-based, not tool-specific |
| Global knowledge becomes stale or mixed | use per-run generated outputs first |
| MCP legitimizes unsafe internals | expose only final safe catalog |
| Developers commit local raw artifacts | ignore `.zeus/` and generated knowledge work dirs |

## 17. Review Checklist For Future PRs

- Does this PR keep raw, sanitized, and final layers separate?
- Does any persisted artifact include names, labels, paths, snippets, comments, or source-like text?
- Can the final artifact reconstruct a real screen or workflow?
- Are all new schema fields allowlisted and vocabulary-bound?
- Does MCP read only final safe artifacts?
- Are tests synthetic and privacy-safe?
- Are logs/report payloads free of raw source-derived values?
- Is any “knowledge” path actually storing raw or source-shaped data?
- Is any new feature drifting into code generation?

## 18. Assessment of Current Local Implementation

### What is good

- `./.local/internal-tools/puiNeutralPatternExtractor.js` is the best current foundation. It generalizes toward structural patterns, qualitative hints, and normalized categories.
- `src/context/puiPatternImport.js` shows a usable shape for compact neutral projection, though it still carries source metadata that should not survive into a final shared knowledge artifact.
- `src/ai/knowledgeBaseService.js` and the current MCP card shape show a reasonable read-only consumer interface pattern.

### What is not good

- The current implementation uses the word `knowledge` for artifacts that are not project-neutral.
- The DDDL/template path stores raw UI payloads and provenance in persistent `.zeus/knowledge` files.
- `analyze` currently refreshes and consumes active PUI pattern knowledge automatically, which couples per-run analysis with mutable local knowledge state.
- The current design assumes a local active registry/library model before the privacy model is proven.

### Bottom-line assessment

- architecturally promising
- currently too coupled to raw extracted data to be trusted as a production knowledgebase path

## 19. Inventory of Contradictory / Unsafe Existing Code

| File / Area | Why it is contradictory or unsafe | Recommended action |
|---|---|---|
| `src/pui/puiDddlKnowledgeBase.js` | Persists full `puiJson` plus source metadata under `.zeus/knowledge/pui-dddl` | Remove from final knowledge path; move to raw evidence/local-only area or delete |
| `src/pui/puiDddl.js` | DDDL payload intentionally stores source file/path and full PUI JSON | Keep only as local raw interchange for `pui-edit`; explicitly mark non-knowledge, non-MCP |
| `src/pui/puiDddlExportService.js` | Exports raw DDDL artifacts and report with source-root details | Keep local-only; do not feed final knowledge pipeline directly |
| `.local/internal-tools/build-pui-knowledgebase.js` | Builds a “knowledgebase” by exporting raw DDDL, promoting it, and activating libraries | Remove or rename as unsafe local experiment |
| `.local/internal-tools/build-pui-catalog.js` | Mixes safe neutral catalog generation with unsafe DDDL promotion and AI library activation | Split into safe catalog build vs local raw export tooling |
| `src/ai/aiKnowledgePatternLibrary.js` | Derives reusable pattern cards from an unsafe persisted DDDL library | Rebuild against privacy-gated final catalog only |
| `src/ai/knowledgeBaseService.js` | Consumer surface is okay, but currently backed by unsafe upstream persistence | Keep interface idea; replace backing store |
| `src/analyze/analyzePipeline.js` | Auto-loads active pattern registries and refreshes AI library during analyze | Remove auto-promotion/activation from analyze path |
| `src/ai/knowledgeProjection.js` | Injects mutable knowledge library summaries into `ai-knowledge.json` | Keep only after knowledge source is privacy-gated and explicit |
| `src/mcp/mcpTools.js` / `src/mcp/mcpServer.js` | Exposes `zeus.knowledge` backed by current local knowledge library | Freeze or restrict until backed by final safe schema |
| `src/api/zeusApi.js` | Exposes `readKnowledge()` from current knowledge library | Rebind to final safe catalog only |
| `docs/mcp/operator-guide.md` and `docs/tool-catalog.md` | Documentation is out of sync with the current `zeus.knowledge` surface, which indicates the feature is not yet stable/governed | Update only after the backing model is redesigned and privacy-gated |
| `tests/pui-dddl-knowledgebase.test.js` | Treats persistent template KB as correct behavior | Replace with tests for raw evidence isolation or remove |
| `tests/ai-knowledge-pattern-library.test.js` | Normalizes derived reusable library built from persisted templates | Replace with final-catalog tests |
| `tests/knowledge-base-service.test.js` | Proves edge sanitization, but still accepts unsafe upstream DDDL storage | Rewrite to use only privacy-passed final catalog fixtures |
| `tests/zeus-api.test.js` | Normalizes API knowledge from DDDL-ingest path | Rewrite to final safe catalog path |
| `.zeus/knowledge/**` | Current generated artifacts include raw/sensitive/reconstructable data and should not be committed | Remove local artifacts and keep ignored |

## 20. Which Existing Files Currently Risk Leakage

Highest-risk current files:

- `.zeus/knowledge/pui-dddl/templates/*.json`
- `.zeus/knowledge/pui-dddl/libraries/*.json`
- `.zeus/knowledge/ai-knowledge-patterns/libraries/*.json`
- `.zeus/knowledge/pui-patterns/catalogs/*.json`
- output paths produced by `src/pui/puiDddlExportService.js`
- reports produced by `.local/internal-tools/build-pui-knowledgebase.js`

Why:

- they preserve source-shaped UI structure
- they contain provenance fields
- they may retain labels, captions, record format names, field names, upload targets, and paths
- they live under `knowledge`, which falsely implies safety

## 21. Recommended Removals / Refactorings

### Remove or quarantine now

- stop using `src/pui/puiDddlKnowledgeBase.js` as a knowledgebase
- remove or quarantine `.local/internal-tools/build-pui-knowledgebase.js`
- stop persisting raw template libraries under `.zeus/knowledge/`

### Refactor next

- split `.local/internal-tools/build-pui-catalog.js` into:
  - safe neutral catalog generation
  - local raw DDDL export tooling
- remove knowledge activation/refresh behavior from `src/analyze/analyzePipeline.js`
- replace `src/ai/aiKnowledgePatternLibrary.js` input source with a privacy-passed final catalog
- rework `src/ai/knowledgeBaseService.js`, `src/api/zeusApi.js`, and `src/mcp/mcpTools.js` to read `project-neutral-knowledge.json`

### Documentation updates needed

- explicitly mark DDDL as raw local interchange, not reusable knowledge
- document the three-layer model and “raw never becomes final knowledge” rule
- document MCP rule: final safe layer only
- bring `docs/mcp/operator-guide.md` and `docs/tool-catalog.md` back into sync only after the new safe knowledge surface is defined

## 22. Recommended Next Codex Task

Recommended next task:

Build the knowledge pipeline skeleton and privacy gate without expanding features.

Concrete scope:

1. Create `src/knowledge/` modules and schemas for raw, sanitized, and final layers.
2. Add a strict privacy gate with synthetic tests.
3. Re-route neutral PUI extraction into `output/knowledge/<run-id>/project-neutral-knowledge.json`.
4. Remove analyze-time activation of current PUI/DDDL knowledge registries.
5. Disable or stub `zeus.knowledge` until it reads only the new final safe artifact.

## Appendix: Repository Assessment Notes

Commands run during this assessment:

- `git status --short --branch`
- `find . -maxdepth 3 -type f | sort | sed 's#^\\./##' | head -200`
- `npm test`
- targeted `rg`/`sed` inspection across `src`, `docs`, `tests`, `.local/internal-tools`, and `.zeus`

Observed test status before changes:

- `npm test` failed in `tests/reproducible-output.test.js`
- failure: reproducible output changed in `analyze-run-manifest.json`
- this is a pre-existing regression relative to this architecture task, not a knowledgebase-specific finding
