# V2 Roadmap

## Status

Zeus already has a substantial V1 in place:

- IBM i source fetch with `sftp`, `jt400`, and `ftp` transport paths
- local source collection and heuristic scanning
- deterministic dependency graph and cross-program graph artifacts
- impact analysis
- DB2 metadata export and bounded test-data extraction
- AI-ready context, prompt generation, reports, viewer output, and portable bundles

The March 16, 2026 architecture review conclusion is straightforward:

- the V1 foundation is real and usable
- the next phase should focus on source fidelity, analysis depth, scalability, and reusable architecture boundaries
- Windows-readable source export and normalization is the most urgent gap to close

## V2 Priorities

### P1: Source Fidelity, Analysis Depth, and Platform Hardening

#### IBM i source fidelity and Windows compatibility

- [#55](https://github.com/gzeuner/zeus-rpg-promptkit/issues/55) Guarantee UTF-8 IBM i Source Export and Windows-Readable Local Files
- [#56](https://github.com/gzeuner/zeus-rpg-promptkit/issues/56) Add Encoding Detection and Source Normalization to the Analyze Pipeline
- [#57](https://github.com/gzeuner/zeus-rpg-promptkit/issues/57) Persist Source Provenance and Fetch Metadata for Imported Members
- [#58](https://github.com/gzeuner/zeus-rpg-promptkit/issues/58) Resolve Duplicate Member Names with Source-File-Aware Program Identity

#### Better IBM i and RPG understanding

- [#39](https://github.com/gzeuner/zeus-rpg-promptkit/issues/39) Build an RPG Pattern Corpus and Detection Benchmark Suite
- [#40](https://github.com/gzeuner/zeus-rpg-promptkit/issues/40) Add Procedure-Level and Call-Site Analysis for RPGLE
- [#41](https://github.com/gzeuner/zeus-rpg-promptkit/issues/41) Detect Service Programs, Modules, and Binder Directories
- [#42](https://github.com/gzeuner/zeus-rpg-promptkit/issues/42) Classify File Usage and Improve Embedded SQL Semantics
- [#59](https://github.com/gzeuner/zeus-rpg-promptkit/issues/59) Add Source-Type Classification and Dedicated CL/DDS Scanners

#### Architecture quality, determinism, and scalability

- [#43](https://github.com/gzeuner/zeus-rpg-promptkit/issues/43) Introduce an Extensible Analyzer Plugin Pipeline
- [#44](https://github.com/gzeuner/zeus-rpg-promptkit/issues/44) Add Incremental Analysis Caching and Artifact Reuse
- [#45](https://github.com/gzeuner/zeus-rpg-promptkit/issues/45) Add Structured Logging, Diagnostics, and Run Manifests
- [#46](https://github.com/gzeuner/zeus-rpg-promptkit/issues/46) Add Configuration Schema Validation and Profile Inheritance
- [#47](https://github.com/gzeuner/zeus-rpg-promptkit/issues/47) Expand Test Infrastructure with Contract, Corpus, and Performance Suites
- [#60](https://github.com/gzeuner/zeus-rpg-promptkit/issues/60) Split Analyze Orchestration from Artifact Writers for CLI and UI Reuse
- [#61](https://github.com/gzeuner/zeus-rpg-promptkit/issues/61) Make Analysis Outputs Reproducible with a Stable-Timestamp Mode
- [#62](https://github.com/gzeuner/zeus-rpg-promptkit/issues/62) Scale Cross-Program Analysis for Large IBM i Source Trees
- [#63](https://github.com/gzeuner/zeus-rpg-promptkit/issues/63) Harden DB2 Test-Data Governance and Extraction Auditability

### P2: Prompt, Workflow, and Bundle Quality

- [#48](https://github.com/gzeuner/zeus-rpg-promptkit/issues/48) Build a Prompt Registry, Versioning Model, and Validation Harness
- [#49](https://github.com/gzeuner/zeus-rpg-promptkit/issues/49) Add Specialized Prompt Packs for Architecture, Modernization, Refactoring, and Test Generation
- [#50](https://github.com/gzeuner/zeus-rpg-promptkit/issues/50) Add Workflow Presets and Guided Analysis Bundles
- [#51](https://github.com/gzeuner/zeus-rpg-promptkit/issues/51) Add Best-Practice Review Workflows for Modernization and Dependency Risk
- [#64](https://github.com/gzeuner/zeus-rpg-promptkit/issues/64) Make the Architecture Viewer Offline-Capable and Version-Stable

### P3: Local UI and Usability

- [#52](https://github.com/gzeuner/zeus-rpg-promptkit/issues/52) Build a Local Web UI Shell and Analysis API Layer
- [#53](https://github.com/gzeuner/zeus-rpg-promptkit/issues/53) Add Interactive Views for Graphs, DB2 Metadata, Test Data, and Prompt Preview

## What Success Looks Like

V2 should be considered successful when:

- fetched IBM i sources are readable and scannable on Windows by default
- source provenance, encoding, and ambiguity are explicit instead of implicit
- larger repositories can be analyzed with stable diagnostics and repeatable artifact contracts
- prompt packs and guided workflows build on the same core context model
- a local UI can reuse shared analysis contracts instead of reimplementing core logic
