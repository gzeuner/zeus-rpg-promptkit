---
Title: ADR-009 Project Intelligence Ownership Split
Description: Community and Commercial ownership boundaries for Zeus Project Intelligence contracts, default backends, and entitlement-gated operations.
Last Updated: 2026-07-22
---

# ADR-009: Project Intelligence Ownership Split

**Status:** Accepted for ZPI-01 documentation baseline

## Context

Zeus already defines a stable open-core boundary in ADR-006. Zeus Project Intelligence adds a
persistent, versioned project-knowledge system that spans source evidence, derived symbols,
relationships, retrieval, and bounded context assembly.

Without an explicit ownership split, two failure modes become likely:

- Community ships only inert contracts while useful local indexing and retrieval move behind a
  private implementation.
- Commercial code duplicates Community infrastructure or leaks proprietary orchestration into the
  Apache-2.0 core for convenience.

ZPI must remain local-first, offline by default, and compatible with the existing capability
registry, safety model, and thin CLI/MCP projection strategy.

Package 09 is closed. ZPI-01 must not reopen Package 09 or introduce new live IBM i behavior.

## Decision

### Community ownership

Community owns the neutral, Apache-2.0 project-intelligence baseline:

- versioned knowledge contracts and schema identifiers
- evidence, source-span, provenance, derivation, and safety contracts
- project, snapshot, analyzer-run, and migration contracts
- store, content, search, and retrieval service provider interfaces
- local default persistence and retrieval backends
- full rebuild and read-only query behavior
- deterministic bounded context-package contracts and default offline policy
- artifact readers, validators, contract tests, and fail-closed reason-code catalogs
- thin CLI, API, and MCP-neutral capability contracts and adapters

Community must remain complete and useful without any Commercial module. A user must be able to:

- build project knowledge from trusted local inputs
- reopen and validate published snapshots
- run deterministic local lexical retrieval
- assemble bounded local context packages under the Community default policy
- read and export Community-owned artifacts without entitlement

### Commercial ownership

Commercial owns entitlement-gated, separately distributed extensions only:

- project-level registration and orchestration beyond the Community baseline
- advanced incremental refresh planning and execution
- advanced retrieval ranking or expansion policies that extend, not replace, Community contracts
- advanced context assembly policies and redacted commercial diagnostics
- resource-governance packs, entitlement-aware operations, and future enterprise integrations

Commercial must depend only on public Community contracts and registration surfaces. Community must
never depend on Commercial code, entitlements, or proprietary store formats.

### Capability and artifact matrix

| Area | Community | Commercial |
| ---- | --------- | ---------- |
| Contracts and schemas | owns | may consume and extend only through public versioned contracts |
| SQLite metadata store | owns default implementation | may use through public interfaces only |
| Content-addressed evidence store | owns default implementation | may use through public interfaces only |
| Lucene lexical retrieval | owns default implementation | may add registered ranking or policy layers |
| Full rebuild | owns | may orchestrate or invoke through public capability surfaces |
| Incremental refresh | baseline invalidation rules and contracts | advanced planning and execution |
| Context assembly | owns default offline bounded policy | may register advanced policy packs |
| Artifact readers and validators | owns | may add entitlement-free readers for private artifact contracts |
| CLI/MCP surface | thin neutral projections | paid capabilities appear only when registered |
| Entitlement enforcement | forbidden | owns |
| Proprietary diagnostics or policy data | forbidden | owns |

### Non-negotiable boundary rules

- Community default backends must not be dormant paid features.
- Commercial modules must not require Community core to branch on product ID, edition, or
  entitlement state.
- Any persisted format needed to read Community-owned project knowledge must remain documented and
  readable without Commercial code.
- Retrieval hits, rankings, and context packages are derived aids, not canonical source evidence.
- Package 09 remains closed. ZPI does not add live IBM i compile, execute, or differential flows.

## Consequences

- ZPI can evolve as an open-core system without making Community a stub.
- Commercial features can add value through registration and policy without redefining core data
  ownership.
- Later implementation packages must treat Community full rebuild and artifact readers as the
  reference behavior that Commercial extensions may optimize but not replace.

## Alternatives considered

- **Commercial owns all useful project-intelligence operations.** Rejected because it would make
  Community contracts nominal only and violate the open-core baseline.
- **Duplicate contracts in Commercial.** Rejected because schema forks would fragment compatibility,
  testing, and artifact portability.
- **Put entitlement checks into Community adapters.** Rejected because ADR-006 keeps entitlement out
  of the core.
- **Reopen Package 09 for project-intelligence runtime hooks.** Rejected because ZPI-01 is a docs
  package and Package 09 is explicitly closed.
