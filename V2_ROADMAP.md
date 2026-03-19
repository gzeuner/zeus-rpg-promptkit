# V2 Roadmap

## North Star

Zeus should evolve into an IBM i analysis system that:

- understands RPG and adjacent IBM i source deeply
- turns that source into structured semantic knowledge
- enriches that knowledge with provenance, DB2 metadata, and repository relationships
- projects the right evidence into high-quality AI context
- supports architecture review, defect analysis, impact analysis, and modernization planning

The roadmap is therefore shifting from "more generated files" to "better semantic understanding and better workflow-specific context."

## Current V1 Position

Zeus already delivers a real baseline:

- IBM i source fetch with `sftp`, `jt400`, and `ftp`
- UTF-8-oriented source export during fetch
- heuristic RPG scanning and dependency extraction
- deterministic dependency and cross-program graph artifacts
- DB2 metadata export and bounded test-data extraction
- AI-ready context, prompt generation, reports, viewer output, and portable bundles
- analyze manifests and bundle manifests as emerging workflow contracts

The foundation is strong enough to support V2. The main gap is semantic depth, not basic plumbing.

## Strategic Decisions

### 1. Semantic Core First

The next phase must define and stabilize a canonical IBM i analysis model before expanding prompts, UI, or generic extension points.

### 2. Provenance and Identity Before Enterprise Scale

Duplicate member names, fetch provenance, encoding validation, and repository-aware identity must become explicit system contracts.

### 3. Typed IBM i Intelligence Over Generic Extensibility

Deeper RPG, SQL, CL, DDS, and DB2 understanding matters more right now than a generic plugin architecture.

### 4. AI Knowledge Projection Over Prompt Proliferation

Prompt quality will improve only if Zeus provides a stronger AI-facing knowledge projection and better evidence selection.

### 5. CLI-First Workflows

Guided workflows and better artifact navigation should land before any significant local UI investment. GUI ideas remain valid, but they do not replace the CLI.

## Short-Term Priorities

### Track A: Semantic Core and Source Fidelity

Highest-impact work for the next phase:

