# V2 Roadmap

## Goal

Zeus should become a stable, practical, developer-friendly IBM i analysis tool that generates high-quality AI prompts from rich structured evidence for:

- RPG and ILE RPGLE understanding
- architecture review
- documentation generation
- defect and issue analysis
- dependency and impact analysis
- modernization planning

The project goal is not "more files." The goal is trusted IBM i knowledge projection.

## Non-Negotiables

### 1. Confidentiality

Reference examples are for architectural learning only.

Do not carry business-specific names from the reference archive into:

- roadmap text
- issues
- prompts
- fixtures
- reports
- code comments
- commit messages

Use generic placeholders only.

### 2. Windows-readable source files

Local IBM i source must be readable on Windows without manual repair.

The effective near-term contract is:

- fetch exports stream files as UTF-8
- import validation proves local readability before analysis
- prompts, reports, and scanners assume UTF-8 input

Until multi-CCSID handling is made consistent end to end, `CCSID 1208` should be treated as the only fully trusted local analysis contract.

### 3. Read-only enrichment first

The best ideas from the reference toolset are read-only analysis patterns. Zeus should adopt those patterns as safe enrichments and workflows, not as mutation-oriented operational scripts.

## Current State

Zeus already has a credible V1 foundation:

- IBM i source fetch with `sftp`, `jt400`, and `ftp`
- UTF-8-oriented stream-file export as the default fetch contract
- import manifests and source validation before analysis
- heuristic RPG scanning for dependencies, procedures, native file I/O, and embedded SQL
- canonical analysis output plus derived reports, prompts, graphs, impact analysis, viewer output, and bundles

The main gap is no longer plumbing. The gap is deeper IBM i semantics, stronger workflow packaging, and safer sharing.

## Lessons from the Reference Toolset

Detailed notes live in [docs/reference-toolset-integration-analysis.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/reference-toolset-integration-analysis.md).

What Zeus should reuse in generalized form:

- richer DB2 catalog enrichment
- dual SQL-name and system-name handling
- catalog-backed classification for unresolved external objects
- IFS path scanning and broad search workflows
- structured read-only diagnostic packs
- stronger output sanitization and sharing discipline

What Zeus should not reuse:

- case-specific scripts, prompts, and logs
- hardcoded machine paths or library defaults
- compiled artifacts in the repository
- monolithic script workflows
- raw logs as the primary artifact contract
- direct member downloads stored as plain `.txt` as a primary strategy

## Execution Order

### Track A: Source Fidelity and Windows Readability

This remains the first gate because every later workflow depends on trustworthy local source text.

