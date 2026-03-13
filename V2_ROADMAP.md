# V2 Roadmap: Next Phase

## Architectural Review

### Current strengths
- Clear CLI-centered workflow with deterministic output artifacts.
- Good separation between fetch, scan, context, graph, report, prompt, DB2, and bundle concerns.
- Conservative DB2 integration that fails open instead of breaking analysis.
- Deterministic sorting and normalized identifiers make generated artifacts stable.
- Lightweight Java helpers isolate IBM i / JT400 specifics from the Node.js orchestration layer.
- The new smoke test proves the core V1 analyze and bundle path end-to-end.

### Architectural weaknesses
- `cli/zeus.js` is still a large orchestration hub and mixes argument parsing, config resolution, workflow policy, and execution.
- The analyzer pipeline is service-oriented but not plugin-oriented; new analyzers require manual CLI wiring and context/report changes.
- The RPG scanner is regex-driven and effective for V1, but it has no formal pattern registry, corpus, or benchmark harness.
- Configuration is JSON-only, profile merging is shallow, and there is no schema validation or environment override model.
- Logging is ad hoc (`console.log` / `console.warn`) and there is no structured run manifest for diagnostics.
- Output artifacts are rich, but there is no stable internal API layer for a future UI or automation clients.

### Scalability limitations
- Full-tree rescans on every analyze run will become expensive on large IBM i codebases.
- Cross-program traversal rescans files repeatedly and has no cache or memoization across runs.
- Context construction and prompt generation assume one-shot in-memory processing.
- DB2 enrichment is synchronous per run and has no metadata or sample-data cache.
- The repository currently has smoke coverage only; there are no contract tests, corpus tests, or performance baselines.

### Missing extension points
- No analyzer plugin contract for adding new detectors without touching the CLI pipeline.
- No prompt registry or versioned prompt-pack abstraction.
- No workflow preset abstraction beyond raw CLI flags and profiles.
- No internal service boundary for exposing data to a local web UI.
- No corpus-driven mechanism for learning from public RPG repositories and validating detection regressions.

### Public reference sources for V2 heuristics
These sources are for pattern learning and architectural heuristics only. No third-party code should be copied into this repository.

- `IBM/tobi-example` - Apache License 2.0
  Use as a reference for IBM i object layouts, build conventions, binder directories, and module/service-program relationships.
- `IBM/ibmi-tobi` - Apache License 2.0
  Use as a reference for project metadata, native object build graphs, and IBM i build/runtime structure.
- `IBM/vscode-ibmi-testing` - Apache License 2.0
  Use as a reference for testing workflows and developer ergonomics around IBM i analysis/testing tools.
- `codefori/vscode-rpgle` - MIT License
  Use as a reference for real-world RPG syntax support, editor-oriented parsing expectations, and language coverage gaps.
- `codefori/vscode-ibmi` - MIT License
  Use as a reference for IBM i workspace configuration and local-tooling UX patterns.
- `SJLennon/IBM-i-RPG-Free-CLP-Code` - no license detected
  Treat as read-only reference material only; use for anonymized pattern observation, not reusable code.

## V2 Direction

V2 should evolve Zeus from a useful CLI bundle generator into a professional IBM i architecture intelligence platform:

- deeper RPG / ILE structure understanding
- repeatable AI prompt quality and workflow outcomes
- guided analysis workflows for modernization and risk review
- a UI-ready internal architecture
- operational maturity for large codebases

## Created GitHub Issues

### P1 - architecture and analysis improvements
- `#37` V2: IBM i Architecture Intelligence Platform
- `#39` Build an RPG Pattern Corpus and Detection Benchmark Suite (Feature, P1)
- `#40` Add Procedure-Level and Call-Site Analysis for RPGLE (Feature, P1)
- `#41` Detect Service Programs, Modules, and Binder Directories (Feature, P1)
- `#42` Classify File Usage and Improve Embedded SQL Semantics (Feature, P1)
- `#43` Introduce an Extensible Analyzer Plugin Pipeline (Architecture, P1)
- `#44` Add Incremental Analysis Caching and Artifact Reuse (Architecture, P1)
- `#45` Add Structured Logging, Diagnostics, and Run Manifests (Architecture, P1)
- `#46` Add Configuration Schema Validation and Profile Inheritance (Architecture, P1)
- `#47` Expand Test Infrastructure with Contract, Corpus, and Performance Suites (Architecture, P1)