- [#65](https://github.com/gzeuner/zeus-rpg-promptkit/issues/65) Define a Canonical IBM i Analysis Model and Evidence Schema
- [#66](https://github.com/gzeuner/zeus-rpg-promptkit/issues/66) Build a Repository Source Catalog with Provenance-Aware Member Identity
- [#67](https://github.com/gzeuner/zeus-rpg-promptkit/issues/67) Add a Fetch Import Manifest and Source Integrity Verification Gate
- [#68](https://github.com/gzeuner/zeus-rpg-promptkit/issues/68) Rebuild Cross-Program Analysis on a Repository Catalog and Reusable Scan Cache
- [#55](https://github.com/gzeuner/zeus-rpg-promptkit/issues/55) Guarantee UTF-8 IBM i Source Export and Windows-Readable Local Files
- [#56](https://github.com/gzeuner/zeus-rpg-promptkit/issues/56) Add Encoding Detection and Source Normalization to the Analyze Pipeline
- [#57](https://github.com/gzeuner/zeus-rpg-promptkit/issues/57) Persist Source Provenance and Fetch Metadata for Imported Members
- [#58](https://github.com/gzeuner/zeus-rpg-promptkit/issues/58) Resolve Duplicate Member Names with Source-File-Aware Program Identity
- [#60](https://github.com/gzeuner/zeus-rpg-promptkit/issues/60) Split Analyze Orchestration from Artifact Writers for CLI and UI Reuse
- [#61](https://github.com/gzeuner/zeus-rpg-promptkit/issues/61) Make Analysis Outputs Reproducible with a Stable-Timestamp Mode

Target outcome:

- one trusted semantic core
- one trusted repository identity model
- one trusted source-import contract

### Track B: Deeper RPG and IBM i Semantics

Once the semantic core is in place, the next priority is analysis fidelity:

- [#69](https://github.com/gzeuner/zeus-rpg-promptkit/issues/69) Add Procedure, Prototype, and Subprocedure Extraction for RPGLE
- [#70](https://github.com/gzeuner/zeus-rpg-promptkit/issues/70) Add Service Program, Module, and Binder Relationship Modeling
- [#71](https://github.com/gzeuner/zeus-rpg-promptkit/issues/71) Add Native File I/O and Record-Format Usage Analysis
- [#72](https://github.com/gzeuner/zeus-rpg-promptkit/issues/72) Add an Embedded SQL Semantic Analyzer with Intent and Dynamic SQL Flags
- [#39](https://github.com/gzeuner/zeus-rpg-promptkit/issues/39) Build an RPG Pattern Corpus and Detection Benchmark Suite
- [#40](https://github.com/gzeuner/zeus-rpg-promptkit/issues/40) Add Procedure-Level and Call-Site Analysis for RPGLE
- [#41](https://github.com/gzeuner/zeus-rpg-promptkit/issues/41) Detect Service Programs, Modules, and Binder Directories
- [#42](https://github.com/gzeuner/zeus-rpg-promptkit/issues/42) Classify File Usage and Improve Embedded SQL Semantics
- [#59](https://github.com/gzeuner/zeus-rpg-promptkit/issues/59) Add Source-Type Classification and Dedicated CL/DDS Scanners

Target outcome:

- Zeus understands more than names and regex hits
- procedures, files, SQL, and IBM i binding concepts become explicit analysis objects

## Mid-Term Priorities

### Track C: AI Context and Prompt Quality

After the semantic model is stronger, the AI layer should mature around it:

- [#73](https://github.com/gzeuner/zeus-rpg-promptkit/issues/73) Introduce an AI Knowledge Projection Layer for Prompt-Ready Context
- [#74](https://github.com/gzeuner/zeus-rpg-promptkit/issues/74) Add Salience-Based Evidence Packs and Token-Budgeted Context Assembly
- [#75](https://github.com/gzeuner/zeus-rpg-promptkit/issues/75) Add Prompt Contracts and a Fixture-Driven Evaluation Harness
- [#77](https://github.com/gzeuner/zeus-rpg-promptkit/issues/77) Link DB2 Metadata and Test Data Back to Source Evidence and AI Context
- [#48](https://github.com/gzeuner/zeus-rpg-promptkit/issues/48) Build a Prompt Registry, Versioning Model, and Validation Harness
- [#49](https://github.com/gzeuner/zeus-rpg-promptkit/issues/49) Add Specialized Prompt Packs for Architecture, Modernization, Refactoring, and Test Generation

Target outcome:

- prompt-ready context is high-signal, evidence-backed, and token-aware
- prompt packs become workflow tools rather than thin template variants

### Track D: Guided Workflows and Output Navigation

The CLI should become easier to use for real analysis tasks:

- [#76](https://github.com/gzeuner/zeus-rpg-promptkit/issues/76) Add Task-Oriented Analysis Indexes and Guided CLI Modes
- [#50](https://github.com/gzeuner/zeus-rpg-promptkit/issues/50) Add Workflow Presets and Guided Analysis Bundles
- [#51](https://github.com/gzeuner/zeus-rpg-promptkit/issues/51) Add Best-Practice Review Workflows for Modernization and Dependency Risk
- [#46](https://github.com/gzeuner/zeus-rpg-promptkit/issues/46) Add Configuration Schema Validation and Profile Inheritance
- [#47](https://github.com/gzeuner/zeus-rpg-promptkit/issues/47) Expand Test Infrastructure with Contract, Corpus, and Performance Suites
- [#62](https://github.com/gzeuner/zeus-rpg-promptkit/issues/62) Scale Cross-Program Analysis for Large IBM i Source Trees
- [#63](https://github.com/gzeuner/zeus-rpg-promptkit/issues/63) Harden DB2 Test-Data Governance and Extraction Auditability
- [#64](https://github.com/gzeuner/zeus-rpg-promptkit/issues/64) Make the Architecture Viewer Offline-Capable and Version-Stable

Target outcome:

- developers can choose a workflow instead of manually assembling files
- artifacts remain scalable, auditable, and offline-friendly

## Long-Term Priorities

### Track E: Local UI on Top of Stable Contracts

UI remains a valid direction, but only after the semantic core and workflow contracts stabilize:

- [#52](https://github.com/gzeuner/zeus-rpg-promptkit/issues/52) Build a Local Web UI Shell and Analysis API Layer
- [#53](https://github.com/gzeuner/zeus-rpg-promptkit/issues/53) Add Interactive Views for Graphs, DB2 Metadata, Test Data, and Prompt Preview

Constraint:

- the CLI remains the primary delivery mechanism
- the UI must consume shared analysis contracts instead of re-implementing analysis logic

## Deprioritized or Reframed

- [#43](https://github.com/gzeuner/zeus-rpg-promptkit/issues/43) Introduce an Extensible Analyzer Plugin Pipeline
  - not a near-term priority
  - first stabilize the canonical model and typed analyzers
- [#45](https://github.com/gzeuner/zeus-rpg-promptkit/issues/45) Add Structured Logging, Diagnostics, and Run Manifests
  - the repository already has staged diagnostics and analyze manifests
  - remaining improvements should be folded into artifact-contract hardening instead of treated as a separate roadmap pillar

## What Success Looks Like

V2 should be considered successful when:

- fetched IBM i sources have trusted provenance, encoding validation, and repository identity
- the analyzer models procedures, binding relationships, file usage, and SQL semantics with evidence
- prompts are built from a dedicated AI knowledge projection instead of thin report summaries
- guided CLI workflows help users choose the right artifacts for architecture, impact, modernization, and defect analysis
- scale, reproducibility, and offline portability are strong enough for larger IBM i estates