- [#55](https://github.com/gzeuner/zeus-rpg-promptkit/issues/55) Guarantee UTF-8 IBM i Source Export and Windows-Readable Local Files
- [#56](https://github.com/gzeuner/zeus-rpg-promptkit/issues/56) Add Encoding Detection and Source Normalization to the Analyze Pipeline
- [#57](https://github.com/gzeuner/zeus-rpg-promptkit/issues/57) Persist Source Provenance and Fetch Metadata for Imported Members
- [#58](https://github.com/gzeuner/zeus-rpg-promptkit/issues/58) Resolve Duplicate Member Names with Source-File-Aware Program Identity
- [#93](https://github.com/gzeuner/zeus-rpg-promptkit/issues/93) Add Fetch Transport Parity and Encoding Contract Tests for Windows-Readable Sources

Immediate interpretation:

- keep `CCSID 1208` as the trusted local analysis contract
- do not treat arbitrary positive CCSID values as production-ready until fetch, fallback export, manifest metadata, and validation all agree on one encoding model

### Track B: DB2 Catalog Intelligence

The reference toolset shows that IBM i catalog depth is one of the fastest ways to improve real-world analysis quality.

- [#86](https://github.com/gzeuner/zeus-rpg-promptkit/issues/86) Promote DB2 Catalog Enrichment to a First-Class Analysis Stage
- [#85](https://github.com/gzeuner/zeus-rpg-promptkit/issues/85) Model Triggers, Derived Objects, and Constraint Rules in Canonical Analysis
- [#87](https://github.com/gzeuner/zeus-rpg-promptkit/issues/87) Resolve DB2 Objects by SQL Name and System Name Across Analysis
- [#77](https://github.com/gzeuner/zeus-rpg-promptkit/issues/77) Link DB2 Metadata and Test Data Back to Source Evidence and AI Context

Target outcome:

- DB2 objects have stronger identity
- tables, triggers, dependents, and constraints become first-class analysis objects
- prompts and reports stop treating DB2 metadata as a thin appendix

### Track C: Deeper IBM i Object Resolution

Source-only reasoning is not enough for large repositories or incomplete fetches.

- [#88](https://github.com/gzeuner/zeus-rpg-promptkit/issues/88) Discover External IBM i Objects for Unresolved Calls via System Catalogs
- [#70](https://github.com/gzeuner/zeus-rpg-promptkit/issues/70) Add Service Program, Module, and Binder Relationship Modeling
- [#72](https://github.com/gzeuner/zeus-rpg-promptkit/issues/72) Add an Embedded SQL Semantic Analyzer with Intent and Dynamic SQL Flags
- [#59](https://github.com/gzeuner/zeus-rpg-promptkit/issues/59) Add Source-Type Classification and Dedicated CL/DDS Scanners

Target outcome:

- unresolved external references shrink
- non-source catalog evidence becomes explicit and auditable
- IBM i object identity becomes stronger than basename matching

### Track D: Search and Investigation Workflows

The reference archive is strongest where it supports investigation work quickly. Zeus should adopt that strength, but with structured contracts instead of one-off scripts.

- [#89](https://github.com/gzeuner/zeus-rpg-promptkit/issues/89) Add Optional IFS Path Scanning and Path-Usage Reporting
- [#90](https://github.com/gzeuner/zeus-rpg-promptkit/issues/90) Add Full-Text Search Workflows for Local Sources and Imported IBM i Artifacts
- [#91](https://github.com/gzeuner/zeus-rpg-promptkit/issues/91) Introduce Structured Read-Only Diagnostic Query Packs for IBM i Investigation
- [#76](https://github.com/gzeuner/zeus-rpg-promptkit/issues/76) Add Task-Oriented Analysis Indexes and Guided CLI Modes
- [#50](https://github.com/gzeuner/zeus-rpg-promptkit/issues/50) Add Workflow Presets and Guided Analysis Bundles
- [#51](https://github.com/gzeuner/zeus-rpg-promptkit/issues/51) Add Best-Practice Review Workflows for Modernization and Dependency Risk

Target outcome:

- developers choose a task, not a pile of files
- broad search and targeted diagnostics sit next to semantic analysis instead of outside it

Current workflow packaging now includes:

- guided analyze modes for architecture, documentation, defect/error analysis, modernization, and impact
- named workflow presets for `architecture-review`, `modernization-review`, `onboarding`, and `dependency-risk`
- workflow-tagged bundle manifests so shared archives can describe which preset produced them
- review-oriented metadata on modes and presets so manifests, analysis indexes, and shared bundle README files identify intended audience, key questions, expected decisions, interpretation guidance, and recommended outputs
- opt-in `--safe-sharing` outputs and bundles that preserve workflow structure while redacting identifiers, source paths, and extracted values with stable placeholders

### Track E: AI Knowledge Projection and Safe Sharing

The AI layer must improve in two directions at once: better evidence and safer outputs.

- [#73](https://github.com/gzeuner/zeus-rpg-promptkit/issues/73) Introduce an AI Knowledge Projection Layer for Prompt-Ready Context
- [#74](https://github.com/gzeuner/zeus-rpg-promptkit/issues/74) Add Salience-Based Evidence Packs and Token-Budgeted Context Assembly
- [#75](https://github.com/gzeuner/zeus-rpg-promptkit/issues/75) Add Prompt Contracts and a Fixture-Driven Evaluation Harness
- [#92](https://github.com/gzeuner/zeus-rpg-promptkit/issues/92) Add Confidentiality-Aware Redaction for Prompts, Reports, and Shared Bundles
- [#94](https://github.com/gzeuner/zeus-rpg-promptkit/issues/94) Build a Sanitized IBM i Fixture Corpus for Catalog, IFS, and Prompt Regression Testing

Target outcome:

- prompts become workflow-specific and evidence-backed
- shared outputs can be sanitized without losing technical usefulness
- tests can grow without introducing confidential example data

### Track F: Release Hardening and Scale

The remaining supporting work still matters because Zeus is becoming a practical release candidate, not just a prototype.

- [#60](https://github.com/gzeuner/zeus-rpg-promptkit/issues/60) Split Analyze Orchestration from Artifact Writers for CLI and UI Reuse
- [#61](https://github.com/gzeuner/zeus-rpg-promptkit/issues/61) Make Analysis Outputs Reproducible with a Stable-Timestamp Mode
- [#62](https://github.com/gzeuner/zeus-rpg-promptkit/issues/62) Scale Cross-Program Analysis for Large IBM i Source Trees
- [#63](https://github.com/gzeuner/zeus-rpg-promptkit/issues/63) Harden DB2 Test-Data Governance and Extraction Auditability
- [#64](https://github.com/gzeuner/zeus-rpg-promptkit/issues/64) Make the Architecture Viewer Offline-Capable and Version-Stable
- [#47](https://github.com/gzeuner/zeus-rpg-promptkit/issues/47) Expand Test Infrastructure with Contract, Corpus, and Performance Suites

## Deprioritized or Reframed

- [#43](https://github.com/gzeuner/zeus-rpg-promptkit/issues/43) Introduce an Extensible Analyzer Plugin Pipeline
  - still not on the critical path
  - stronger typed IBM i analysis is more important than generic extensibility right now
- [#52](https://github.com/gzeuner/zeus-rpg-promptkit/issues/52) Build a Local Web UI Shell and Analysis API Layer
- [#53](https://github.com/gzeuner/zeus-rpg-promptkit/issues/53) Add Interactive Views for Graphs, DB2 Metadata, Test Data, and Prompt Preview
  - valid long-term direction
  - should consume shared contracts instead of shaping them prematurely
- [#45](https://github.com/gzeuner/zeus-rpg-promptkit/issues/45) Add Structured Logging, Diagnostics, and Run Manifests
  - much of this already exists in staged manifests and diagnostics
  - remaining work should be folded into artifact-contract hardening instead of treated as a separate roadmap pillar

## What Success Looks Like

V2 should be considered successful when:

- imported IBM i source arrives locally in a Windows-readable format with trusted provenance and validation
- Zeus models RPG, DB2, native file I/O, and IBM i external object identity with evidence
- prompt generation is driven by workflow-specific knowledge projection instead of thin summaries
- search, diagnostics, architecture review, and modernization workflows are available out of the box
- confidential naming can be removed from shared artifacts without breaking technical usefulness
- the tool is stable enough to use repeatedly on real IBM i repositories, not just sample programs