### P2 - AI templates and workflows
- `#38` V2: Guided Workflows and Interactive Exploration (Epic, P2)
- `#48` Build a Prompt Registry, Versioning Model, and Validation Harness (Feature, P2)
- `#49` Add Specialized Prompt Packs for Architecture, Modernization, Refactoring, and Test Generation (Feature, P2)
- `#50` Add Workflow Presets and Guided Analysis Bundles (Feature, P2)
- `#51` Add Best-Practice Review Workflows for Modernization and Dependency Risk (Feature, P2)

### P3 - GUI and usability
- `#52` Build a Local Web UI Shell and Analysis API Layer (Feature, P3)
- `#53` Add Interactive Views for Graphs, DB2 Metadata, Test Data, and Prompt Preview (Feature, P3)

## Epic (P1)

### Title
V2: IBM i Architecture Intelligence Platform (`#37`)

### Labels
`epic`, `enhancement`, `analysis`, `architecture`, `priority:P1`

### Description
Goal:
Transform Zeus from a single-run analysis CLI into an extensible IBM i architecture intelligence platform with stronger RPG understanding, repeatable workflows, and a UI-ready internal architecture.

Scope (In):
- richer RPG / ILE program structure detection
- analyzer extensibility and plugin seams
- scalable execution for larger repositories
- workflow-ready prompt and report generation
- operational diagnostics and stronger test infrastructure

Scope (Out):
- full compiler-grade RPG parsing in one step
- remote multi-user SaaS platform
- code modification or auto-remediation engine

Architectural outcomes:
- analyzers become composable and easier to extend
- output contracts remain deterministic while becoming richer
- the platform supports future UI and workflow layers without duplicating core logic

Acceptance criteria:
- [ ] V2 analyzers can be added through a documented extension seam
- [ ] The project has a benchmarkable RPG pattern corpus and regression tests
- [ ] Large-repository analysis has caching and structured diagnostics
- [ ] Prompt generation supports versioned prompt packs and validation
- [ ] The V2 platform can serve both CLI workflows and a local UI layer

---

## Issue Backlog

### 1) `#38` V2: Guided Workflows and Interactive Exploration (Epic, P2)
Labels: `epic`, `enhancement`, `workflow`, `ui`, `priority:P2`

Description:
Create the user-facing V2 layer on top of the stronger analyzer core so Zeus can guide developers through repeatable IBM i architecture review, modernization planning, and interactive exploration.

Scope:
- workflow presets and guided run modes
- richer report bundles tuned for specific goals
- local UI foundations for exploring results
- prompt preview and review flows

Acceptance criteria:
- [ ] Guided workflow concepts are defined and implemented as first-class product features
- [ ] V2 workflows can reuse the same core analysis artifacts without special-case forks
- [ ] A local UI foundation exists for exploring graphs, prompts, metadata, and test data

Suggested labels:
`epic`, `enhancement`, `workflow`, `ui`, `priority:P2`

---

### 2) `#39` Build an RPG Pattern Corpus and Detection Benchmark Suite (Feature, P1)
Labels: `analysis`, `rpg`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
The current scanner works well for V1 heuristics but lacks a repeatable benchmark corpus. V2 should introduce a curated pattern corpus and regression harness so scanner improvements are data-driven instead of anecdotal.

Scope:
- define a corpus format for anonymized RPG / SQL pattern cases
- collect pattern categories from public references and internal fixtures
- record expected detections for tables, calls, copy members, procedures, and object types
- add regression reporting for scanner changes

Acceptance criteria:
- [ ] A corpus format and benchmark runner exist in-repo
- [ ] At least one corpus section covers fixed-form RPG, free-form RPG, SQLRPGLE, and ILE patterns
- [ ] Scanner regressions fail CI with readable diagnostics
- [ ] External reference sources and licenses are documented for the corpus inputs

Suggested labels:
`analysis`, `rpg`, `enhancement`, `priority:P1`

---

