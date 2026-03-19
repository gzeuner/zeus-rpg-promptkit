# Architecture Review

## Review Date

2026-03-19

## Scope Reviewed

The review covered the live repository across:

- CLI entry points and command adapters
- fetch/import flow and IBM i source export
- analyze staging, manifests, reports, prompts, and bundle packaging
- scanner depth for RPG, SQL, and mixed IBM i source sets
- dependency graphs, cross-program resolution, and impact analysis
- DB2 metadata and test-data enrichment
- workflow usability, reproducibility, and scalability

## Current System Reality

Zeus is a real V1.

The repository already delivers a coherent CLI workflow:

1. `zeus fetch`
   - exports IBM i source members to stream files
   - downloads them locally through `sftp`, `jt400`, or `ftp`
2. `zeus analyze`
   - collects local sources
   - scans them heuristically
   - builds context, graphs, prompts, reports, viewer output, and manifests
   - enriches analysis with DB2 metadata and bounded test data when available
3. `zeus impact`
   - reuses the generated cross-program graph for reverse dependency analysis
4. `zeus bundle`
   - packages outputs using the analyze manifest as the primary contract

This is not a stub project and not just a prompt generator. It is already an IBM i analysis pipeline with real artifact contracts.

## Module Interaction Summary

- `cli/zeus.js` dispatches to thin command adapters.
- `src/config/runtimeConfig.js` resolves profiles, defaults, and validation.
- `src/fetch/fetchService.js` orchestrates IBM i export plus transport download.
- `src/analyze/analyzePipeline.js` runs the staged analyze flow through `src/analyze/runStages.js`.
- `src/scanner/rpgScanner.js` produces the primary heuristic signals for files, calls, copy members, and SQL.
- `src/context/contextBuilder.js` builds the canonical V1 context artifact consumed by reports and prompts.
- `src/dependency/*.js` builds deterministic single-program and cross-program graph artifacts.
- `src/report/*.js`, `src/prompt/promptBuilder.js`, and `src/viewer/architectureViewerGenerator.js` turn analysis state into human and AI-facing outputs.
- `src/analyze/analyzeRunManifest.js` and `src/bundle/outputBundleBuilder.js` enforce the emerging artifact contract.

## True Goal

The true goal of the project is not merely to emit Markdown prompts.

The real target is:

- deep understanding of IBM i application source
- extraction of structured semantic knowledge
- enrichment of that knowledge with provenance, DB2 metadata, and repository relationships
- projection of the right evidence into task-specific AI context
- support for architecture review, defect analysis, impact analysis, and modernization planning

In short: Zeus should evolve from a useful heuristic artifact generator into an IBM i analysis and AI-context platform.

## Strengths

- The CLI workflow is coherent and already usable end to end.
- The staged analyze runner is simple, explicit, and testable.
- Artifact discipline is strong for a V1: sorted outputs, manifests, checksums, and bundle metadata already exist.
- IBM i and DB2 platform concerns are mostly isolated behind Java helpers instead of leaking through the Node.js codebase.
- Bundle and impact commands reuse analyze outputs instead of inventing parallel models.

## Strategic Gaps

### 1. No explicit semantic core yet

The current `context.json` is useful, but it is still closer to a report-shaped summary than a durable analysis model. Reports, prompts, and graphs are aligned, but they are not yet derived from a clearly defined semantic core.

### 2. Source identity and provenance are not first-class

The system now targets UTF-8 export during fetch, but repository identity is still weak. Cross-program resolution is basename-driven, duplicate member names remain hazardous, and there is no repository-wide source catalog or import manifest that downstream analysis can trust.

### 3. RPG understanding is still heuristic

The scanner detects important surface signals, but Zeus does not yet model:

- procedures and prototypes deeply
- service programs, modules, and binder relationships
- native file I/O semantics
- robust SQL intent and uncertainty

That means Zeus is currently better at dependency hinting than true RPG understanding.

### 4. AI context is useful but not optimized for reasoning

The current prompt system works, but it still depends on summary-oriented context and a blunt source snippet strategy. Evidence ranking, workflow-specific context projection, and prompt contracts are not mature enough for serious modernization or root-cause workflows.

### 5. Workflow quality lags behind artifact richness

The repository creates many useful files, but developers still need to know which artifacts matter for which task. Guided modes, task-oriented indexes, and workflow-specific bundles are still underdeveloped.

### 6. Scale and portability need another step

Cross-program analysis rescans files during traversal. Reproducibility is partial because timestamps still vary. The architecture viewer still depends on a CDN, which weakens offline portability.

## Strategic Direction

The next phase should follow five principles:

1. Semantic core first
   - make the internal IBM i analysis model explicit before adding more outputs
2. Identity and provenance before scale
   - resolve duplicate members, fetch provenance, and source validation before claiming enterprise-grade analysis
3. Typed IBM i analysis before generic extensibility
   - deeper RPG, CL, DDS, SQL, and DB2 understanding matters more than a generic plugin story right now
4. AI knowledge projection, not just more templates
   - prompt quality depends on better context structure and evidence selection
5. CLI-first workflows, UI later
   - the local UI remains valuable, but only after the shared contracts stabilize

## Recommended Priority Order

### Short-Term

- `#65` Define a Canonical IBM i Analysis Model and Evidence Schema
- `#66` Build a Repository Source Catalog with Provenance-Aware Member Identity
- `#67` Add a Fetch Import Manifest and Source Integrity Verification Gate
- `#68` Rebuild Cross-Program Analysis on a Repository Catalog and Reusable Scan Cache
- `#69` Add Procedure, Prototype, and Subprocedure Extraction for RPGLE
- `#70` Add Service Program, Module, and Binder Relationship Modeling
- `#71` Add Native File I/O and Record-Format Usage Analysis
- `#72` Add an Embedded SQL Semantic Analyzer with Intent and Dynamic SQL Flags

### Mid-Term

- `#73` Introduce an AI Knowledge Projection Layer for Prompt-Ready Context
- `#74` Add Salience-Based Evidence Packs and Token-Budgeted Context Assembly
- `#75` Add Prompt Contracts and a Fixture-Driven Evaluation Harness
- `#76` Add Task-Oriented Analysis Indexes and Guided CLI Modes
- `#77` Link DB2 Metadata and Test Data Back to Source Evidence and AI Context

### Supporting Work That Still Matters

- `#55` through `#58` remain necessary to harden the fetch/import contract.
- `#60` through `#64` remain important for reuse, reproducibility, scale, DB2 governance, and offline portability.
- `#39` through `#42` and `#59` remain valid, but they should now be read as part of the deeper semantic-analysis track rather than isolated feature work.

## Reframed Priorities

- `#43` generic analyzer plugins are not on the critical path. A plugin system only becomes valuable after the canonical analysis model is stable.
- `#52` and `#53` stay long-term. UI work should consume the same contracts produced for the CLI, not drive the shape of the core model.
- `#45` is directionally already present through staged diagnostics and manifests. Remaining improvements should be folded into the shared artifact-contract work rather than treated as a separate top-level theme.

## Bottom Line

Zeus already has a credible V1 foundation.

The best next move is not to add more surface area. It is to make IBM i semantics, provenance, and AI-ready evidence first-class so every downstream workflow becomes more trustworthy.