### 3) `#40` Add Procedure-Level and Call-Site Analysis for RPGLE (Feature, P1)
Labels: `analysis`, `rpg`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
V1 models programs as coarse units. V2 should recognize procedures and call sites so architecture analysis can explain how logic is internally structured and how procedures relate to external calls.

Scope:
- detect `dcl-proc`, `begsr`, exported procedures, and local procedure boundaries
- map call sites to procedure names when deterministically possible
- enrich context and graph outputs with procedure summaries
- keep outputs deterministic and optional when evidence is weak

Acceptance criteria:
- [ ] Procedure declarations are extracted from RPGLE source
- [ ] Procedure-level call relationships are represented in structured output
- [ ] Reports can summarize top procedures and their dependencies
- [ ] Low-confidence detections are marked without breaking existing program-level analysis

Suggested labels:
`analysis`, `rpg`, `enhancement`, `priority:P1`

---

### 4) `#41` Detect Service Programs, Modules, and Binder Directories (Feature, P1)
Labels: `analysis`, `rpg`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
Professional IBM i architecture analysis requires understanding ILE structure beyond plain program calls. V2 should detect modules, service programs, binder directories, and related source artifacts.

Scope:
- detect source-file patterns such as `QSRVSRC`, `QILEGEN`, `QBNDSRC`, and module/service-program metadata when present
- classify module/service-program references separately from simple program calls
- enrich graphs and reports with ILE object types
- document heuristic limits when build metadata is incomplete

Acceptance criteria:
- [ ] Module, service-program, and binder-directory references can be identified from supported source/build hints
- [ ] Graph outputs distinguish program, module, service program, and binder directory nodes
- [ ] Reports explain when ILE structure was detected versus inferred
- [ ] Detection rules are backed by corpus examples or documented references

Suggested labels:
`analysis`, `rpg`, `enhancement`, `priority:P1`

---

### 5) `#42` Classify File Usage and Improve Embedded SQL Semantics (Feature, P1)
Labels: `analysis`, `rpg`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
V1 detects files and SQL statements, but it does not classify how they are used. V2 should infer richer semantics such as read/write intent, join participation, and SQL operation patterns.

Scope:
- classify file usage as input/update/output/reference when evidence exists
- improve SQL extraction around CTEs, aliases, subqueries, and multi-line patterns
- capture SQL operation intent and touched tables with better precision
- expose summarized access patterns in context and reports

Acceptance criteria:
- [ ] File usage categories are emitted when deterministically identifiable
- [ ] SQL detection supports broader real-world patterns than V1
- [ ] Context/report outputs summarize data access intent per object
- [ ] Regression fixtures cover common false-positive and false-negative cases

Suggested labels:
`analysis`, `rpg`, `enhancement`, `priority:P1`

---

### 6) `#43` Introduce an Extensible Analyzer Plugin Pipeline (Architecture, P1)
Labels: `architecture`, `refactoring`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
The current pipeline is service-oriented but centrally wired in the CLI. V2 should define an internal analyzer contract so new detection stages can be added without editing multiple orchestration paths.

Scope:
- define analyzer stage contracts, inputs, outputs, and lifecycle hooks
- move current scan / graph / DB2 / prompt enrichments onto the shared pipeline model
- support stage-level notes, diagnostics, and artifact metadata
- preserve deterministic output ordering

Acceptance criteria:
- [ ] A documented analyzer/stage interface exists
- [ ] Existing core stages can run through the shared pipeline abstraction
- [ ] New stages can be registered without modifying the main CLI control flow in multiple places
- [ ] Stage execution metadata is available for debugging and reporting

Suggested labels:
`architecture`, `refactoring`, `enhancement`, `priority:P1`

---

### 7) `#44` Add Incremental Analysis Caching and Artifact Reuse (Architecture, P1)
Labels: `architecture`, `refactoring`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
Large IBM i repositories will make repeated full scans too expensive. V2 should cache source scans and reusable enrichment artifacts so repeated analyses are materially faster.

Scope:
- cache scan results keyed by file content hash and tool version
- cache cross-program graph sub-results where safe
- reuse DB2 metadata and sample-data artifacts when inputs are unchanged
- expose cache invalidation and cache-status reporting

Acceptance criteria:
- [ ] Repeat analysis runs can reuse cached scan data
- [ ] Cache invalidation is deterministic and documented
- [ ] CLI/report output can indicate cache hits and misses
- [ ] Large-project benchmark data shows measurable improvement

Suggested labels:
`architecture`, `refactoring`, `enhancement`, `priority:P1`

---

### 8) `#45` Add Structured Logging, Diagnostics, and Run Manifests (Architecture, P1)
Labels: `architecture`, `refactoring`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
V1 logging is human-readable but not operationally rich. V2 should emit structured diagnostics that support debugging, benchmarking, and future UI consumption.

Scope:
- introduce log levels and structured event emission
- generate a run manifest with stage timings, warnings, config summary, and artifact inventory
- separate user-facing console output from machine-readable diagnostics
- preserve quiet defaults for normal CLI usage

Acceptance criteria:
- [ ] Structured diagnostics can be enabled without changing business logic
- [ ] A run manifest is generated for analyze executions
- [ ] Stage timings and warnings are captured consistently
- [ ] Human-readable CLI output remains concise by default

Suggested labels:
`architecture`, `refactoring`, `enhancement`, `priority:P1`

---

### 9) `#46` Add Configuration Schema Validation and Profile Inheritance (Architecture, P1)
Labels: `architecture`, `refactoring`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
Configuration is currently simple and useful, but it will become difficult to scale as workflows, prompts, analyzers, and UI settings grow. V2 should formalize config contracts.

Scope:
- define a config schema with validation and defaults
- support profile inheritance / composition
- support environment-variable overrides for secrets and deployment settings
- surface validation errors with actionable guidance

Acceptance criteria:
- [ ] Config files are validated before execution
- [ ] Profiles can inherit and override other profiles predictably
- [ ] Secrets can be supplied without storing them in plain config files
- [ ] Invalid configuration produces clear diagnostics and non-zero exit behavior

Suggested labels:
`architecture`, `refactoring`, `enhancement`, `priority:P1`

---

### 10) `#47` Expand Test Infrastructure with Contract, Corpus, and Performance Suites (Architecture, P1)
Labels: `architecture`, `refactoring`, `enhancement`, `priority:P1`
Part of: `#37`

Description:
The V1 smoke test proves the happy path, but V2 needs layered test coverage that protects analyzer correctness, output contracts, and large-project performance.

Scope:
- add contract tests for JSON/Markdown output shapes
- add corpus-based scanner tests and false-positive / false-negative fixtures
- add performance baselines for scan and graph stages
- define test tiers for unit, contract, smoke, and benchmark runs

Acceptance criteria:
- [ ] Multiple test tiers exist with clear ownership and purpose
- [ ] Output contracts are asserted automatically
- [ ] Performance regressions can be measured and compared over time
- [ ] CI can run at least smoke + contract coverage by default

Suggested labels:
`architecture`, `refactoring`, `enhancement`, `priority:P1`

---

### 11) `#48` Build a Prompt Registry, Versioning Model, and Validation Harness (Feature, P2)
Labels: `ai`, `prompt`, `enhancement`, `priority:P2`
Part of: `#37`

Description:
Prompt generation is currently template-based but not managed as a versioned product surface. V2 should make prompt packs versioned, testable, and comparable.

Scope:
- define prompt registry metadata and version identifiers
- support prompt-pack selection by workflow or profile
- add validation tests for placeholder completeness and output invariants
- enable side-by-side prompt revisions for experimentation

Acceptance criteria:
- [ ] Prompt packs can be versioned and selected explicitly
- [ ] Template validation fails on missing placeholders or malformed outputs
- [ ] Prompt metadata is available in generated artifacts
- [ ] Prompt changes can be tested without manual inspection only

Suggested labels:
`ai`, `prompt`, `enhancement`, `priority:P2`

---

### 12) `#49` Add Specialized Prompt Packs for Architecture, Modernization, Refactoring, and Test Generation (Feature, P2)
Labels: `ai`, `prompt`, `enhancement`, `priority:P2`
Part of: `#37`

Description:
Professional IBM i analysis requires different prompt strategies for different tasks. V2 should ship specialized prompt packs rather than relying on one generic documentation/error-analysis pair.

Scope:
- architecture review prompt pack
- modernization planning prompt pack
- code refactoring prompt pack
- documentation generation prompt pack
- test generation prompt pack

Acceptance criteria:
- [ ] At least four specialized prompt packs are available and documented
- [ ] Prompt packs consume the same shared context model
- [ ] Generated prompts clearly state their intended analysis goal
- [ ] Example workflow docs explain when to use each pack

Suggested labels:
`ai`, `prompt`, `enhancement`, `priority:P2`

---

### 13) `#50` Add Workflow Presets and Guided Analysis Bundles (Feature, P2)
Labels: `workflow`, `analysis`, `enhancement`, `priority:P2`
Related theme: `V2: Guided Workflows and Interactive Exploration`

Description:
Users should not have to assemble every flag combination manually. V2 should ship named workflows that bundle analyzer settings, prompt packs, and outputs around common IBM i analysis goals.

Scope:
- workflow presets such as architecture review, modernization review, onboarding, and dependency risk
- workflow-specific output manifests
- reusable preset configuration format
- CLI entry points or subcommands for guided runs

Acceptance criteria:
- [ ] Named workflows can be executed without manually assembling many flags
- [ ] Each workflow maps to explicit analyzer and prompt settings
- [ ] Generated bundles describe which workflow produced them
- [ ] README and roadmap document the available workflow presets

Suggested labels:
`workflow`, `analysis`, `enhancement`, `priority:P2`

---

### 14) `#51` Add Best-Practice Review Workflows for Modernization and Dependency Risk (Feature, P2)
Labels: `workflow`, `analysis`, `enhancement`, `priority:P2`
Related theme: `V2: Guided Workflows and Interactive Exploration`

Description:
Beyond presets, Zeus should provide opinionated review workflows that encode best-practice questions and artifacts for common IBM i transformation scenarios.

Scope:
- modernization readiness review workflow
- dependency risk analysis workflow
- onboarding documentation workflow
- architecture review workflow with recommended outputs and prompts

Acceptance criteria:
- [ ] Workflow outputs are opinionated and task-specific
- [ ] Each workflow has clear inputs, outputs, and interpretation guidance
- [ ] Review bundles can be shared without extra manual assembly
- [ ] Workflow docs identify intended audience and expected decisions

Suggested labels:
`workflow`, `analysis`, `enhancement`, `priority:P2`

---

### 15) `#52` Build a Local Web UI Shell and Analysis API Layer (Feature, P3)
Labels: `ui`, `frontend`, `enhancement`, `priority:P3`
Related theme: `V2: Guided Workflows and Interactive Exploration`

Description:
The current HTML viewer is useful but narrow. V2 should expose a local UI shell backed by a stable internal API so users can inspect analysis outputs interactively without leaving the workstation.

Scope:
- lightweight local web server or desktop-friendly dev mode
- read-only API for graphs, reports, context, metadata, and prompt artifacts
- dashboard shell for navigation across analysis runs
- preserve full CLI functionality for headless usage

Acceptance criteria:
- [ ] A local UI shell can open and browse analysis runs
- [ ] The UI reads from a stable internal data API rather than reimplementing parsing in the frontend
- [ ] CLI and UI can coexist on the same output contract
- [ ] The first UI slice is read-only and local-only

Suggested labels:
`ui`, `frontend`, `enhancement`, `priority:P3`

---

### 16) `#53` Add Interactive Views for Graphs, DB2 Metadata, Test Data, and Prompt Preview (Feature, P3)
Labels: `ui`, `frontend`, `enhancement`, `priority:P3`
Related theme: `V2: Guided Workflows and Interactive Exploration`

Description:
Once a UI shell exists, users need focused views that make the analysis artifacts explorable and actionable.

Scope:
- architecture graph exploration
- dependency drill-down and impact exploration
- DB2 metadata and test data browsing
- prompt preview and prompt-pack comparison
- artifact cross-linking between graph nodes, reports, and prompts

Acceptance criteria:
- [ ] Users can navigate from a dependency node to related tables, reports, and prompts
- [ ] DB2 metadata and test data are viewable in dedicated UI panels
- [ ] Prompt previews support comparing multiple prompt packs or versions
- [ ] UI views remain usable on larger analysis outputs without freezing

Suggested labels:
`ui`, `frontend`, `enhancement`, `priority:P3`
